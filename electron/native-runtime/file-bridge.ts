import {
  lstatSync,
  realpathSync,
  statSync,
  type BigIntStats,
} from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { NativeFileMountMetadata } from "./types.js";

const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_CONFIGURED_BYTES = 1024 * 1024 * 1024;

export const NativeFileBridgeCode = {
  RootInvalid: "ROOT_INVALID",
  GuestPathInvalid: "GUEST_PATH_INVALID",
  PathEscape: "PATH_ESCAPE",
  IoError: "IO_ERROR",
  NotRegularFile: "NOT_REGULAR_FILE",
  FileTooLarge: "FILE_TOO_LARGE",
  TotalLimit: "TOTAL_LIMIT",
  FileChanged: "FILE_CHANGED",
} as const;

export type NativeFileBridgeCode =
  (typeof NativeFileBridgeCode)[keyof typeof NativeFileBridgeCode];

export class NativeFileBridgeError extends Error {
  public readonly code: NativeFileBridgeCode;

  public constructor(code: NativeFileBridgeCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "NativeFileBridgeError";
    this.code = code;
  }
}

export interface NativeFileBridgeOptions {
  readonly rootPath: string;
  readonly maxFileBytes?: number;
  readonly maxTotalBytes?: number;
}

function configuredBytes(value: number | undefined, fallback: number, label: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > MAX_CONFIGURED_BYTES) {
    throw new NativeFileBridgeError(
      NativeFileBridgeCode.RootInvalid,
      `${label} must be an integer between 1 and ${MAX_CONFIGURED_BYTES}.`,
    );
  }
  return selected;
}

function isWindowsNamespacePath(value: string): boolean {
  const normalized = value.replaceAll("/", "\\");
  return (
    normalized.startsWith("\\\\") ||
    normalized.startsWith("\\?\\") ||
    normalized.startsWith("\\.\\") ||
    normalized.startsWith("\\??\\")
  );
}

function isExplicitLocalAbsolutePath(value: string): boolean {
  if (process.platform === "win32") {
    return /^[a-z]:[\\/]/iu.test(value) && path.win32.isAbsolute(value) && !isWindowsNamespacePath(value);
  }
  return path.posix.isAbsolute(value) && !value.startsWith("//");
}

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs
  );
}

function isWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function rootPathOrThrow(rootPath: string): string {
  if (
    typeof rootPath !== "string" ||
    rootPath.length === 0 ||
    rootPath.includes("\0") ||
    !isExplicitLocalAbsolutePath(rootPath)
  ) {
    throw new NativeFileBridgeError(
      NativeFileBridgeCode.RootInvalid,
      "NativeFileBridge requires an explicit local absolute root directory.",
    );
  }

  try {
    const symbolic = lstatSync(rootPath);
    if (symbolic.isSymbolicLink()) {
      throw new NativeFileBridgeError(
        NativeFileBridgeCode.RootInvalid,
        "NativeFileBridge root must not be a symbolic link.",
      );
    }
    const canonical = realpathSync.native(rootPath);
    if (!statSync(canonical).isDirectory()) {
      throw new NativeFileBridgeError(
        NativeFileBridgeCode.RootInvalid,
        "NativeFileBridge root is not a directory.",
      );
    }
    return canonical;
  } catch (error) {
    if (error instanceof NativeFileBridgeError) {
      throw error;
    }
    throw new NativeFileBridgeError(
      NativeFileBridgeCode.RootInvalid,
      "NativeFileBridge root could not be resolved.",
      error,
    );
  }
}

function guestSegments(guestRelativePath: string): readonly string[] {
  if (
    typeof guestRelativePath !== "string" ||
    guestRelativePath.length === 0 ||
    guestRelativePath.includes("\0") ||
    guestRelativePath.startsWith("/") ||
    guestRelativePath.startsWith("\\") ||
    path.isAbsolute(guestRelativePath) ||
    path.win32.isAbsolute(guestRelativePath) ||
    path.posix.isAbsolute(guestRelativePath) ||
    isWindowsNamespacePath(guestRelativePath)
  ) {
    throw new NativeFileBridgeError(
      NativeFileBridgeCode.GuestPathInvalid,
      "Guest paths must be non-empty relative paths.",
    );
  }

  const segments = guestRelativePath.split(/[\\/]/u);
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.includes(":") ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment),
    )
  ) {
    throw new NativeFileBridgeError(
      NativeFileBridgeCode.GuestPathInvalid,
      "Guest path contains a traversal, device, stream, or empty component.",
    );
  }
  return segments;
}

export class NativeFileBridge {
  public readonly rootPath: string;
  public readonly maxFileBytes: number;
  public readonly maxTotalBytes: number;
  public readonly mount: NativeFileMountMetadata;
  private consumedBytes = 0;

