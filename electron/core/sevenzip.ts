import { spawn } from "node:child_process";
import path from "node:path";
import { open, stat } from "node:fs/promises";

import { CoreAnalysisError, CoreErrorCode, coreError } from "./errors.js";
import type {
  ArchiveEntryDescriptor,
  ArchiveEntryKind,
  ArchivePreflightSummary,
} from "./model.js";
import {
  DEFAULT_ARCHIVE_PATH_LIMITS,
  preflightArchiveEntries,
  validateArchivePath,
  type ArchivePathLimits,
} from "./safe-path.js";

const REQUIRED_FULL_FORMATS = ["APFS", "Cpio", "Dmg", "HFS", "Xar"] as const;

export interface SevenZipInstallation {
  readonly executablePath: string;
  readonly version: string;
  readonly formats: readonly string[];
  readonly source: "explicit" | "environment" | "bundled" | "installed" | "path";
}

export interface SevenZipDiscoveryOptions {
  readonly explicitPaths?: readonly string[];
  readonly strictExplicitOnly?: boolean;
  readonly additionalSearchDirectories?: readonly string[];
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly signal?: AbortSignal;
}

export interface SevenZipListOptions {
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly pathLimits?: ArchivePathLimits;
  readonly signal?: AbortSignal;
}

export interface SevenZipListing extends ArchivePreflightSummary {
  readonly archivePath: string;
  readonly archiveFormat?: string;
  readonly encryptedEntryCount: number;
  readonly tool: SevenZipInstallation;
}

interface CandidateExecutable {
  readonly executablePath: string;
  readonly source: SevenZipInstallation["source"];
}

interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface RunProcessOptions {
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly cwd: string;
  readonly signal?: AbortSignal;
}

interface ParsedSlt {
  readonly archiveFormat?: string;
  readonly entries: readonly ArchiveEntryDescriptor[];
}

function processError(
  code: typeof CoreErrorCode.ImportToolCrash | typeof CoreErrorCode.ImportToolMissing,
  message: string,
  cause: unknown,
  details?: Readonly<Record<string, unknown>>,
): CoreAnalysisError {
  return new CoreAnalysisError({
    code,
    stage: "indexing",
    message,
    cause,
    details: {
      ...(details ?? {}),
      cause: cause instanceof Error ? cause.message : String(cause),
    },
  });
}

async function runSevenZip(
  executablePath: string,
  args: readonly string[],
  options: RunProcessOptions,
): Promise<ProcessResult> {
  if (options.signal?.aborted === true) {
    throw coreError(CoreErrorCode.ImportCanceled, "indexing", "7-Zip operation was canceled.");
  }

  return await new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(executablePath, [...args], {
      cwd: options.cwd,
      env: {
        SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
        TEMP: process.env.TEMP ?? options.cwd,
        TMP: process.env.TMP ?? options.cwd,
      },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outputBytes = 0;
    let timedOut = false;
    let outputExceeded = false;
    let canceled = false;
    let settled = false;

    const kill = (): void => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    };

    const onData = (destination: Buffer[], chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += buffer.byteLength;
      if (outputBytes > options.maxOutputBytes) {
        outputExceeded = true;
        kill();
        return;
      }
      destination.push(buffer);
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      onData(stdoutChunks, chunk);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      onData(stderrChunks, chunk);
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      kill();
    }, options.timeoutMs);
    timeout.unref();

    const abort = (): void => {
      canceled = true;
      kill();
    };
    options.signal?.addEventListener("abort", abort, { once: true });

    const cleanup = (): void => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    };

    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      const missing = errnoCode(error) === "ENOENT";
      reject(
        processError(
          missing ? CoreErrorCode.ImportToolMissing : CoreErrorCode.ImportToolCrash,
          missing ? "7-Zip executable was not found." : "7-Zip could not be started.",
          error,
          { executablePath },
        ),
      );
    });

    child.once("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (canceled) {
        reject(coreError(CoreErrorCode.ImportCanceled, "indexing", "7-Zip operation was canceled."));
        return;
      }
      if (timedOut) {
        reject(
          coreError(CoreErrorCode.ImportToolTimeout, "indexing", "7-Zip operation timed out.", {
            timeoutMs: options.timeoutMs,
          }),
        );
        return;
      }
      if (outputExceeded) {
        reject(
          coreError(
            CoreErrorCode.ImportToolOutputInvalid,
            "indexing",
            "7-Zip output exceeded the configured byte limit.",
            { maxOutputBytes: options.maxOutputBytes },
          ),
        );
        return;
      }
      resolve({
        exitCode: exitCode ?? -1,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });
  });
}

function errnoCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function uniqueCandidates(candidates: readonly CandidateExecutable[]): CandidateExecutable[] {
  const seen = new Set<string>();
  const unique: CandidateExecutable[] = [];
  for (const candidate of candidates) {
    const absolute = path.resolve(candidate.executablePath);
    const key = process.platform === "win32" ? absolute.toLowerCase() : absolute;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push({ executablePath: absolute, source: candidate.source });
    }
  }
  return unique;
}

function discoveryCandidates(options: SevenZipDiscoveryOptions): CandidateExecutable[] {
  const candidates: CandidateExecutable[] = [];
  for (const explicitPath of options.explicitPaths ?? []) {
    candidates.push({ executablePath: explicitPath, source: "explicit" });
  }
  if (options.strictExplicitOnly === true) {
    return uniqueCandidates(candidates);
  }
  if (process.env.MVM_7ZIP_PATH) {
    candidates.push({ executablePath: process.env.MVM_7ZIP_PATH, source: "environment" });
  }

  for (const directory of options.additionalSearchDirectories ?? []) {
    candidates.push({ executablePath: path.join(directory, "7z.exe"), source: "bundled" });
    candidates.push({ executablePath: path.join(directory, "7zz.exe"), source: "bundled" });
  }

  const electronProcess = process as NodeJS.Process & { resourcesPath?: string };
  if (electronProcess.resourcesPath) {
    for (const relativePath of [
      ["tools", "7zip", "7z.exe"],
      ["7zip", "7z.exe"],
      ["tools", "7zip", "7zz.exe"],
    ]) {
      candidates.push({
        executablePath: path.join(electronProcess.resourcesPath, ...relativePath),
        source: "bundled",
      });
    }
  }

  candidates.push({
    executablePath: path.join(path.dirname(process.execPath), "7z.exe"),
    source: "bundled",
  });
  if (process.env.ProgramFiles) {
    candidates.push({
      executablePath: path.join(process.env.ProgramFiles, "7-Zip", "7z.exe"),
      source: "installed",
    });
  }
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  if (programFilesX86) {
    candidates.push({
      executablePath: path.join(programFilesX86, "7-Zip", "7z.exe"),
      source: "installed",
    });
  }
  if (process.env.LOCALAPPDATA) {
    candidates.push({
      executablePath: path.join(process.env.LOCALAPPDATA, "Programs", "7-Zip", "7z.exe"),
      source: "installed",
    });
  }

  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (directory.length > 0) {
      candidates.push({ executablePath: path.join(directory, "7z.exe"), source: "path" });
      candidates.push({ executablePath: path.join(directory, "7zz.exe"), source: "path" });
    }
  }
  return uniqueCandidates(candidates);
}

function parseFormats(informationOutput: string): string[] {
  const formats = new Set<string>();
  for (const format of REQUIRED_FULL_FORMATS) {
    const expression = new RegExp(`(?:^|\\s)${format}(?:\\s|$)`, "imu");
    if (expression.test(informationOutput)) {
      formats.add(format);
    }
  }
  return [...formats];
}

