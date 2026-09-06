import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import {
  mkdir,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";

import {
  SevenZipListAdapter,
  discoverSevenZip,
  type SevenZipListing,
} from "./core/index.js";
import type {
  DarlingInstallPhase,
  DarlingInstallPlan,
  DarlingInstallProgress,
  DarlingInstallResult,
} from "./desktop-api.js";

export const DARLING_DISTRIBUTION = "MVM-Darling" as const;
export const DARLING_BASE_DISTRIBUTION = "Ubuntu-24.04" as const;
export const DARLING_RELEASE_TAG = "v0.1.20260608";
export const DARLING_PACKAGE_VERSION = "0.1.20260609~noble";
export const DARLING_ASSET_URL = "https://github.com/darlinghq/darling/releases/download/v0.1.20260608/debs_20260608.zip";
export const DARLING_ASSET_BYTES = 118_018_438;
export const DARLING_ASSET_SHA256 = "27469ef3932da2e91dd7fb34b70e3628a3e54b7af9fb5480051f44af35eca1fd";
export const DARLING_MARKER_PATH = "/var/lib/mvm/runtime.json";
export const DARLING_PREFIX = "/home/mvm/.local/share/mvm/darling-prefix";

const BUNDLED_7ZIP_EXE_SHA256 = "e2ca3ec168ae9c0b4115cd4fe220145ea9b2dc4b6fc79d765e91f415b34d00de";
const BUNDLED_7ZIP_DLL_SHA256 = "882063948d675ee41b5ae68db3e84879350ec81cf88d15b9babf2fa08e332863";
const DEB_DIRECTORY = "debs_20260609";
const MAX_PROCESS_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_PROCESS_LOG_LINES = 2_000;

export const DARLING_DEB_FILES = Object.freeze([
  "darling-cli-devenv-gui-common_0.1.20260609~noble_amd64.deb",
  "darling-cli-devenv-gui-stubs-common_0.1.20260609~noble_amd64.deb",
  "darling-cli-extra_0.1.20260609~noble_amd64.deb",
  "darling-cli-gui-common_0.1.20260609~noble_amd64.deb",
  "darling-cli-python2-common_0.1.20260609~noble_amd64.deb",
  "darling-cli_0.1.20260609~noble_amd64.deb",
  "darling-core_0.1.20260609~noble_amd64.deb",
  "darling-extra_0.1.20260609~noble_amd64.deb",
  "darling-ffi_0.1.20260609~noble_amd64.deb",
  "darling-gui-stubs_0.1.20260609~noble_amd64.deb",
  "darling-gui_0.1.20260609~noble_amd64.deb",
  "darling-iokitd_0.1.20260609~noble_amd64.deb",
  "darling-iosurface_0.1.20260609~noble_amd64.deb",
  "darling-jsc-webkit-common_0.1.20260609~noble_amd64.deb",
  "darling-jsc_0.1.20260609~noble_amd64.deb",
  "darling-perl_0.1.20260609~noble_amd64.deb",
  "darling-pyobjc_0.1.20260609~noble_amd64.deb",
  "darling-python2_0.1.20260609~noble_amd64.deb",
  "darling-ruby_0.1.20260609~noble_amd64.deb",
  "darling-system_0.1.20260609~noble_amd64.deb",
  "darling_0.1.20260609~noble_amd64.deb",
] as const);

interface ManagedMarker {
  readonly owner: "MVM";
  readonly schema: 1;
  readonly base: "ubuntu-24.04";
  readonly darlingRelease: string;
  readonly darlingPackageVersion: string;
  readonly assetSha256: string;
  readonly status: "installing" | "ready" | "cli-ready-gui-unavailable";
}

interface InstallerJob {
  readonly id: string;
  readonly abortController: AbortController;
  phase: DarlingInstallPhase;
  progress: number;
  label: string;
  cancelRequested: boolean;
  canCancel: boolean;
}

export interface InstallerProcessResult {
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

export interface InstallerProcessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly stdinFile?: string;
  readonly onLine?: (line: string) => void;
}

export type InstallerProcessRunner = (request: InstallerProcessRequest) => Promise<InstallerProcessResult>;

export interface DarlingInstallerOptions {
  readonly userDataPath: string;
  readonly resourcesRoot: string;
  readonly processRunner?: InstallerProcessRunner;
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly platform?: NodeJS.Platform;
  readonly architecture?: string;
  readonly systemRoot?: string;
  readonly localAppData?: string;
}

function abortError(message = "Operation canceled."): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "").replaceAll("\0", "").trim();
}

function decodeWindowsOutput(bytes: Buffer): string {
  if (bytes.length >= 2) {
    let oddZeroes = 0;
    const sampleLength = Math.min(bytes.length, 1024);
    for (let index = 1; index < sampleLength; index += 2) {
      if (bytes[index] === 0) oddZeroes += 1;
    }
    if (oddZeroes > sampleLength / 8) {
      return bytes.toString("utf16le").replace(/^\ufeff/u, "").replaceAll("\0", "").trim();
    }
  }
  return bytes.toString("utf8").replace(/^\ufeff/u, "").replaceAll("\0", "").trim();
}

