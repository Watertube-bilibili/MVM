export type FindingSeverity = "info" | "warning" | "blocker";
export type Launchability = "not-tested" | "no-backend" | "candidate" | "blocked";
export type ImportPhase =
  | "queued"
  | "acquiring"
  | "probing"
  | "indexing"
  | "materializing"
  | "discovering"
  | "analyzing"
  | "committing"
  | "ready"
  | "ready-with-warnings"
  | "unsupported"
  | "failed";

export interface ArchitectureSlice {
  readonly name: "x86_64" | "arm64" | "arm64e" | "unknown";
  readonly minimumOs?: string;
  readonly sdk?: string;
  readonly fileType: string;
  readonly encrypted: boolean;
  readonly dylibs: readonly string[];
  readonly rpaths: readonly string[];
  readonly hasCodeSignature: boolean;
}

export interface AppFinding {
  readonly code: string;
  readonly severity: FindingSeverity;
  readonly title: string;
  readonly description: string;
  readonly action?: string;
  readonly evidence?: Readonly<Record<string, unknown>>;
}

export interface MvmAppRecord {
  readonly id: string;
  readonly displayName: string;
  readonly fileName: string;
  readonly sourcePath: string;
  readonly sourceKind: "app" | "dmg" | "pkg" | "zip" | "fixture";
  readonly importedAt: string;
  readonly isFixture: boolean;
  readonly bundleIdentifier?: string;
  readonly version?: string;
  readonly executableName?: string;
  readonly minimumSystemVersion?: string;
  readonly architectures: readonly ArchitectureSlice[];
  readonly frameworks: readonly string[];
  readonly findings: readonly AppFinding[];
  readonly phase: ImportPhase;
  readonly launchability: Launchability;
  readonly sourceSha256?: string;
}

export interface ToolProbe {
  readonly available: boolean;
  readonly label: string;
  readonly detail: string;
  readonly version?: string;
}

export interface RuntimeSnapshot {
  readonly nativeTranslator: ToolProbe;
  readonly sevenZip: ToolProbe;
  readonly wsl: ToolProbe;
  readonly darling: ToolProbe;
  readonly selectedBackend: "native-windows" | "diagnostic" | "darling-wsl";
  readonly probedAt: string;
}

export interface MvmEvent {
  readonly id: string;
  readonly at: string;
  readonly level: "info" | "warning" | "error" | "success";
  readonly title: string;
  readonly detail: string;
  readonly appId?: string;
}

export interface DesktopSnapshot {
  readonly apps: readonly MvmAppRecord[];
  readonly runtime: RuntimeSnapshot;
  readonly events: readonly MvmEvent[];
}

export interface ImportProgress {
  readonly jobId: string;
  readonly phase: ImportPhase;
  readonly progress: number;
  readonly label: string;
  readonly appId?: string;
}

export interface ImportResult {
  readonly canceled: boolean;
  readonly app?: MvmAppRecord;
  readonly error?: AppFinding;
}

export interface LaunchResult {
  readonly started: boolean;
  readonly message: string;
}

export type NativeRuntimeCode =
  | "OK"
  | "INPUT_INVALID"
  | "FILE_IO_ERROR"
  | "FILE_TOO_LARGE"
  | "MACHO_UNSUPPORTED"
  | "ARCHITECTURE_UNSUPPORTED"
  | "MACHO_MALFORMED"
  | "ENTRYPOINT_INVALID"
  | "UNSUPPORTED_OPCODE"
  | "FORBIDDEN_INSTRUCTION"
  | "TRANSLATION_LIMIT"
  | "INSTRUCTION_BUDGET_EXCEEDED"
  | "STACK_BOUNDS"
  | "UNBALANCED_STACK"
  | "ADDRESS_BOUNDS"
  | "PROGRAM_DID_NOT_RETURN"
  | "FILE_BRIDGE_REJECTED"
  | "APP_RECORD_NOT_FOUND"
  | "NATIVE_RUN_BUSY"
  | "NATIVE_RUNTIME_ERROR";

export interface NativeFileMount {
  readonly kind: "windows-directory";
  readonly guestRoot: "/mvm/shared";
  readonly hostRoot: string;
  readonly readOnly: true;
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
}

