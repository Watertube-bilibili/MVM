import { nativeFault, type NativeRuntimeFault } from "./fault.js";
import { NativeRuntimeCode, type MvmTranslatedProgram } from "./types.js";

const UINT32_MASK = 0xffff_ffffn;

export interface NativeExecutionCompleted {
  readonly completed: true;
  readonly rax: bigint;
  readonly exitCode: number;
  readonly executedInstructionCount: number;
  readonly minimumStackPointer: number;
}

export interface NativeExecutionBlocked {
  readonly completed: false;
  readonly fault: NativeRuntimeFault;
  readonly executedInstructionCount: number;
  readonly minimumStackPointer: number;
}

export type NativeExecutionOutcome = NativeExecutionCompleted | NativeExecutionBlocked;

function asUint32(value: bigint): bigint {
  return value & UINT32_MASK;
}

export function executeMvmProgram(
  program: MvmTranslatedProgram,
  instructionBudget: number,
  stackBytes: number,
): NativeExecutionOutcome {
  const stack = new Uint8Array(stackBytes);
  const stackView = new DataView(stack.buffer, stack.byteOffset, stack.byteLength);
  const textEnd = program.textFileOffset + program.textFileSize;
  let rax = 0n;
  let rbp = 0n;
  let rsp = stackBytes;
  let minimumStackPointer = rsp;
  let executedInstructionCount = 0;

  const blocked = (fault: NativeRuntimeFault): NativeExecutionBlocked => ({
    completed: false,
    fault,
    executedInstructionCount,
    minimumStackPointer,
  });

  for (const instruction of program.instructions) {
    if (executedInstructionCount >= instructionBudget) {
      return blocked(
        nativeFault(
          "blocked",
          NativeRuntimeCode.InstructionBudgetExceeded,
          "MVM stopped the program at its instruction budget.",
          { instructionBudget },
        ),
      );
    }
    if (
      instruction.sourceOffset < program.textFileOffset ||
      instruction.byteLength <= 0 ||
      instruction.sourceOffset > textEnd ||
      instruction.byteLength > textEnd - instruction.sourceOffset
    ) {
      return blocked(
        nativeFault(
          "blocked",
          NativeRuntimeCode.AddressBounds,
          "An MVM IR instruction points outside executable __TEXT bytes.",
          { sourceOffset: instruction.sourceOffset, byteLength: instruction.byteLength },
        ),
      );
    }

    executedInstructionCount += 1;
    switch (instruction.opcode) {
      case "nop":
        break;
      case "push-rbp":
        if (rsp < 8) {
          return blocked(
            nativeFault(
              "blocked",
              NativeRuntimeCode.StackBounds,
              "The isolated MVM stack overflowed during PUSH RBP.",
            ),
          );
        }
        rsp -= 8;
        stackView.setBigUint64(rsp, BigInt.asUintN(64, rbp), true);
        minimumStackPointer = Math.min(minimumStackPointer, rsp);
        break;
      case "pop-rbp":
        if (rsp > stackBytes - 8) {
          return blocked(
            nativeFault(
              "blocked",
              NativeRuntimeCode.StackBounds,
              "The isolated MVM stack underflowed during POP RBP.",
            ),
          );
        }
        rbp = stackView.getBigUint64(rsp, true);
        rsp += 8;
        break;
      case "move-rbp-rsp":
        rbp = BigInt(rsp);
        break;
      case "move-eax-immediate":
        rax = BigInt(instruction.immediate >>> 0);
        break;
      case "move-rax-immediate":
        rax = BigInt.asUintN(64, instruction.immediate);
        break;
      case "xor-eax":
        rax = 0n;
        break;
      case "add-eax-immediate":
        rax = asUint32(asUint32(rax) + BigInt(instruction.immediate));
        break;
      case "sub-eax-immediate":
        rax = asUint32(asUint32(rax) - BigInt(instruction.immediate));
        break;
      case "adjust-rsp": {
        const nextStackPointer = rsp + instruction.delta;
        if (
          !Number.isSafeInteger(nextStackPointer) ||
          nextStackPointer < 0 ||
          nextStackPointer > stackBytes
        ) {
          return blocked(
            nativeFault(
              "blocked",
              NativeRuntimeCode.StackBounds,
              "RSP moved outside the isolated MVM stack.",
              { rsp, delta: instruction.delta, stackBytes },
            ),
          );
        }
        rsp = nextStackPointer;
        minimumStackPointer = Math.min(minimumStackPointer, rsp);
        break;
      }
      case "return":
        if (rsp !== stackBytes) {
          return blocked(
            nativeFault(
              "blocked",
              NativeRuntimeCode.UnbalancedStack,
              "The translated entry point returned with an unbalanced stack.",
              { rsp, initialRsp: stackBytes },
            ),
          );
        }
        return {
          completed: true,
          rax: BigInt.asUintN(64, rax),
          exitCode: Number(rax & UINT32_MASK),
          executedInstructionCount,
          minimumStackPointer,
        };
    }
  }

  return blocked(
    nativeFault(
      "blocked",
      NativeRuntimeCode.ProgramDidNotReturn,
      "MVM IR ended without a return instruction.",
    ),
  );
}