async function defaultProcessRunner(request: InstallerProcessRequest): Promise<InstallerProcessResult> {
  if (request.signal?.aborted) throw abortError();
  return await new Promise<InstallerProcessResult>((resolve, reject) => {
    const child = spawn(request.executable, [...request.args], {
      cwd: request.cwd,
      shell: false,
      windowsHide: true,
      stdio: [request.stdinFile ? "pipe" : "ignore", "pipe", "pipe"],
      env: {
        SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
        TEMP: process.env.TEMP ?? request.cwd,
        TMP: process.env.TMP ?? request.cwd,
      },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let lineRemainder = "";
    let forwardedLines = 0;

    const emitLogLine = (rawLine: string): void => {
      if (!request.onLine) return;
      if (forwardedLines < MAX_PROCESS_LOG_LINES) {
        const line = stripAnsi(rawLine);
        if (line) {
          forwardedLines += 1;
          request.onLine(line.slice(0, 4096));
        }
      } else if (forwardedLines === MAX_PROCESS_LOG_LINES) {
        forwardedLines += 1;
        request.onLine("[process output truncated after 2000 lines]");
      }
    };

    const forwardLines = (chunk: Buffer | string): void => {
      if (!request.onLine) return;
      lineRemainder += (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)).toString("utf8");
      if (lineRemainder.length > 8192) {
        emitLogLine(lineRemainder.slice(0, 4096));
        lineRemainder = lineRemainder.slice(-4096);
      }
      const lines = lineRemainder.split(/\r?\n/u);
      lineRemainder = lines.pop() ?? "";
      for (const rawLine of lines) {
        emitLogLine(rawLine);
      }
    };

    const collect = (destination: Buffer[], chunk: Buffer | string, current: number): number => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const next = current + bytes.length;
      if (current < MAX_PROCESS_OUTPUT_BYTES) {
        destination.push(bytes.subarray(0, Math.max(0, MAX_PROCESS_OUTPUT_BYTES - current)));
      }
      forwardLines(bytes);
      return next;
    };

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdoutBytes = collect(stdout, chunk, stdoutBytes);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderrBytes = collect(stderr, chunk, stderrBytes);
    });

    const timer = request.timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, request.timeoutMs) : undefined;
    timer?.unref();

    const abort = (): void => {
      aborted = true;
      child.kill("SIGKILL");
    };
    request.signal?.addEventListener("abort", abort, { once: true });

    let input: ReturnType<typeof createReadStream> | undefined;
    const cleanup = (): void => {
      if (timer) clearTimeout(timer);
      request.signal?.removeEventListener("abort", abort);
      input?.destroy();
    };

    if (request.stdinFile && child.stdin) {
      input = createReadStream(request.stdinFile);
      const failPipe = (error: Error): void => {
        if (!settled) {
          settled = true;
          child.kill("SIGKILL");
          cleanup();
          reject(error);
        }
      };
      input.on("error", failPipe);
      child.stdin.on("error", failPipe);
      input.pipe(child.stdin);
    }

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      emitLogLine(lineRemainder);
      if (aborted) {
        reject(abortError());
        return;
      }
      if (timedOut) {
        reject(new Error(`Process timed out after ${request.timeoutMs} ms.`));
        return;
      }
      resolve({ exitCode: code ?? -1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
}

function parseVersionTuple(value: string): readonly number[] | null {
  const match = /(?:^|\s)(\d+)\.(\d+)\.(\d+)(?:\.\d+)?/u.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function isWslVersionSupported(value: string): boolean {
  const tuple = parseVersionTuple(value);
  if (!tuple) return false;
  const minimum = [2, 4, 4] as const;
  for (let index = 0; index < minimum.length; index += 1) {
    const actual = tuple[index] ?? 0;
    const target = minimum[index]!;
    if (actual > target) return true;
    if (actual < target) return false;
  }
  return true;
}

export function parseQuietWslDistributions(value: string): readonly string[] {
  return value
    .replaceAll("\0", "")
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s*\*?\s*/u, "").trim())
    .filter(Boolean);
}

export function isWsl2Distribution(value: string, distributionName: string): boolean {
  const expectedName = distributionName.toLowerCase();
  for (const rawLine of value.replaceAll("\0", "").split(/\r?\n/u)) {
    const line = rawLine.replace(/^\s*\*?\s*/u, "").trimEnd();
    const exactName = line.slice(0, distributionName.length).toLowerCase() === expectedName;
    const columns = line.slice(distributionName.length);
    if (exactName && /^\s+.+\s2\s*$/u.test(columns)) return true;
  }
  return false;
}

export function isManagedMarker(value: unknown): value is ManagedMarker {
  if (typeof value !== "object" || value === null) return false;
  const marker = value as Partial<ManagedMarker>;
  return marker.owner === "MVM"
    && marker.schema === 1
    && marker.base === "ubuntu-24.04"
    && marker.darlingRelease === DARLING_RELEASE_TAG
    && marker.darlingPackageVersion === DARLING_PACKAGE_VERSION
    && marker.assetSha256 === DARLING_ASSET_SHA256
    && typeof marker.status === "string"
    && ["installing", "ready", "cli-ready-gui-unavailable"].includes(marker.status);
}

