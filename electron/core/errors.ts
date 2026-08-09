import type { ImportStage } from "./model.js";

export const CoreErrorCode = {
  InputNotFound: "INPUT_NOT_FOUND",
  InputPermissionDenied: "INPUT_PERMISSION_DENIED",
  InputChanged: "INPUT_CHANGED_DURING_IMPORT",
  InputTooLarge: "INPUT_TOO_LARGE",
  InputDevicePathRejected: "INPUT_DEVICE_PATH_REJECTED",
  FormatUnknown: "FORMAT_UNKNOWN",
  ExtensionMagicMismatch: "EXTENSION_MAGIC_MISMATCH",
  FormatCorrupt: "FORMAT_CORRUPT",
  EncryptedContainer: "ENCRYPTED_CONTAINER",
  UnsupportedFormat: "UNSUPPORTED_FORMAT",
  UnsupportedCompression: "UNSUPPORTED_COMPRESSION",
  UnsafePath: "UNSAFE_PATH",
  UnsafeLink: "UNSAFE_LINK",
  DuplicateArchivePath: "DUPLICATE_ARCHIVE_PATH",
  ArchivePathTypeConflict: "ARCHIVE_PATH_TYPE_CONFLICT",
  WindowsPathCollision: "WINDOWS_PATH_COLLISION",
  LimitContainerDepth: "LIMIT_CONTAINER_DEPTH",
  LimitEntryCount: "LIMIT_ENTRY_COUNT",
  LimitExpandedBytes: "LIMIT_EXPANDED_BYTES",
  LimitFileBytes: "LIMIT_FILE_BYTES",
  AppLayoutInvalid: "APP_LAYOUT_INVALID",
  PlistMissing: "PLIST_MISSING",
  PlistInvalid: "PLIST_INVALID",
  ExecutableMissing: "EXECUTABLE_MISSING",
  NotMachO: "NOT_MACHO",
  MachOMalformed: "MACHO_MALFORMED",
  UnsupportedArchitecture: "UNSUPPORTED_ARCH",
  ImportToolMissing: "IMPORT_TOOL_MISSING",
  ImportToolUnsupportedVersion: "IMPORT_TOOL_UNSUPPORTED_VERSION",
  ImportToolTimeout: "IMPORT_TOOL_TIMEOUT",
  ImportToolCrash: "IMPORT_TOOL_CRASH",
  ImportToolOutputInvalid: "IMPORT_TOOL_OUTPUT_INVALID",
  ImportCanceled: "IMPORT_CANCELED",
} as const;

export type CoreErrorCode = (typeof CoreErrorCode)[keyof typeof CoreErrorCode];

export interface CoreAnalysisErrorOptions {
  readonly code: CoreErrorCode;
  readonly stage: ImportStage;
  readonly message: string;
  readonly recoverable?: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

export interface SerializedCoreAnalysisError {
  readonly name: "CoreAnalysisError";
  readonly code: CoreErrorCode;
  readonly stage: ImportStage;
  readonly message: string;
  readonly recoverable: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
}

export class CoreAnalysisError extends Error {
  public readonly code: CoreErrorCode;
  public readonly stage: ImportStage;
  public readonly recoverable: boolean;
  public readonly details: Readonly<Record<string, unknown>> | undefined;

  public constructor(options: CoreAnalysisErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CoreAnalysisError";
    this.code = options.code;
    this.stage = options.stage;
    this.recoverable = options.recoverable ?? false;
    this.details = options.details;
  }

  public toJSON(): SerializedCoreAnalysisError {
    const base = {
      name: "CoreAnalysisError" as const,
      code: this.code,
      stage: this.stage,
      message: this.message,
      recoverable: this.recoverable,
    };

    return this.details === undefined ? base : { ...base, details: this.details };
  }
}

export function isCoreAnalysisError(error: unknown): error is CoreAnalysisError {
  return error instanceof CoreAnalysisError;
}

export function coreError(
  code: CoreErrorCode,
  stage: ImportStage,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): CoreAnalysisError {
  return new CoreAnalysisError({
    code,
    stage,
    message,
    ...(details === undefined ? {} : { details }),
  });
}
