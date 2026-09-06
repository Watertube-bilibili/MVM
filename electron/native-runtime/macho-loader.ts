import { nativeFault } from "./fault.js";
import { NativeRuntimeCode } from "./types.js";

const MH_MAGIC_64_BYTES = [0xcf, 0xfa, 0xed, 0xfe] as const;
const MH_CIGAM_64_BYTES = [0xfe, 0xed, 0xfa, 0xcf] as const;
const FAT_MAGIC_BYTES = [0xca, 0xfe, 0xba, 0xbe] as const;
const FAT_CIGAM_BYTES = [0xbe, 0xba, 0xfe, 0xca] as const;
const FAT_MAGIC_64_BYTES = [0xca, 0xfe, 0xba, 0xbf] as const;
const FAT_CIGAM_64_BYTES = [0xbf, 0xba, 0xfe, 0xca] as const;

const CPU_TYPE_X86_64 = 0x0100_0007;
const MH_EXECUTE = 0x2;
const LC_SEGMENT_64 = 0x19;
const LC_MAIN = 0x8000_0028;
const VM_PROT_EXECUTE = 0x4;
const MAX_FAT_SLICES = 32;
const MAX_LOAD_COMMANDS = 4_096;
const MAX_LOAD_COMMAND_BYTES = 16 * 1024 * 1024;
const MACH_HEADER_64_BYTES = 32;
const SEGMENT_COMMAND_64_BYTES = 72;
const SECTION_64_BYTES = 80;

interface FatDescriptor {
  readonly index: number;
  readonly cpuType: number;
  readonly cpuSubtype: number;
  readonly offset: number;
  readonly size: number;
}

interface SelectedSlice {
  readonly offset: number;
  readonly size: number;
  readonly expectedCpuType?: number;
  readonly expectedCpuSubtype?: number;
}

interface TextSegment {
  readonly vmAddress: bigint;
  readonly vmSize: bigint;
  readonly fileOffset: number;
  readonly fileSize: number;
  readonly maximumProtection: number;
  readonly initialProtection: number;
}

export interface ParsedMachOImage {
  readonly sliceBytes: Uint8Array;
  readonly selectedSliceOffset: number;
  readonly selectedSliceSize: number;
  readonly entryOffset: number;
  readonly entryFileOffset: number;
  readonly entryVmAddress: bigint;
  readonly textFileOffset: number;
  readonly textFileSize: number;
}

function hasBytes(bytes: Uint8Array, wanted: readonly number[], offset = 0): boolean {
  if (offset < 0 || offset + wanted.length > bytes.byteLength) {
    return false;
  }
  return wanted.every((value, index) => bytes[offset + index] === value);
}

function checkedEnd(offset: number, length: number, limit: number, label: string): number {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > limit ||
    length > limit - offset
  ) {
    throw nativeFault("blocked", NativeRuntimeCode.MachOMalformed, `${label} is out of bounds.`, {
      offset,
      length,
      limit,
    });
  }
  return offset + length;
}

function readUint32(view: DataView, offset: number, littleEndian: boolean, label: string): number {
  checkedEnd(offset, 4, view.byteLength, label);
  return view.getUint32(offset, littleEndian);
}

function readInt32(view: DataView, offset: number, littleEndian: boolean, label: string): number {
  checkedEnd(offset, 4, view.byteLength, label);
  return view.getInt32(offset, littleEndian);
}

function readUint64(view: DataView, offset: number, littleEndian: boolean, label: string): bigint {
  checkedEnd(offset, 8, view.byteLength, label);
  return view.getBigUint64(offset, littleEndian);
}

function uint64AsNumber(
  view: DataView,
  offset: number,
  littleEndian: boolean,
  label: string,
): number {
  const value = readUint64(view, offset, littleEndian, label);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw nativeFault(
      "blocked",
      NativeRuntimeCode.MachOMalformed,
      `${label} exceeds the safe host address range.`,
      { value: value.toString() },
    );
  }
  return Number(value);
}