export function validateDarlingDebListing(listing: SevenZipListing): readonly string[] {
  const expected = new Set(DARLING_DEB_FILES.map((name) => `${DEB_DIRECTORY}/${name}`));
  const files = listing.entries.filter((entry) => entry.kind === "file");
  const directories = listing.entries.filter((entry) => entry.kind === "directory");
  if (
    listing.encryptedEntryCount !== 0
    || listing.entries.length !== DARLING_DEB_FILES.length + 1
    || directories.length !== 1
    || directories[0]?.normalizedPath.replace(/\/$/u, "") !== DEB_DIRECTORY
    || files.length !== DARLING_DEB_FILES.length
    || listing.entries.some((entry) => entry.kind !== "file" && entry.kind !== "directory")
  ) {
    throw new Error("Darling release ZIP does not match the fixed 21-package structure.");
  }
  const actual = files.map((entry) => entry.normalizedPath).sort();
  if (actual.some((entry) => !expected.has(entry)) || new Set(actual).size !== expected.size) {
    throw new Error("Darling release ZIP contains an unexpected package name or duplicate.");
  }
  return actual;
}

async function sha256File(filePath: string): Promise<string> {
  const before = await stat(filePath);
  if (!before.isFile()) throw new Error(`Expected a regular file for SHA-256: ${filePath}`);
  const hash = createHash("sha256");
  let bytesRead = 0;
  if (before.size > 0) {
    await new Promise<void>((resolve, reject) => {
      const input = createReadStream(filePath, { start: 0, end: before.size - 1 });
      input.on("data", (chunk: Buffer) => {
        bytesRead += chunk.length;
        hash.update(chunk);
      });
      input.on("error", reject);
      input.on("end", resolve);
    });
  }
  const after = await stat(filePath);
  if (
    bytesRead !== before.size
    || after.size !== before.size
    || after.mtimeMs !== before.mtimeMs
    || after.ctimeMs !== before.ctimeMs
  ) {
    throw new Error(`File changed while calculating SHA-256: ${filePath}`);
  }
  return hash.digest("hex");
}