async function inspectCandidate(
  candidate: CandidateExecutable,
  options: SevenZipDiscoveryOptions,
): Promise<SevenZipInstallation> {
  const candidateStats = await stat(candidate.executablePath);
  if (!candidateStats.isFile()) {
    throw coreError(CoreErrorCode.ImportToolMissing, "indexing", "7-Zip candidate is not a regular file.", {
      executablePath: candidate.executablePath,
    });
  }

  // On Windows, spawn(shell:false) still accepts several executable file
  // classes.  Refuse .cmd/.bat/.ps1 launchers and require the DOS/PE prefix so
  // discovery never turns an environment override into script execution.
  if (process.platform === "win32") {
    const basename = path.basename(candidate.executablePath).toLowerCase();
    if (basename !== "7z.exe" && basename !== "7zz.exe") {
      throw coreError(
        CoreErrorCode.ImportToolUnsupportedVersion,
        "indexing",
        "7-Zip candidate must be the native 7z.exe or 7zz.exe executable.",
        { executablePath: candidate.executablePath },
      );
    }
    const handle = await open(candidate.executablePath, "r");
    try {
      const prefix = Buffer.alloc(2);
      const { bytesRead } = await handle.read(prefix, 0, prefix.byteLength, 0);
      if (bytesRead !== 2 || prefix[0] !== 0x4d || prefix[1] !== 0x5a) {
        throw coreError(
          CoreErrorCode.ImportToolUnsupportedVersion,
          "indexing",
          "7-Zip candidate is not a native Windows executable.",
          { executablePath: candidate.executablePath },
        );
      }
    } finally {
      await handle.close();
    }
  }

  const result = await runSevenZip(candidate.executablePath, ["i"], {
    cwd: path.dirname(candidate.executablePath),
    timeoutMs: options.timeoutMs ?? 10_000,
    maxOutputBytes: options.maxOutputBytes ?? 8 * 1024 * 1024,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (result.exitCode !== 0) {
    throw coreError(
      CoreErrorCode.ImportToolUnsupportedVersion,
      "indexing",
      "7-Zip information command failed.",
      {
        executablePath: candidate.executablePath,
        exitCode: result.exitCode,
        stderr: result.stderr.slice(0, 4096),
      },
    );
  }

  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  const versionMatch = /7-Zip(?:\s+\(z\))?\s+([^\s:]+)/iu.exec(combinedOutput);
  const formats = parseFormats(combinedOutput);
  const missingFormats = REQUIRED_FULL_FORMATS.filter((format) => !formats.includes(format));
  if (missingFormats.length > 0) {
    throw coreError(
      CoreErrorCode.ImportToolUnsupportedVersion,
      "indexing",
      "7-Zip candidate is not a complete build for MVM imports.",
      { executablePath: candidate.executablePath, missingFormats },
    );
  }

  return {
    executablePath: candidate.executablePath,
    version: versionMatch?.[1] ?? "unknown",
    formats,
    source: candidate.source,
  };
}

export async function discoverSevenZip(
  options: SevenZipDiscoveryOptions = {},
): Promise<SevenZipInstallation> {
  const candidates = discoveryCandidates(options);
  const failures: Array<{ path: string; reason: string }> = [];

  for (const candidate of candidates) {
    try {
      return await inspectCandidate(candidate, options);
    } catch (error) {
      if (options.signal?.aborted === true) {
        throw error;
      }
      failures.push({
        path: candidate.executablePath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  throw coreError(
    CoreErrorCode.ImportToolMissing,
    "indexing",
    "A complete 7-Zip build with DMG, HFS, APFS, XAR, and CPIO support was not found.",
    { checked: candidates.map((candidate) => candidate.executablePath), failures },
  );
}

function parseBlocks(output: string): ReadonlyArray<ReadonlyMap<string, string>> {
  const blocks: Array<ReadonlyMap<string, string>> = [];
  let current = new Map<string, string>();

  const flush = (): void => {
    if (current.size > 0) {
      blocks.push(current);
      current = new Map<string, string>();
    }
  };

  const normalizedOutput = output
    .replace(/^\ufeff/u, "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");
  for (const [lineNumber, line] of normalizedOutput.split("\n").entries()) {
    if (line.trim().length === 0 || /^-{5,}$/u.test(line.trim())) {
      flush();
      continue;
    }
    let separator = line.indexOf(" = ");
    const blankValue = separator < 0 && line.endsWith(" =");
    if (blankValue) {
      separator = line.length - 2;
    }
    if (separator <= 0) {
      throw coreError(
        CoreErrorCode.ImportToolOutputInvalid,
        "indexing",
        "7-Zip technical listing contains an unrecognized line.",
        { lineNumber: lineNumber + 1, line: line.slice(0, 512) },
      );
    }
    const key = line.slice(0, separator).trim();
    const value = blankValue ? "" : line.slice(separator + 3);
    if (key.length === 0 || current.has(key)) {
      throw coreError(
        CoreErrorCode.ImportToolOutputInvalid,
        "indexing",
        "7-Zip technical listing contains an empty or duplicate property name.",
        { lineNumber: lineNumber + 1, key },
      );
    }
    current.set(key, value);
  }
  flush();
  if (blocks.length === 0) {
    throw coreError(
      CoreErrorCode.ImportToolOutputInvalid,
      "indexing",
      "7-Zip technical listing was empty.",
    );
  }
  return blocks;
}

function parseDecimal(value: string, label: string, entryPath: string): number {
  const normalized = value.trim();
  if (!/^[0-9]+$/u.test(normalized) || normalized.length > 24) {
    throw coreError(CoreErrorCode.ImportToolOutputInvalid, "indexing", `${label} is not a decimal integer.`, {
      entryPath,
      value,
    });
  }
  const parsed = BigInt(normalized);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw coreError(CoreErrorCode.ImportToolOutputInvalid, "indexing", `${label} is too large.`, {
      entryPath,
      value,
    });
  }
  return Number(parsed);
}

function canonicalizeToolPath(toolPath: string): string {
  return toolPath.replaceAll("\\", "/");
}

function entryKind(block: ReadonlyMap<string, string>, canonicalPath: string): ArchiveEntryKind {
  if (block.has("Symbolic Link")) {
    return "symlink";
  }
  if (block.has("Hard Link")) {
    return "hardlink";
  }
  if (block.get("Folder") === "+" || canonicalPath.endsWith("/")) {
    return "directory";
  }
  if (block.has("Size")) {
    return "file";
  }
  return "unknown";
}

export function parseSevenZipSlt(output: string): ParsedSlt {
  const blocks = parseBlocks(output);
  let archiveFormat: string | undefined;
  const entries: ArchiveEntryDescriptor[] = [];

  for (const block of blocks) {
    const toolPath = block.get("Path");
    if (block.has("Type")) {
      const reportedType = block.get("Type");
      if (
        archiveFormat !== undefined ||
        toolPath === undefined ||
        reportedType === undefined ||
        reportedType.trim().length === 0
      ) {
        throw coreError(
          CoreErrorCode.ImportToolOutputInvalid,
          "indexing",
          "7-Zip technical listing contains an invalid archive header block.",
        );
      }
      archiveFormat = reportedType;
      continue;
    }
    if (toolPath === undefined) {
      throw coreError(
        CoreErrorCode.ImportToolOutputInvalid,
        "indexing",
        "7-Zip technical listing block is missing Path.",
        { properties: [...block.keys()].slice(0, 32) },
      );
    }

    const canonicalPath = canonicalizeToolPath(toolPath);
    const validation = validateArchivePath(canonicalPath);
    if (!validation.safe || validation.normalizedPath === undefined) {
      throw coreError(CoreErrorCode.UnsafePath, "indexing", "7-Zip listed an unsafe archive path.", {
        path: toolPath,
        canonicalPath,
        reasons: validation.reasons,
      });
    }
    const kind = entryKind(block, canonicalPath);
    const sizeText = block.get("Size");
    if (sizeText === undefined && kind !== "directory") {
      throw coreError(
        CoreErrorCode.ImportToolOutputInvalid,
        "indexing",
        "7-Zip entry is missing its unpacked size.",
        { path: toolPath, kind },
      );
    }
    // Solid and filesystem-style archives can leave Packed Size blank for
    // entries that do not own a compressed block.  Expanded size remains the
    // security limit; a blank packed size is therefore "unknown", not zero.
    const packedSizeValue = block.get("Packed Size");
    const packedSizeText = packedSizeValue?.trim() === "" ? undefined : packedSizeValue;
    const symbolicLink = block.get("Symbolic Link");
    const hardLink = block.get("Hard Link");
    const rawLinkTarget = symbolicLink ?? hardLink;
    const canonicalLinkTarget =
      rawLinkTarget === undefined ? undefined : canonicalizeToolPath(rawLinkTarget);

    entries.push({
      rawPath: canonicalPath,
      toolReportedPath: toolPath,
      normalizedPath: validation.normalizedPath,
      kind,
      size: sizeText === undefined ? 0 : parseDecimal(sizeText, "Unpacked size", toolPath),
      ...(packedSizeText === undefined
        ? {}
        : { packedSize: parseDecimal(packedSizeText, "Packed size", toolPath) }),
      ...(canonicalLinkTarget === undefined ? {} : { linkTarget: canonicalLinkTarget }),
      encrypted: block.get("Encrypted") === "+",
    });
  }

  if (entries.length === 0) {
    throw coreError(
      CoreErrorCode.ImportToolOutputInvalid,
      "indexing",
      "7-Zip technical listing did not contain any archive entries.",
      { archiveFormat: archiveFormat ?? null },
    );
  }

  return {
    ...(archiveFormat === undefined ? {} : { archiveFormat }),
    entries,
  };
}

export class SevenZipListAdapter {
  public constructor(private readonly tool: SevenZipInstallation) {}

  public async listAndPreflight(
    archivePath: string,
    options: SevenZipListOptions = {},
  ): Promise<SevenZipListing> {
    const absoluteArchivePath = path.resolve(archivePath);
    let archiveStats;
    try {
      archiveStats = await stat(absoluteArchivePath);
    } catch (error) {
      throw new CoreAnalysisError({
        code: CoreErrorCode.InputNotFound,
        stage: "indexing",
        message: "Archive file was not found.",
        cause: error,
        details: {
          archivePath: absoluteArchivePath,
          cause: error instanceof Error ? error.message : String(error),
        },
      });
    }
    if (!archiveStats.isFile()) {
      throw coreError(CoreErrorCode.FormatUnknown, "indexing", "7-Zip listing requires a regular file.", {
        archivePath: absoluteArchivePath,
      });
    }

    const result = await runSevenZip(
      this.tool.executablePath,
      ["l", "-slt", "-ba", "-sccUTF-8", absoluteArchivePath],
      {
        cwd: path.dirname(absoluteArchivePath),
        timeoutMs: options.timeoutMs ?? 120_000,
        maxOutputBytes: options.maxOutputBytes ?? 64 * 1024 * 1024,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
    );
    if (result.exitCode !== 0) {
      throw coreError(CoreErrorCode.FormatCorrupt, "indexing", "7-Zip could not list the archive.", {
        archivePath: absoluteArchivePath,
        exitCode: result.exitCode,
        stderr: result.stderr.slice(0, 8192),
      });
    }

    const afterStats = await stat(absoluteArchivePath);
    if (
      archiveStats.size !== afterStats.size ||
      archiveStats.mtimeMs !== afterStats.mtimeMs
    ) {
      throw coreError(
        CoreErrorCode.InputChanged,
        "indexing",
        "Archive changed while 7-Zip was listing it.",
        { archivePath: absoluteArchivePath },
      );
    }

    const parsed = parseSevenZipSlt(result.stdout);
    const summary = preflightArchiveEntries(
      parsed.entries,
      options.pathLimits ?? DEFAULT_ARCHIVE_PATH_LIMITS,
    );
    return {
      archivePath: absoluteArchivePath,
      ...(parsed.archiveFormat === undefined ? {} : { archiveFormat: parsed.archiveFormat }),
      encryptedEntryCount: parsed.entries.filter((entry) => entry.encrypted).length,
      tool: this.tool,
      ...summary,
    };
  }
}
