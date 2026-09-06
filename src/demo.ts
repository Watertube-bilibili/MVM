import type { DesktopSnapshot, MvmAppRecord, RuntimeSnapshot } from "./mvm-api";

export const EMPTY_RUNTIME: RuntimeSnapshot = {
  nativeTranslator: {
    available: true,
    label: "MVM Compatibility Engine",
    detail: "Windows 进程内的 x86_64 → MVM-CPU/2 微转译实验核心",
    version: "MVM-CPU/2",
  },
  sevenZip: {
    available: false,
    label: "7-Zip",
    detail: "尚未探测",
  },
  wsl: {
    available: false,
    label: "WSL 2",
    detail: "尚未探测",
  },
  darling: {
    available: false,
    label: "Darling",
    detail: "未连接实验后端",
  },
  selectedBackend: "native-windows",
  probedAt: new Date(0).toISOString(),
};

export const STRUCTURE_FIXTURE: MvmAppRecord = {
  id: "fixture-mvm-probe",
  displayName: "MVM Probe",
  fileName: "MVM Probe.app",
  sourcePath: "MVM://fixtures/MVM Probe.app",
  sourceKind: "fixture",
  importedAt: new Date().toISOString(),
  isFixture: true,
  bundleIdentifier: "io.mvm.fixture.probe",
  version: "1.0",
  executableName: "MVMProbe",
  minimumSystemVersion: "13.0",
  architectures: [
    {
      name: "x86_64",
      minimumOs: "13.0",
      sdk: "15.0",
      fileType: "execute",
      encrypted: false,
      dylibs: [
        "/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit",
        "/System/Library/Frameworks/Foundation.framework/Versions/C/Foundation",
      ],
      rpaths: ["@executable_path/../Frameworks"],
      hasCodeSignature: false,
    },
    {
      name: "arm64",
      minimumOs: "13.0",
      sdk: "15.0",
      fileType: "execute",
      encrypted: false,
      dylibs: [
        "/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit",
        "/System/Library/Frameworks/Foundation.framework/Versions/C/Foundation",
      ],
      rpaths: ["@executable_path/../Frameworks"],
      hasCodeSignature: false,
    },
  ],
  frameworks: ["AppKit", "Foundation"],
  findings: [
    {
      code: "SOURCE_FIXTURE",
      severity: "info",
      title: "这是可执行微转译样本",
      description: "该记录由 MVM 本地生成；x86_64 的 LC_MAIN 会在 Windows 兼容引擎器中完成并返回 42。它不是第三方商业应用。",
    },
  ],
  phase: "ready",
  launchability: "candidate",
  sourceSha256: "fixture:deterministic-macho-universal2",
};

export function createDemoSnapshot(includeFixture: boolean): DesktopSnapshot {
  return {
    apps: includeFixture ? [STRUCTURE_FIXTURE] : [],
    runtime: EMPTY_RUNTIME,
    events: includeFixture
      ? [
          {
            id: "fixture-event-3",
            at: new Date().toISOString(),
            level: "success",
            title: "Windows 兼容引擎可用",
            detail: "MVM-CPU/2 可执行内置 LC_MAIN 样本并返回 42；无需 WSL。",
            appId: STRUCTURE_FIXTURE.id,
          },
          {
            id: "fixture-event-2",
            at: new Date(Date.now() - 800).toISOString(),
            level: "success",
            title: "Mach-O 分析完成",
            detail: "识别到 x86_64 与 arm64 两个 slice。",
            appId: STRUCTURE_FIXTURE.id,
          },
          {
            id: "fixture-event-1",
            at: new Date(Date.now() - 1_600).toISOString(),
            level: "info",
            title: "结构样本已生成",
            detail: "未读取任何第三方应用内容。",
            appId: STRUCTURE_FIXTURE.id,
          },
        ]
      : [],
  };
}
