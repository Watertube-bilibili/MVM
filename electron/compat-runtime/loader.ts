import { parseMachOImage } from '../native-runtime/macho-loader.js';
import { nativeFault } from '../native-runtime/fault.js';
import { NativeRuntimeCode as Code } from '../native-runtime/types.js';
import { GuestMemory } from './memory.js';

export function loadExecutable(bytes: Uint8Array) {
  const image = parseMachOImage(bytes);
  const b = Buffer.from(image.sliceBytes);
  const memory = new GuestMemory();
  const imports = new Map<bigint, string>();
  const segments: { base: bigint; size: bigint }[] = [];
  const sections: { address: bigint; size: number; type: number; indirect: number; stride: number }[] = [];
  const commands: { cmd: number; offset: number; size: number }[] = [];
  const bound = (offset: number, length: number) => {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > b.length) {
      throw nativeFault('blocked', Code.MachOMalformed, 'Link-edit table outside the Mach-O file.');
    }
  };
  let cursor = 32;
  for (let i = 0; i < b.readUInt32LE(16); i++) {
    const cmd = b.readUInt32LE(cursor), size = b.readUInt32LE(cursor + 4);
    commands.push({ cmd, offset: cursor, size });
    if ([0xc,0x80000018,0x8000001f,0x80000023].includes(cmd)) {
      if (size < 24) throw nativeFault('blocked',Code.MachOMalformed,'Truncated dylib command.');
      const nameOffset = b.readUInt32LE(cursor+8), end = b.indexOf(0,cursor+nameOffset);
      if (nameOffset < 24 || nameOffset >= size || end < 0 || end >= cursor+size) throw nativeFault('blocked',Code.MachOMalformed,'Invalid dylib name.');
      const name = b.toString('utf8',cursor+nameOffset,end);
      if (!['/usr/lib/libSystem.B.dylib','/usr/lib/libobjc.A.dylib','/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit','/System/Library/Frameworks/Foundation.framework/Versions/C/Foundation'].includes(name)) {
        throw nativeFault('unsupported',Code.MachOUnsupported,`Guest dynamic library loading is not implemented: ${name}`);
      }
    }
    if (cmd === 0x19) {
      const base = b.readBigUInt64LE(cursor + 24), vmSize = b.readBigUInt64LE(cursor + 32);
      const fileOffset = Number(b.readBigUInt64LE(cursor + 40)), fileSize = Number(b.readBigUInt64LE(cursor + 48));
      const protection = b.readUInt32LE(cursor + 60);
      segments.push({ base, size: vmSize });
      if (protection) {
        if (vmSize > 128n * 1024n * 1024n) throw nativeFault('blocked', Code.AddressBounds, 'Guest segment exceeds memory budget.');
        memory.map(base, Number(vmSize), protection, b.toString('ascii', cursor + 8, cursor + 24).replace(/\0.*$/s, ''), b.subarray(fileOffset, fileOffset + fileSize));
      }
      for (let s = 0; s < b.readUInt32LE(cursor + 64); s++) {
        const p = cursor + 72 + s * 80;
        const address = b.readBigUInt64LE(p + 32), sectionSize = b.readBigUInt64LE(p + 40);
        if (sectionSize && [9,10].includes(b.readUInt32LE(p+64)&255)) throw nativeFault('unsupported',Code.MachOUnsupported,'Guest image initializers/finalizers are not implemented.');
        if (address < base || address + sectionSize > base + vmSize) throw nativeFault('blocked', Code.MachOMalformed, 'Section escapes its segment.');
        sections.push({ address, size: Number(sectionSize), type: b.readUInt32LE(p + 64) & 255, indirect: b.readUInt32LE(p + 68), stride: b.readUInt32LE(p + 72) });
      }
    }
    if ((cmd === 0x21 || cmd === 0x2c) && size >= 20 && b.readUInt32LE(cursor + 16) !== 0) {
      throw nativeFault('blocked', Code.MachOUnsupported, 'Encrypted Mach-O images are not supported.');
    }
    if (cmd === 0x80000034) throw nativeFault('unsupported', Code.MachOUnsupported, 'Chained dyld fixups are not implemented.');
    cursor += size;
  }
  const symbolTable = commands.find(c => c.cmd === 2);
  const dynamicTable = commands.find(c => c.cmd === 0xb);
  const traps = new Map<string, bigint>();
  function trap(symbol: string): bigint {
    let address = traps.get(symbol);
    if (address === undefined) {
      address = 0x7fff00000000n + BigInt(traps.size * 16);
      traps.set(symbol, address);
      imports.set(address, symbol);
    }
    return address;
  }
  if (symbolTable && dynamicTable) {
    if (symbolTable.size < 24 || dynamicTable.size < 80) throw nativeFault('blocked', Code.MachOMalformed, 'Truncated symbol table command.');
    const so = b.readUInt32LE(symbolTable.offset + 8), count = b.readUInt32LE(symbolTable.offset + 12);
    const strings = b.readUInt32LE(symbolTable.offset + 16), stringSize = b.readUInt32LE(symbolTable.offset + 20);
    const indirect = b.readUInt32LE(dynamicTable.offset + 56), indirectCount = b.readUInt32LE(dynamicTable.offset + 60);
    bound(so, count * 16); bound(strings, stringSize); bound(indirect, indirectCount * 4);
    for (const section of sections.filter(s => [6, 7, 8].includes(s.type))) {
      const stride = section.type === 8 ? section.stride : 8;
      if (!stride || section.size % stride || section.indirect + section.size / stride > indirectCount) throw nativeFault('blocked', Code.MachOMalformed, 'Invalid indirect-symbol section.');
      for (let i = 0; i < section.size / stride; i++) {
        const symbolIndex = b.readUInt32LE(indirect + (section.indirect + i) * 4);
        if (symbolIndex & 0xc0000000) continue;
        if (symbolIndex >= count) throw nativeFault('blocked', Code.MachOMalformed, 'Invalid indirect symbol index.');
        const strx = b.readUInt32LE(so + symbolIndex * 16);
        if (strx >= stringSize) throw nativeFault('blocked', Code.MachOMalformed, 'Invalid symbol string offset.');
        const end = b.indexOf(0, strings + strx);
        if (end < 0 || end >= strings + stringSize || end - strings - strx > 4096) throw nativeFault('blocked', Code.MachOMalformed, 'Invalid symbol string.');
        const symbol = b.toString('utf8', strings + strx, end);
        const address = section.address + BigInt(i * stride);
        if (section.type === 8) imports.set(address, symbol);
        else memory.write(address, trap(symbol), 64);
      }
    }
  }
  // Classic dyld binding is needed for GOT entries outside indirect-symbol sections.
  for (const command of commands.filter(c => c.cmd === 0x22 || c.cmd === 0x80000022)) {
    if (command.size < 48) throw nativeFault('blocked', Code.MachOMalformed, 'Truncated dyld info command.');
    if (b.readUInt32LE(command.offset+28)) throw nativeFault('unsupported',Code.MachOUnsupported,'Weak dyld binding is not implemented.');
    for (const pair of [16, 32]) {
      const start = b.readUInt32LE(command.offset + pair), size = b.readUInt32LE(command.offset + pair + 4);
      bound(start, size);
      let p = start, symbol = '', segment = 0, offset = 0n, type = 1, addend = 0n, operations = 0;
      const end = start + size;
      const uleb = (): bigint => {
        let value = 0n, shift = 0n;
        for (let j = 0; j < 10 && p < end; j++) {
          const v = b[p++]!; value |= BigInt(v & 127) << shift;
          if (!(v & 128)) return value;
          shift += 7n;
        }
        throw nativeFault('blocked', Code.MachOMalformed, 'Invalid dyld LEB integer.');
      };
      const bind = () => {
        const seg = segments[segment];
        if (!seg || offset < 0 || offset + 8n > seg.size || !symbol || type !== 1 || addend !== 0n || ++operations > 100000) throw nativeFault('unsupported', Code.MachOUnsupported, 'Unsupported dyld binding.');
        memory.write(seg.base + offset, trap(symbol), 64); offset += 8n;
      };
      while (p < end) {
        const byte = b[p++]!, op = byte & 240, imm = byte & 15;
        if (op === 0) { symbol = ''; offset = 0n; addend = 0n; type = 1; continue; }
        if (op === 0x10 || op === 0x30) continue;
        if (op === 0x20) { uleb(); continue; }
        if (op === 0x40) {
          const z = b.indexOf(0, p);
          if (z < p || z >= end || z - p > 4096) throw nativeFault('blocked', Code.MachOMalformed, 'Unterminated bind symbol.');
          symbol = b.toString('utf8', p, z); p = z + 1;
        } else if (op === 0x50) type = imm;
        else if (op === 0x60) addend = uleb();
        else if (op === 0x70) { segment = imm; offset = uleb(); }
        else if (op === 0x80) offset += uleb();
        else if (op === 0x90) bind();
        else if (op === 0xa0) { bind(); offset += uleb(); }
        else if (op === 0xb0) { bind(); offset += BigInt(imm * 8); }
        else if (op === 0xc0) {
          const count = uleb(), skip = uleb();
          if (count > 100000n) throw nativeFault('blocked', Code.MachOMalformed, 'Excessive dyld bind count.');
          for (let j = 0n; j < count; j++) { bind(); offset += skip; }
        } else throw nativeFault('unsupported', Code.MachOUnsupported, `Dyld bind opcode 0x${op.toString(16)} is not implemented.`);
      }
    }
  }
  return { image, memory, imports };
}