function parseFatContainer(bytes: Uint8Array, littleEndian: boolean, is64Bit: boolean): SelectedSlice {
  if (bytes.byteLength < 8) {
    throw nativeFault("blocked", NativeRuntimeCode.MachOMalformed, "Fat Mach-O header is truncated.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = readUint32(view, 4, littleEndian, "Fat architecture count");
  if (count === 0 || count > MAX_FAT_SLICES) {
    throw nativeFault(
      "blocked",
      NativeRuntimeCode.MachOMalformed,
      "Fat Mach-O architecture count is invalid.",
      { count, maximum: MAX_FAT_SLICES },
    );
  }

  const descriptorBytes = is64Bit ? 32 : 20;
  const tableEnd = checkedEnd(8, count * descriptorBytes, bytes.byteLength, "Fat architecture table");
  const descriptors: FatDescriptor[] = [];

  for (let index = 0; index < count; index += 1) {
    const cursor = 8 + index * descriptorBytes;
    const cpuType = readInt32(view, cursor, littleEndian, "Fat CPU type");
    const cpuSubtype = readInt32(view, cursor + 4, littleEndian, "Fat CPU subtype");
    const offset = is64Bit
      ? uint64AsNumber(view, cursor + 8, littleEndian, "Fat slice offset")
      : readUint32(view, cursor + 8, littleEndian, "Fat slice offset");
    const size = is64Bit
      ? uint64AsNumber(view, cursor + 16, littleEndian, "Fat slice size")
      : readUint32(view, cursor + 12, littleEndian, "Fat slice size");
    const alignmentExponent = readUint32(
      view,
      cursor + (is64Bit ? 24 : 16),
      littleEndian,
      "Fat slice alignment",
    );

    if (is64Bit && readUint32(view, cursor + 28, littleEndian, "Fat reserved field") !== 0) {
      throw nativeFault(
        "blocked",
        NativeRuntimeCode.MachOMalformed,
        "Fat 64-bit architecture reserved field is not zero.",
        { index },
      );
    }
    if (size === 0 || offset < tableEnd) {
      throw nativeFault(
        "blocked",
        NativeRuntimeCode.MachOMalformed,
        "Fat Mach-O slice is empty or overlaps its architecture table.",
        { index, offset, size, tableEnd },
      );
    }
    if (alignmentExponent > 31 || offset % 2 ** alignmentExponent !== 0) {
      throw nativeFault(
        "blocked",
        NativeRuntimeCode.MachOMalformed,
        "Fat Mach-O slice alignment is invalid.",
        { index, offset, alignmentExponent },
      );
    }
    checkedEnd(offset, size, bytes.byteLength, "Fat Mach-O slice");
    descriptors.push({ index, cpuType, cpuSubtype, offset, size });
  }

  const ordered = [...descriptors].sort((left, right) => left.offset - right.offset);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (previous !== undefined && current !== undefined && previous.offset + previous.size > current.offset) {
      throw nativeFault(
        "blocked",
        NativeRuntimeCode.MachOMalformed,
        "Fat Mach-O slices overlap.",
        { firstIndex: previous.index, secondIndex: current.index },
      );
    }
  }

  const candidates = descriptors.filter((descriptor) => (descriptor.cpuType >>> 0) === CPU_TYPE_X86_64);
  if (candidates.length === 0) {
    throw nativeFault(
      "unsupported",
      NativeRuntimeCode.ArchitectureUnsupported,
      "The Mach-O container has no x86_64 slice.",
    );
  }

  const preferred =
    candidates.find((candidate) => ((candidate.cpuSubtype >>> 0) & 0x00ff_ffff) === 3) ??
    candidates[0];
  if (preferred === undefined) {
    throw nativeFault(
      "unsupported",
      NativeRuntimeCode.ArchitectureUnsupported,
      "The Mach-O container has no usable x86_64 slice.",
    );
  }

  return {
    offset: preferred.offset,
    size: preferred.size,
    expectedCpuType: preferred.cpuType,
    expectedCpuSubtype: preferred.cpuSubtype,
  };
}

function selectSlice(bytes: Uint8Array): SelectedSlice {
  if (hasBytes(bytes, MH_MAGIC_64_BYTES)) {
    return { offset: 0, size: bytes.byteLength };
  }
  if (hasBytes(bytes, MH_CIGAM_64_BYTES)) {
    throw nativeFault(
      "unsupported",
      NativeRuntimeCode.MachOUnsupported,
      "Big-endian 64-bit Mach-O executables are not supported by MVM-IR/1.",
    );
  }
  if (hasBytes(bytes, FAT_MAGIC_BYTES)) {
    return parseFatContainer(bytes, false, false);
  }
  if (hasBytes(bytes, FAT_CIGAM_BYTES)) {
    return parseFatContainer(bytes, true, false);
  }
  if (hasBytes(bytes, FAT_MAGIC_64_BYTES)) {
    return parseFatContainer(bytes, false, true);
  }
  if (hasBytes(bytes, FAT_CIGAM_64_BYTES)) {
    return parseFatContainer(bytes, true, true);
  }

  throw nativeFault(
    "blocked",
    NativeRuntimeCode.MachOUnsupported,
    "Input is not a recognized thin or fat Mach-O container.",
  );
}

function fixedAscii(bytes: Uint8Array, offset: number, length: number, label: string): string {
  checkedEnd(offset, length, bytes.byteLength, label);
  let end = offset;
  while (end < offset + length && bytes[end] !== 0) {
    const value = bytes[end];
    if (value === undefined || value < 0x20 || value > 0x7e) {
      throw nativeFault(
        "blocked",
        NativeRuntimeCode.MachOMalformed,
        `${label} contains non-ASCII bytes.`,
      );
    }
    end += 1;
  }
  for (let cursor = end; cursor < offset + length; cursor += 1) {
    if (bytes[cursor] !== 0) {
      throw nativeFault(
        "blocked",
        NativeRuntimeCode.MachOMalformed,
        `${label} has non-zero bytes after its terminator.`,
      );
    }
  }
  return String.fromCharCode(...bytes.subarray(offset, end));
}

function parseSelectedThin(bytes: Uint8Array, selection: SelectedSlice): ParsedMachOImage {
  checkedEnd(selection.offset, selection.size, bytes.byteLength, "Selected Mach-O slice");
  const slice = bytes.subarray(selection.offset, selection.offset + selection.size);
  if (!hasBytes(slice, MH_MAGIC_64_BYTES)) {
    throw nativeFault(
      "blocked",
      NativeRuntimeCode.MachOMalformed,
      "Selected x86_64 fat slice is not a little-endian 64-bit Mach-O image.",
    );
  }
  if (slice.byteLength < MACH_HEADER_64_BYTES) {
    throw nativeFault("blocked", NativeRuntimeCode.MachOMalformed, "Mach-O header is truncated.");
  }

  const view = new DataView(slice.buffer, slice.byteOffset, slice.byteLength);
  const cpuType = readInt32(view, 4, true, "Mach-O CPU type");
  const cpuSubtype = readInt32(view, 8, true, "Mach-O CPU subtype");
  if ((cpuType >>> 0) !== CPU_TYPE_X86_64) {
    throw nativeFault(
      "unsupported",
      NativeRuntimeCode.ArchitectureUnsupported,
      "Selected Mach-O image is not x86_64.",
      { cpuType: cpuType >>> 0 },
    );
  }
  if (
    selection.expectedCpuType !== undefined &&
    ((cpuType >>> 0) !== (selection.expectedCpuType >>> 0) ||
      (cpuSubtype >>> 0) !== (selection.expectedCpuSubtype! >>> 0))
  ) {
    throw nativeFault(
      "blocked",
      NativeRuntimeCode.MachOMalformed,
      "Fat architecture metadata does not match the selected thin Mach-O header.",
    );
  }
  if (readUint32(view, 12, true, "Mach-O file type") !== MH_EXECUTE) {
    throw nativeFault(
      "unsupported",
      NativeRuntimeCode.MachOUnsupported,
      "MVM-IR/1 accepts Mach-O executables only.",
    );
  }

  const commandCount = readUint32(view, 16, true, "Mach-O load command count");
  const commandBytes = readUint32(view, 20, true, "Mach-O load command bytes");
  if (commandCount === 0 || commandCount > MAX_LOAD_COMMANDS) {
    throw nativeFault(
      "blocked",
      NativeRuntimeCode.MachOMalformed,
      "Mach-O load command count is invalid.",
      { commandCount, maximum: MAX_LOAD_COMMANDS },
    );
  }
  if (commandBytes > MAX_LOAD_COMMAND_BYTES) {
    throw nativeFault(
      "blocked",
      NativeRuntimeCode.MachOMalformed,
      "Mach-O load command table exceeds the runtime limit.",
      { commandBytes, maximum: MAX_LOAD_COMMAND_BYTES },
    );
  }
  const commandsEnd = checkedEnd(
    MACH_HEADER_64_BYTES,
    commandBytes,
    slice.byteLength,
    "Mach-O load command table",
  );

  let cursor = MACH_HEADER_64_BYTES;
  let textSegment: TextSegment | undefined;
  let entryOffset: number | undefined;

  for (let index = 0; index < commandCount; index += 1) {
    checkedEnd(cursor, 8, commandsEnd, "Mach-O load command header");
    const command = readUint32(view, cursor, true, "Mach-O load command");
    const commandSize = readUint32(view, cursor + 4, true, "Mach-O load command size");
    if (commandSize < 8 || commandSize % 8 !== 0) {
      throw nativeFault(
        "blocked",
        NativeRuntimeCode.MachOMalformed,
        "Mach-O load command size is invalid.",
        { index, command, commandSize },
      );
    }
    checkedEnd(cursor, commandSize, commandsEnd, "Mach-O load command");

    if (command === LC_SEGMENT_64) {
      if (commandSize < SEGMENT_COMMAND_64_BYTES) {
        throw nativeFault(
          "blocked",
          NativeRuntimeCode.MachOMalformed,
          "LC_SEGMENT_64 is truncated.",
          { index, commandSize },
        );
      }
      const sectionCount = readUint32(view, cursor + 64, true, "Mach-O section count");
      const expectedCommandSize = SEGMENT_COMMAND_64_BYTES + sectionCount * SECTION_64_BYTES;
      if (!Number.isSafeInteger(expectedCommandSize) || expectedCommandSize !== commandSize) {
        throw nativeFault(
          "blocked",
          NativeRuntimeCode.MachOMalformed,
          "LC_SEGMENT_64 section table does not match cmdsize.",
          { index, commandSize, sectionCount },
        );
      }

      const segmentName = fixedAscii(slice, cursor + 8, 16, "Mach-O segment name");
      const vmAddress = readUint64(view, cursor + 24, true, "Mach-O segment VM address");
      const vmSize = readUint64(view, cursor + 32, true, "Mach-O segment VM size");
      const fileOffset = uint64AsNumber(view, cursor + 40, true, "Mach-O segment file offset");
      const fileSize = uint64AsNumber(view, cursor + 48, true, "Mach-O segment file size");
      const maximumProtection = readInt32(view, cursor + 56, true, "Mach-O maximum protection");
      const initialProtection = readInt32(view, cursor + 60, true, "Mach-O initial protection");
      checkedEnd(fileOffset, fileSize, slice.byteLength, "Mach-O segment file mapping");
      if (vmSize < BigInt(fileSize) || vmAddress + vmSize > (1n << 64n)) {
        throw nativeFault(
          "blocked",
          NativeRuntimeCode.MachOMalformed,
          "Mach-O segment VM mapping is invalid.",
          { segmentName },
        );
      }

      if (segmentName === "__TEXT") {
        if (textSegment !== undefined) {
          throw nativeFault(
            "blocked",
            NativeRuntimeCode.MachOMalformed,
            "Mach-O image contains duplicate __TEXT segments.",
          );
        }
        textSegment = {
          vmAddress,
          vmSize,
          fileOffset,
          fileSize,
          maximumProtection,
          initialProtection,
        };
      }
    } else if (command === LC_MAIN) {
      if (commandSize !== 24 || entryOffset !== undefined) {
        throw nativeFault(
          "blocked",
          NativeRuntimeCode.MachOMalformed,
          entryOffset === undefined ? "LC_MAIN has an invalid size." : "Mach-O image contains duplicate LC_MAIN commands.",
          { index, commandSize },
        );
      }
      entryOffset = uint64AsNumber(view, cursor + 8, true, "LC_MAIN entryoff");
      readUint64(view, cursor + 16, true, "LC_MAIN stack size");
    }

    cursor += commandSize;
  }

  if (cursor !== commandsEnd) {
    throw nativeFault(
      "blocked",
      NativeRuntimeCode.MachOMalformed,
      "Mach-O sizeofcmds does not equal the parsed command sizes.",
    );
  }
  if (textSegment === undefined || entryOffset === undefined) {
    throw nativeFault(
      "unsupported",
      NativeRuntimeCode.EntryPointInvalid,
      textSegment === undefined ? "Mach-O image has no __TEXT segment." : "Mach-O image has no LC_MAIN entry point.",
    );
  }
  if (
    textSegment.fileSize === 0 ||
    (textSegment.maximumProtection & VM_PROT_EXECUTE) === 0 ||
    (textSegment.initialProtection & VM_PROT_EXECUTE) === 0
  ) {
    throw nativeFault(
      "blocked",
      NativeRuntimeCode.EntryPointInvalid,
      "The __TEXT segment is empty or not executable.",
    );
  }

  const textEnd = checkedEnd(
    textSegment.fileOffset,
    textSegment.fileSize,
    slice.byteLength,
    "__TEXT file mapping",
  );
  if (entryOffset < textSegment.fileOffset || entryOffset >= textEnd || entryOffset < commandsEnd) {
    throw nativeFault(
      "blocked",
      NativeRuntimeCode.EntryPointInvalid,
      "LC_MAIN entryoff is outside executable __TEXT bytes.",
      { entryOffset, textFileOffset: textSegment.fileOffset, textEnd, commandsEnd },
    );
  }

  const vmDelta = BigInt(entryOffset - textSegment.fileOffset);
  if (vmDelta >= textSegment.vmSize) {
    throw nativeFault(
      "blocked",
      NativeRuntimeCode.EntryPointInvalid,
      "LC_MAIN cannot be mapped into the __TEXT virtual address range.",
    );
  }

  return {
    sliceBytes: slice,
    selectedSliceOffset: selection.offset,
    selectedSliceSize: selection.size,
    entryOffset,
    entryFileOffset: selection.offset + entryOffset,
    entryVmAddress: textSegment.vmAddress + vmDelta,
    textFileOffset: textSegment.fileOffset,
    textFileSize: textSegment.fileSize,
  };
}

export function parseMachOImage(bytes: Uint8Array): ParsedMachOImage {
  return parseSelectedThin(bytes, selectSlice(bytes));
}
