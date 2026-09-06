import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";

import {
  CoreErrorCode,
  DEFAULT_MACHO_LIMITS,
  DirectAppAnalyzer,
  PlistV5Adapter,
  SevenZipListAdapter,
  coreError,
  discoverSevenZip,
  isCoreAnalysisError,
  isPathInside,
  isPlistDictionary,
  probeFileMagic,
  type AnalysisFinding,
  type DirectAppAnalysis,
  type SevenZipInstallation,
  type SevenZipListing,
} from "./core/index.js";
import type {
  AppFinding,
  ArchitectureSlice,
  DarlingInstallPlan,
  DarlingInstallProgress,
  DarlingInstallResult,
  DesktopSnapshot,
  ImportAndRunNativeResult,
  ImportPhase,
  ImportProgress,
  ImportResult,
  LaunchResult,
  NativeAppRunResult,
  MvmAppRecord,
  MvmEvent,
  RuntimeSnapshot,
  ToolProbe,
} from "./desktop-api.js";
import { DARLING_DISTRIBUTION, DARLING_PREFIX, DarlingInstaller } from "./darling-installer.js";
import { createStructureFixture } from "./fixture-builder.js";
import {
  type NativeRunResult,
} from "./native-runtime/index.js";
import { COMPATIBILITY_PROBE as NATIVE_RUNTIME_PROBE } from './compat-runtime/probe.js';
import { runCompatibilityWorker } from './compat-runtime/broker.js';
import type { CompatibilityResult } from './compat-runtime/index.js';
import type { HostOptions } from './compat-runtime/host.js';

interface StoredApp extends MvmAppRecord {
  readonly bundlePath: string;
}

interface PersistedState {
  readonly schemaVersion: 1;
  readonly apps: readonly StoredApp[];
  readonly events: readonly MvmEvent[];
}

interface ProcessOutput {
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

interface ArchiveMaterialization {
  readonly bundlePath: string;
  readonly appEntryPath: string;
  readonly listing: SevenZipListing;
}

const EMPTY_RUNTIME: RuntimeSnapshot = {
  nativeTranslator: {
    available: NATIVE_RUNTIME_PROBE.available,
    label: NATIVE_RUNTIME_PROBE.name,
    detail: NATIVE_RUNTIME_PROBE.detail,
    version: NATIVE_RUNTIME_PROBE.version,
  },
  sevenZip: { available: false, label: "7-Zip", detail: "尚未探测" },
  wsl: { available: false, label: "WSL 2", detail: "尚未探测" },
  darling: { available: false, label: "Darling", detail: "未连接实验后端" },
  selectedBackend: NATIVE_RUNTIME_PROBE.available ? "native-windows" : "diagnostic",
  probedAt: new Date(0).toISOString(),
};

const MAX_EVENTS = 200;
const MAX_EXECUTABLE_BYTES = 512 * 1024 * 1024;
const MAX_PLIST_BYTES = 32 * 1024 * 1024;
const MAX_CONTAINER_BYTES = 16 * 1024 * 1024 * 1024;
const MAX_BUNDLE_ENTRIES = 100_000;
const NATIVE_MAX_FILE_BYTES = 64 * 1024 * 1024;
const NATIVE_INSTRUCTION_BUDGET = 1_000_000;
const NATIVE_STACK_BYTES = 1024 * 1024;
const BUNDLED_7ZIP_EXE_SHA256 = "e2ca3ec168ae9c0b4115cd4fe220145ea9b2dc4b6fc79d765e91f415b34d00de";
const BUNDLED_7ZIP_DLL_SHA256 = "882063948d675ee41b5ae68db3e84879350ec81cf88d15b9babf2fa08e332863";

function sourceKindFor(inputPath: string, fixture: boolean): MvmAppRecord["sourceKind"] {
  if (fixture) return "fixture";
  const extension = path.extname(inputPath).toLowerCase();
  if (extension === ".dmg") return "dmg";
  if (extension === ".pkg") return "pkg";
  if (extension === ".zip") return "zip";
  return "app";
}

function safeFileStem(value: string): string {
  const stem = value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "-")
    .replace(/[. ]+$/gu, "")
    .trim();
  return stem.slice(0, 80) || "MVM";
}

function isSafeLocalInputPath(inputPath: string): boolean {
  if (!path.isAbsolute(inputPath) || inputPath.length > 32_000 || inputPath.includes("\0")) return false;
  if (process.platform !== "win32") return true;
  const normalized = inputPath.replaceAll("/", "\\");
  if (
    normalized.startsWith("\\\\") ||
    normalized.startsWith("\\?") ||
    normalized.startsWith("\\.\\") ||
    normalized.startsWith("\\??\\") ||
    normalized.toUpperCase().includes("GLOBALROOT")
  ) {
    return false;
  }
  return /^[A-Za-z]:\\/u.test(normalized);
}

function optional<T>(value: T | undefined, key: string): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

function findingTitle(code: string): string {
  const known: Readonly<Record<string, string>> = {
    BUNDLE_PACKAGE_TYPE_NOT_APPL: "包类型不是应用",
    BUNDLE_IDENTIFIER_MISSING: "缺少 Bundle ID",
    MAIN_BINARY_NOT_EXECUTE: "主文件不是可执行 Mach-O",
    UNKNOWN_CPU_ARCHITECTURE: "无法识别 CPU 架构",
    ENCRYPTED_MACHO_SLICE: "主程序包含加密 slice",
    CODE_SIGNATURE_ABSENT: "未声明代码签名",
    NON_MACOS_BUILD_PLATFORM: "目标平台不是 macOS",
    INPUT_NOT_FOUND: "找不到输入",
    INPUT_PERMISSION_DENIED: "没有读取权限",
    INPUT_DEVICE_PATH_REJECTED: "拒绝非本地输入路径",
    INPUT_CHANGED_DURING_IMPORT: "导入期间文件发生变化",
    FORMAT_UNKNOWN: "无法识别包格式",
    FORMAT_CORRUPT: "包内容损坏",
    UNSUPPORTED_FORMAT: "当前版本尚不支持该容器",
    UNSAFE_PATH: "包内路径不安全",
    UNSAFE_LINK: "包内链接不安全",
    WINDOWS_PATH_COLLISION: "包内路径在 Windows 上冲突",
    DUPLICATE_ARCHIVE_PATH: "包内存在重复路径",
    LIMIT_ENTRY_COUNT: "包内项目过多",
    LIMIT_EXPANDED_BYTES: "展开体积超过安全限制",
    APP_LAYOUT_INVALID: "应用目录结构无效",
    PLIST_MISSING: "缺少 Info.plist",
    PLIST_INVALID: "Info.plist 无法解析",
    EXECUTABLE_MISSING: "缺少主程序",
    NOT_MACHO: "主程序不是 Mach-O",
    MACHO_MALFORMED: "Mach-O 结构无效",
    IMPORT_TOOL_MISSING: "缺少完整 7-Zip",
    IMPORT_TOOL_UNSUPPORTED_VERSION: "7-Zip 格式能力不足",
    IMPORT_TOOL_TIMEOUT: "包检查超时",
    IMPORT_TOOL_CRASH: "包检查工具异常退出",
    IMPORT_TOOL_OUTPUT_INVALID: "包检查结果无效",
    NO_APP_BUNDLE_FOUND: "没有找到可分析的 .app",
    ARCHIVE_MEMBER_READ_FAILED: "无法读取包内应用",
  };
  return known[code] ?? "静态检查发现问题";
}

function actionForCode(code: string): string | undefined {
  if (code === CoreErrorCode.ImportToolMissing || code === CoreErrorCode.ImportToolUnsupportedVersion) {
    return "重新安装 MVM，或在设置中提供支持 DMG/HFS/APFS/XAR/CPIO 的完整 7-Zip。";
  }
  if (code === "NO_APP_BUNDLE_FOUND") {
    return "尝试直接导入应用的 .app 文件夹；PKG Payload 递归展开将在后续运行时包中加入。";
  }
  if (code.startsWith("UNSAFE_") || code.includes("COLLISION")) {
    return "请从可信来源重新获取安装包；MVM 不会绕过该安全检查。";
  }
  if (code === "ENCRYPTED_MACHO_SLICE") {
    return "使用未加密、由开发者合法分发的应用构建。";
  }
  return undefined;
}