  public constructor(options: NativeFileBridgeOptions) {
    this.maxFileBytes = configuredBytes(options.maxFileBytes, DEFAULT_MAX_FILE_BYTES, "maxFileBytes");
    this.maxTotalBytes = configuredBytes(options.maxTotalBytes, DEFAULT_MAX_TOTAL_BYTES, "maxTotalBytes");
    if (this.maxTotalBytes < this.maxFileBytes) {
      throw new NativeFileBridgeError(
        NativeFileBridgeCode.RootInvalid,
        "maxTotalBytes must be greater than or equal to maxFileBytes.",
      );
    }
    this.rootPath = rootPathOrThrow(options.rootPath);
    this.mount = Object.freeze({
      kind: "windows-directory",
      guestRoot: "/mvm/shared",
      hostRoot: this.rootPath,
      readOnly: true,
      maxFileBytes: this.maxFileBytes,
      maxTotalBytes: this.maxTotalBytes,
    });
  }

  public get totalBytesRead(): number {
    return this.consumedBytes;
  }

  public async resolveGuestPath(guestRelativePath: string): Promise<string> {
    const segments = guestSegments(guestRelativePath);
    const lexicalPath = path.resolve(this.rootPath, ...segments);
    if (!isWithinRoot(this.rootPath, lexicalPath)) {
      throw new NativeFileBridgeError(
        NativeFileBridgeCode.PathEscape,
        "Guest path escapes the explicit NativeFileBridge root.",
      );
    }

    try {
      const canonical = await realpath(lexicalPath);
      if (!isWithinRoot(this.rootPath, canonical)) {
        throw new NativeFileBridgeError(
          NativeFileBridgeCode.PathEscape,
          "Guest path resolves outside the explicit NativeFileBridge root.",
        );
      }
      return canonical;
    } catch (error) {
      if (error instanceof NativeFileBridgeError) {
        throw error;
      }
      throw new NativeFileBridgeError(
        NativeFileBridgeCode.IoError,
        "Guest path could not be resolved.",
        error,
      );
    }
  }

  public async readFile(guestRelativePath: string): Promise<Uint8Array> {
    const canonicalPath = await this.resolveGuestPath(guestRelativePath);
    let reservedBytes = 0;
    try {
      if ((await lstat(canonicalPath)).isSymbolicLink()) {
        throw new NativeFileBridgeError(
          NativeFileBridgeCode.PathEscape,
          "Guest file became a symbolic link before it could be opened.",
        );
      }

      const handle = await open(canonicalPath, "r");
      try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile()) {
          throw new NativeFileBridgeError(
            NativeFileBridgeCode.NotRegularFile,
            "Guest path is not a regular file.",
          );
        }
        if (before.size > BigInt(this.maxFileBytes)) {
          throw new NativeFileBridgeError(
            NativeFileBridgeCode.FileTooLarge,
            "Guest file exceeds the per-file read limit.",
          );
        }
        const size = Number(before.size);
        if (size > this.maxTotalBytes - this.consumedBytes) {
          throw new NativeFileBridgeError(
            NativeFileBridgeCode.TotalLimit,
            "NativeFileBridge cumulative read limit has been reached.",
          );
        }
        this.consumedBytes += size;
        reservedBytes = size;

        const output = Buffer.alloc(size);
        let offset = 0;
        while (offset < size) {
          const result = await handle.read(output, offset, size - offset, offset);
          if (result.bytesRead === 0) {
            throw new NativeFileBridgeError(
              NativeFileBridgeCode.FileChanged,
              "Guest file ended before its stable size was read.",
            );
          }
          offset += result.bytesRead;
        }

        const after = await handle.stat({ bigint: true });
        const postCanonical = await realpath(canonicalPath);
        if (!isWithinRoot(this.rootPath, postCanonical)) {
          throw new NativeFileBridgeError(
            NativeFileBridgeCode.PathEscape,
            "Guest file resolved outside the bridge root during the read.",
          );
        }
        const namedFile = await stat(postCanonical, { bigint: true });
        if (!sameFile(before, after) || !sameFile(after, namedFile)) {
          throw new NativeFileBridgeError(
            NativeFileBridgeCode.FileChanged,
            "Guest file changed while it was being read.",
          );
        }
        return output;
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (reservedBytes > 0) {
        this.consumedBytes -= reservedBytes;
      }
      if (error instanceof NativeFileBridgeError) {
        throw error;
      }
      throw new NativeFileBridgeError(
        NativeFileBridgeCode.IoError,
        "Guest file could not be read.",
        error,
      );
    }
  }
}
