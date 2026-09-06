const MACH_HEADER_BYTES = 32;
const SEGMENT_COMMAND_BYTES = 72;
const ENTRY_COMMAND_BYTES = 24;
const COMMAND_BYTES = SEGMENT_COMMAND_BYTES + ENTRY_COMMAND_BYTES;
export const ENTRY_OFFSET = 0x100;
export const LC_MAIN_OFFSET = MACH_HEADER_BYTES + SEGMENT_COMMAND_BYTES;

export function makeThinX64Executable(code: readonly number[]): Buffer {
  const fileSize = ENTRY_OFFSET + code.length;
  const bytes = Buffer.alloc(fileSize);

  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeInt32LE(0x01000007, 4);
  bytes.writeInt32LE(3, 8);
  bytes.writeUInt32LE(2, 12);
  bytes.writeUInt32LE(2, 16);
  bytes.writeUInt32LE(COMMAND_BYTES, 20);
  bytes.writeUInt32LE(0, 24);
  bytes.writeUInt32LE(0, 28);

  bytes.writeUInt32LE(0x19, MACH_HEADER_BYTES);
  bytes.writeUInt32LE(SEGMENT_COMMAND_BYTES, MACH_HEADER_BYTES + 4);
  bytes.write("__TEXT", MACH_HEADER_BYTES + 8, "ascii");
  bytes.writeBigUInt64LE(0x1_0000_0000n, MACH_HEADER_BYTES + 24);
  bytes.writeBigUInt64LE(BigInt(fileSize), MACH_HEADER_BYTES + 32);
  bytes.writeBigUInt64LE(0n, MACH_HEADER_BYTES + 40);
  bytes.writeBigUInt64LE(BigInt(fileSize), MACH_HEADER_BYTES + 48);
  bytes.writeInt32LE(7, MACH_HEADER_BYTES + 56);
  bytes.writeInt32LE(5, MACH_HEADER_BYTES + 60);
  bytes.writeUInt32LE(0, MACH_HEADER_BYTES + 64);
  bytes.writeUInt32LE(0, MACH_HEADER_BYTES + 68);

  bytes.writeUInt32LE(0x80000028, LC_MAIN_OFFSET);
  bytes.writeUInt32LE(ENTRY_COMMAND_BYTES, LC_MAIN_OFFSET + 4);
  bytes.writeBigUInt64LE(BigInt(ENTRY_OFFSET), LC_MAIN_OFFSET + 8);
  bytes.writeBigUInt64LE(0n, LC_MAIN_OFFSET + 16);
  Buffer.from(code).copy(bytes, ENTRY_OFFSET);
  return bytes;
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

export interface FatFixture {
  readonly bytes: Buffer;
  readonly x64Offset: number;
  readonly x64Size: number;
  readonly armOffset: number;
  readonly armSize: number;
}

export function makeFatExecutable(
  x64Code: readonly number[],
  endianness: "big" | "little" = "big",
): FatFixture {
  const armSlice = makeThinX64Executable([0xc3]);
  armSlice.writeInt32LE(0x0100000c, 4);
  armSlice.writeInt32LE(0, 8);
  const x64Slice = makeThinX64Executable(x64Code);
  const alignment = 16;
  const armOffset = align(8 + 2 * 20, alignment);
  const x64Offset = align(armOffset + armSlice.byteLength, alignment);
  const bytes = Buffer.alloc(x64Offset + x64Slice.byteLength);

  const writeUint32 = (value: number, offset: number): void => {
    if (endianness === "little") {
      bytes.writeUInt32LE(value, offset);
    } else {
      bytes.writeUInt32BE(value, offset);
    }
  };
  const writeInt32 = (value: number, offset: number): void => {
    if (endianness === "little") {
      bytes.writeInt32LE(value, offset);
    } else {
      bytes.writeInt32BE(value, offset);
    }
  };

  writeUint32(0xcafebabe, 0);
  writeUint32(2, 4);
  writeInt32(0x0100000c, 8);
  writeInt32(0, 12);
  writeUint32(armOffset, 16);
  writeUint32(armSlice.byteLength, 20);
  writeUint32(4, 24);
  writeInt32(0x01000007, 28);
  writeInt32(3, 32);
  writeUint32(x64Offset, 36);
  writeUint32(x64Slice.byteLength, 40);
  writeUint32(4, 44);
  armSlice.copy(bytes, armOffset);
  x64Slice.copy(bytes, x64Offset);

  return {
    bytes,
    x64Offset,
    x64Size: x64Slice.byteLength,
    armOffset,
    armSize: armSlice.byteLength,
  };
}

export const RETURN_42_PROGRAM = [
  0x55,
  0x48, 0x89, 0xe5,
  0x48, 0x83, 0xec, 0x10,
  0x48, 0xb8, 0x63, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x31, 0xc0,
  0xb8, 0x32, 0x00, 0x00, 0x00,
  0x05, 0x05, 0x00, 0x00, 0x00,
  0x2d, 0x0a, 0x00, 0x00, 0x00,
  0x83, 0xc0, 0x02,
  0x83, 0xe8, 0x05,
  0x48, 0x83, 0xc4, 0x10,
  0x5d,
  0xc3,
] as const;
