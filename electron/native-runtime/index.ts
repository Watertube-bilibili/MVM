import { lstat } from "node:fs/promises";
import path from "node:path";

import { executeMvmProgram } from "./executor.js";
import { NativeRuntimeFault, nativeFault } from "./fault.js";
import {
  NativeFileBridge,
  NativeFileBridgeCode,
  NativeFileBridgeError,
} from "./file-bridge.js";
import { parseMachOImage, type ParsedMachOImage } from "./macho-loader.js";
import {
  NativeRuntimeCode,
  type MvmTranslatedProgram,
  type NativeFileMountMetadata,
  type NativeRunFailure,
  type NativeRunOptions,
  type NativeRunResult,
  type NativeRuntimeProbe,
} from "./types.js";
import { translateX64EntryPoint } from "./x64-translator.js";

const DEFAULT_INSTRUCTION_BUDGET = 100_000;
const DEFAULT_MAX_FILE_BYTES = 128 * 1024 * 1024;
const DEFAULT_STACK_BYTES = 64 * 1024;
const DEFAULT_MAX_TRANSLATED_INSTRUCTIONS = 100_000;

interface NormalizedOptions {
  readonly instructionBudget: number;
  readonly maxFileBytes: number;
  readonly stackBytes: number;
  readonly maxTranslatedInstructions: number;
  readonly fileBridgeRoot?: string;
  readonly executableRoot?: string;
  readonly maxSharedFileBytes?: number;
  readonly maxSharedTotalBytes?: number;
}

interface ResultContext {
  readonly image?: ParsedMachOImage | undefined;
  readonly program?: MvmTranslatedProgram | undefined;
  readonly executedInstructionCount?: number | undefined;
}

