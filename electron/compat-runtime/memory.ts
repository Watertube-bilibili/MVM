import { nativeFault } from '../native-runtime/fault.js';
import { NativeRuntimeCode as Code } from '../native-runtime/types.js';

interface Region { base: bigint; bytes: Buffer; protection: number; name: string }

/** Guest addresses are values, never pointers into the Windows process. */
export class GuestMemory {
  private readonly regions: Region[] = [];
  private total = 0;
  public map(base: bigint, size: number, protection: number, name: string, initial?: Uint8Array): void {
    if (!Number.isSafeInteger(size) || size < 0 || this.total + size > 128 * 1024 * 1024 ||
        base < 0n || base + BigInt(size) > (1n << 64n) || (initial?.length ?? 0) > size) {
      throw nativeFault('blocked', Code.AddressBounds, `Invalid guest mapping: ${name}`);
    }
    if (this.regions.some(r => base < r.base + BigInt(r.bytes.length) && r.base < base + BigInt(size))) {
      throw nativeFault('blocked', Code.AddressBounds, `Overlapping guest mapping: ${name}`);
    }
    if (!size) return;
    const bytes = Buffer.alloc(size);
    if (initial) bytes.set(initial);
    this.regions.push({ base, bytes, protection, name });
    this.total += size;
  }
  public view(address: bigint, size: number, permission = 1): Buffer {
    if (!Number.isSafeInteger(size) || size < 0) throw nativeFault('blocked', Code.AddressBounds, 'Invalid memory access length.');
    const region = this.regions.find(r => address >= r.base && address + BigInt(size) <= r.base + BigInt(r.bytes.length));
    if (!region || (region.protection & permission) !== permission) {
      throw nativeFault('blocked', Code.AddressBounds, `Guest memory ${permission === 2 ? 'write' : permission === 4 ? 'execute' : 'read'} denied at 0x${address.toString(16)} (${size} bytes).`);
    }
    return region.bytes.subarray(Number(address - region.base), Number(address - region.base) + size);
  }
  public read(address: bigint, bits: number): bigint {
    const b = this.view(address, bits / 8);
    return bits === 64 ? b.readBigUInt64LE() : BigInt(bits === 32 ? b.readUInt32LE() : bits === 16 ? b.readUInt16LE() : b[0]!);
  }
  public write(address: bigint, value: bigint, bits: number): void {
    const b = this.view(address, bits / 8, 2);
    const v = BigInt.asUintN(bits, value);
    if (bits === 64) b.writeBigUInt64LE(v);
    else if (bits === 32) b.writeUInt32LE(Number(v));
    else if (bits === 16) b.writeUInt16LE(Number(v));
    else b[0] = Number(v);
  }
  public cstring(address: bigint, limit = 16384): string {
    const bytes: number[] = [];
    for (let i = 0; i < limit; i++) {
      const byte = Number(this.read(address + BigInt(i), 8));
      if (!byte) return Buffer.from(bytes).toString('utf8');
      bytes.push(byte);
    }
    throw nativeFault('blocked', Code.AddressBounds, 'Unterminated guest string.');
  }
}