async function existsAsFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function directoryHasEntries(directoryPath: string): Promise<boolean> {
  try {
    return (await readdir(directoryPath)).length > 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function markerJson(status: NonNullable<ManagedMarker["status"]>): string {
  return JSON.stringify({
    owner: "MVM",
    schema: 1,
    base: "ubuntu-24.04",
    darlingRelease: DARLING_RELEASE_TAG,
    darlingPackageVersion: DARLING_PACKAGE_VERSION,
    assetSha256: DARLING_ASSET_SHA256,
    status,
  } satisfies ManagedMarker);
}

export class DarlingInstaller {
  private readonly runProcess: InstallerProcessRunner;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly platform: NodeJS.Platform;
  private readonly architecture: string;
  private readonly wslPath: string;
  private readonly runtimeRoot: string;
  private readonly distroLocation: string;
  private readonly cacheRoot: string;
  private readonly sevenZipPath: string;
  private readonly sevenZipDllPath: string;
  private progressEmitter: (progress: DarlingInstallProgress) => void = () => undefined;
  private currentJob: InstallerJob | undefined;

  public constructor(private readonly options: DarlingInstallerOptions) {
    this.runProcess = options.processRunner ?? defaultProcessRunner;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.platform = options.platform ?? process.platform;
    this.architecture = options.architecture ?? process.arch;
    const systemRoot = options.systemRoot ?? process.env.SystemRoot ?? "C:\\Windows";
    this.wslPath = path.join(systemRoot, "System32", "wsl.exe");
    const localAppData = options.localAppData ?? process.env.LOCALAPPDATA ?? options.userDataPath;
    this.runtimeRoot = path.resolve(localAppData, "MVM", "runtime");
    this.distroLocation = path.join(this.runtimeRoot, "wsl", DARLING_DISTRIBUTION);
    this.cacheRoot = path.resolve(options.userDataPath, "runtime-cache", "darling", DARLING_RELEASE_TAG);
    this.sevenZipPath = path.join(options.resourcesRoot, "runtime", "7zip", "7z.exe");
    this.sevenZipDllPath = path.join(options.resourcesRoot, "runtime", "7zip", "7z.dll");
  }

  public setProgressEmitter(emitter: (progress: DarlingInstallProgress) => void): void {
    this.progressEmitter = emitter;
  }

  public isRunning(): boolean {
    return this.currentJob !== undefined;
  }

  private async invokeWsl(args: readonly string[], timeoutMs = 20_000): Promise<InstallerProcessResult> {
    return await this.runProcess({
      executable: this.wslPath,
      args,
      cwd: this.options.userDataPath,
      timeoutMs,
    });
  }

  private async listDistributions(): Promise<readonly string[]> {
    const result = await this.invokeWsl(["--list", "--quiet"]);
    if (result.exitCode !== 0) return [];
    return parseQuietWslDistributions(decodeWindowsOutput(result.stdout));
  }

  private async hasManagedDistribution(): Promise<boolean> {
    const names = await this.listDistributions();
    return names.some((name) => name.localeCompare(DARLING_DISTRIBUTION, undefined, { sensitivity: "accent" }) === 0);
  }

  private async readManagedMarker(): Promise<ManagedMarker | null> {
    const result = await this.invokeWsl([
      "--distribution",
      DARLING_DISTRIBUTION,
      "--user",
      "root",
      "--exec",
      "cat",
      DARLING_MARKER_PATH,
    ]);
    if (result.exitCode !== 0) return null;
    try {
      const parsed: unknown = JSON.parse(decodeWindowsOutput(result.stdout));
      return isManagedMarker(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  public async isManagedDistributionUsable(): Promise<boolean> {
    try {
      if (!await this.hasManagedDistribution()) return false;
      const marker = await this.readManagedMarker();
      if (marker?.status !== "ready" && marker?.status !== "cli-ready-gui-unavailable") return false;
      return (await this.validateDistroEnvironment()).length > 0;
    } catch {
      return false;
    }
  }

  private async validateDistroEnvironment(): Promise<readonly string[]> {
    const result = await this.invokeWsl([
      "--distribution",
      DARLING_DISTRIBUTION,
      "--user",
      "root",
      "--exec",
      "sh",
      "-c",
      "set -eu; . /etc/os-release; printf '%s|%s|%s|%s|' \"$(uname -m)\" \"${ID:-}\" \"${VERSION_ID:-}\" \"${VERSION_CODENAME:-}\"; uname -r; grep -Eqw '(pni|sse3)' /proc/cpuinfo",
    ]);
    if (result.exitCode !== 0) throw new Error("MVM-Darling does not satisfy the x86_64/SSE3 Linux requirements.");
    const fields = decodeWindowsOutput(result.stdout).split("|");
    if (fields[0] !== "x86_64" || fields[1] !== "ubuntu" || fields[2] !== "24.04" || fields[3] !== "noble") {
      throw new Error("MVM-Darling must be Ubuntu 24.04 Noble on x86_64.");
    }
    const kernelMajor = Number.parseInt(fields[4] ?? "0", 10);
    if (!Number.isInteger(kernelMajor) || kernelMajor < 5) throw new Error("MVM-Darling requires Linux kernel 5.0 or newer.");
    return fields;
  }

  public async preflight(): Promise<DarlingInstallPlan> {
    const blockers: string[] = [];
    const warnings: string[] = [
      "Darling 的官方 Debian 打包仍标注为未广泛测试；复杂 GUI 应用可能无法运行。",
      "专用发行版不是恶意代码安全沙箱；当前启动路径仍可见 WSL 自动挂载的 Windows 驱动器。",
    ];
    let requiresAdmin = false;
    let requiresReboot = false;

    if (this.platform !== "win32" || this.architecture !== "x64") {
      blockers.push("该固定运行包只支持 Windows x64；Windows ARM64 当前不能自动安装。");
    }
    if (!await existsAsFile(this.wslPath)) {
      blockers.push("未找到 WSL。请先用管理员 PowerShell 安装 WSL 平台并按提示重启，再返回 MVM。");
      requiresAdmin = true;
      requiresReboot = true;
    } else {
      const [versionResult, helpResult] = await Promise.all([
        this.invokeWsl(["--version"]),
        this.invokeWsl(["--help"]),
      ]);
      const versionText = decodeWindowsOutput(Buffer.concat([versionResult.stdout, versionResult.stderr]));
      const helpText = decodeWindowsOutput(Buffer.concat([helpResult.stdout, helpResult.stderr]));
      if (versionResult.exitCode !== 0 || !isWslVersionSupported(versionText)) {
        blockers.push("WSL 版本需要 2.4.4 或更高。请先明确执行 `wsl --update`，再重新预检。");
      }
      if (!helpText.includes("--name") || !helpText.includes("--location") || !helpText.includes("--no-launch")) {
        blockers.push("当前 WSL 不支持创建带固定名称和位置的专用发行版；MVM 不会降级去修改已有 Ubuntu。");
      }

      const names = await this.listDistributions();
      const existing = names.some((name) => name.toLowerCase() === DARLING_DISTRIBUTION.toLowerCase());
      if (existing) {
        const verbose = await this.invokeWsl(["--list", "--verbose"]);
        if (verbose.exitCode !== 0 || !isWsl2Distribution(decodeWindowsOutput(verbose.stdout), DARLING_DISTRIBUTION)) {
          blockers.push("现有 MVM-Darling 不是明确的 WSL 2 发行版；MVM 不会自动转换或接管。");
        }
        const marker = await this.readManagedMarker();
        if (!marker) {
          blockers.push("已存在同名 MVM-Darling，但没有有效的 MVM 所有权标记；为避免接管用户数据，安装已阻断。");
        } else {
          try {
            await this.validateDistroEnvironment();
            warnings.push("检测到由 MVM 管理的现有发行版；向导会执行幂等修复和版本复核。 ");
          } catch (error) {
            blockers.push(error instanceof Error ? error.message : "现有 MVM-Darling 环境无效。");
          }
        }
      } else if (await directoryHasEntries(this.distroLocation)) {
        blockers.push("专用安装目录已存在非空内容，但 WSL 没有注册 MVM-Darling；为避免覆盖，安装已阻断。");
      }
    }

    return {
      canInstall: blockers.length === 0,
      distributionName: DARLING_DISTRIBUTION,
      releaseTag: DARLING_RELEASE_TAG,
      packageVersion: DARLING_PACKAGE_VERSION,
      assetUrl: DARLING_ASSET_URL,
      assetBytes: DARLING_ASSET_BYTES,
      assetSha256: DARLING_ASSET_SHA256,
      requiresAdmin,
      requiresReboot,
      steps: [
        "下载固定的官方 Darling DEB 压缩包并校验字节数与 SHA-256",
        "严格确认 21 个 Ubuntu 24.04 / amd64 包，不接受额外或缺失文件",
        "创建或修复专用 MVM-Darling / Ubuntu 24.04 / WSL2 发行版",
        "在专用发行版内以 Linux root 安装固定包并创建无 sudo 权限的 mvm 用户",
        "以 mvm 用户初始化独立 DPREFIX，执行 Darwin CLI smoke test，并单独检测 WSLg",
      ],
      warnings,
      blockers,
    };
  }

  private emit(
    job: InstallerJob,
    phase: DarlingInstallPhase,
    progress: number,
    label: string,
    extra: Partial<Omit<DarlingInstallProgress, "jobId" | "phase" | "progress" | "label">> = {},
  ): void {
    job.phase = phase;
    job.progress = Math.max(0, Math.min(1, progress));
    job.label = label;
    job.canCancel = extra.canCancel ?? true;
    this.progressEmitter({
      jobId: job.id,
      phase,
      progress: job.progress,
      label,
      canCancel: job.canCancel,
      ...(extra.detail === undefined ? {} : { detail: extra.detail }),
      ...(extra.logLine === undefined ? {} : { logLine: extra.logLine }),
      ...(extra.downloadedBytes === undefined ? {} : { downloadedBytes: extra.downloadedBytes }),
      ...(extra.totalBytes === undefined ? {} : { totalBytes: extra.totalBytes }),
    });
  }

  private throwIfCanceled(job: InstallerJob): void {
    if (job.cancelRequested || job.abortController.signal.aborted) throw abortError("Darling installation canceled.");
  }

  private async runChecked(
    job: InstallerJob,
    args: readonly string[],
    options: { readonly timeoutMs: number; readonly abortable: boolean; readonly stdinFile?: string },
  ): Promise<InstallerProcessResult> {
    const result = await this.runProcess({
      executable: this.wslPath,
      args,
      cwd: this.options.userDataPath,
      timeoutMs: options.timeoutMs,
      ...(options.abortable ? { signal: job.abortController.signal } : {}),
      ...(options.stdinFile === undefined ? {} : { stdinFile: options.stdinFile }),
      onLine: (line) => this.emit(job, job.phase, job.progress, job.label, {
        logLine: line,
        canCancel: job.canCancel && !job.cancelRequested,
      }),
    });
    if (result.exitCode !== 0) {
      const detail = decodeWindowsOutput(Buffer.concat([result.stderr, result.stdout])).slice(-4096);
      throw new Error(`WSL step failed with exit code ${result.exitCode}${detail ? `: ${detail}` : "."}`);
    }
    return result;
  }

  private async downloadAsset(job: InstallerJob): Promise<string> {
    await mkdir(this.cacheRoot, { recursive: true });
    const finalPath = path.join(this.cacheRoot, "debs_20260608.zip");
    const partialPath = `${finalPath}.partial`;
    if (await existsAsFile(finalPath)) {
      const existing = await stat(finalPath);
      if (existing.size === DARLING_ASSET_BYTES && await sha256File(finalPath) === DARLING_ASSET_SHA256) {
        this.emit(job, "downloading", 0.42, "复用已验证的官方 Darling 下载", { canCancel: true });
        return finalPath;
      }
      await rm(finalPath, { force: true });
    }

    let offset = 0;
    if (await existsAsFile(partialPath)) {
      offset = (await stat(partialPath)).size;
      if (offset > DARLING_ASSET_BYTES) {
        await rm(partialPath, { force: true });
        offset = 0;
      } else if (offset === DARLING_ASSET_BYTES) {
        if (await sha256File(partialPath) === DARLING_ASSET_SHA256) {
          await rename(partialPath, finalPath);
          return finalPath;
        }
        await rm(partialPath, { force: true });
        offset = 0;
      }
    }
    this.emit(job, "downloading", 0.1, "下载固定的官方 Darling 包", {
      detail: DARLING_RELEASE_TAG,
      downloadedBytes: offset,
      totalBytes: DARLING_ASSET_BYTES,
      canCancel: true,
    });

    let response = await this.fetchImpl(DARLING_ASSET_URL, {
      redirect: "follow",
      signal: job.abortController.signal,
      ...(offset > 0 ? { headers: { Range: `bytes=${offset}-` } } : {}),
    });
    if (offset > 0 && response.status === 416) {
      await response.body?.cancel().catch(() => undefined);
      await rm(partialPath, { force: true });
      offset = 0;
      response = await this.fetchImpl(DARLING_ASSET_URL, {
        redirect: "follow",
        signal: job.abortController.signal,
      });
    }
    if (!response.ok || !response.body) throw new Error(`Official Darling download failed with HTTP ${response.status}.`);
    const append = offset > 0 && response.status === 206;
    if (offset > 0 && !append) {
      await rm(partialPath, { force: true });
      offset = 0;
    }
    if (append) {
      const contentRange = response.headers.get("content-range") ?? "";
      if (!contentRange.startsWith(`bytes ${offset}-`)) throw new Error("Darling download resume range was not honored safely.");
    }

    const output = createWriteStream(partialPath, { flags: append ? "a" : "w" });
    const reader = response.body.getReader();
    let outputError: Error | undefined;
    output.on("error", (error: Error) => {
      outputError = error;
      void reader.cancel(error).catch(() => undefined);
    });
    let downloaded = offset;
    let lastEmit = 0;
    try {
      while (true) {
        this.throwIfCanceled(job);
        const chunk = await reader.read();
        if (outputError) throw outputError;
        if (chunk.done) break;
        downloaded += chunk.value.byteLength;
        if (downloaded > DARLING_ASSET_BYTES) throw new Error("Darling download exceeded the pinned asset size.");
        if (!output.write(Buffer.from(chunk.value))) await once(output, "drain");
        const now = Date.now();
        if (now - lastEmit > 160 || downloaded === DARLING_ASSET_BYTES) {
          lastEmit = now;
          this.emit(job, "downloading", 0.1 + (downloaded / DARLING_ASSET_BYTES) * 0.32, "下载固定的官方 Darling 包", {
            downloadedBytes: downloaded,
            totalBytes: DARLING_ASSET_BYTES,
            canCancel: true,
          });
        }
      }
      if (outputError) throw outputError;
      await new Promise<void>((resolve, reject) => {
        const finish = (): void => {
          output.removeListener("error", fail);
          resolve();
        };
        const fail = (error: Error): void => {
          output.removeListener("finish", finish);
          reject(error);
        };
        output.once("finish", finish);
        output.once("error", fail);
        output.end();
      });
    } catch (error) {
      output.destroy();
      await reader.cancel().catch(() => undefined);
      throw error;
    }

    if (downloaded !== DARLING_ASSET_BYTES) throw new Error(`Darling asset size mismatch: ${downloaded}.`);
    await rename(partialPath, finalPath);
    return finalPath;
  }

  private async verifyAndExtract(job: InstallerJob, archivePath: string): Promise<void> {
    this.emit(job, "verifying", 0.46, "校验官方下载与 21 项固定包清单", { canCancel: true });
    const archiveStats = await stat(archivePath);
    if (archiveStats.size !== DARLING_ASSET_BYTES) throw new Error("Darling asset byte size does not match the pinned release.");
    if (await sha256File(archivePath) !== DARLING_ASSET_SHA256) throw new Error("Darling asset SHA-256 does not match the pinned release.");
    const [sevenZipHash, sevenZipDllHash] = await Promise.all([
      sha256File(this.sevenZipPath),
      sha256File(this.sevenZipDllPath),
    ]);
    if (sevenZipHash !== BUNDLED_7ZIP_EXE_SHA256 || sevenZipDllHash !== BUNDLED_7ZIP_DLL_SHA256) {
      throw new Error("Bundled 7-Zip integrity check failed; Darling installation was not started.");
    }
    const tool = await discoverSevenZip({
      explicitPaths: [this.sevenZipPath],
      strictExplicitOnly: true,
      signal: job.abortController.signal,
    });
    const listing = await new SevenZipListAdapter(tool).listAndPreflight(archivePath, {
      signal: job.abortController.signal,
      timeoutMs: 120_000,
    });
    validateDarlingDebListing(listing);
    this.throwIfCanceled(job);

    this.emit(job, "extracting", 0.52, "在受控缓存中展开已验证的 DEB", { canCancel: true });
    const extractRoot = path.resolve(this.cacheRoot, "extracted");
    if (path.dirname(extractRoot) !== path.resolve(this.cacheRoot)) throw new Error("Unsafe Darling extraction root.");
    await rm(extractRoot, { recursive: true, force: true });
    await mkdir(extractRoot, { recursive: true });
    const result = await this.runProcess({
      executable: this.sevenZipPath,
      args: ["x", "-y", "-bd", "-bso0", "-bsp0", `-o${extractRoot}`, "--", archivePath],
      cwd: this.cacheRoot,
      timeoutMs: 120_000,
      signal: job.abortController.signal,
    });
    if (result.exitCode !== 0) throw new Error("Verified Darling ZIP could not be extracted.");
    const rootEntries = await readdir(extractRoot, { withFileTypes: true });
    if (rootEntries.length !== 1 || rootEntries[0]?.name !== DEB_DIRECTORY || !rootEntries[0].isDirectory()) {
      throw new Error("Extracted Darling package root differs from the fixed manifest.");
    }
    const debEntries = await readdir(path.join(extractRoot, DEB_DIRECTORY), { withFileTypes: true });
    const actualNames = debEntries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
    const expectedNames = [...DARLING_DEB_FILES].sort();
    if (debEntries.length !== expectedNames.length || actualNames.some((name, index) => name !== expectedNames[index])) {
      throw new Error("Extracted Darling DEB names differ from the fixed manifest.");
    }
  }

  private async createDistribution(job: InstallerJob): Promise<void> {
    if (await this.hasManagedDistribution()) return;
    this.emit(job, "creating-distro", 0.58, "创建专用 Ubuntu 24.04 / WSL2 发行版", {
      detail: `${DARLING_DISTRIBUTION} · 不修改已有 Ubuntu`,
      canCancel: true,
    });
    await mkdir(path.dirname(this.distroLocation), { recursive: true });
    await this.runChecked(job, [
      "--install",
      DARLING_BASE_DISTRIBUTION,
      "--name",
      DARLING_DISTRIBUTION,
      "--location",
      this.distroLocation,
      "--no-launch",
      "--version",
      "2",
      "--web-download",
    ], { timeoutMs: 45 * 60_000, abortable: false });
    if (!await this.hasManagedDistribution()) throw new Error("WSL did not register the dedicated MVM-Darling distribution.");
    await this.writeMarker(job, "installing");
    this.throwIfCanceled(job);
  }

  private async writeMarker(job: InstallerJob, status: NonNullable<ManagedMarker["status"]>): Promise<void> {
    await this.runChecked(job, [
      "--distribution",
      DARLING_DISTRIBUTION,
      "--user",
      "root",
      "--exec",
      "sh",
      "-c",
      `set -eu; install -d -m 0700 /var/lib/mvm; printf '%s\\n' \"$1\" > ${DARLING_MARKER_PATH}; chmod 0600 ${DARLING_MARKER_PATH}`,
      "mvm-marker",
      markerJson(status),
    ], { timeoutMs: 30_000, abortable: false });
  }

  private async installPackages(job: InstallerJob, archivePath: string): Promise<void> {
    this.emit(job, "installing-packages", 0.66, "准备专用发行版的软件包事务", {
      detail: "APT 阶段不会被强制终止；取消会在事务结束后生效。",
      canCancel: true,
    });
    await this.runChecked(job, [
      "--distribution",
      DARLING_DISTRIBUTION,
      "--user",
      "root",
      "--exec",
      "sh",
      "-c",
      "set -eu; export DEBIAN_FRONTEND=noninteractive; dpkg --configure -a; apt-get update; apt-get -f install -y; apt-get install -y --no-install-recommends ca-certificates unzip",
    ], { timeoutMs: 90 * 60_000, abortable: false });
    this.throwIfCanceled(job);

    this.emit(job, "installing-packages", 0.72, "复制并在 Linux 内复核官方包", { canCancel: true });
    await this.runChecked(job, [
      "--distribution",
      DARLING_DISTRIBUTION,
      "--user",
      "root",
      "--exec",
      "sh",
      "-c",
      "set -eu; install -d -m 0700 /var/cache/mvm; cat > /var/cache/mvm/debs_20260608.zip; printf '%s  %s\\n' \"$1\" /var/cache/mvm/debs_20260608.zip | sha256sum -c -",
      "mvm-stage",
      DARLING_ASSET_SHA256,
    ], { timeoutMs: 15 * 60_000, abortable: false, stdinFile: archivePath });
    this.throwIfCanceled(job);

    const allowlist = DARLING_DEB_FILES.join(" ");
    const validateScript = [
      "set -eu",
      "cache=/var/cache/mvm",
      `rm -rf -- \"$cache/${DEB_DIRECTORY}\"`,
      "unzip -q -o \"$cache/debs_20260608.zip\" -d \"$cache\"",
      "version=$1",
      `set -- \"$cache/${DEB_DIRECTORY}\"/*.deb`,
      `test \"$#\" -eq ${DARLING_DEB_FILES.length}`,
      `allow=' ${allowlist} '`,
      "for deb in \"$@\"; do name=${deb##*/}; case \"$allow\" in *\" $name \"*) ;; *) echo \"Unexpected DEB: $name\" >&2; exit 41;; esac; test \"$(dpkg-deb -f \"$deb\" Architecture)\" = amd64; test \"$(dpkg-deb -f \"$deb\" Version)\" = \"$version\"; done",
    ].join("; ");
    await this.runChecked(job, [
      "--distribution",
      DARLING_DISTRIBUTION,
      "--user",
      "root",
      "--exec",
      "sh",
      "-c",
      validateScript,
      "mvm-validate-debs",
      DARLING_PACKAGE_VERSION,
    ], { timeoutMs: 10 * 60_000, abortable: false });
    this.throwIfCanceled(job);

    this.emit(job, "installing-packages", 0.78, "安装 21 个固定 Darling DEB", { canCancel: true });
    await this.runChecked(job, [
      "--distribution",
      DARLING_DISTRIBUTION,
      "--user",
      "root",
      "--exec",
      "sh",
      "-c",
      `set -eu; export DEBIAN_FRONTEND=noninteractive; apt-get install -y --no-install-recommends /var/cache/mvm/${DEB_DIRECTORY}/*.deb; test \"$(dpkg-query -W -f='\${Version}' darling)\" = \"$1\"`,
      "mvm-install-debs",
      DARLING_PACKAGE_VERSION,
    ], { timeoutMs: 90 * 60_000, abortable: false });
    this.throwIfCanceled(job);
  }

  private async configureUser(job: InstallerJob): Promise<void> {
    this.emit(job, "configuring-user", 0.88, "创建无 sudo 权限的 mvm 运行用户", { canCancel: true });
    const configuration = [
      "set -eu",
      "id -u mvm >/dev/null 2>&1 || useradd --create-home --shell /bin/bash mvm",
      "usermod -G '' mvm",
      "passwd -l mvm >/dev/null",
      "install -d -o mvm -g mvm -m 0700 /home/mvm",
      "install -d -o mvm -g mvm -m 0700 /home/mvm/.local /home/mvm/.local/share /home/mvm/.local/share/mvm",
      `install -d -o mvm -g mvm -m 0700 ${DARLING_PREFIX}`,
      "printf '%s\\n' '[interop]' 'enabled=false' 'appendWindowsPath=false' '' '[user]' 'default=mvm' > /etc/wsl.conf",
      "chmod 0644 /etc/wsl.conf",
    ].join("; ");
    await this.runChecked(job, [
      "--distribution",
      DARLING_DISTRIBUTION,
      "--user",
      "root",
      "--exec",
      "sh",
      "-c",
      configuration,
    ], { timeoutMs: 60_000, abortable: false });
    this.throwIfCanceled(job);
    await this.writeMarker(job, "installing");
    await this.runChecked(job, ["--terminate", DARLING_DISTRIBUTION], { timeoutMs: 30_000, abortable: false });
  }

  private async smokeTest(job: InstallerJob): Promise<"ready" | "ready-cli-only"> {
    this.emit(job, "smoke-testing", 0.94, "初始化独立 Darling prefix 并验证 Darwin 用户态", { canCancel: true });
    const smoke = await this.runChecked(job, [
      "--distribution",
      DARLING_DISTRIBUTION,
      "--user",
      "mvm",
      "--exec",
      "sh",
      "-c",
      `export DPREFIX=${DARLING_PREFIX}; darling shell uname -s 2>/dev/null`,
    ], { timeoutMs: 5 * 60_000, abortable: true });
    if (decodeWindowsOutput(smoke.stdout).split(/\r?\n/u).at(-1)?.trim() !== "Darwin") {
      throw new Error("Darling smoke test did not return Darwin.");
    }
    const gui = await this.invokeWsl([
      "--distribution",
      DARLING_DISTRIBUTION,
      "--user",
      "mvm",
      "--exec",
      "sh",
      "-c",
      "test -n \"${DISPLAY:-}\" || test -n \"${WAYLAND_DISPLAY:-}\"",
    ], 30_000);
    return gui.exitCode === 0 ? "ready" : "ready-cli-only";
  }

  public async install(acceptedRisk: boolean): Promise<DarlingInstallResult> {
    if (!acceptedRisk) throw new TypeError("Explicit Darling installation consent is required.");
    if (this.currentJob) return { completed: false, canceled: false, message: "Darling 安装任务已经在运行。" };
    const job: InstallerJob = {
      id: randomUUID(),
      abortController: new AbortController(),
      phase: "idle",
      progress: 0,
      label: "等待安装",
      cancelRequested: false,
      canCancel: true,
    };
    this.currentJob = job;
    try {
      this.emit(job, "preflight", 0.02, "重新核对安装边界", { canCancel: true });
      const plan = await this.preflight();
      if (!plan.canInstall) throw new Error(plan.blockers[0] ?? "Darling installation preflight failed.");
      const archivePath = await this.downloadAsset(job);
      this.throwIfCanceled(job);
      await this.verifyAndExtract(job, archivePath);
      this.throwIfCanceled(job);
      await this.createDistribution(job);
      await this.validateDistroEnvironment();
      this.throwIfCanceled(job);
      await this.installPackages(job, archivePath);
      await this.configureUser(job);
      const terminal = await this.smokeTest(job);
      this.throwIfCanceled(job);
      this.emit(job, "smoke-testing", 0.99, "记录已验证的 Darling 状态", { canCancel: false });
      await this.writeMarker(job, terminal === "ready" ? "ready" : "cli-ready-gui-unavailable");
      this.emit(job, terminal, 1, terminal === "ready" ? "Darling CLI 与 WSLg 实验通道已就绪" : "Darling CLI 已就绪，WSLg 未发现", {
        canCancel: false,
      });
      return {
        completed: true,
        canceled: false,
        message: terminal === "ready"
          ? "Darling 已安装到专用 MVM-Darling 发行版；CLI 与图形通道探测通过，但应用兼容性仍需逐个测试。"
          : "Darling CLI 已安装并验证，但未检测到 WSLg 图形通道。",
      };
    } catch (error) {
      const canceled = job.cancelRequested || job.abortController.signal.aborted || (error instanceof Error && error.name === "AbortError");
      if (canceled) {
        await this.invokeWsl(["--terminate", DARLING_DISTRIBUTION], 30_000).catch(() => undefined);
        this.emit(job, "canceled", 1, "安装已在安全步骤边界停止", { canCancel: false });
        return { completed: false, canceled: true, message: "Darling 安装已取消；已完成内容保留用于后续恢复。" };
      }
      const detail = error instanceof Error ? error.message : "Unknown Darling installation error.";
      this.emit(job, "failed", 1, "Darling 安装未完成", { detail, logLine: detail, canCancel: false });
      return { completed: false, canceled: false, message: detail };
    } finally {
      this.currentJob = undefined;
    }
  }

  public cancel(jobId: string): boolean {
    const job = this.currentJob;
    if (!job || job.id !== jobId || !job.canCancel) return false;
    job.cancelRequested = true;
    const transactional = job.phase === "creating-distro" || job.phase === "installing-packages" || job.phase === "configuring-user";
    if (!transactional) job.abortController.abort();
    const label = job.phase === "creating-distro"
      ? "将在 WSL 注册并写入所有权标记后停止"
      : transactional
        ? "将在当前软件包或配置步骤完成后停止"
        : "正在停止安装";
    this.emit(job, "canceling", job.progress, label, {
      canCancel: false,
    });
    return true;
  }
}
