import path from "node:path";
import { lstat, open, opendir, realpath, stat } from "node:fs/promises";

import { CoreAnalysisError, CoreErrorCode, coreError } from "./errors.js";
import { parseMachO, DEFAULT_MACHO_LIMITS, type MachOParserLimits } from "./macho.js";
import type {
  AnalysisFinding,
  AppBundleMetadata,
  DirectAppAnalysis,
  MachOAnalysis,
} from "./model.js";
import {
  isPlistDictionary,
  PlistV5Adapter,
  type InfoPlistAdapter,
  type PlistDictionary,
  type PlistValue,
} from "./plist.js";
import { isPathInside } from "./safe-path.js";

export interface DirectAppAnalyzerOptions {
  readonly plistAdapter?: InfoPlistAdapter;
  readonly machoLimits?: MachOParserLimits;
  readonly maxInfoPlistBytes?: number;
  readonly requireAppExtension?: boolean;
}

interface ContainedFile {
  readonly visiblePath: string;
  readonly realPath: string;
}

const MAX_DIRECT_DIRECTORY_ENTRIES = 100_000;

function errnoCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

async function exactChild(parentPath: string, expectedName: string): Promise<string | undefined> {
  const directory = await opendir(parentPath);
  let entryCount = 0;
  try {
    while (true) {
      const entry = await directory.read();
      if (entry === null) {
        return undefined;
      }
      entryCount += 1;
      if (entryCount > MAX_DIRECT_DIRECTORY_ENTRIES) {
        throw coreError(
          CoreErrorCode.LimitEntryCount,
          "discovering",
          "App bundle directory contains too many entries to inspect safely.",
          { parentPath, maxEntries: MAX_DIRECT_DIRECTORY_ENTRIES },
        );
      }
      if (entry.name === expectedName) {
        return path.join(parentPath, expectedName);
      }
    }
  } finally {
    await directory.close();
  }
}

async function requireExactDirectory(parentPath: string, name: string): Promise<string> {
  const candidate = await exactChild(parentPath, name);
  if (candidate === undefined) {
    throw coreError(CoreErrorCode.AppLayoutInvalid, "discovering", `App bundle is missing ${name}.`, {
      parentPath,
      expectedName: name,
    });
  }
  const candidateStats = await lstat(candidate);
  if (!candidateStats.isDirectory()) {
    throw coreError(CoreErrorCode.AppLayoutInvalid, "discovering", `${name} is not a directory.`, {
      path: candidate,
    });
  }
  return candidate;
}

async function requireContainedFile(
  bundleRealPath: string,
  visiblePath: string,
  missingCode: typeof CoreErrorCode.PlistMissing | typeof CoreErrorCode.ExecutableMissing,
  label: string,
): Promise<ContainedFile> {
  let visibleStats;
  try {
    visibleStats = await lstat(visiblePath);
  } catch (error) {
    throw new CoreAnalysisError({
      code: missingCode,
      stage: "discovering",
      message: `${label} was not found.`,
      cause: error,
      details: { path: visiblePath },
    });
  }
  if (!visibleStats.isFile()) {
    throw coreError(missingCode, "discovering", `${label} must not be a link or special file.`, {
      path: visiblePath,
    });
  }

  let resolved: string;
  try {
    resolved = await realpath(visiblePath);
  } catch (error) {
    throw new CoreAnalysisError({
      code: missingCode,
      stage: "discovering",
      message: `${label} was not found.`,
      cause: error,
      details: {
        path: visiblePath,
        cause: error instanceof Error ? error.message : String(error),
      },
    });
  }

  if (!isPathInside(bundleRealPath, resolved)) {
    throw coreError(CoreErrorCode.UnsafeLink, "discovering", `${label} resolves outside the app bundle.`, {
      visiblePath,
      resolvedPath: resolved,
      bundleRealPath,
    });
  }

  const resolvedStats = await stat(resolved);
  if (!resolvedStats.isFile()) {
    throw coreError(missingCode, "discovering", `${label} is not a regular file.`, {
      path: visiblePath,
      resolvedPath: resolved,
    });
  }

  return { visiblePath, realPath: resolved };
}