function mapCoreFinding(finding: AnalysisFinding): AppFinding {
  const action = actionForCode(finding.code);
  return {
    code: finding.code,
    severity: finding.severity,
    title: findingTitle(finding.code),
    description: finding.message,
    ...(action === undefined ? {} : { action }),
    ...(finding.evidence === undefined ? {} : { evidence: finding.evidence }),
  };
}

function errorFinding(error: unknown): AppFinding {
  if (isCoreAnalysisError(error)) {
    const action = actionForCode(error.code);
    return {
      code: error.code,
      severity: "blocker",
      title: findingTitle(error.code),
      description: error.message,
      ...(action === undefined ? {} : { action }),
      ...(error.details === undefined ? {} : { evidence: error.details }),
    };
  }
  return {
    code: "IMPORT_FAILED",
    severity: "blocker",
    title: "导入未完成",
    description: error instanceof Error ? error.message : "发生未知错误。",
    action: "确认输入仍可读取后重试，并导出事件日志用于诊断。",
  };
}

function decodeWindowsOutput(bytes: Buffer): string {
  if (bytes.length >= 2) {
    let zeroBytes = 0;
    for (let index = 1; index < Math.min(bytes.length, 512); index += 2) {
      if (bytes[index] === 0) zeroBytes += 1;
    }
    if (zeroBytes > Math.min(bytes.length, 512) / 8) {
      return bytes.toString("utf16le").replace(/^\ufeff/u, "").trim();
    }
  }
  return bytes.toString("utf8").replace(/^\ufeff/u, "").trim();
}

export function parseWsl2Distributions(output: string): readonly string[] {
  const distributions: string[] = [];
  for (const rawLine of output.replaceAll("\0", "").split(/\r?\n/u)) {
    const line = rawLine.replace(/^\s*\*?\s*/u, "").trimEnd();
    const match = /^(.+?)\s{2,}.+?\s+2\s*$/u.exec(line) ?? /^(\S+)\s+.+\s+2\s*$/u.exec(line);
    const name = match?.[1]?.trim();
    if (name && !name.toLowerCase().includes("docker-desktop")) distributions.push(name);
  }
  return distributions;
}

async function runProcess(
  executable: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly timeoutMs: number; readonly maxStdoutBytes: number },
): Promise<ProcessOutput> {
  return await new Promise<ProcessOutput>((resolve, reject) => {
    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
        TEMP: process.env.TEMP ?? options.cwd,
        TMP: process.env.TMP ?? options.cwd,
      },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let exceeded = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs);
    timer.unref();

    child.stdout.on("data", (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stdoutBytes += bytes.length;
      if (stdoutBytes > options.maxStdoutBytes) {
        exceeded = true;
        child.kill("SIGKILL");
      } else {
        stdout.push(bytes);
      }
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderrBytes += bytes.length;
      if (stderrBytes <= 1024 * 1024) stderr.push(bytes);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(coreError(CoreErrorCode.ImportToolTimeout, "materializing", "读取包内文件超时。"));
        return;
      }
      if (exceeded) {
        reject(coreError(CoreErrorCode.LimitFileBytes, "materializing", "包内文件超过静态分析大小限制。"));
        return;
      }
      resolve({ exitCode: code ?? -1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) });
    });
  });
}

async function hashFiles(filePaths: readonly string[]): Promise<string> {
  const hash = createHash("sha256");
  for (const filePath of filePaths) {
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(filePath);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("error", reject);
      stream.on("end", resolve);
    });
  }
  return hash.digest("hex");
}

async function bundleManifestHash(bundlePath: string): Promise<string> {
  const root = path.resolve(bundlePath);
  const rootStats = await lstat(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw coreError(CoreErrorCode.AppLayoutInvalid, "analyzing", "App bundle root must be a real directory.");
  }
  const hash = createHash("sha256");
  hash.update("mvm-bundle-manifest-v1\0");
  const collisionKeys = new Set<string>();
  let entryCount = 0;
  let totalBytes = 0;

  const walk = async (absoluteDirectory: string, relativeDirectory: string): Promise<void> => {
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    entries.sort((left, right) => Buffer.compare(Buffer.from(left.name, "utf8"), Buffer.from(right.name, "utf8")));
    for (const entry of entries) {
      entryCount += 1;
      if (entryCount > MAX_BUNDLE_ENTRIES) {
        throw coreError(CoreErrorCode.LimitEntryCount, "analyzing", "App bundle contains too many filesystem entries.");
      }
      const relativePath = (relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name).normalize("NFC");
      const collisionKey = relativePath.toLowerCase();
      if (collisionKeys.has(collisionKey)) {
        throw coreError(CoreErrorCode.WindowsPathCollision, "analyzing", "App bundle contains colliding Windows paths.", {
          relativePath,
        });
      }
      collisionKeys.add(collisionKey);
      const absolutePath = path.join(absoluteDirectory, entry.name);
      const before = await lstat(absolutePath);

      if (before.isSymbolicLink()) {
        const target = await readlink(absolutePath);
        if (path.isAbsolute(target) || !isPathInside(root, path.resolve(path.dirname(absolutePath), target))) {
          throw coreError(CoreErrorCode.UnsafeLink, "analyzing", "App bundle contains a link that resolves outside the bundle.", {
            relativePath,
            target,
          });
        }
        hash.update(`L\0${relativePath}\0${target.normalize("NFC")}\0`);
      } else if (before.isDirectory()) {
        hash.update(`D\0${relativePath}\0`);
        await walk(absolutePath, relativePath);
      } else if (before.isFile()) {
        totalBytes += before.size;
        if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_CONTAINER_BYTES) {
          throw coreError(CoreErrorCode.LimitExpandedBytes, "analyzing", "App bundle exceeds the 16 GiB manifest limit.");
        }
        hash.update(`F\0${relativePath}\0${before.size}\0`);
        let bytesRead = 0;
        if (before.size > 0) {
          await new Promise<void>((resolve, reject) => {
            const stream = createReadStream(absolutePath, { start: 0, end: before.size - 1 });
            stream.on("data", (chunk: Buffer | string) => {
              const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              bytesRead += bytes.length;
              hash.update(bytes);
            });
            stream.on("error", reject);
            stream.on("end", resolve);
          });
        }
        const after = await lstat(absolutePath);
        if (
          !after.isFile() ||
          bytesRead !== before.size ||
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          before.ino !== after.ino
        ) {
          throw coreError(CoreErrorCode.InputChanged, "analyzing", "App bundle changed while its manifest was being hashed.", {
            relativePath,
          });
        }
      } else {
        throw coreError(CoreErrorCode.AppLayoutInvalid, "analyzing", "App bundle contains an unsupported filesystem entry.", {
          relativePath,
        });
      }
    }
  };

  await walk(root, "");
  return hash.digest("hex");
}

