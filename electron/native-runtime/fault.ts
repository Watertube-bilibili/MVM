import type { NativeRunStatus, NativeRuntimeCode } from "./types.js";

export class NativeRuntimeFault extends Error {
  public readonly status: Exclude<NativeRunStatus, "completed">;
  public readonly code: Exclude<NativeRuntimeCode, "OK">;
  public readonly details: Readonly<Record<string, unknown>> | undefined;

  public constructor(
    status: Exclude<NativeRunStatus, "completed">,
    code: Exclude<NativeRuntimeCode, "OK">,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "NativeRuntimeFault";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function nativeFault(
  status: Exclude<NativeRunStatus, "completed">,
  code: Exclude<NativeRuntimeCode, "OK">,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): NativeRuntimeFault {
  return new NativeRuntimeFault(status, code, message, details);
}
