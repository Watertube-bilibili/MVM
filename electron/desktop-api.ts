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
  readonly sevenZip: ToolProbe;
  readonly wsl: ToolProbe;
  readonly darling: ToolProbe;
  readonly selectedBackend: "diagnostic" | "darling-wsl";
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

export interface MvmDesktopApi {
  getSnapshot(): Promise<DesktopSnapshot>;
  chooseInput(kind: "package" | "app-folder"): Promise<string | null>;
  pathForFile(file: File): string;
  importPath(path: string): Promise<ImportResult>;
  createFixture(): Promise<ImportResult>;
  removeApp(appId: string): Promise<DesktopSnapshot>;
  probeRuntime(): Promise<RuntimeSnapshot>;
  launch(appId: string): Promise<LaunchResult>;
  exportReport(appId: string): Promise<boolean>;
  exportEvents(): Promise<boolean>;
  revealSource(appId: string): Promise<boolean>;
  onImportProgress(listener: (progress: ImportProgress) => void): () => void;
}

export const IPC = Object.freeze({
  getSnapshot: "mvm:get-snapshot",
  chooseInput: "mvm:choose-input",
  importPath: "mvm:import-path",
  createFixture: "mvm:create-fixture",
  removeApp: "mvm:remove-app",
  probeRuntime: "mvm:probe-runtime",
  launch: "mvm:launch",
  exportReport: "mvm:export-report",
  exportEvents: "mvm:export-events",
  revealSource: "mvm:reveal-source",
  importProgress: "mvm:import-progress",
});
