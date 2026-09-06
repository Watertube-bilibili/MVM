import { nativeFault } from '../native-runtime/fault.js';
import { NativeRuntimeCode as Code } from '../native-runtime/types.js';
import { GuestMemory } from './memory.js';

export type Operand = { kind: 'reg'; index: number; high?: boolean } |
  { kind: 'mem'; base?: number; index?: number; scale: number; displacement: bigint; rip: boolean } |
  { kind: 'imm'; value: bigint };
export interface Instruction { op: string; bits: number; dst?: Operand; src?: Operand; extra?: bigint; next: bigint; cc?: number }
const reg = (index: number): Operand => ({ kind: 'reg', index });
const imm = (value: bigint): Operand => ({ kind: 'imm', value });

/** Decodes reached instructions once and caches IR. Control flow is interpreted by CPU.step. */
export function decode(memory: GuestMemory, pc: bigint): Instruction {
  let cursor = pc, rex = 0, operand16 = false;
  const byte = () => { if (cursor - pc >= 15n) throw nativeFault('blocked', Code.MachOMalformed, 'Instruction exceeds 15 bytes.'); return memory.view(cursor++, 1, 4)[0]!; };
  const integer = (bytes: number, signed = false) => {
    let v = 0n; for (let i = 0; i < bytes; i++) v |= BigInt(byte()) << BigInt(i * 8);
    return signed ? BigInt.asIntN(bytes * 8, v) : v;
  };
  let opcode = byte();
  if (opcode === 0x66) { operand16 = true; opcode = byte(); }
  if (opcode >= 0x40 && opcode <= 0x4f) { rex = opcode; opcode = byte(); }
  let bits = rex & 8 ? 64 : operand16 ? 16 : 32;
  const register = (n: number, extend: boolean): Operand => {
    if (bits === 8 && !rex && n >= 4) return { kind: 'reg', index: n - 4, high: true };
    return reg(n + (extend ? 8 : 0));
  };
  const modrm = () => {
    const v = byte(), mod = v >> 6, ext = (v >> 3) & 7, rm = v & 7;
    const r = register(ext, Boolean(rex & 4));
    if (mod === 3) return { r, m: register(rm, Boolean(rex & 1)), ext };
    let base: number | undefined = rm + (rex & 1 ? 8 : 0), index: number | undefined;
    let scale = 1, displacement = 0n, rip = false;
    if (rm === 4) {
      const sib = byte(); scale = 1 << (sib >> 6);
      const ix = (sib >> 3) & 7;
      if (ix !== 4 || (rex & 2)) index = ix + (rex & 2 ? 8 : 0);
      base = (sib & 7) + (rex & 1 ? 8 : 0);
      if (mod === 0 && (sib & 7) === 5) { base = undefined; displacement = integer(4, true); }
    } else if (mod === 0 && rm === 5) { base = undefined; rip = true; displacement = integer(4, true); }
    if (mod === 1) displacement = integer(1, true);
    if (mod === 2) displacement = integer(4, true);
    const m: Operand = { kind: 'mem', scale, displacement, rip, ...(base === undefined ? {} : { base }), ...(index === undefined ? {} : { index }) };
    return { r, m, ext };
  };
  const done = (op: string, dst?: Operand, src?: Operand, extra?: bigint, cc?: number): Instruction => ({
    op, bits, next: cursor, ...(dst ? { dst } : {}), ...(src ? { src } : {}), ...(extra === undefined ? {} : { extra }), ...(cc === undefined ? {} : { cc }),
  });
  if (opcode === 0x90) return done('nop');
  if (opcode === 0xc3) return done('ret');
  if (opcode === 0xc9) return done('leave');
  if (opcode >= 0x50 && opcode <= 0x5f) { bits = 64; return done(opcode < 0x58 ? 'push' : 'pop', reg((opcode & 7) + (rex & 1 ? 8 : 0))); }
  if (opcode === 0x68 || opcode === 0x6a) { bits = 64; return done('push', imm(integer(opcode === 0x68 ? 4 : 1, true))); }
  if (opcode >= 0xb8 && opcode <= 0xbf) return done('mov', reg((opcode & 7) + (rex & 1 ? 8 : 0)), imm(integer(bits / 8)));
  if (opcode >= 0xb0 && opcode <= 0xb7) { bits = 8; return done('mov', register(opcode & 7, Boolean(rex & 1)), imm(integer(1))); }
  if (opcode === 0xe8 || opcode === 0xe9 || opcode === 0xeb) {
    const rel = integer(opcode === 0xeb ? 1 : 4, true);
    return done(opcode === 0xe8 ? 'call' : 'jmp', imm(cursor + rel));
  }
  if (opcode >= 0x70 && opcode <= 0x7f) { const rel = integer(1, true); return done('jcc', imm(cursor + rel), undefined, undefined, opcode & 15); }
  if (opcode === 0x0f) {
    const second = byte();
    if (second === 5) return done('syscall');
    if (second >= 0x80 && second <= 0x8f) { const rel = integer(4, true); return done('jcc', imm(cursor + rel), undefined, undefined, second & 15); }
    if (second === 0x1f) { modrm(); return done('nop'); }
    if (second === 0xaf) { const {r,m} = modrm(); return done('imul', r, m); }
    if ([0xb6, 0xb7, 0xbe, 0xbf].includes(second)) {
      const {r,m} = modrm();
      const sourceBits = second & 1 ? 16 : 8;
      const source: Operand = sourceBits === 8 && !rex && m.kind === 'reg' && m.index >= 4
        ? {kind:'reg',index:m.index-4,high:true} : m;
      return done(second < 0xbe ? 'movzx' : 'movsx', r, source, BigInt(sourceBits));
    }
    if (second >= 0x90 && second <= 0x9f) { bits = 8; const {m} = modrm(); return done('setcc', m, undefined, undefined, second & 15); }
    if (second >= 0x40 && second <= 0x4f) { const {r,m} = modrm(); return done('cmov', r, m, undefined, second & 15); }
    if ([0x34, 0x0b].includes(second)) throw nativeFault('blocked', Code.ForbiddenInstruction, `Forbidden instruction at 0x${pc.toString(16)}.`);
  }
  if ([0x88, 0x89, 0x8a, 0x8b, 0x8d, 0x63].includes(opcode)) {
    if (opcode === 0x88 || opcode === 0x8a) bits = 8;
    const {r,m} = modrm();
    if (opcode === 0x8d && m.kind !== 'mem') throw nativeFault('blocked', Code.MachOMalformed, 'LEA requires memory operand.');
    return done(opcode === 0x8d ? 'lea' : opcode === 0x63 ? 'movsx' : 'mov', opcode === 0x88 || opcode === 0x89 ? m : r, opcode === 0x88 || opcode === 0x89 ? r : m, opcode === 0x63 ? 32n : undefined);
  }
  if (opcode === 0xc6 || opcode === 0xc7) {
    if (opcode === 0xc6) bits = 8;
    const {m,ext} = modrm();
    if (ext !== 0) throw nativeFault('unsupported', Code.UnsupportedOpcode, 'Unsupported MOV immediate extension.');
    return done('mov', m, imm(integer(bits === 64 ? 4 : bits / 8, bits === 64)));
  }
  const arithmetic = ['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor', 'cmp'];
  if (opcode <= 0x3d && (opcode & 7) <= 5) {
    const group = opcode >> 3, form = opcode & 7;
    if (form % 2 === 0) bits = 8;
    if (form >= 4) return done(arithmetic[group]!, reg(0), imm(integer(bits === 64 ? 4 : bits / 8, bits === 64)));
    const {r,m} = modrm(); return done(arithmetic[group]!, form < 2 ? m : r, form < 2 ? r : m);
  }
  if ([0x80, 0x81, 0x83].includes(opcode)) {
    if (opcode === 0x80) bits = 8;
    const {m,ext} = modrm();
    return done(arithmetic[ext]!, m, imm(integer(opcode === 0x81 ? (bits === 16 ? 2 : 4) : 1, opcode === 0x83 || bits === 64)));
  }
  if (opcode === 0x84 || opcode === 0x85) { if (opcode === 0x84) bits = 8; const {r,m} = modrm(); return done('test', m, r); }
  if (opcode === 0xa8 || opcode === 0xa9) { if (opcode === 0xa8) bits = 8; return done('test', reg(0), imm(integer(bits === 64 ? 4 : bits / 8))); }
  if (opcode === 0x69 || opcode === 0x6b) { const {r,m} = modrm(); return done('imul3', r, m, integer(opcode === 0x6b ? 1 : bits === 16 ? 2 : 4, true)); }
  if (opcode === 0xff || opcode === 0xfe) {
    if (opcode === 0xfe) bits = 8;
    const {m,ext} = modrm();
    if (opcode === 0xfe && ext > 1) throw nativeFault('unsupported', Code.UnsupportedOpcode, 'Unknown FE extension.');
    const op = {0:'inc',1:'dec',2:'call',4:'jmp',6:'push'}[ext];
    if (op) { if (ext >= 2) bits = 64; return done(op, m); }
  }
  if ([0xc0,0xc1,0xd0,0xd1,0xd2,0xd3].includes(opcode)) {
    if (!(opcode & 1)) bits = 8;
    const {m,ext} = modrm(); const op = {4:'shl',5:'shr',7:'sar'}[ext];
    const count = opcode <= 0xc1 ? imm(integer(1)) : opcode <= 0xd1 ? imm(1n) : reg(1);
    if (op) return done(op, m, count);
  }
  if (opcode === 0xf6 || opcode === 0xf7) {
    if (opcode === 0xf6) bits = 8;
    const {m,ext} = modrm();
    if (ext === 0) return done('test', m, imm(integer(bits === 64 ? 4 : bits / 8)));
    const op = {2:'not',3:'neg',6:'div',7:'idiv'}[ext]; if (op) return done(op, m);
  }
  if (opcode === 0x98) return done('signextend-acc');
  if (opcode === 0x99) return done('signextend-pair');
  if ([0xcc,0xcd,0xf4,0xfa,0xfb].includes(opcode)) throw nativeFault('blocked', Code.ForbiddenInstruction, `Privileged/trap opcode 0x${opcode.toString(16)} at 0x${pc.toString(16)}.`);
  throw nativeFault('unsupported', Code.UnsupportedOpcode, `Unsupported x86_64 opcode 0x${opcode.toString(16)} at guest PC 0x${pc.toString(16)}.`);
}