interface NativeAppRunBase {
  readonly engine?: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly dialogsShown?: number;
  readonly hostCalls?: readonly string[];
  readonly runId: string;
  readonly appId: string;
  readonly backend: "native-windows-ir";
  readonly code: NativeRuntimeCode;
  readonly message: string;
  readonly durationMs: number;
  readonly selectedSliceOffset?: number;
  readonly selectedSliceSize?: number;
  readonly entryOffset?: number;
  readonly entryFileOffset?: number;
  readonly translatedInstructionCount: number;
  readonly executedInstructionCount: number;
  readonly mount?: NativeFileMount;
}

export type NativeAppRunResult =
  | (NativeAppRunBase & {
      readonly status: "completed";
      readonly code: "OK";
      readonly returnValue: string;
      readonly exitCode: number;
    })
  | (NativeAppRunBase & {
      readonly status: "unsupported" | "blocked";
      readonly code: Exclude<NativeRuntimeCode, "OK">;
      readonly returnValue?: never;
      readonly exitCode?: never;
    });

export interface ImportAndRunNativeResult {
  readonly importResult: ImportResult;
  readonly runResult?: NativeAppRunResult;
}

export type DarlingInstallPhase =
  | "idle"
  | "preflight"
  | "creating-distro"
  | "downloading"
  | "verifying"
  | "extracting"
  | "installing-packages"
  | "configuring-user"
  | "smoke-testing"
  | "ready"
  | "ready-cli-only"
  | "canceling"
  | "canceled"
  | "failed";

export interface DarlingInstallPlan {
  readonly canInstall: boolean;
  readonly distributionName: "MVM-Darling";
  readonly releaseTag: string;
  readonly packageVersion: string;
  readonly assetUrl: string;
  readonly assetBytes: number;
  readonly assetSha256: string;
  readonly requiresAdmin: boolean;
  readonly requiresReboot: boolean;
  readonly steps: readonly string[];
  readonly warnings: readonly string[];
  readonly blockers: readonly string[];
}

export interface DarlingInstallProgress {
  readonly jobId: string;
  readonly phase: DarlingInstallPhase;
  readonly progress: number;
  readonly label: string;
  readonly detail?: string;
  readonly logLine?: string;
  readonly downloadedBytes?: number;
  readonly totalBytes?: number;
  readonly canCancel: boolean;
}

export interface DarlingInstallResult {
  readonly completed: boolean;
  readonly canceled: boolean;
  readonly message: string;
}

export interface QemuState { phase: 'offline'|'preparing'|'booting'|'ready'|'error'; message: string; running: boolean }
export interface QemuRunResult { status: 'submitted'|'blocked'; message: string }

export interface MvmDesktopApi {
  qemuStatus(): Promise<QemuState>;
  prepareQemu(): Promise<QemuState>;
  stopQemu(): Promise<QemuState>;
  runQemu(appId: string): Promise<QemuRunResult>;
  downloadQemu(): Promise<void>;
  getSnapshot(): Promise<DesktopSnapshot>;
  chooseInput(kind: "package" | "app-folder"): Promise<string | null>;
  pathForFile(file: File): string;
  importPath(path: string): Promise<ImportResult>;
  createFixture(): Promise<ImportResult>;
  removeApp(appId: string): Promise<DesktopSnapshot>;
  probeRuntime(): Promise<RuntimeSnapshot>;
  prepareDarlingInstall(): Promise<DarlingInstallPlan>;
  installDarling(options: { readonly acceptedRisk: true }): Promise<DarlingInstallResult>;
  cancelDarlingInstall(jobId: string): Promise<boolean>;
  runNative(appId: string): Promise<NativeAppRunResult>;
  importAndRunNative(path: string): Promise<ImportAndRunNativeResult>;
  launch(appId: string): Promise<LaunchResult>;
  exportReport(appId: string): Promise<boolean>;
  exportEvents(): Promise<boolean>;
  revealSource(appId: string): Promise<boolean>;
  onImportProgress(listener: (progress: ImportProgress) => void): () => void;
  onDarlingInstallProgress(listener: (progress: DarlingInstallProgress) => void): () => void;
}

export function formatArchitectureLabel(app: MvmAppRecord): string {
  const names = [...new Set(app.architectures.map((slice) => slice.name))];
  if (names.includes("x86_64") && names.some((name) => name === "arm64" || name === "arm64e")) {
    return "Universal 2";
  }
  return names.length > 0 ? names.join(" + ") : "未识别";
}

export function getDesktopApi(): MvmDesktopApi | null {
  return window.mvmDesktop ?? null;
}
