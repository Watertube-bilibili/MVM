import { NativeFileBridge } from '../native-runtime/file-bridge.js';
import { nativeFault } from '../native-runtime/fault.js';
import { NativeRuntimeCode as Code } from '../native-runtime/types.js';
import { Cpu } from './cpu.js';

export interface AlertRequest { message: string; detail: string; buttons: string[] }
export interface HostOptions {
  fileBridgeRoot?: string;
  showAlert?: (request: AlertRequest) => Promise<number>;
}
interface Obj { kind: string; text?: string; detail?: string; buttons?: string[] }

/** Small explicit Darwin/libSystem/Objective-C ABI bridge, with no arbitrary host calls. */
export class DarwinHost {
  public stdout = '';
  public stderr = '';
  public exited = false;
  public exitCode = 0;
  public exitRequested = false;
  public dialogsShown = 0;
  public readonly calls: string[] = [];
  private readonly descriptors = new Map<number, { bytes: Uint8Array; offset: number }>();
  private readonly objects = new Map<bigint, Obj>();
  private readonly selectors = new Map<string, bigint>();
  private readonly bridge: NativeFileBridge | undefined;
  private heap = 0x600000000000n;
  private readonly heapEnd = 0x600001000000n;
  private nextFd = 3;
  public constructor(private readonly cpu: Cpu, private readonly options: HostOptions) {
    cpu.memory.map(this.heap, Number(this.heapEnd - this.heap), 3, 'libSystem heap');
    this.bridge = options.fileBridgeRoot ? new NativeFileBridge({ rootPath: options.fileBridgeRoot, maxFileBytes: 8 * 1024 * 1024, maxTotalBytes: 32 * 1024 * 1024 }) : undefined;
  }
  private arg(i: number): bigint { return this.cpu.r[[7,6,2,1,8,9][i]!]!; }
  private result(v: bigint | number): void { this.cpu.r[0] = BigInt.asUintN(64,BigInt(v)); }
  private size(v: bigint, max = 1024 * 1024): number {
    if (v < 0n || v > BigInt(max)) throw nativeFault('blocked', Code.AddressBounds, 'Host-call buffer exceeds its limit.');
    return Number(v);
  }
  public allocate(size: number): bigint {
    const address = this.heap; this.heap += BigInt(Math.max(16, Math.ceil(size / 16) * 16));
    if (this.heap > this.heapEnd) throw nativeFault('blocked', Code.AddressBounds, 'Guest heap exhausted.');
    return address;
  }
  public string(text: string): bigint {
    const bytes = Buffer.from(text + '\0','utf8'), ptr = this.allocate(bytes.length);
    this.cpu.memory.view(ptr,bytes.length,2).set(bytes); return ptr;
  }
  private object(obj: Obj): bigint { const p = this.allocate(16); this.objects.set(p,obj); return p; }
  private text(p: bigint): string {
    const obj = this.objects.get(p);
    if (!obj || obj.kind !== 'NSString') throw nativeFault('unsupported', Code.MachOUnsupported, 'Expected an NSString from the supported Objective-C bridge.');
    return obj.text ?? '';
  }
  private output(fd: number, bytes: Uint8Array): number {
    const text = Buffer.from(bytes).toString('utf8');
    if (Buffer.byteLength(this.stdout) + Buffer.byteLength(this.stderr) + bytes.length > 256 * 1024) throw nativeFault('blocked', Code.AddressBounds, 'Program output limit exceeded.');
    if (fd === 1) this.stdout += text;
    else if (fd === 2) this.stderr += text;
    else return -1;
    return bytes.length;
  }
  private async open(p: bigint, flags: bigint): Promise<number> {
    if (!this.bridge || flags !== 0n || this.descriptors.size >= 64) return -1;
    const name = this.cpu.memory.cstring(p);
    const relative = name.startsWith('/mvm/shared/') ? name.slice('/mvm/shared/'.length) : name;
    try {
      const bytes = await this.bridge.readFile(relative);
      const fd = this.nextFd++; this.descriptors.set(fd,{bytes,offset:0}); return fd;
    } catch { return -1; }
  }
  private read(fd: number, p: bigint, count: bigint): number {
    const d = this.descriptors.get(fd); if (!d) return -1;
    const n = Math.min(this.size(count), d.bytes.length - d.offset);
    this.cpu.memory.view(p,n,2).set(d.bytes.subarray(d.offset,d.offset+n)); d.offset += n; return n;
  }
  public async syscall(): Promise<void> {
    const number = Number(this.cpu.r[0]!);
    if (this.calls.length < 2048) this.calls.push(`syscall:${number.toString(16)}`);
    let result: number;
    switch (number) {
      case 0x2000001: this.exited = this.exitRequested = true; this.exitCode = Number(this.cpu.r[7]! & 255n); return;
      case 0x2000003: result = this.read(Number(this.cpu.r[7]!),this.cpu.r[6]!,this.cpu.r[2]!); break;
      case 0x2000004: result = this.output(Number(this.cpu.r[7]!),this.cpu.memory.view(this.cpu.r[6]!,this.size(this.cpu.r[2]!))); break;
      case 0x2000005: result = await this.open(this.cpu.r[7]!,this.cpu.r[6]!); break;
      case 0x2000006: result = this.descriptors.delete(Number(this.cpu.r[7]!)) ? 0 : -1; break;
      default: throw nativeFault('unsupported', Code.MachOUnsupported, `Darwin syscall 0x${number.toString(16)} is not implemented.`);
    }
    this.cpu.cf = result < 0;
    this.result(result < 0 ? 9 : result);
  }
  public async invoke(symbol: string): Promise<void> {
    if (this.calls.length < 2048) this.calls.push(symbol);
    const name = symbol.replace(/^_/, '');
    const a = this.arg(0), b = this.arg(1), c = this.arg(2);
    const memory = this.cpu.memory;
    if (name === 'NSApplicationLoad') this.result(1);
    else if (name === 'puts') this.result(this.output(1,Buffer.from(memory.cstring(a) + '\n')));
    else if (name === 'write') this.result(this.output(Number(a),memory.view(b,this.size(c))));
    else if (name === 'read') this.result(this.read(Number(a),b,c));
    else if (name === 'open') this.result(await this.open(a,b));
    else if (name === 'close') this.result(this.descriptors.delete(Number(a)) ? 0 : -1);
    else if (name === 'strlen') this.result(Buffer.byteLength(memory.cstring(a)));
    else if (name === 'strcmp' || name === 'strncmp') {
      const left = Buffer.from(memory.cstring(a)), right = Buffer.from(memory.cstring(b));
      this.result(Buffer.compare(name === 'strncmp' ? left.subarray(0,this.size(c)) : left,name === 'strncmp' ? right.subarray(0,this.size(c)) : right));
    } else if (name === 'malloc' || name === 'calloc') this.result(this.allocate(this.size(name === 'calloc' ? a*b : a,16*1024*1024)));
    else if (name === 'free') this.result(0);
    else if (name === 'memcpy' || name === 'memmove') { const n = this.size(c); memory.view(a,n,2).set(Buffer.from(memory.view(b,n))); this.result(a); }
    else if (name === 'memset') { memory.view(a,this.size(c),2).fill(Number(b & 255n)); this.result(a); }
    else if (name === 'exit' || name === '_exit') { this.exited = this.exitRequested = true; this.exitCode = Number(a & 255n); }
    else if (name === 'objc_getClass') {
      const cls = memory.cstring(a);
      if (!['NSAlert','NSString','NSAutoreleasePool'].includes(cls)) throw nativeFault('unsupported', Code.MachOUnsupported, `Objective-C class ${cls} is not implemented.`);
      this.result(this.object({kind:'class',text:cls}));
    } else if (name === 'sel_registerName') {
      const text = memory.cstring(a); let selector = this.selectors.get(text);
      if (selector === undefined) { selector = this.string(text); this.selectors.set(text,selector); }
      this.result(selector);
    } else if (name === 'objc_autoreleasePoolPush') this.result(this.object({kind:'NSAutoreleasePool'}));
    else if (name === 'objc_autoreleasePoolPop') this.result(0);
    else if (name === 'objc_msgSend') await this.message(a,b,c);
    else throw nativeFault('unsupported', Code.MachOUnsupported, `Unimplemented imported function: ${symbol}`);
  }
  private async message(receiver: bigint, selector: bigint, argument: bigint): Promise<void> {
    if (receiver === 0n) { this.result(0); return; }
    const obj = this.objects.get(receiver), name = this.cpu.memory.cstring(selector);
    if (!obj) throw nativeFault('unsupported', Code.MachOUnsupported, `Unrecognized Objective-C receiver for ${name}.`);
    if (obj.kind === 'class' && name === 'alloc') this.result(this.object({kind:obj.text!}));
    else if (obj.kind === 'class' && obj.text === 'NSString' && name === 'stringWithUTF8String:') this.result(this.object({kind:'NSString',text:this.cpu.memory.cstring(argument)}));
    else if (name === 'init') this.result(receiver);
    else if (name === 'release' || name === 'drain') { this.objects.delete(receiver); this.result(0); }
    else if (name === 'autorelease' || name === 'retain') this.result(receiver);
    else if (obj.kind === 'NSString' && name === 'UTF8String') this.result(this.string(obj.text ?? ''));
    else if (obj.kind === 'NSAlert' && name === 'setMessageText:') { obj.text = this.text(argument); this.result(0); }
    else if (obj.kind === 'NSAlert' && name === 'setInformativeText:') { obj.detail = this.text(argument); this.result(0); }
    else if (obj.kind === 'NSAlert' && name === 'addButtonWithTitle:') { obj.buttons ??= []; if (obj.buttons.length >= 8) throw nativeFault('blocked',Code.AddressBounds,'Too many dialog buttons.'); obj.buttons.push(this.text(argument)); this.result(0); }
    else if (obj.kind === 'NSAlert' && name === 'runModal') {
      if (!this.options.showAlert) throw nativeFault('unsupported',Code.MachOUnsupported,'This host has no NSAlert window bridge.');
      if (this.dialogsShown >= 8) throw nativeFault('blocked',Code.AddressBounds,'Dialog limit exceeded.');
      const response = await this.options.showAlert({message:obj.text ?? '',detail:obj.detail ?? '',buttons:obj.buttons?.length ? obj.buttons : ['OK']});
      this.dialogsShown++; this.result(1000 + response);
    } else throw nativeFault('unsupported',Code.MachOUnsupported,`Objective-C method ${obj.kind}.${name} is not implemented.`);
  }
}
