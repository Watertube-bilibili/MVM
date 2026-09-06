import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { NativeFileBridge } from '../native-runtime/file-bridge.js';
import { NativeRuntimeFault, nativeFault } from '../native-runtime/fault.js';
import { NativeRuntimeCode as Code, type NativeRunResult } from '../native-runtime/types.js';
import { loadExecutable } from './loader.js';
import { Cpu, decode, type Instruction } from './cpu.js';
import { DarwinHost, type HostOptions } from './host.js';

export interface CompatibilityOptions extends HostOptions { instructionBudget?: number; stackBytes?: number }
export type CompatibilityResult = NativeRunResult & {
  engine: 'MVM-CPU/2'; stdout: string; stderr: string; dialogsShown: number; hostCalls: string[];
};

export async function runCompatibilityBytes(bytes: Uint8Array, options: CompatibilityOptions = {}): Promise<CompatibilityResult> {
  let loaded: ReturnType<typeof loadExecutable> | undefined;
  let host: DarwinHost | undefined;
  let executed = 0;
  const cache = new Map<bigint,Instruction>();
  const context = () => ({
    engine: 'MVM-CPU/2' as const, stdout: host?.stdout ?? '', stderr: host?.stderr ?? '', dialogsShown: host?.dialogsShown ?? 0, hostCalls: host?.calls ?? [],
    translatedInstructionCount: cache.size, executedInstructionCount: executed,
    ...(loaded ? {selectedSliceOffset:loaded.image.selectedSliceOffset,selectedSliceSize:loaded.image.selectedSliceSize,entryOffset:loaded.image.entryOffset,entryFileOffset:loaded.image.entryFileOffset} : {}),
  });
  try {
    const budget = options.instructionBudget ?? 1000000, stack = options.stackBytes ?? 1024*1024;
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 10000000 || !Number.isSafeInteger(stack) || stack < 1024 || stack > 16*1024*1024 || bytes.length > 64*1024*1024) throw nativeFault('blocked',Code.InputInvalid,'Invalid engine resource limits.');
    loaded = loadExecutable(bytes);
    const cpu = new Cpu(loaded.memory,loaded.image.entryVmAddress,stack);
    host = new DarwinHost(cpu,options);
    // LC_MAIN uses the Darwin/System V integer argument registers.
    const argv = host.allocate(16); loaded.memory.write(argv,host.string('MVMApplication'),64); loaded.memory.write(argv+8n,0n,64);
    cpu.r[7] = 1n; cpu.r[6] = argv;
    const envp = host.allocate(8); loaded.memory.write(envp,0n,64); cpu.r[2] = envp;
    for (; executed < budget;) {
      if ((executed & 1023) === 0) await setImmediate();
      const imported = loaded.imports.get(cpu.pc);
      if (imported !== undefined) {
        await host.invoke(imported); executed++;
        if (!host.exitRequested) cpu.pc = cpu.pop();
        if (cpu.pc === cpu.returnSentinel) {
          if(cpu.r[4]!==cpu.initialSp+8n) throw nativeFault('blocked',Code.UnbalancedStack,'Entry returned with an unbalanced stack.');
          host.exited = true;
        }
      } else {
        let instruction = cache.get(cpu.pc);
        if (!instruction) {
          if (cache.size >= 100000) throw nativeFault('blocked',Code.TranslationLimit,'Instruction translation cache exhausted.');
          instruction = decode(loaded.memory,cpu.pc); cache.set(cpu.pc,instruction);
        }
        const action = cpu.step(instruction); executed++;
        if (action === 'syscall') await host.syscall();
        if (action === 'returned') host.exited = true;
      }
      if (host.exited) {
        const exitCode = host.exitRequested ? host.exitCode : Number(cpu.r[0]! & 0xffffffffn);
        return {...context(),status:'completed',code:'OK',message:`Program finished in MVM-CPU/2; exit code ${exitCode}.`,returnValue:cpu.r[0]!.toString(),exitCode};
      }
    }
    throw nativeFault('blocked',Code.InstructionBudgetExceeded,'Program instruction budget exhausted.');
  } catch (error) {
    const fault = error instanceof NativeRuntimeFault ? error : nativeFault('blocked',Code.MachOMalformed,error instanceof Error ? error.message : 'Engine failure.');
    return {...context(),status:fault.status,code:fault.code,message:fault.message};
  }
}

export async function runCompatibilityExecutable(filePath: string, options: CompatibilityOptions = {}): Promise<CompatibilityResult> {
  try {
    const root = options.fileBridgeRoot ?? path.dirname(filePath);
    const bridge = new NativeFileBridge({rootPath:root,maxFileBytes:64*1024*1024,maxTotalBytes:64*1024*1024});
    const bytes = await bridge.readFile(path.relative(root,filePath));
    return await runCompatibilityBytes(bytes,options);
  } catch (error) {
    return {engine:'MVM-CPU/2',status:'blocked',code:Code.FileIoError,message:error instanceof Error ? error.message : 'Executable read failed.',translatedInstructionCount:0,executedInstructionCount:0,stdout:'',stderr:'',hostCalls:[],dialogsShown:0};
  }
}
