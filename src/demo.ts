import type { DesktopSnapshot, MvmAppRecord, RuntimeSnapshot } from "./mvm-api";

export const EMPTY_RUNTIME: RuntimeSnapshot = {
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
  selectedBackend: "diagnostic",
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
      code: "RUNTIME_BACKEND_UNAVAILABLE",
      severity: "blocker",
      title: "需要运行后端",
      description: "结构样本可以完成分析，但当前没有可执行 macOS 用户态的后端。",
      action: "连接 Darling/WSL 实验后端后重新探测。",
    },
    {
      code: "SOURCE_FIXTURE",
      severity: "info",
      title: "这是结构样本",
      description: "该记录由 MVM 本地生成，只用于验证解析流程，不是可运行的商业应用。",
    },
  ],
  phase: "ready-with-warnings",
  launchability: "no-backend",
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
            level: "warning",
            title: "未找到运行后端",
            detail: "分析完成，启动保持禁用。",
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
