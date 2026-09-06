import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { runCompatibilityBytes } from '../../electron/compat-runtime/index.js';
import { GuestMemory } from '../../electron/compat-runtime/memory.js';
import { Cpu, decode } from '../../electron/compat-runtime/cpu.js';
import { makeThinX64Executable } from '../native-runtime/fixtures.js';

describe('MVM CPU compatibility engine', () => {
  test('runs a compiler-produced macOS executable through libc, file IO and Objective-C', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(),'mvm-compiled-'));
    try {
      await mkdir(path.join(root,'Contents','Resources'),{recursive:true});
      const message = 'A real Windows file read by macOS machine code.';
      await writeFile(path.join(root,'Contents','Resources','message.txt'),message);
      const alerts: unknown[] = [];
      const result = await runCompatibilityBytes(await readFile('resources/samples/MVMProbe'),{
        fileBridgeRoot:root,
        showAlert: async alert => { alerts.push(alert); return 0; },
      });
      expect(result,JSON.stringify(result)).toMatchObject({status:'completed',exitCode:42,dialogsShown:1});
      expect(result.stdout).toContain(message);
      expect(result.stdout).toContain('NSAlert host bridge completed.');
      expect(result.executedInstructionCount).toBeGreaterThan(200);
      expect(result.hostCalls).toContain('_objc_msgSend');
      expect(alerts).toEqual([{message:'MVM Probe - macOS application on Windows',detail:message,buttons:['Continue']}]);
    } finally { await rm(root,{recursive:true,force:true}); }
  });
  test('stops infinite backward branches at the execution budget',async()=>{
    const r = await runCompatibilityBytes(makeThinX64Executable([0xeb,0xfe]),{instructionBudget:50});
    expect(r).toMatchObject({status:'blocked',code:'INSTRUCTION_BUDGET_EXCEEDED',executedInstructionCount:50,translatedInstructionCount:1});
  });
  test('handles direct calls and returns',async()=>{
    const r = await runCompatibilityBytes(makeThinX64Executable([0xe8,1,0,0,0,0xc3,0xb8,42,0,0,0,0xc3]));
    expect(r).toMatchObject({status:'completed',exitCode:42});
  });
  test('rejects writes to executable text',async()=>{
    const r = await runCompatibilityBytes(makeThinX64Executable([0xc6,5,0xf9,0xff,0xff,0xff,0x90,0xc3]));
    expect(r).toMatchObject({status:'blocked',code:'ADDRESS_BOUNDS'});
  });
  test('unknown imports and missing GUI are reported with captured output',async()=>{
    const r = await runCompatibilityBytes(makeThinX64Executable([0xb8,0xff,0xff,0,2,0x0f,5]));
    expect(r.status).toBe('unsupported');
    expect(r.message).toContain('Darwin syscall');
  });
  test('virtual Darwin write captures stdout without host syscall execution',async()=>{
    const code = [0xb8,4,0,0,2,0xbf,1,0,0,0,0x48,0x8d,0x35,8,0,0,0,0xba,3,0,0,0,0x0f,5,0xc3,0x4f,0x4b,10];
    const r = await runCompatibilityBytes(makeThinX64Executable(code));
    expect(r).toMatchObject({status:'completed',stdout:'OK\n',exitCode:3});
  });
  test('CPU computes overflow, carry, sign, zero and 32-bit zero extension',()=>{
    const m = new GuestMemory(); m.map(0x1000n,16,5,'text',Buffer.from([0x83,0xc0,1,0x83,0xf8,0,0x90]));
    const cpu = new Cpu(m,0x1000n,4096); cpu.r[0]=0xffffffffffffffffn;
    cpu.step(decode(m,cpu.pc));
    expect(cpu.r[0]).toBe(0n); expect(cpu.cf).toBe(true); expect(cpu.zf).toBe(true); expect(cpu.of).toBe(false);
    cpu.r[0]=0x80000000n; cpu.step(decode(m,cpu.pc));
    expect(cpu.sf).toBe(true); expect(cpu.of).toBe(false);
  });
  test('MOVZX and MOVSX read AH while REX selects SPL',()=>{
    const m = new GuestMemory(); m.map(0x1000n,16,5,'text',Buffer.from([0x0f,0xb6,0xcc,0x0f,0xbe,0xd4,0x40,0x0f,0xb6,0xdc]));
    const cpu = new Cpu(m,0x1000n,4096); cpu.r[0]=0x8000n; cpu.r[4]=0x55n;
    cpu.step(decode(m,cpu.pc)); expect(cpu.r[1]).toBe(0x80n);
    cpu.step(decode(m,cpu.pc)); expect(cpu.r[2]).toBe(0xffffff80n);
    cpu.step(decode(m,cpu.pc)); expect(cpu.r[3]).toBe(0x55n);
  });
  test('Darwin exit preserves the requested exit code',async()=>{
    const r = await runCompatibilityBytes(makeThinX64Executable([0xb8,1,0,0,2,0xbf,42,0,0,0,0x0f,5]));
    expect(r).toMatchObject({status:'completed',exitCode:42});
  });
});
