export type NativeRunStatus = "completed" | "unsupported" | "blocked";

export const NativeRuntimeCode = {
  Ok: "OK",
  InputInvalid: "INPUT_INVALID",
  FileIoError: "FILE_IO_ERROR",
  FileTooLarge: "FILE_TOO_LARGE",
  MachOUnsupported: "MACHO_UNSUPPORTED",
  ArchitectureUnsupported: "ARCHITECTURE_UNSUPPORTED",
  MachOMalformed: "MACHO_MALFORMED",
  EntryPointInvalid: "ENTRYPOINT_INVALID",
  UnsupportedOpcode: "UNSUPPORTED_OPCODE",
  ForbiddenInstruction: "FORBIDDEN_INSTRUCTION",
  TranslationLimit: "TRANSLATION_LIMIT",
  InstructionBudgetExceeded: "INSTRUCTION_BUDGET_EXCEEDED",
  StackBounds: "STACK_BOUNDS",
  UnbalancedStack: "UNBALANCED_STACK",
  AddressBounds: "ADDRESS_BOUNDS",
  ProgramDidNotReturn: "PROGRAM_DID_NOT_RETURN",
  FileBridgeRejected: "FILE_BRIDGE_REJECTED",
} as const;

export type NativeRuntimeCode =
  (typeof NativeRuntimeCode)[keyof typeof NativeRuntimeCode];

export interface NativeFileMountMetadata {
  readonly kind: "windows-directory";
  readonly guestRoot: "/mvm/shared";
  readonly hostRoot: string;
  readonly readOnly: true;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
}

export interface NativeRunOptions {
  /** Maximum number of MVM IR instructions that may execute. */
  readonly instructionBudget?: number;
  /** Maximum size of the Mach-O file read from disk. */
  readonly maxFileBytes?: number;
  /** Size of the isolated MVM stack. */
  readonly stackBytes?: number;
  /** Maximum number of x86-64 instructions accepted during translation. */
  readonly maxTranslatedInstructions?: number;
  /** Optional explicit Windows directory exposed as a read-only future mount. */
  readonly fileBridgeRoot?: string;
  /** Optional explicit root that must contain the executable after realpath resolution. */
  readonly executableRoot?: string;
  readonly maxSharedFileBytes?: number;
  readonly maxSharedTotalBytes?: number;
}

export interface NativeRunBase {
  readonly status: NativeRunStatus;
  readonly code: NativeRuntimeCode;
  readonly message: string;
  readonly selectedSliceOffset?: number;
  readonly selectedSliceSize?: number;
  /** LC_MAIN entryoff, relative to the selected Mach-O slice. */
  readonly entryOffset?: number;
  /** Absolute byte offset in the container file. */
  readonly entryFileOffset?: number;
  readonly translatedInstructionCount: number;
  readonly executedInstructionCount: number;
  readonly mount?: NativeFileMountMetadata;
}

export interface NativeRunCompleted extends NativeRunBase {
  readonly status: "completed";
  readonly code: typeof NativeRuntimeCode.Ok;
  /** Unsigned 64-bit RAX rendered in decimal for lossless IPC. */
  readonly returnValue: string;
  /** Low 32 bits of RAX. */
  readonly exitCode: number;
}

export interface NativeRunFailure extends NativeRunBase {
  readonly status: "unsupported" | "blocked";
  readonly code: Exclude<NativeRuntimeCode, typeof NativeRuntimeCode.Ok>;
}

export type NativeRunResult = NativeRunCompleted | NativeRunFailure;

interface IrSource {
  /** Byte offset inside the selected thin Mach-O slice. */
  readonly sourceOffset: number;
  readonly byteLength: number;
}

export type MvmIrInstruction =
  | (IrSource & { readonly opcode: "nop" })
  | (IrSource & { readonly opcode: "return" })
  | (IrSource & { readonly opcode: "push-rbp" })
  | (IrSource & { readonly opcode: "pop-rbp" })
  | (IrSource & { readonly opcode: "move-rbp-rsp" })
  | (IrSource & { readonly opcode: "move-eax-immediate"; readonly immediate: number })
  | (IrSource & { readonly opcode: "move-rax-immediate"; readonly immediate: bigint })
  | (IrSource & { readonly opcode: "xor-eax" })
  | (IrSource & { readonly opcode: "add-eax-immediate"; readonly immediate: number })
  | (IrSource & { readonly opcode: "sub-eax-immediate"; readonly immediate: number })
  | (IrSource & { readonly opcode: "adjust-rsp"; readonly delta: number });

export interface MvmTranslatedProgram {
  readonly irVersion: 1;
  readonly architecture: "x86_64";
  readonly selectedSliceOffset: number;
  readonly selectedSliceSize: number;
  readonly entryOffset: number;
  readonly entryFileOffset: number;
  readonly entryVmAddress: string;
  readonly textFileOffset: number;
  readonly textFileSize: number;
  readonly instructions: readonly MvmIrInstruction[];
}

export interface NativeRuntimeProbe {
  readonly id: "mvm-native-runtime";
  readonly name: "MVM Native Micro-Translator";
  readonly version: "MVM-IR/1";
  readonly backend: "native-windows";
  readonly available: boolean;
  readonly detail: string;
}
