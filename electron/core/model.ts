export type ImportStage =
  | "acquiring"
  | "probing"
  | "indexing"
  | "materializing"
  | "discovering"
  | "analyzing"
  | "committing";

export type FindingSeverity = "info" | "warning" | "blocker";

export interface AnalysisFinding {
  readonly code: string;
  readonly severity: FindingSeverity;
  readonly message: string;
  readonly evidence?: Readonly<Record<string, unknown>>;
}

export type DetectedFormat =
  | "unknown"
  | "app-bundle"
  | "dmg"
  | "apfs"
  | "hfs"
  | "hfsplus"
  | "hfsx"
  | "xar"
  | "cpio"
  | "pbzx"
  | "plist-binary"
  | "plist-xml"
  | "plist-openstep"
  | "macho-thin"
  | "macho-fat"
  | "gzip"
  | "bzip2"
  | "xz"
  | "zstd"
  | "zip";

export interface MagicSignal {
  readonly format: DetectedFormat;
  readonly offset: number;
  readonly detail?: string;
}

export interface MagicProbeResult {
  readonly primary: DetectedFormat;
  readonly signals: readonly MagicSignal[];
}

export type MachEndianness = "little" | "big";
export type MachBitness = 32 | 64;
export type MachArchitecture =
  | "x86_64"
  | "arm64"
  | "arm64e"
  | "unknown";

export type MachFileTypeName =
  | "object"
  | "execute"
  | "fvmlib"
  | "core"
  | "preload"
  | "dylib"
  | "dylinker"
  | "bundle"
  | "dylib-stub"
  | "dsym"
  | "kext-bundle"
  | "fileset"
  | "unknown";

export type MachDylibKind = "load" | "weak" | "reexport" | "upward";

export interface MachDylibReference {
  readonly kind: MachDylibKind;
  readonly path: string;
  readonly timestamp: number;
  readonly currentVersion: string;
  readonly compatibilityVersion: string;
}

export interface MachBuildVersion {
  readonly platform: number;
  readonly platformName: string;
  readonly minimumOs: string;
  readonly sdk: string;
  readonly toolCount: number;
}

export interface MachMinimumVersion {
  readonly command: string;
  readonly version: string;
  readonly sdk: string;
}

export interface MachCodeSignatureInfo {
  readonly dataOffset: number;
  readonly dataSize: number;
}

export interface MachEncryptionInfo {
  readonly command: "LC_ENCRYPTION_INFO" | "LC_ENCRYPTION_INFO_64";
  readonly cryptOffset: number;
  readonly cryptSize: number;
  readonly cryptId: number;
  readonly encrypted: boolean;
}

export interface MachOSliceAnalysis {
  readonly offset: number;
  readonly size: number;
  readonly bitness: MachBitness;
  readonly endianness: MachEndianness;
  readonly cpuType: number;
  readonly cpuSubtype: number;
  readonly architecture: MachArchitecture;
  readonly fileType: number;
  readonly fileTypeName: MachFileTypeName;
  readonly commandCount: number;
  readonly commandBytes: number;
  readonly flags: number;
  readonly buildVersions: readonly MachBuildVersion[];
  readonly minimumVersions: readonly MachMinimumVersion[];
  readonly dylibs: readonly MachDylibReference[];
  readonly rpaths: readonly string[];
  readonly codeSignatures: readonly MachCodeSignatureInfo[];
  readonly encryption: readonly MachEncryptionInfo[];
}

export interface MachOAnalysis {
  readonly kind: "thin" | "fat";
  readonly slices: readonly MachOSliceAnalysis[];
}

export interface AppBundleMetadata {
  readonly bundleIdentifier?: string;
  readonly bundleName?: string;
  readonly displayName?: string;
  readonly executable: string;
  readonly packageType?: string;
  readonly version?: string;
  readonly shortVersion?: string;
  readonly iconFile?: string;
  readonly minimumSystemVersion?: string;
  readonly architecturePriority: readonly string[];
  readonly uiElement?: boolean;
  readonly backgroundOnly?: boolean;
  readonly platformName?: string;
  readonly sdkName?: string;
}

export interface DirectAppAnalysis {
  readonly sourcePath: string;
  readonly realPath: string;
  readonly infoPlistPath: string;
  readonly executablePath: string;
  readonly metadata: AppBundleMetadata;
  readonly mainExecutable: MachOAnalysis;
  readonly launchability: "not-tested";
  readonly findings: readonly AnalysisFinding[];
}

export type ArchiveEntryKind =
  | "file"
  | "directory"
  | "symlink"
  | "hardlink"
  | "unknown";

export interface ArchiveEntryDescriptor {
  readonly rawPath: string;
  readonly toolReportedPath?: string;
  readonly normalizedPath: string;
  readonly kind: ArchiveEntryKind;
  readonly size: number;
  readonly packedSize?: number;
  readonly linkTarget?: string;
  readonly encrypted: boolean;
}

export interface ArchivePreflightSummary {
  readonly entryCount: number;
  readonly totalUnpackedBytes: number;
  readonly totalPackedBytes: number;
  readonly entries: readonly ArchiveEntryDescriptor[];
}