async function readBoundedStableFile(
  file: ContainedFile,
  maximumBytes: number,
  label: string,
): Promise<Uint8Array> {
  const handle = await open(file.realPath, "r");
  try {
    const before = await handle.stat();
    if (before.size > maximumBytes) {
      throw coreError(CoreErrorCode.LimitFileBytes, "analyzing", `${label} exceeds its byte limit.`, {
        path: file.visiblePath,
        fileBytes: before.size,
        maximumBytes,
      });
    }
    // Allocate only the already-bounded initial size. FileHandle.readFile()
    // would keep allocating if a hostile input were appended concurrently.
    const bytes = Buffer.alloc(before.size);
    let bytesRead = 0;
    while (bytesRead < bytes.byteLength) {
      const readResult = await handle.read(
        bytes,
        bytesRead,
        bytes.byteLength - bytesRead,
        bytesRead,
      );
      if (readResult.bytesRead === 0) {
        break;
      }
      bytesRead += readResult.bytesRead;
    }
    const after = await handle.stat();
    if (
      bytesRead !== before.size ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    ) {
      throw coreError(
        CoreErrorCode.InputChanged,
        "analyzing",
        `${label} changed while it was being analyzed.`,
        { path: file.visiblePath },
      );
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function optionalString(dictionary: PlistDictionary, key: string): string | undefined {
  const value = dictionary[key];
  return typeof value === "string" ? value : undefined;
}

function optionalBoolean(dictionary: PlistDictionary, key: string): boolean | undefined {
  const value = dictionary[key];
  return typeof value === "boolean" ? value : undefined;
}

function stringArray(dictionary: PlistDictionary, key: string): readonly string[] {
  const value = dictionary[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item: PlistValue): item is string => typeof item === "string");
}

function executableName(dictionary: PlistDictionary): string {
  const value = optionalString(dictionary, "CFBundleExecutable");
  if (
    value === undefined ||
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.includes(":") ||
    Buffer.byteLength(value, "utf8") > 255
  ) {
    throw coreError(
      CoreErrorCode.AppLayoutInvalid,
      "discovering",
      "CFBundleExecutable must be a safe, non-empty file name.",
      { value: value ?? null },
    );
  }
  return value;
}

function metadataFromPlist(dictionary: PlistDictionary): AppBundleMetadata {
  const executable = executableName(dictionary);
  const optional = {
    bundleIdentifier: optionalString(dictionary, "CFBundleIdentifier"),
    bundleName: optionalString(dictionary, "CFBundleName"),
    displayName: optionalString(dictionary, "CFBundleDisplayName"),
    packageType: optionalString(dictionary, "CFBundlePackageType"),
    version: optionalString(dictionary, "CFBundleVersion"),
    shortVersion: optionalString(dictionary, "CFBundleShortVersionString"),
    iconFile: optionalString(dictionary, "CFBundleIconFile"),
    minimumSystemVersion: optionalString(dictionary, "LSMinimumSystemVersion"),
    uiElement: optionalBoolean(dictionary, "LSUIElement"),
    backgroundOnly: optionalBoolean(dictionary, "LSBackgroundOnly"),
    platformName: optionalString(dictionary, "DTPlatformName"),
    sdkName: optionalString(dictionary, "DTSDKName"),
  };

  return {
    executable,
    architecturePriority: stringArray(dictionary, "LSArchitecturePriority"),
    ...(optional.bundleIdentifier === undefined
      ? {}
      : { bundleIdentifier: optional.bundleIdentifier }),
    ...(optional.bundleName === undefined ? {} : { bundleName: optional.bundleName }),
    ...(optional.displayName === undefined ? {} : { displayName: optional.displayName }),
    ...(optional.packageType === undefined ? {} : { packageType: optional.packageType }),
    ...(optional.version === undefined ? {} : { version: optional.version }),
    ...(optional.shortVersion === undefined ? {} : { shortVersion: optional.shortVersion }),
    ...(optional.iconFile === undefined ? {} : { iconFile: optional.iconFile }),
    ...(optional.minimumSystemVersion === undefined
      ? {}
      : { minimumSystemVersion: optional.minimumSystemVersion }),
    ...(optional.uiElement === undefined ? {} : { uiElement: optional.uiElement }),
    ...(optional.backgroundOnly === undefined
      ? {}
      : { backgroundOnly: optional.backgroundOnly }),
    ...(optional.platformName === undefined ? {} : { platformName: optional.platformName }),
    ...(optional.sdkName === undefined ? {} : { sdkName: optional.sdkName }),
  };
}

function findingsFor(metadata: AppBundleMetadata, macho: MachOAnalysis): AnalysisFinding[] {
  const findings: AnalysisFinding[] = [];
  if (metadata.packageType !== undefined && metadata.packageType !== "APPL") {
    findings.push({
      code: "BUNDLE_PACKAGE_TYPE_NOT_APPL",
      severity: "warning",
      message: `CFBundlePackageType is ${metadata.packageType}, not APPL.`,
    });
  }
  if (metadata.bundleIdentifier === undefined) {
    findings.push({
      code: "BUNDLE_IDENTIFIER_MISSING",
      severity: "warning",
      message: "The app bundle does not declare CFBundleIdentifier.",
    });
  }

  for (const slice of macho.slices) {
    if (slice.fileTypeName !== "execute") {
      findings.push({
        code: "MAIN_BINARY_NOT_EXECUTE",
        severity: "blocker",
        message: `The ${slice.architecture} main slice is ${slice.fileTypeName}, not an executable.`,
        evidence: { architecture: slice.architecture, fileType: slice.fileType },
      });
    }
    if (slice.architecture === "unknown") {
      findings.push({
        code: "UNKNOWN_CPU_ARCHITECTURE",
        severity: "blocker",
        message: "The main executable contains an unknown CPU architecture.",
        evidence: { cpuType: slice.cpuType, cpuSubtype: slice.cpuSubtype },
      });
    }
    if (slice.encryption.some((item) => item.encrypted)) {
      findings.push({
        code: "ENCRYPTED_MACHO_SLICE",
        severity: "blocker",
        message: `The ${slice.architecture} slice declares encrypted code.`,
        evidence: { architecture: slice.architecture },
      });
    }
    if (slice.codeSignatures.length === 0) {
      findings.push({
        code: "CODE_SIGNATURE_ABSENT",
        severity: "warning",
        message: `The ${slice.architecture} slice has no LC_CODE_SIGNATURE command.`,
        evidence: { architecture: slice.architecture },
      });
    }
    for (const build of slice.buildVersions) {
      if (build.platform !== 1) {
        findings.push({
          code: "NON_MACOS_BUILD_PLATFORM",
          severity: "blocker",
          message: `The ${slice.architecture} slice targets ${build.platformName}, not macOS.`,
          evidence: { architecture: slice.architecture, platform: build.platform },
        });
      }
    }
    for (const minimum of slice.minimumVersions) {
      if (minimum.command !== "LC_VERSION_MIN_MACOSX") {
        findings.push({
          code: "NON_MACOS_MINIMUM_PLATFORM",
          severity: "blocker",
          message: `The ${slice.architecture} slice declares ${minimum.command}, not macOS.`,
          evidence: { architecture: slice.architecture, command: minimum.command },
        });
      }
    }
    if (slice.buildVersions.length === 0 && slice.minimumVersions.length === 0) {
      findings.push({
        code: "MACHO_PLATFORM_UNKNOWN",
        severity: "warning",
        message: `The ${slice.architecture} slice does not declare a recognized target platform.`,
        evidence: { architecture: slice.architecture },
      });
    }
  }
  return findings;
}

export class DirectAppAnalyzer {
  private readonly plistAdapter: InfoPlistAdapter;
  private readonly machoLimits: MachOParserLimits;
  private readonly maxInfoPlistBytes: number;
  private readonly requireAppExtension: boolean;

  public constructor(options: DirectAppAnalyzerOptions = {}) {
    this.plistAdapter = options.plistAdapter ?? new PlistV5Adapter();
    this.machoLimits = options.machoLimits ?? DEFAULT_MACHO_LIMITS;
    this.maxInfoPlistBytes = options.maxInfoPlistBytes ?? 32 * 1024 * 1024;
    this.requireAppExtension = options.requireAppExtension ?? true;
  }

  public async analyze(bundlePath: string): Promise<DirectAppAnalysis> {
    const absoluteBundlePath = path.resolve(bundlePath);
    if (this.requireAppExtension && path.extname(absoluteBundlePath).toLowerCase() !== ".app") {
      throw coreError(CoreErrorCode.AppLayoutInvalid, "discovering", "Input directory is not a .app bundle.", {
        bundlePath: absoluteBundlePath,
      });
    }

    let bundleStats;
    try {
      bundleStats = await lstat(absoluteBundlePath);
    } catch (error) {
      const code = errnoCode(error) === "EACCES"
        ? CoreErrorCode.InputPermissionDenied
        : CoreErrorCode.InputNotFound;
      throw new CoreAnalysisError({
        code,
        stage: "discovering",
        message: "App bundle could not be opened.",
        cause: error,
        details: {
          bundlePath: absoluteBundlePath,
          cause: error instanceof Error ? error.message : String(error),
        },
      });
    }
    if (!bundleStats.isDirectory()) {
      throw coreError(CoreErrorCode.AppLayoutInvalid, "discovering", ".app input is not a direct directory (links are rejected).", {
        bundlePath: absoluteBundlePath,
      });
    }

    const bundleRealPath = await realpath(absoluteBundlePath);
    const contentsPath = await requireExactDirectory(absoluteBundlePath, "Contents");
    const infoPlistVisiblePath = await exactChild(contentsPath, "Info.plist");
    if (infoPlistVisiblePath === undefined) {
      throw coreError(CoreErrorCode.PlistMissing, "discovering", "App bundle is missing Contents/Info.plist.", {
        bundlePath: absoluteBundlePath,
      });
    }
    const infoPlist = await requireContainedFile(
      bundleRealPath,
      infoPlistVisiblePath,
      CoreErrorCode.PlistMissing,
      "Info.plist",
    );
    const plistBytes = await readBoundedStableFile(
      infoPlist,
      this.maxInfoPlistBytes,
      "Info.plist",
    );
    const parsedPlist = await this.plistAdapter.parse(plistBytes);
    if (!isPlistDictionary(parsedPlist)) {
      throw coreError(CoreErrorCode.PlistInvalid, "analyzing", "Info.plist root value is not a dictionary.");
    }
    const metadata = metadataFromPlist(parsedPlist);

    const macOsPath = await requireExactDirectory(contentsPath, "MacOS");
    const executableVisiblePath = await exactChild(macOsPath, metadata.executable);
    if (executableVisiblePath === undefined) {
      throw coreError(
        CoreErrorCode.ExecutableMissing,
        "discovering",
        "CFBundleExecutable does not name a file in Contents/MacOS.",
        { executable: metadata.executable },
      );
    }
    const executable = await requireContainedFile(
      bundleRealPath,
      executableVisiblePath,
      CoreErrorCode.ExecutableMissing,
      "Main executable",
    );
    const executableBytes = await readBoundedStableFile(
      executable,
      this.machoLimits.maxFileBytes,
      "Main executable",
    );
    const mainExecutable = parseMachO(executableBytes, this.machoLimits);

    return {
      sourcePath: absoluteBundlePath,
      realPath: bundleRealPath,
      infoPlistPath: infoPlist.visiblePath,
      executablePath: executable.visiblePath,
      metadata,
      mainExecutable,
      launchability: "not-tested",
      findings: findingsFor(metadata, mainExecutable),
    };
  }
}
