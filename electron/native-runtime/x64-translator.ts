import { nativeFault } from "./fault.js";
import type { ParsedMachOImage } from "./macho-loader.js";
import {
  NativeRuntimeCode,
  type MvmIrInstruction,
  type MvmTranslatedProgram,
} from "./types.js";

const FORBIDDEN_SCAN_PREFIXES = new Set([
  0x26, 0x2e, 0x36, 0x3e, 0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47,
  0x48, 0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4e, 0x4f, 0x64, 0x65, 0x66, 0x67, 0xf2,
  0xf3,
]);

function hexadecimal(value: number): string {
  return `0x${value.toString(16).padStart(2, "0")}`;
}

function ensureBytes(cursor: number, count: number, textEnd: number): void {
  if (
    !Number.isSafeInteger(cursor) ||
    !Number.isSafeInteger(count) ||
    cursor < 0 ||
    count < 0 ||
    cursor > textEnd ||
    count > textEnd - cursor
  ) {
    throw nativeFault(
      "blocked",
      NativeRuntimeCode.AddressBounds,
      "An x86-64 instruction crosses the executable __TEXT boundary.",
      { cursor, count, textEnd },
    );
  }
}

function byteAt(bytes: Uint8Array, cursor: number, textEnd: number): number {
  ensureBytes(cursor, 1, textEnd);
  const value = bytes[cursor];
  if (value === undefined) {
    throw nativeFault(
      "blocked",
      NativeRuntimeCode.AddressBounds,
      "An x86-64 instruction byte is outside the selected slice.",
      { cursor },
    );
  }
  return value;
}

function uint32At(bytes: Uint8Array, cursor: number, textEnd: number): number {
  ensureBytes(cursor, 4, textEnd);
  return new DataView(bytes.buffer, bytes.byteOffset + cursor, 4).getUint32(0, true);
}

function uint64At(bytes: Uint8Array, cursor: number, textEnd: number): bigint {
  ensureBytes(cursor, 8, textEnd);
  return new DataView(bytes.buffer, bytes.byteOffset + cursor, 8).getBigUint64(0, true);
}

function signedByte(value: number): number {
  return value < 0x80 ? value : value - 0x100;
}

function forbiddenInstruction(bytes: Uint8Array, cursor: number, textEnd: number): string | undefined {
  let opcodeCursor = cursor;
  for (let count = 0; count < 14 && opcodeCursor < textEnd; count += 1) {
    const candidate = byteAt(bytes, opcodeCursor, textEnd);
    if (!FORBIDDEN_SCAN_PREFIXES.has(candidate)) {
      break;
    }
    opcodeCursor += 1;
  }
  if (opcodeCursor >= textEnd) {
    return undefined;
  }

  const first = byteAt(bytes, opcodeCursor, textEnd);
  if (first === 0x0f) {
    ensureBytes(opcodeCursor, 2, textEnd);
    const second = byteAt(bytes, opcodeCursor + 1, textEnd);
    if (second === 0x05) {
      return "syscall";
    }
    if (second === 0x34) {
      return "sysenter";
    }
    if (second === 0x0b) {
      return "ud2";
    }
  }
  const names: Readonly<Record<number, string>> = {
    0xcc: "int3",
    0xcd: "int",
    0xce: "into",
    0xf1: "int1",
    0xf4: "hlt",
    0xfa: "cli",
    0xfb: "sti",
  };
  return names[first];
}