export const NATIVE_RUNTIME_PROBE: NativeRuntimeProbe = Object.freeze({
  id: "mvm-native-runtime",
  name: "MVM Native Micro-Translator",
  version: "MVM-IR/1",
  backend: "native-windows",
  available: process.platform === "win32" && process.arch === "x64",
  detail:
    process.platform === "win32" && process.arch === "x64"
      ? "Process-local Mach-O x86_64 to MVM-IR/1 translation is available; WSL is not used."
      : "MVM-IR/1 is intended for a Windows x64 host.",
});

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < minimum || selected > maximum) {
    throw nativeFault(
      "blocked",
      NativeRuntimeCode.InputInvalid,
      `${label} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return selected;
}

function normalizeOptions(options: NativeRunOptions): NormalizedOptions {
  return {
    instructionBudget: boundedInteger(
      options.instructionBudget,
      DEFAULT_INSTRUCTION_BUDGET,
      1,
      10_000_000,
      "instructionBudget",
    ),
    maxFileBytes: boundedInteger(
      options.maxFileBytes,
      DEFAULT_MAX_FILE_BYTES,
      32,
      1024 * 1024 * 1024,
      "maxFileBytes",
    ),
    stackBytes: boundedInteger(
      options.stackBytes,
      DEFAULT_STACK_BYTES,
      64,
      16 * 1024 * 1024,
      "stackBytes",
    ),
    maxTranslatedInstructions: boundedInteger(
      options.maxTranslatedInstructions,
      DEFAULT_MAX_TRANSLATED_INSTRUCTIONS,
      1,
      1_000_000,
      "maxTranslatedInstructions",
    ),
    ...(options.fileBridgeRoot === undefined ? {} : { fileBridgeRoot: options.fileBridgeRoot }),
    ...(options.executableRoot === undefined ? {} : { executableRoot: options.executableRoot }),
    ...(options.maxSharedFileBytes === undefined
      ? {}
      : { maxSharedFileBytes: options.maxSharedFileBytes }),
    ...(options.maxSharedTotalBytes === undefined
      ? {}
      : { maxSharedTotalBytes: options.maxSharedTotalBytes }),
  };
}

function createMount(options: NormalizedOptions): NativeFileMountMetadata | undefined {
  if (options.fileBridgeRoot === undefined) {
    return undefined;
  }
  return new NativeFileBridge({
    rootPath: options.fileBridgeRoot,
    ...(options.maxSharedFileBytes === undefined
      ? {}
      : { maxFileBytes: options.maxSharedFileBytes }),
    ...(options.maxSharedTotalBytes === undefined
      ? {}
      : { maxTotalBytes: options.maxSharedTotalBytes }),
  }).mount;
}

function failureResult(
  fault: NativeRuntimeFault,
  context: ResultContext,
  mount?: NativeFileMountMetadata,
): NativeRunFailure {
  const source = context.program ?? context.image;
  return {
    status: fault.status,
    code: fault.code,
    message: fault.message,
    ...(source === undefined
      ? {}
      : {
          selectedSliceOffset: source.selectedSliceOffset,
          selectedSliceSize: source.selectedSliceSize,
          entryOffset: source.entryOffset,
          entryFileOffset: source.entryFileOffset,
        }),
    translatedInstructionCount: context.program?.instructions.length ?? 0,
    executedInstructionCount: context.executedInstructionCount ?? 0,
    ...(mount === undefined ? {} : { mount }),
  };
}

function bridgeFault(error: NativeFileBridgeError): NativeRuntimeFault {
  const code =
    error.code === NativeFileBridgeCode.FileTooLarge
      ? NativeRuntimeCode.FileTooLarge
      : NativeRuntimeCode.FileBridgeRejected;
  return nativeFault("blocked", code, error.message);
}

function internalRun(
  bytes: Uint8Array,
  options: NormalizedOptions,
  mount?: NativeFileMountMetadata,
): NativeRunResult {
  let image: ParsedMachOImage | undefined;
  let program: MvmTranslatedProgram | undefined;
  try {
    if (bytes.byteLength > options.maxFileBytes) {
      throw nativeFault(
        "blocked",
        NativeRuntimeCode.FileTooLarge,
        "Mach-O executable exceeds the configured file limit.",
        { fileBytes: bytes.byteLength, maxFileBytes: options.maxFileBytes },
      );
    }
    image = parseMachOImage(bytes);
    program = translateX64EntryPoint(image, options.maxTranslatedInstructions);
    const execution = executeMvmProgram(program, options.instructionBudget, options.stackBytes);
    if (!execution.completed) {
      return failureResult(
        execution.fault,
        {
          image,
          program,
          executedInstructionCount: execution.executedInstructionCount,
        },
        mount,
      );
    }
    return {
      status: "completed",
      code: NativeRuntimeCode.Ok,
      message: "The LC_MAIN entry point completed inside MVM-IR/1.",
      selectedSliceOffset: program.selectedSliceOffset,
      selectedSliceSize: program.selectedSliceSize,
      entryOffset: program.entryOffset,
      entryFileOffset: program.entryFileOffset,
      translatedInstructionCount: program.instructions.length,
      executedInstructionCount: execution.executedInstructionCount,
      returnValue: execution.rax.toString(),
      exitCode: execution.exitCode,
      ...(mount === undefined ? {} : { mount }),
    };
  } catch (error) {
    if (error instanceof NativeRuntimeFault) {
      return failureResult(error, { image, program }, mount);
    }
    if (error instanceof NativeFileBridgeError) {
      return failureResult(bridgeFault(error), { image, program }, mount);
    }
    return failureResult(
      nativeFault(
        "blocked",
        NativeRuntimeCode.MachOMalformed,
        "MVM rejected the executable after an internal validation failure.",
      ),
      { image, program },
      mount,
    );
  }
}

/** Translate and execute an in-memory Mach-O image without JIT or host syscalls. */
export function runMachOBytes(bytes: Uint8Array, options: NativeRunOptions = {}): NativeRunResult {
  try {
    const normalized = normalizeOptions(options);
    const mount = createMount(normalized);
    return internalRun(bytes, normalized, mount);
  } catch (error) {
    if (error instanceof NativeRuntimeFault) {
      return failureResult(error, {});
    }
    if (error instanceof NativeFileBridgeError) {
      return failureResult(bridgeFault(error), {});
    }
    return failureResult(
      nativeFault("blocked", NativeRuntimeCode.InputInvalid, "Native runtime options are invalid."),
      {},
    );
  }
}

async function securelyReadExecutable(
  filePath: string,
  options: NormalizedOptions,
): Promise<Uint8Array> {
  if (
    typeof filePath !== "string" ||
    filePath.length === 0 ||
    filePath.includes("\0") ||
    (process.platform === "win32"
      ? !/^[a-z]:[\\/]/iu.test(filePath) || !path.win32.isAbsolute(filePath) || filePath.startsWith("\\\\")
      : !path.posix.isAbsolute(filePath) || filePath.startsWith("//"))
  ) {
    throw nativeFault(
      "blocked",
      NativeRuntimeCode.InputInvalid,
      "Mach-O executable path must be an explicit absolute host path.",
    );
  }

  try {
    if ((await lstat(filePath)).isSymbolicLink()) {
      throw nativeFault(
        "blocked",
        NativeRuntimeCode.InputInvalid,
        "Mach-O executable path must not be a symbolic link.",
      );
    }
    const requestedRoot = options.executableRoot ?? options.fileBridgeRoot ?? path.dirname(filePath);
    const reader = new NativeFileBridge({
      rootPath: requestedRoot,
      maxFileBytes: options.maxFileBytes,
      maxTotalBytes: options.maxFileBytes,
    });
    const relativePath = path.relative(reader.rootPath, path.resolve(filePath));
    if (relativePath === "" || path.isAbsolute(relativePath) || relativePath.startsWith("..")) {
      throw nativeFault(
        "blocked",
        NativeRuntimeCode.InputInvalid,
        "Mach-O executable is outside the explicit executable root.",
      );
    }
    return await reader.readFile(relativePath);
  } catch (error) {
    if (error instanceof NativeRuntimeFault) {
      throw error;
    }
    if (error instanceof NativeFileBridgeError) {
      throw bridgeFault(error);
    }
    throw nativeFault(
      "blocked",
      NativeRuntimeCode.FileIoError,
      "Mach-O executable could not be opened for a stable read.",
    );
  }
}

/**
 * Strictly reads, translates, and executes a Mach-O entry point in the current
 * process. It never invokes child_process, WSL, eval, JIT, or executable memory.
 */
export async function runMachOExecutable(
  filePath: string,
  options: NativeRunOptions = {},
): Promise<NativeRunResult> {
  let normalized: NormalizedOptions;
  let mount: NativeFileMountMetadata | undefined;
  try {
    normalized = normalizeOptions(options);
    mount = createMount(normalized);
    const bytes = await securelyReadExecutable(filePath, normalized);
    return internalRun(bytes, normalized, mount);
  } catch (error) {
    if (error instanceof NativeRuntimeFault) {
      return failureResult(error, {}, mount);
    }
    if (error instanceof NativeFileBridgeError) {
      return failureResult(bridgeFault(error), {}, mount);
    }
    return failureResult(
      nativeFault(
        "blocked",
        NativeRuntimeCode.FileIoError,
        "Mach-O executable could not be read safely.",
      ),
      {},
      mount,
    );
  }
}

export { executeMvmProgram } from "./executor.js";
export { NativeRuntimeFault } from "./fault.js";
export {
  NativeFileBridge,
  NativeFileBridgeCode,
  NativeFileBridgeError,
} from "./file-bridge.js";
export { parseMachOImage } from "./macho-loader.js";
export { translateX64EntryPoint } from "./x64-translator.js";
export { NativeRuntimeCode } from "./types.js";
export type { NativeFileBridgeOptions } from "./file-bridge.js";
export type {
  MvmIrInstruction,
  MvmTranslatedProgram,
  NativeFileMountMetadata,
  NativeRunCompleted,
  NativeRunFailure,
  NativeRunOptions,
  NativeRunResult,
  NativeRunStatus,
  NativeRuntimeProbe,
} from "./types.js";