export class Cpu {
  public readonly r = Array<bigint>(16).fill(0n);
  public pc: bigint;
  public cf = false; public zf = false; public sf = false; public of = false; public pf = false;
  public readonly returnSentinel = 0x7ffffffefff0n;
  public readonly initialSp: bigint;
  public constructor(public readonly memory: GuestMemory, entry: bigint, stackBytes: number) {
    this.pc = entry;
    const stackBase = 0x700000000000n;
    memory.map(stackBase, stackBytes, 3, 'stack');
    this.r[4] = stackBase + BigInt(stackBytes & ~15);
    this.push(this.returnSentinel);
    this.initialSp = this.r[4]!;
  }
  public address(o: Operand, next: bigint): bigint {
    if (o.kind !== 'mem') throw new Error('Expected memory operand');
    return BigInt.asUintN(64, (o.rip ? next : 0n) + (o.base === undefined ? 0n : this.r[o.base]!) + (o.index === undefined ? 0n : this.r[o.index]! * BigInt(o.scale)) + o.displacement);
  }
  public read(o: Operand, bits: number, next: bigint): bigint {
    if (o.kind === 'imm') return BigInt.asUintN(bits, o.value);
    if (o.kind === 'reg') return BigInt.asUintN(bits, this.r[o.index]! >> (o.high ? 8n : 0n));
    return this.memory.read(this.address(o, next), bits);
  }
  public write(o: Operand, value: bigint, bits: number, next: bigint): void {
    value = BigInt.asUintN(bits, value);
    if (o.kind === 'reg') {
      if (bits >= 32) this.r[o.index] = value;
      else { const shift = o.high ? 8n : 0n, mask = ((1n << BigInt(bits)) - 1n) << shift; this.r[o.index] = (this.r[o.index]! & ~mask) | (value << shift); }
    } else if (o.kind === 'mem') this.memory.write(this.address(o, next), value, bits);
    else throw new Error('Cannot write immediate operand');
  }
  public push(v: bigint): void { this.r[4] = this.r[4]! - 8n; this.memory.write(this.r[4]!, v, 64); }
  public pop(): bigint { const v = this.memory.read(this.r[4]!,64); this.r[4] = this.r[4]! + 8n; return v; }
  public condition(cc: number): boolean {
    const conditions = [this.of, !this.of, this.cf, !this.cf, this.zf, !this.zf, this.cf || this.zf, !this.cf && !this.zf, this.sf, !this.sf, this.pf, !this.pf, this.sf !== this.of, this.sf === this.of, this.zf || this.sf !== this.of, !this.zf && this.sf === this.of];
    return conditions[cc]!;
  }
  private flags(value: bigint, bits: number): bigint {
    const v = BigInt.asUintN(bits, value);
    this.zf = v === 0n; this.sf = Boolean(v & (1n << BigInt(bits - 1)));
    let low = Number(v & 255n); low ^= low >> 4; low ^= low >> 2; low ^= low >> 1; this.pf = !(low & 1);
    return v;
  }
  public step(i: Instruction): 'continue' | 'syscall' | 'returned' {
    const {op,bits,next} = i;
    const a = () => this.read(i.dst!, bits, next), b = () => this.read(i.src!, bits, next);
    const put = (v: bigint) => this.write(i.dst!, v, bits, next);
    this.pc = next;
    if (op === 'nop') return 'continue';
    if (op === 'mov') put(b());
    else if (op === 'lea') put(this.address(i.src!, next));
    else if (op === 'movzx' || op === 'movsx') { const v = this.read(i.src!, Number(i.extra!), next); put(op === 'movsx' ? BigInt.asIntN(Number(i.extra!), v) : v); }
    else if (op === 'push') this.push(this.read(i.dst!,64,next));
    else if (op === 'pop') put(this.pop());
    else if (op === 'leave') { this.r[4] = this.r[5]!; this.r[5] = this.pop(); }
    else if (op === 'ret') {
      this.pc = this.pop();
      if (this.pc === this.returnSentinel) {
        if (this.r[4] !== this.initialSp + 8n) throw nativeFault('blocked', Code.UnbalancedStack, 'Entry returned with an unbalanced stack.');
        return 'returned';
      }
    } else if (op === 'call') { const target = this.read(i.dst!,64,next); this.push(next); this.pc = target; }
    else if (op === 'jmp') this.pc = this.read(i.dst!,64,next);
    else if (op === 'jcc') { if (this.condition(i.cc!)) this.pc = this.read(i.dst!,64,next); }
    else if (op === 'setcc') put(this.condition(i.cc!) ? 1n : 0n);
    else if (op === 'cmov') { const value = b(); if (this.condition(i.cc!)) put(value); }
    else if (op === 'syscall') { this.r[1] = next; return 'syscall'; }
    else if (op === 'signextend-acc') this.r[0] = BigInt.asUintN(bits, BigInt.asIntN(bits / 2, this.r[0]!));
    else if (op === 'signextend-pair') this.r[2] = BigInt.asIntN(bits,this.r[0]!) < 0n ? (1n << BigInt(bits)) - 1n : 0n;
    else if (op === 'not') put(~a());
    else if (op === 'imul' || op === 'imul3') {
      const left = BigInt.asIntN(bits, op === 'imul' ? a() : b()), right = op === 'imul' ? BigInt.asIntN(bits,b()) : i.extra!;
      const v = left * right; put(v); this.cf = this.of = BigInt.asIntN(bits,v) !== v;
    } else if (op === 'idiv' || op === 'div') {
      if (bits === 8) throw nativeFault('unsupported', Code.UnsupportedOpcode, '8-bit division not implemented.');
      const raw = (BigInt.asUintN(bits,this.r[2]!) << BigInt(bits)) | BigInt.asUintN(bits,this.r[0]!);
      const numerator = op === 'idiv' ? BigInt.asIntN(bits * 2,raw) : raw;
      const denominator = op === 'idiv' ? BigInt.asIntN(bits,a()) : a();
      if (!denominator) throw nativeFault('blocked', Code.AddressBounds, 'Guest division by zero.');
      const q = numerator / denominator, rem = numerator % denominator;
      if ((op === 'idiv' ? BigInt.asIntN(bits,q) : BigInt.asUintN(bits,q)) !== q) throw nativeFault('blocked', Code.AddressBounds, 'Guest division overflow.');
      this.r[0] = BigInt.asUintN(bits,q); this.r[2] = BigInt.asUintN(bits,rem);
    } else if (op === 'shl' || op === 'shr' || op === 'sar') {
      const count = Number(b() & BigInt(bits === 64 ? 63 : 31));
      if (count) {
        const value = a(), sign = 1n << BigInt(bits-1);
        const v = op === 'shl' ? value << BigInt(count) : op === 'sar' ? BigInt.asIntN(bits,value) >> BigInt(count) : value >> BigInt(count);
        this.cf = count <= bits && Boolean(op === 'shl' ? value & (1n << BigInt(bits-count)) : value & (1n << BigInt(count-1)));
        if (count === 1) this.of = op === 'shl' ? Boolean(v & sign) !== this.cf : op === 'shr' && Boolean(value & sign);
        put(this.flags(v,bits));
      }
    } else if (['and','or','xor','test'].includes(op)) {
      const left = a(), right = b(), v = op === 'or' ? left | right : op === 'xor' ? left ^ right : left & right;
      this.cf = this.of = false; const value = this.flags(v,bits); if (op !== 'test') put(value);
    } else if (['add','sub','cmp','inc','dec','neg','adc','sbb'].includes(op)) {
      const carry = this.cf, left = op === 'neg' ? 0n : a();
      const right = op === 'inc' || op === 'dec' ? 1n : op === 'neg' ? a() : b();
      const subtract = ['sub','cmp','dec','neg','sbb'].includes(op);
      const carryIn = (op === 'adc' || op === 'sbb') && carry ? 1n : 0n;
      const raw = subtract ? left - right - carryIn : left + right + carryIn;
      const value = this.flags(raw,bits), sign = 1n << BigInt(bits-1);
      this.cf = subtract ? left < right + carryIn : raw >= (1n << BigInt(bits));
      this.of = Boolean((subtract ? (left ^ right) & (left ^ value) : ~(left ^ right) & (left ^ value)) & sign);
      if (op === 'inc' || op === 'dec') this.cf = carry;
      if (op !== 'cmp') put(value);
    } else throw nativeFault('unsupported', Code.UnsupportedOpcode, `IR operation not implemented: ${op}`);
    return 'continue';
  }
}