function frameworkNames(analysis: DirectAppAnalysis): readonly string[] {
  const names = new Set<string>();
  for (const slice of analysis.mainExecutable.slices) {
    for (const dylib of slice.dylibs) {
      const match = /(?:^|\/)([^/]+)\.framework(?:\/|$)/u.exec(dylib.path);
      if (match?.[1]) names.add(match[1]);
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

function architectureSlices(analysis: DirectAppAnalysis): readonly ArchitectureSlice[] {
  return analysis.mainExecutable.slices.map((slice) => {
    const build = slice.buildVersions.find((item) => item.platform === 1) ?? slice.buildVersions[0];
    const minimum = slice.minimumVersions[0];
    return {
      name: slice.architecture,
      ...optional(build?.minimumOs ?? minimum?.version, "minimumOs"),
      ...optional(build?.sdk ?? minimum?.sdk, "sdk"),
      fileType: slice.fileTypeName,
      encrypted: slice.encryption.some((item) => item.encrypted),
      dylibs: slice.dylibs.map((item) => item.path),
      rpaths: slice.rpaths,
      hasCodeSignature: slice.codeSignatures.length > 0,
    } as ArchitectureSlice;
  });
}

function makeStoredRecord(
  id: string,
  sourcePath: string,
  bundlePath: string,
  analysis: DirectAppAnalysis,
  sourceSha256: string,
  fixture: boolean,
  extraFindings: readonly AppFinding[] = [],
): StoredApp {
  const findings = [...analysis.findings.map(mapCoreFinding), ...extraFindings];
  const metadata = analysis.metadata;
  const displayName = metadata.displayName ?? metadata.bundleName ?? path.basename(bundlePath, ".app");
  return {
    id,
    displayName,
    fileName: path.basename(bundlePath),
    sourcePath,
    sourceKind: sourceKindFor(sourcePath, fixture),
    importedAt: new Date().toISOString(),
    isFixture: fixture,
    ...optional(metadata.bundleIdentifier, "bundleIdentifier"),
    ...optional(metadata.shortVersion ?? metadata.version, "version"),
    executableName: metadata.executable,
    ...optional(metadata.minimumSystemVersion, "minimumSystemVersion"),
    architectures: architectureSlices(analysis),
    frameworks: frameworkNames(analysis),
    findings,
    phase: findings.length === 0 ? "ready" : "ready-with-warnings",
    launchability: findings.some((finding) => finding.severity === "blocker") ? "blocked" : "not-tested",
    sourceSha256,
    bundlePath,
  };
}

function isPersistedContainer(value: unknown): value is PersistedState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PersistedState>;
  return candidate.schemaVersion === 1 && Array.isArray(candidate.apps) && Array.isArray(candidate.events);
}

function isBoundedString(value: unknown, maximum = 4096): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !value.includes("\0");
}

function isOptionalBoundedString(value: unknown, maximum = 4096): value is string | undefined {
  return value === undefined || isBoundedString(value, maximum);
}

function isStoredApp(value: unknown): value is StoredApp {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<StoredApp>;
  return (
    isBoundedString(item.id, 128) &&
    isBoundedString(item.displayName, 512) &&
    isBoundedString(item.fileName, 512) &&
    isBoundedString(item.sourcePath, 32_000) &&
    isSafeLocalInputPath(item.sourcePath) &&
    isBoundedString(item.bundlePath, 32_000) &&
    isSafeLocalInputPath(item.bundlePath) &&
    typeof item.sourceKind === "string" &&
    ["app", "dmg", "pkg", "zip", "fixture"].includes(item.sourceKind) &&
    isBoundedString(item.importedAt, 64) &&
    !Number.isNaN(Date.parse(item.importedAt)) &&
    typeof item.isFixture === "boolean" &&
    isOptionalBoundedString(item.bundleIdentifier, 1024) &&
    isOptionalBoundedString(item.version, 256) &&
    isOptionalBoundedString(item.executableName, 512) &&
    isOptionalBoundedString(item.minimumSystemVersion, 128) &&
    typeof item.sourceSha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(item.sourceSha256) &&
    Array.isArray(item.architectures) &&
    item.architectures.length <= 32 &&
    item.architectures.every((slice) =>
      typeof slice === "object" &&
      slice !== null &&
      typeof slice.name === "string" &&
      ["x86_64", "arm64", "arm64e", "unknown"].includes(slice.name) &&
      isOptionalBoundedString(slice.minimumOs, 128) &&
      isOptionalBoundedString(slice.sdk, 128) &&
      isBoundedString(slice.fileType, 128) &&
      typeof slice.encrypted === "boolean" &&
      Array.isArray(slice.dylibs) &&
      slice.dylibs.length <= 65_535 &&
      slice.dylibs.every((entry: unknown) => isBoundedString(entry, 64 * 1024)) &&
      Array.isArray(slice.rpaths) &&
      slice.rpaths.length <= 65_535 &&
      slice.rpaths.every((entry: unknown) => isBoundedString(entry, 64 * 1024)) &&
      typeof slice.hasCodeSignature === "boolean",
    ) &&
    Array.isArray(item.frameworks) &&
    item.frameworks.length <= 4096 &&
    item.frameworks.every((entry) => isBoundedString(entry, 1024)) &&
    Array.isArray(item.findings) &&
    item.findings.length <= 4096 &&
    item.findings.every((finding) =>
      typeof finding === "object" &&
      finding !== null &&
      isBoundedString(finding.code, 256) &&
      typeof finding.severity === "string" &&
      ["info", "warning", "blocker"].includes(finding.severity) &&
      isBoundedString(finding.title, 1024) &&
      isBoundedString(finding.description, 16 * 1024) &&
      isOptionalBoundedString(finding.action, 16 * 1024) &&
      (finding.evidence === undefined || (typeof finding.evidence === "object" && finding.evidence !== null && !Array.isArray(finding.evidence))),
    ) &&
    typeof item.phase === "string" &&
    ["queued", "acquiring", "probing", "indexing", "materializing", "discovering", "analyzing", "committing", "ready", "ready-with-warnings", "unsupported", "failed"].includes(item.phase) &&
    typeof item.launchability === "string" &&
    ["not-tested", "no-backend", "candidate", "blocked"].includes(item.launchability)
  );
}

function isStoredEvent(value: unknown): value is MvmEvent {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<MvmEvent>;
  return (
    isBoundedString(item.id, 128) &&
    isBoundedString(item.at, 64) &&
    !Number.isNaN(Date.parse(item.at)) &&
    typeof item.level === "string" &&
    ["info", "warning", "error", "success"].includes(item.level) &&
    isBoundedString(item.title, 1024) &&
    isBoundedString(item.detail, 16 * 1024) &&
    (item.appId === undefined || isBoundedString(item.appId, 128))
  );
}

export class MvmService {
  private readonly analyzer = new DirectAppAnalyzer();
  private readonly nativeAnalyzer = new DirectAppAnalyzer({
    machoLimits: { ...DEFAULT_MACHO_LIMITS, maxFileBytes: NATIVE_MAX_FILE_BYTES },
  });
  private readonly darlingInstaller: DarlingInstaller;
  private readonly statePath: string;
  private readonly importsRoot: string;
  private readonly fixturesRoot: string;
  private readonly bundledSevenZipPath: string;
  private readonly bundledSevenZipDllPath: string;
  private apps: StoredApp[] = [];
  private events: MvmEvent[] = [];
  private runtime: RuntimeSnapshot = EMPTY_RUNTIME;
  private sevenZip: SevenZipInstallation | undefined;
  private darlingDistribution: string | undefined;
  /** Serializes imports and native execution so an imported bundle cannot be replaced mid-run. */
  private operationInProgress = false;
  private persistenceTail: Promise<void> = Promise.resolve();
  private progressEmitter: (progress: ImportProgress) => void = () => undefined;

  public constructor(
    private readonly userDataPath: string,
    private readonly resourcesRoot: string,
    private readonly nativeHost: HostOptions = {},
  ) {
    this.statePath = path.join(userDataPath, "mvm-state.json");
    this.importsRoot = path.join(userDataPath, "imports");
    this.fixturesRoot = path.join(userDataPath, "fixtures");
    this.bundledSevenZipPath = path.join(resourcesRoot, "runtime", "7zip", "7z.exe");
    this.bundledSevenZipDllPath = path.join(resourcesRoot, "runtime", "7zip", "7z.dll");
    this.darlingInstaller = new DarlingInstaller({ userDataPath, resourcesRoot });
  }

  public async initialize(): Promise<void> {
    await mkdir(this.userDataPath, { recursive: true });
    await mkdir(this.importsRoot, { recursive: true });
    await mkdir(this.fixturesRoot, { recursive: true });
    let repairState = false;
    try {
      const parsed: unknown = JSON.parse(await readFile(this.statePath, "utf8"));
      if (isPersistedContainer(parsed)) {
        const validApps = parsed.apps.filter(isStoredApp);
        const allValidEvents = parsed.events.filter(isStoredEvent);
        const validEvents = allValidEvents.slice(0, MAX_EVENTS);
        this.apps = validApps;
        this.events = validEvents;
        const dropped = parsed.apps.length - validApps.length + parsed.events.length - allValidEvents.length;
        if (dropped > 0) {
          this.addEvent("warning", "已隔离无效本地状态", `${dropped} 条不符合 v1 数据模型的记录未被加载。`);
          repairState = true;
        }
      } else {
        this.addEvent("warning", "本地状态已重建", "状态文件版本或结构无效，MVM 已从空应用库启动。");
        repairState = true;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.addEvent("warning", "本地状态已重建", "旧状态文件无法读取，MVM 已从空应用库启动。");
        repairState = true;
      }
    }
    const sevenZip = await this.probeSevenZip();
    this.runtime = {
      ...EMPTY_RUNTIME,
      sevenZip,
      probedAt: new Date().toISOString(),
    };
    if (repairState) await this.persist();
  }

  public setProgressEmitter(emitter: (progress: ImportProgress) => void): void {
    this.progressEmitter = emitter;
  }

  public setDarlingInstallProgressEmitter(emitter: (progress: DarlingInstallProgress) => void): void {
    this.darlingInstaller.setProgressEmitter(emitter);
  }

  private emit(jobId: string, phase: ImportPhase, progress: number, label: string, appId?: string): void {
    this.progressEmitter({ jobId, phase, progress, label, ...(appId === undefined ? {} : { appId }) });
  }

  private addEvent(
    level: MvmEvent["level"],
    title: string,
    detail: string,
    appId?: string,
  ): void {
    this.events.unshift({
      id: randomUUID(),
      at: new Date().toISOString(),
      level,
      title,
      detail,
      ...(appId === undefined ? {} : { appId }),
    });
    this.events = this.events.slice(0, MAX_EVENTS);
  }

  private async persist(): Promise<void> {
    const state: PersistedState = { schemaVersion: 1, apps: this.apps, events: this.events };
    const serialized = `${JSON.stringify(state, null, 2)}\n`;
    const operation = this.persistenceTail.then(async () => {
      await mkdir(this.userDataPath, { recursive: true });
      const temporaryPath = `${this.statePath}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, serialized, "utf8");
      await rename(temporaryPath, this.statePath);
    });
    this.persistenceTail = operation.catch(() => undefined);
    await operation;
  }

  private async discardImportDirectory(id: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/u.test(id)) return;
    const target = path.resolve(this.importsRoot, id);
    if (path.dirname(target) !== path.resolve(this.importsRoot) || !isPathInside(this.importsRoot, target)) return;
    await rm(target, { recursive: true, force: true });
  }

  private async discardManagedRecord(record: StoredApp): Promise<void> {
    if (record.sourceKind === "app") return;
    if (record.sourceKind === "fixture") {
      const relativeFixture = path.relative(this.fixturesRoot, record.bundlePath);
      const fixtureId = relativeFixture.split(path.sep)[0];
      if (fixtureId && /^[0-9a-f-]{36}$/u.test(fixtureId)) {
        const target = path.resolve(this.fixturesRoot, fixtureId);
        if (path.dirname(target) === path.resolve(this.fixturesRoot) && isPathInside(this.fixturesRoot, target)) {
          await rm(target, { recursive: true, force: true });
        }
      }
      return;
    }
    const relative = path.relative(this.importsRoot, record.bundlePath);
    const id = relative.split(path.sep)[0];
    if (id) await this.discardImportDirectory(id);
  }

  private decorate(record: StoredApp): MvmAppRecord {
    const staticBlocker = record.findings.some((finding) => finding.severity === "blocker");
    const hasX64 = record.architectures.some((slice) => slice.name === "x86_64");
    const runtimeFindings: AppFinding[] = [];
    let launchability: MvmAppRecord["launchability"];

    if (record.isFixture) {
      launchability = "blocked";
      runtimeFindings.push({
        code: "FIXTURE_NATIVE_PROOF",
        severity: "info",
        title: "MVM 兼容引擎证明样本",
        description: "该样本由 C 源码编译为 macOS x86_64 程序，执行循环和函数调用、读取资源文件并显示 NSAlert，完成后返回 42。",
      });
    } else if (staticBlocker) {
      launchability = "blocked";
    } else if (!hasX64) {
      launchability = "blocked";
      runtimeFindings.push({
        code: "NATIVE_RUNTIME_REQUIRES_X86_64",
        severity: "blocker",
        title: "兼容引擎需要 Intel slice",
        description: "MVM-CPU/2 当前只能翻译 x86_64；该应用只包含 Apple Silicon 代码。",
        action: "获取包含 x86_64 的 Universal 2 构建。",
      });
    } else if (this.runtime.nativeTranslator.available) {
      launchability = "candidate";
    } else if (!this.runtime.darling.available) {
      launchability = "no-backend";
      runtimeFindings.push({
        code: "RUNTIME_BACKEND_UNAVAILABLE",
        severity: "blocker",
        title: "没有可用运行后端",
        description: "MVM 兼容引擎器在此主机不可用，也没有发现可选 Darling 后端。",
        action: "在 Windows x64 主机运行 MVM，或明确配置 Darling 回退。",
      });
    } else {
      launchability = "candidate";
    }

    const { bundlePath: _bundlePath, ...publicRecord } = record;
    return {
      ...publicRecord,
      findings: [...record.findings, ...runtimeFindings],
      phase: record.phase === "ready" && runtimeFindings.length > 0 ? "ready-with-warnings" : record.phase,
      launchability,
    };
  }

  public snapshot(): DesktopSnapshot {
    return {
      apps: this.apps.map((record) => this.decorate(record)),
      runtime: this.runtime,
      events: this.events,
    };
  }

  private async sevenZipTool(): Promise<SevenZipInstallation> {
    if (this.sevenZip) return this.sevenZip;
    const [executableHash, libraryHash] = await Promise.all([
      hashFiles([this.bundledSevenZipPath]),
      hashFiles([this.bundledSevenZipDllPath]),
    ]);
    if (executableHash !== BUNDLED_7ZIP_EXE_SHA256 || libraryHash !== BUNDLED_7ZIP_DLL_SHA256) {
      throw coreError(CoreErrorCode.ImportToolUnsupportedVersion, "indexing", "Bundled 7-Zip integrity check failed.", {
        executableHash,
        libraryHash,
      });
    }
    this.sevenZip = await discoverSevenZip({
      explicitPaths: [this.bundledSevenZipPath],
      strictExplicitOnly: true,
    });
    return this.sevenZip;
  }

  private async extractMember(
    tool: SevenZipInstallation,
    archivePath: string,
    memberPath: string,
    maximumBytes: number,
  ): Promise<Buffer> {
    const result = await runProcess(
      tool.executablePath,
      ["e", "-so", "-bd", "-y", "-spd", "-sccUTF-8", "--", archivePath, memberPath],
      { cwd: path.dirname(archivePath), timeoutMs: 120_000, maxStdoutBytes: maximumBytes },
    );
    if (result.exitCode !== 0) {
      throw coreError(CoreErrorCode.FormatCorrupt, "materializing", "7-Zip could not read a selected archive member.", {
        memberPath,
        exitCode: result.exitCode,
        stderr: decodeWindowsOutput(result.stderr).slice(0, 4096),
      });
    }
    return result.stdout;
  }

  private async materializeArchive(
    archivePath: string,
    id: string,
    jobId: string,
  ): Promise<ArchiveMaterialization> {
    const tool = await this.sevenZipTool();
    this.emit(jobId, "indexing", 32, "预检包内路径与展开体积");
    const listing = await new SevenZipListAdapter(tool).listAndPreflight(archivePath);
    if (listing.encryptedEntryCount > 0) {
      throw coreError(CoreErrorCode.EncryptedContainer, "indexing", "Encrypted archive entries are not imported.", {
        encryptedEntryCount: listing.encryptedEntryCount,
      });
    }

    const infoCandidates = listing.entries
      .filter((entry) => entry.kind === "file" && /(?:^|\/)[^/]+\.app\/Contents\/Info\.plist$/u.test(entry.normalizedPath))
      .sort((left, right) => {
        const depth = left.normalizedPath.split("/").length - right.normalizedPath.split("/").length;
        return depth !== 0 ? depth : left.normalizedPath.localeCompare(right.normalizedPath);
      });
    const infoEntry = infoCandidates[0];
    if (!infoEntry) {
      throw coreError(CoreErrorCode.UnsupportedFormat, "discovering", "The container passed safety preflight, but no directly visible .app bundle was found.", {
        code: "NO_APP_BUNDLE_FOUND",
        archiveFormat: listing.archiveFormat ?? null,
        entryCount: listing.entryCount,
      });
    }

    this.emit(jobId, "materializing", 54, "只读取 Info.plist 与主程序");
    if (infoEntry.size > MAX_PLIST_BYTES) {
      throw coreError(CoreErrorCode.LimitFileBytes, "materializing", "Info.plist exceeds the static-analysis byte limit.");
    }
    const infoBytes = await this.extractMember(
      tool,
      archivePath,
      infoEntry.toolReportedPath ?? infoEntry.rawPath,
      MAX_PLIST_BYTES,
    );
    const parsedInfo = await new PlistV5Adapter().parse(infoBytes);
    if (!isPlistDictionary(parsedInfo) || typeof parsedInfo.CFBundleExecutable !== "string") {
      throw coreError(CoreErrorCode.PlistInvalid, "materializing", "Info.plist does not declare a valid CFBundleExecutable.");
    }
    const executableName = parsedInfo.CFBundleExecutable;
    if (!executableName || /[\\/:\u0000]/u.test(executableName) || executableName === "." || executableName === "..") {
      throw coreError(CoreErrorCode.AppLayoutInvalid, "materializing", "CFBundleExecutable is not a safe file name.");
    }

    const suffix = "/Contents/Info.plist";
    const appEntryPath = infoEntry.normalizedPath.slice(0, -suffix.length);
    const executableEntryPath = `${appEntryPath}/Contents/MacOS/${executableName}`;
    const executableEntry = listing.entries.find(
      (entry) => entry.kind === "file" && entry.normalizedPath === executableEntryPath,
    );
    if (!executableEntry) {
      throw coreError(CoreErrorCode.ExecutableMissing, "materializing", "The selected app's main executable is missing from the container.", {
        executableEntryPath,
      });
    }
    if (executableEntry.size > MAX_EXECUTABLE_BYTES) {
      throw coreError(CoreErrorCode.LimitFileBytes, "materializing", "The main executable exceeds the static-analysis byte limit.");
    }
    const executableBytes = await this.extractMember(
      tool,
      archivePath,
      executableEntry.toolReportedPath ?? executableEntry.rawPath,
      MAX_EXECUTABLE_BYTES,
    );

    const bundleName = safeFileStem(path.posix.basename(appEntryPath, ".app"));
    const bundlePath = path.join(this.importsRoot, id, `${bundleName}.app`);
    const contentsPath = path.join(bundlePath, "Contents");
    const macOsPath = path.join(contentsPath, "MacOS");
    await mkdir(macOsPath, { recursive: true });
    await writeFile(path.join(contentsPath, "Info.plist"), infoBytes);
    await writeFile(path.join(macOsPath, executableName), executableBytes);
    const additional = listing.entries.filter(entry => entry.kind === 'file' && entry.normalizedPath.startsWith(appEntryPath + '/') && entry !== infoEntry && entry !== executableEntry);
    const total = additional.reduce((sum,entry)=>sum+entry.size,infoBytes.length+executableBytes.length);
    if (additional.length > 2048 || total > 512*1024*1024 || additional.some(entry=>entry.size>64*1024*1024)) {
      throw coreError(CoreErrorCode.LimitFileBytes,'materializing','Bundle exceeds the current 512 MiB / 2048-file import limit.');
    }
    for (let index=0;index<additional.length;index++) {
      const entry=additional[index]!;
      const relative=entry.normalizedPath.slice(appEntryPath.length+1);
      const target=path.resolve(bundlePath,...relative.split('/'));
      if(!isPathInside(bundlePath,target)) throw coreError(CoreErrorCode.AppLayoutInvalid,'materializing','Bundle member escapes its destination.');
      const bytes=await this.extractMember(tool,archivePath,entry.toolReportedPath ?? entry.rawPath,Math.max(1,entry.size));
      if(bytes.length!==entry.size) throw coreError(CoreErrorCode.FormatCorrupt,'materializing','Bundle member size changed during extraction.');
      await mkdir(path.dirname(target),{recursive:true});
      await writeFile(target,bytes,{flag:'wx'});
      this.emit(jobId,'materializing',56+Math.floor(16*(index+1)/additional.length),`展开应用文件 ${index+1}/${additional.length}`);
    }
    return { bundlePath, appEntryPath, listing };
  }

  private async analyzeInput(
    inputPath: string,
    id: string,
    jobId: string,
    fixture: boolean,
  ): Promise<StoredApp> {
    const inputStats = await stat(inputPath);
    let bundlePath = inputPath;
    let sourceSha256: string;
    const extraFindings: AppFinding[] = [];

    if (inputStats.isDirectory()) {
      if (path.extname(inputPath).toLowerCase() !== ".app") {
        throw coreError(CoreErrorCode.AppLayoutInvalid, "probing", "Selected directory is not a .app bundle.");
      }
      this.emit(jobId, "discovering", 42, "定位 Info.plist 与主程序");
      const manifestBefore = await bundleManifestHash(bundlePath);
      const preliminary = await this.analyzer.analyze(bundlePath);
      this.emit(jobId, "analyzing", 75, "解析 Mach-O 架构与依赖");
      const manifestAfter = await bundleManifestHash(bundlePath);
      if (manifestBefore !== manifestAfter) {
        throw coreError(CoreErrorCode.InputChanged, "analyzing", "App bundle changed between manifest and structural analysis.");
      }
      sourceSha256 = manifestAfter;
      if (fixture) {
        extraFindings.push({
          code: "SOURCE_FIXTURE",
          severity: "info",
          title: "MVM 默认测试应用",
          description: "由 C 源码交叉编译的 macOS x86_64 应用，用于验证机器码、文件读取和 NSAlert 窗口桥接。",
        });
      }
      return makeStoredRecord(id, inputPath, bundlePath, preliminary, sourceSha256, fixture, extraFindings);
    }

    if (!inputStats.isFile()) {
      throw coreError(CoreErrorCode.FormatUnknown, "probing", "Input is neither a regular file nor an app directory.");
    }
    this.emit(jobId, "probing", 16, "核对扩展名与文件魔数");
    const sourceKind = sourceKindFor(inputPath, false);
    if (sourceKind === "app") {
      throw coreError(CoreErrorCode.UnsupportedFormat, "probing", "Only DMG, PKG, ZIP, or a direct .app directory can be imported.");
    }
    if (inputStats.size > MAX_CONTAINER_BYTES) {
      throw coreError(CoreErrorCode.InputTooLarge, "acquiring", "Container exceeds MVM's 16 GiB import limit.", {
        inputBytes: inputStats.size,
        maximumBytes: MAX_CONTAINER_BYTES,
      });
    }
    const stagedInput = path.join(this.importsRoot, id, `source${path.extname(inputPath).toLowerCase()}`);
    await mkdir(path.dirname(stagedInput), { recursive: true });
    await copyFile(inputPath, stagedInput);
    const sourceAfterCopy = await stat(inputPath);
    if (sourceAfterCopy.size !== inputStats.size || sourceAfterCopy.mtimeMs !== inputStats.mtimeMs) {
      throw coreError(CoreErrorCode.InputChanged, "acquiring", "Input changed while MVM was creating its read-only analysis copy.");
    }
    const magic = await probeFileMagic(stagedInput);
    const expected = sourceKind === "dmg" ? ["dmg"] : sourceKind === "pkg" ? ["xar"] : ["zip"];
    if (!expected.includes(magic.primary)) {
      throw coreError(CoreErrorCode.ExtensionMagicMismatch, "probing", "File extension does not match the detected container format.", {
        extension: path.extname(inputPath),
        detected: magic.primary,
      });
    }

    const materialized = await this.materializeArchive(stagedInput, id, jobId);
    bundlePath = materialized.bundlePath;
    this.emit(jobId, "discovering", 70, `定位 ${materialized.appEntryPath}`);
    this.emit(jobId, "analyzing", 82, "解析主 Mach-O 的架构、框架与签名声明");
    const analysis = await this.analyzer.analyze(bundlePath);
    if (materialized.listing.entries.some((entry) => entry.kind === "symlink" || entry.kind === "hardlink")) {
      extraFindings.push({
        code: "ARCHIVE_LINKS_NOT_MATERIALIZED",
        severity: "info",
        title: "链接保持只读",
        description: "包中常规文件会被解包；符号链接和硬链接不会在 Windows 上创建。",
      });
    }
    extraFindings.push({
      code: "ARCHIVE_STATIC_IMPORT_ONLY",
      severity: "blocker",
      title: "归档不走旧版 Darling 启动路径",
      description: "MVM 自研引擎会尝试运行已解包的应用及常规资源。此标记仅阻止旧版 Darling 启动；安装脚本和链接不会执行或创建。",
      action: "使用“运行应用”进入 MVM-CPU/2。",
    });
    sourceSha256 = await hashFiles([stagedInput]);
    return makeStoredRecord(id, inputPath, bundlePath, analysis, sourceSha256, false, extraFindings);
  }

  private async importResolvedPath(
    inputPath: string,
    fixture: boolean,
    operationAlreadyHeld = false,
  ): Promise<ImportResult> {
    if (!operationAlreadyHeld && this.operationInProgress) {
      return {
        canceled: false,
        error: {
          code: "IMPORT_IN_PROGRESS",
          severity: "warning",
          title: "已有导入正在进行",
          description: "请等待当前安全检查完成后再导入下一个应用。",
        },
      };
    }
    if (!operationAlreadyHeld) this.operationInProgress = true;
    const jobId = randomUUID();
    const id = randomUUID();
    this.emit(jobId, "queued", 0, "准备导入");
    try {
      if (!isSafeLocalInputPath(inputPath)) {
        throw coreError(CoreErrorCode.InputDevicePathRejected, "acquiring", "Only a local drive path selected by the Windows picker or drag-and-drop is accepted.");
      }
      this.emit(jobId, "acquiring", 7, "锁定本地输入");
      const record = await this.analyzeInput(path.resolve(inputPath), id, jobId, fixture);
      this.emit(jobId, "committing", 94, "写入本地应用库");
      const previousApps = this.apps;
      const previousEvents = [...this.events];
      const sourceKey = path.resolve(record.sourcePath).toLowerCase();
      const matchesSource = (item: StoredApp): boolean => record.isFixture
        ? item.isFixture
        : path.resolve(item.sourcePath).toLowerCase() === sourceKey;
      const replaced = this.apps.filter(matchesSource);
      this.apps = [record, ...this.apps.filter((item) => !matchesSource(item))];
      this.addEvent("success", fixture ? "默认测试应用已生成" : "静态分析完成", `${record.displayName} 已加入本地应用库。`, record.id);
      this.addEvent(
        record.architectures.some((slice) => slice.name === "x86_64") ? "success" : "warning",
        "Mach-O 分析完成",
        `识别到 ${record.architectures.map((slice) => slice.name).join("、") || "未知"}。`,
        record.id,
      );
      try {
        await this.persist();
      } catch (error) {
        this.apps = previousApps;
        this.events = previousEvents;
        throw error;
      }
      await Promise.allSettled(replaced.map(async (item) => await this.discardManagedRecord(item)));
      const publicRecord = this.decorate(record);
      this.emit(jobId, publicRecord.phase, 100, "静态检测完成", record.id);
      return { canceled: false, app: publicRecord };
    } catch (error) {
      const finding = errorFinding(error);
      const unsupported = isCoreAnalysisError(error) && (
        error.code === CoreErrorCode.UnsupportedFormat ||
        error.code === CoreErrorCode.FormatUnknown ||
        error.code === CoreErrorCode.ExtensionMagicMismatch
      );
      this.addEvent("error", finding.title, finding.description);
      await this.discardImportDirectory(id).catch(() => undefined);
      await this.persist().catch(() => undefined);
      this.emit(jobId, unsupported ? "unsupported" : "failed", 100, finding.title);
      return { canceled: false, error: finding };
    } finally {
      if (!operationAlreadyHeld) this.operationInProgress = false;
    }
  }

  public async importPath(inputPath: string): Promise<ImportResult> {
    return await this.importResolvedPath(inputPath, false);
  }

  public async createFixture(): Promise<ImportResult> {
    const fixtureRoot = path.join(this.fixturesRoot, randomUUID());
    const fixturePath = await createStructureFixture(fixtureRoot);
    // The shipped default is compiler-produced. The old byte fixture remains in
    // unit tests for malformed-container coverage, never as a GUI proof.
    try {
      const compiled = path.join(this.resourcesRoot,'samples','MVMProbe');
      await copyFile(compiled,path.join(fixturePath,'Contents','MacOS','MVMProbe'));
      await copyFile(path.join(this.resourcesRoot,'samples','Info.plist'),path.join(fixturePath,'Contents','Info.plist'));
      await mkdir(path.join(fixturePath,'Contents','Resources'),{recursive:true});
      await copyFile(path.join(this.resourcesRoot,'samples','message.txt'),path.join(fixturePath,'Contents','Resources','message.txt'));
    } catch(error) {
      await rm(fixtureRoot,{recursive:true,force:true}).catch(()=>undefined);
      throw error;
    }
    const result = await this.importResolvedPath(fixturePath, true);
    if (result.error) await rm(fixtureRoot, { recursive: true, force: true }).catch(() => undefined);
    return result;
  }

  private mapNativeRunResult(
    appId: string,
    runId: string,
    startedAt: number,
    result: NativeRunResult | CompatibilityResult,
  ): NativeAppRunResult {
    const common = {
      runId,
      appId,
      backend: "native-windows-ir" as const,
      message: result.message,
      durationMs: Math.max(0, Date.now() - startedAt),
      translatedInstructionCount: result.translatedInstructionCount,
      executedInstructionCount: result.executedInstructionCount,
      ...('engine' in result ? {engine:result.engine,stdout:result.stdout,stderr:result.stderr,dialogsShown:result.dialogsShown,hostCalls:result.hostCalls} : {}),
      ...(result.selectedSliceOffset === undefined ? {} : { selectedSliceOffset: result.selectedSliceOffset }),
      ...(result.selectedSliceSize === undefined ? {} : { selectedSliceSize: result.selectedSliceSize }),
      ...(result.entryOffset === undefined ? {} : { entryOffset: result.entryOffset }),
      ...(result.entryFileOffset === undefined ? {} : { entryFileOffset: result.entryFileOffset }),
      ...(result.mount === undefined ? {} : { mount: result.mount }),
    };
    if (result.status === "completed") {
      return {
        ...common,
        status: "completed",
        code: "OK",
        returnValue: result.returnValue,
        exitCode: result.exitCode,
      };
    }
    return { ...common, status: result.status, code: result.code };
  }

  private nativeBlockedResult(
    appId: string,
    runId: string,
    code: "APP_RECORD_NOT_FOUND" | "NATIVE_RUN_BUSY" | "NATIVE_RUNTIME_ERROR",
    message: string,
    startedAt = Date.now(),
  ): NativeAppRunResult {
    return {
      runId,
      appId,
      backend: "native-windows-ir",
      status: "blocked",
      code,
      message,
      durationMs: Math.max(0, Date.now() - startedAt),
      translatedInstructionCount: 0,
      executedInstructionCount: 0,
    };
  }

  private async recordNativeTerminalEvent(record: StoredApp, result: NativeAppRunResult): Promise<void> {
    if (result.status === "completed") {
      this.addEvent(
        "success",
        "Mac 应用运行结束",
        `${result.engine ?? 'MVM-CPU/2'}：退出码 ${result.exitCode}，执行 ${result.executedInstructionCount} 条指令，完成 ${result.dialogsShown ?? 0} 个系统对话框。${result.stdout ? '\n' + result.stdout.slice(0,3000) : ''}`,
        record.id,
      );
    } else if (result.status === "unsupported") {
      this.addEvent(
        "warning",
        "Windows 兼容引擎暂不支持",
        `${result.code}: ${result.message} 未报告应用窗口已启动。`,
        record.id,
      );
    } else {
      this.addEvent(
        "error",
        "Windows 兼容引擎已阻止",
        `${result.code}: ${result.message} 路径、格式或预算边界未被绕过。`,
        record.id,
      );
    }
    await this.persist().catch(() => undefined);
  }

  private async runNativeRecord(record: StoredApp, runId: string): Promise<NativeAppRunResult> {
    const startedAt = Date.now();
    try {
      // This fresh structural read locates the executable and re-applies bundle
      // containment checks. Findings are intentionally not a launch gate: the
      // native runtime makes its own bounded format/opcode decision below.
      const analysis = await this.nativeAnalyzer.analyze(record.bundlePath);
      const runtimeResult = await runCompatibilityWorker(analysis.executablePath, {
        instructionBudget: NATIVE_INSTRUCTION_BUDGET,
        stackBytes: NATIVE_STACK_BYTES,
        fileBridgeRoot: record.bundlePath,
        ...this.nativeHost,
      });
      const result = this.mapNativeRunResult(record.id, runId, startedAt, runtimeResult);
      await this.recordNativeTerminalEvent(record, result);
      return result;
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 4_096) : "原生运行时发生未知错误。";
      const result = this.nativeBlockedResult(record.id, runId, "NATIVE_RUNTIME_ERROR", detail, startedAt);
      await this.recordNativeTerminalEvent(record, result);
      return result;
    }
  }

  public async runNative(appId: string): Promise<NativeAppRunResult> {
    const runId = randomUUID();
    if (this.operationInProgress) {
      return this.nativeBlockedResult(appId, runId, "NATIVE_RUN_BUSY", "已有导入或原生转译正在进行，请稍后重试。");
    }
    this.operationInProgress = true;
    try {
      const record = this.apps.find((item) => item.id === appId);
      if (!record) {
        const result = this.nativeBlockedResult(appId, runId, "APP_RECORD_NOT_FOUND", "应用记录不存在。请重新导入后再试。");
        this.addEvent("warning", "无法开始 Windows 兼容引擎", `${result.code}: ${result.message}`);
        await this.persist().catch(() => undefined);
        return result;
      }
      return await this.runNativeRecord(record, runId);
    } finally {
      this.operationInProgress = false;
    }
  }

  public async importAndRunNative(inputPath: string): Promise<ImportAndRunNativeResult> {
    if (this.operationInProgress) {
      return {
        importResult: {
          canceled: false,
          error: {
            code: "IMPORT_IN_PROGRESS",
            severity: "warning",
            title: "已有操作正在进行",
            description: "请等待当前导入或原生转译完成后重试。",
          },
        },
      };
    }

    this.operationInProgress = true;
    try {
      const importResult = await this.importResolvedPath(inputPath, false, true);
      if (!importResult.app) return { importResult };

      // The operation gate remains held, so a same-source re-import cannot
      // replace this exact record or discard its managed archive directory.
      const record = this.apps.find((item) => item.id === importResult.app!.id);
      if (!record) {
        const runResult = this.nativeBlockedResult(
          importResult.app.id,
          randomUUID(),
          "APP_RECORD_NOT_FOUND",
          "刚导入的应用记录无法定位；没有执行其他记录。",
        );
        this.addEvent("error", "无法开始 Windows 兼容引擎", `${runResult.code}: ${runResult.message}`);
        await this.persist().catch(() => undefined);
        return {
          importResult,
          runResult,
        };
      }
      return {
        importResult,
        runResult: await this.runNativeRecord(record, randomUUID()),
      };
    } finally {
      this.operationInProgress = false;
    }
  }

  public async removeApp(appId: string): Promise<DesktopSnapshot> {
    const record = this.apps.find((item) => item.id === appId);
    if (!record) return this.snapshot();
    const previousApps = this.apps;
    const previousEvents = [...this.events];
    this.apps = this.apps.filter((item) => item.id !== appId);
    this.addEvent("info", "应用记录已移除", `${record.displayName} 的来源文件未被删除。`);
    try {
      await this.persist();
    } catch (error) {
      this.apps = previousApps;
      this.events = previousEvents;
      throw error;
    }
    return this.snapshot();
  }

  public async prepareDarlingInstall(): Promise<DarlingInstallPlan> {
    return await this.darlingInstaller.preflight();
  }

  public async installDarling(acceptedRisk: boolean): Promise<DarlingInstallResult> {
    const result = await this.darlingInstaller.install(acceptedRisk);
    if (result.completed) {
      await this.probeRuntime(false);
      this.addEvent("success", "Darling 实验后端已安装", result.message);
    } else if (result.canceled) {
      this.addEvent("info", "Darling 安装已停止", result.message);
    } else {
      this.addEvent("error", "Darling 安装未完成", result.message);
    }
    await this.persist().catch(() => undefined);
    return result;
  }

  public cancelDarlingInstall(jobId: string): boolean {
    return this.darlingInstaller.cancel(jobId);
  }

  public isDarlingInstallRunning(): boolean {
    return this.darlingInstaller.isRunning();
  }

  public async probeRuntime(persistEvent = true): Promise<RuntimeSnapshot> {
    const sevenZip = await this.probeSevenZip();
    const { wsl, darling } = await this.probeWslAndDarling();
    this.runtime = {
      nativeTranslator: {
        available: NATIVE_RUNTIME_PROBE.available,
        label: NATIVE_RUNTIME_PROBE.name,
        detail: NATIVE_RUNTIME_PROBE.detail,
        version: NATIVE_RUNTIME_PROBE.version,
      },
      sevenZip,
      wsl,
      darling,
      selectedBackend: NATIVE_RUNTIME_PROBE.available
        ? "native-windows"
        : darling.available
          ? "darling-wsl"
          : "diagnostic",
      probedAt: new Date().toISOString(),
    };
    if (persistEvent) {
      const nativeAvailable = this.runtime.nativeTranslator.available;
      this.addEvent(
        nativeAvailable || darling.available ? "success" : "info",
        "运行能力已探测",
        nativeAvailable
          ? `MVM-CPU/2 Windows 兼容引擎已就绪，无需 WSL；Darling ${darling.available ? "已发现，可作为可选回退" : "未发现，不影响原生路径"}。`
          : darling.available
            ? "MVM 兼容引擎不可用；Darling 命令已发现，可作为实验回退。"
            : "当前没有可用运行后端。",
      );
      await this.persist().catch(() => undefined);
    }
    return this.runtime;
  }

  private async probeSevenZip(): Promise<ToolProbe> {
    try {
      const tool = await this.sevenZipTool();
      return {
        available: true,
        label: "7-Zip",
        detail: `${tool.formats.length} 种格式能力，包含 DMG/HFS/APFS/XAR/CPIO`,
        version: tool.version,
      };
    } catch {
      this.sevenZip = undefined;
      return { available: false, label: "7-Zip", detail: "未找到支持全部目标格式的完整构建" };
    }
  }

  private async probeWslAndDarling(): Promise<{ readonly wsl: ToolProbe; readonly darling: ToolProbe }> {
    const wslPath = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "wsl.exe");
    try {
      const wslStats = await stat(wslPath);
      if (!wslStats.isFile()) throw new Error("wsl.exe is not a file");
      const distributions = await runProcess(wslPath, ["--list", "--verbose"], {
        cwd: this.userDataPath,
        timeoutMs: 10_000,
        maxStdoutBytes: 1024 * 1024,
      });
      const names = parseWsl2Distributions(decodeWindowsOutput(distributions.stdout));
      if (distributions.exitCode !== 0 || names.length === 0) {
        this.darlingDistribution = undefined;
        return {
          wsl: { available: false, label: "WSL 2", detail: "没有已确认 VERSION=2 的 Linux 发行版" },
          darling: { available: false, label: "Darling", detail: "需要 WSL 2 Linux 发行版" },
        };
      }
      const managedDistributionAvailable = names.some((name) => name.toLowerCase() === DARLING_DISTRIBUTION.toLowerCase())
        && await this.darlingInstaller.isManagedDistributionUsable();
      const distribution = managedDistributionAvailable
        ? DARLING_DISTRIBUTION
        : names.find((name) => name.toLowerCase().includes("ubuntu")) ?? names[0]!;
      const managedArgs = distribution === DARLING_DISTRIBUTION ? ["--user", "mvm"] : [];
      const discoveryScript = distribution === DARLING_DISTRIBUTION
        ? `export DPREFIX=${DARLING_PREFIX}; command -v darling >/dev/null 2>&1 || exit 3; darling --version 2>&1 | head -n 1`
        : "command -v darling >/dev/null 2>&1 || exit 3; darling --version 2>&1 | head -n 1";
      const darlingResult = await runProcess(
        wslPath,
        [
          "--distribution",
          distribution,
          ...managedArgs,
          "--exec",
          "sh",
          "-c",
          discoveryScript,
        ],
        { cwd: this.userDataPath, timeoutMs: 15_000, maxStdoutBytes: 1024 * 1024 },
      );
      const darlingOutput = decodeWindowsOutput(Buffer.concat([darlingResult.stdout, darlingResult.stderr]));
      const darlingLines = darlingOutput.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
      const darlingAvailable = darlingResult.exitCode === 0 && darlingLines.length > 0;
      this.darlingDistribution = darlingAvailable ? distribution : undefined;
      return {
        wsl: { available: true, label: "WSL 2", detail: distribution === DARLING_DISTRIBUTION ? `${distribution} · VERSION 2 · MVM 专用` : `${distribution} · VERSION 2` },
        darling: darlingAvailable
          ? { available: true, label: "Darling", detail: "命令已发现；启动时验证用户态", ...(darlingLines[0] ? { version: darlingLines[0] } : {}) }
          : { available: false, label: "Darling", detail: darlingResult.exitCode === 3 ? `${distribution} 中未安装 Darling` : "Darling 版本探测失败" },
      };
    } catch {
      this.darlingDistribution = undefined;
      return {
        wsl: { available: false, label: "WSL 2", detail: "未找到可用 WSL 2 环境" },
        darling: { available: false, label: "Darling", detail: "未连接实验后端" },
      };
    }
  }

  public async launch(appId: string): Promise<LaunchResult> {
    const record = this.apps.find((item) => item.id === appId);
    if (!record) return { started: false, message: "应用记录不存在。" };
    const decorated = this.decorate(record);
    if (decorated.launchability !== "candidate") {
      return { started: false, message: "当前证据不足，MVM 没有发送启动命令。" };
    }

    const wslPath = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "wsl.exe");
    const distribution = this.darlingDistribution;
    if (!distribution) return { started: false, message: "尚未发现可用的 Darling 命令，请先探测运行能力。" };
    try {
      const managedArgs = distribution === DARLING_DISTRIBUTION ? ["--user", "mvm"] : [];
      const healthScript = distribution === DARLING_DISTRIBUTION
        ? `export DPREFIX=${DARLING_PREFIX}; darling shell uname -s 2>/dev/null`
        : "darling shell uname -s 2>/dev/null";
      const health = await runProcess(
        wslPath,
        ["--distribution", distribution, ...managedArgs, "--exec", "sh", "-c", healthScript],
        { cwd: this.userDataPath, timeoutMs: 30_000, maxStdoutBytes: 1024 * 1024 },
      );
      if (health.exitCode !== 0 || decodeWindowsOutput(health.stdout).split(/\r?\n/u).at(-1)?.trim() !== "Darwin") {
        this.addEvent("error", "Darling 健康检查失败", "未得到 Darwin 用户态响应，应用未执行。", record.id);
        await this.persist().catch(() => undefined);
        return { started: false, message: "Darling 用户态健康检查未通过，未执行应用。" };
      }
      try {
        if (!record.sourceSha256) throw new Error("记录缺少完整来源指纹");
        const manifestBefore = await bundleManifestHash(record.bundlePath);
        if (manifestBefore !== record.sourceSha256) {
          this.addEvent("error", "启动已阻断", "应用内容在导入后发生变化；请重新导入并检查报告。", record.id);
          await this.persist().catch(() => undefined);
          return { started: false, message: "应用内容已变化，MVM 拒绝启动未分析的版本。请重新导入。" };
        }
        const freshAnalysis = await this.analyzer.analyze(record.bundlePath);
        const manifestAfter = await bundleManifestHash(record.bundlePath);
        if (manifestAfter !== record.sourceSha256 || manifestAfter !== manifestBefore) {
          this.addEvent("error", "启动已阻断", "应用在启动前复核期间发生变化。", record.id);
          await this.persist().catch(() => undefined);
          return { started: false, message: "应用在复核期间发生变化，未发送启动命令。" };
        }
        const freshHasBlocker = freshAnalysis.findings.some((finding) => finding.severity === "blocker");
        const freshHasX64 = freshAnalysis.mainExecutable.slices.some((slice) => slice.architecture === "x86_64");
        if (freshHasBlocker || !freshHasX64) {
          this.addEvent("error", "启动资格已变化", "最新静态分析不再满足 Darling 候选条件。", record.id);
          await this.persist().catch(() => undefined);
          return { started: false, message: "最新静态分析不再满足启动条件，请重新导入查看报告。" };
        }
      } catch (error) {
        this.addEvent("error", "启动前复核失败", error instanceof Error ? error.message : "未知复核错误", record.id);
        await this.persist().catch(() => undefined);
        return { started: false, message: "启动前完整性复核未通过，未发送启动命令。" };
      }
      const child = spawn(
        wslPath,
        [
          "--distribution",
          distribution,
          ...managedArgs,
          "--exec",
          "sh",
          "-c",
          distribution === DARLING_DISTRIBUTION
            ? `export DPREFIX=${DARLING_PREFIX}; bundle=$(wslpath -a -- \"$1\") && exec darling shell open \"$bundle\"`
            : "bundle=$(wslpath -a -- \"$1\") && exec darling shell open \"$bundle\"",
          "mvm-launch",
          record.bundlePath,
        ],
        { detached: true, windowsHide: true, shell: false, stdio: "ignore" },
      );
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => reject(error);
        child.once("error", onError);
        child.once("spawn", () => {
          child.removeListener("error", onError);
          resolve();
        });
      });
      child.on("error", (error) => {
        this.addEvent("error", "Darling 进程异常", error.message, record.id);
        void this.persist().catch(() => undefined);
      });
      child.once("exit", (code) => {
        if (code !== null && code !== 0) {
          this.addEvent("error", "Darling 返回错误", `实验后端退出码：${code}`, record.id);
          void this.persist().catch(() => undefined);
        }
      });
      child.unref();
      this.addEvent("info", "已交给 Darling", "启动命令已发送；结果仍需从运行日志验证。", record.id);
      void this.persist().catch(() => undefined);
      return { started: true, message: "已把应用交给 Darling/WSL；这不是启动成功证明，请观察应用窗口与事件日志。" };
    } catch (error) {
      this.addEvent("error", "启动命令发送失败", error instanceof Error ? error.message : "未知错误", record.id);
      await this.persist().catch(() => undefined);
      return { started: false, message: "未能把应用交给实验后端。" };
    }
  }

  public getRecord(appId: string): MvmAppRecord | undefined {
    const record = this.apps.find((item) => item.id === appId);
    return record ? this.decorate(record) : undefined;
  }

  public sourcePath(appId: string): string | undefined {
    return this.apps.find((item) => item.id === appId)?.sourcePath;
  }

  public reportJson(appId: string): string | undefined {
    const record = this.getRecord(appId);
    if (!record) return undefined;
    return `${JSON.stringify({ schema: "io.mvm.report.v1", generatedAt: new Date().toISOString(), app: record, runtime: this.runtime }, null, 2)}\n`;
  }

  public eventsJson(): string {
    return `${JSON.stringify({ schema: "io.mvm.events.v1", generatedAt: new Date().toISOString(), events: this.events }, null, 2)}\n`;
  }

  public suggestedReportName(appId: string): string {
    const record = this.apps.find((item) => item.id === appId);
    return `${safeFileStem(record?.displayName ?? "MVM")}-compatibility-report.json`;
  }
}