export function translateX64EntryPoint(
  image: ParsedMachOImage,
  maxTranslatedInstructions: number,
): MvmTranslatedProgram {
  const instructions: MvmIrInstruction[] = [];
  const textEnd = image.textFileOffset + image.textFileSize;
  let cursor = image.entryOffset;
  let returned = false;

  while (cursor < textEnd) {
    if (instructions.length >= maxTranslatedInstructions) {
      throw nativeFault(
        "blocked",
        NativeRuntimeCode.TranslationLimit,
        "Translation stopped at the configured instruction limit.",
        { maxTranslatedInstructions, sourceOffset: cursor },
      );
    }

    const forbidden = forbiddenInstruction(image.sliceBytes, cursor, textEnd);
    if (forbidden !== undefined) {
      throw nativeFault(
        "blocked",
        NativeRuntimeCode.ForbiddenInstruction,
        `MVM-IR/1 blocks the ${forbidden} instruction.`,
        { sourceOffset: cursor },
      );
    }

    const first = byteAt(image.sliceBytes, cursor, textEnd);
    if (first === 0x90) {
      instructions.push({ opcode: "nop", sourceOffset: cursor, byteLength: 1 });
      cursor += 1;
    } else if (first === 0xc3) {
      instructions.push({ opcode: "return", sourceOffset: cursor, byteLength: 1 });
      cursor += 1;
      returned = true;
      break;
    } else if (first === 0x55) {
      instructions.push({ opcode: "push-rbp", sourceOffset: cursor, byteLength: 1 });
      cursor += 1;
    } else if (first === 0x5d) {
      instructions.push({ opcode: "pop-rbp", sourceOffset: cursor, byteLength: 1 });
      cursor += 1;
    } else if (first === 0xb8) {
      const immediate = uint32At(image.sliceBytes, cursor + 1, textEnd);
      instructions.push({
        opcode: "move-eax-immediate",
        immediate,
        sourceOffset: cursor,
        byteLength: 5,
      });
      cursor += 5;
    } else if (first === 0x31) {
      ensureBytes(cursor, 2, textEnd);
      const modRm = byteAt(image.sliceBytes, cursor + 1, textEnd);
      if (modRm !== 0xc0) {
        throw nativeFault(
          "unsupported",
          NativeRuntimeCode.UnsupportedOpcode,
          `Unsupported XOR encoding 31 ${hexadecimal(modRm)} at __TEXT+${cursor}.`,
          { sourceOffset: cursor, opcode: `31 ${hexadecimal(modRm)}` },
        );
      }
      instructions.push({ opcode: "xor-eax", sourceOffset: cursor, byteLength: 2 });
      cursor += 2;
    } else if (first === 0x05 || first === 0x2d) {
      const immediate = uint32At(image.sliceBytes, cursor + 1, textEnd);
      instructions.push({
        opcode: first === 0x05 ? "add-eax-immediate" : "sub-eax-immediate",
        immediate,
        sourceOffset: cursor,
        byteLength: 5,
      });
      cursor += 5;
    } else if (first === 0x83) {
      ensureBytes(cursor, 3, textEnd);
      const modRm = byteAt(image.sliceBytes, cursor + 1, textEnd);
      const immediate = signedByte(byteAt(image.sliceBytes, cursor + 2, textEnd));
      if (modRm !== 0xc0 && modRm !== 0xe8) {
        throw nativeFault(
          "unsupported",
          NativeRuntimeCode.UnsupportedOpcode,
          `Unsupported group-1 encoding 83 ${hexadecimal(modRm)} at __TEXT+${cursor}.`,
          { sourceOffset: cursor, opcode: `83 ${hexadecimal(modRm)}` },
        );
      }
      instructions.push({
        opcode: modRm === 0xc0 ? "add-eax-immediate" : "sub-eax-immediate",
        immediate,
        sourceOffset: cursor,
        byteLength: 3,
      });
      cursor += 3;
    } else if (first === 0x48) {
      ensureBytes(cursor, 2, textEnd);
      const second = byteAt(image.sliceBytes, cursor + 1, textEnd);
      if (second === 0x89) {
        ensureBytes(cursor, 3, textEnd);
        const modRm = byteAt(image.sliceBytes, cursor + 2, textEnd);
        if (modRm !== 0xe5) {
          throw nativeFault(
            "unsupported",
            NativeRuntimeCode.UnsupportedOpcode,
            `Unsupported MOV encoding 48 89 ${hexadecimal(modRm)} at __TEXT+${cursor}.`,
            { sourceOffset: cursor },
          );
        }
        instructions.push({ opcode: "move-rbp-rsp", sourceOffset: cursor, byteLength: 3 });
        cursor += 3;
      } else if (second === 0xb8) {
        const immediate = uint64At(image.sliceBytes, cursor + 2, textEnd);
        instructions.push({
          opcode: "move-rax-immediate",
          immediate,
          sourceOffset: cursor,
          byteLength: 10,
        });
        cursor += 10;
      } else if (second === 0x83) {
        ensureBytes(cursor, 4, textEnd);
        const modRm = byteAt(image.sliceBytes, cursor + 2, textEnd);
        const immediate = signedByte(byteAt(image.sliceBytes, cursor + 3, textEnd));
        if (modRm !== 0xc4 && modRm !== 0xec) {
          throw nativeFault(
            "unsupported",
            NativeRuntimeCode.UnsupportedOpcode,
            `Unsupported RSP group-1 encoding 48 83 ${hexadecimal(modRm)} at __TEXT+${cursor}.`,
            { sourceOffset: cursor },
          );
        }
        instructions.push({
          opcode: "adjust-rsp",
          delta: modRm === 0xc4 ? immediate : -immediate,
          sourceOffset: cursor,
          byteLength: 4,
        });
        cursor += 4;
      } else {
        throw nativeFault(
          "unsupported",
          NativeRuntimeCode.UnsupportedOpcode,
          `Unsupported REX.W opcode 48 ${hexadecimal(second)} at __TEXT+${cursor}.`,
          { sourceOffset: cursor },
        );
      }
    } else {
      throw nativeFault(
        "unsupported",
        NativeRuntimeCode.UnsupportedOpcode,
        `Unsupported x86-64 opcode ${hexadecimal(first)} at __TEXT+${cursor}.`,
        { sourceOffset: cursor, opcode: hexadecimal(first) },
      );
    }
  }

  if (!returned) {
    throw nativeFault(
      "blocked",
      NativeRuntimeCode.ProgramDidNotReturn,
      "The translated entry point reaches the end of __TEXT without RET.",
    );
  }

  return {
    irVersion: 1,
    architecture: "x86_64",
    selectedSliceOffset: image.selectedSliceOffset,
    selectedSliceSize: image.selectedSliceSize,
    entryOffset: image.entryOffset,
    entryFileOffset: image.entryFileOffset,
    entryVmAddress: image.entryVmAddress.toString(),
    textFileOffset: image.textFileOffset,
    textFileSize: image.textFileSize,
    instructions,
  };
}
