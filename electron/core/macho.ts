import { CoreErrorCode, coreError } from "./errors.js";
import type {
  MachArchitecture,
  MachBitness,
  MachBuildVersion,
  MachCodeSignatureInfo,
  MachDylibKind,
  MachDylibReference,
  MachEncryptionInfo,
  MachEndianness,
  MachFileTypeName,
  MachMinimumVersion,
  MachOAnalysis,
  MachOSliceAnalysis,
} from "./model.js";

const CPU_TYPE_X86_64 = 0x01000007;
const CPU_TYPE_ARM64 = 0x0100000c;
const CPU_SUBTYPE_MASK = 0x00ff_ffff;
const CPU_SUBTYPE_ARM64E = 2;

const LC_LOAD_DYLIB = 0x0000_000c;
const LC_LOAD_WEAK_DYLIB = 0x8000_0018;
const LC_REEXPORT_DYLIB = 0x8000_001f;
const LC_LOAD_UPWARD_DYLIB = 0x8000_0023;
const LC_RPATH = 0x8000_001c;
const LC_CODE_SIGNATURE = 0x0000_001d;
const LC_ENCRYPTION_INFO = 0x0000_0021;
const LC_ENCRYPTION_INFO_64 = 0x0000_002c;
const LC_VERSION_MIN_MACOSX = 0x0000_0024;
const LC_VERSION_MIN_IPHONEOS = 0x0000_0025;
const LC_VERSION_MIN_TVOS = 0x0000_002f;
const LC_VERSION_MIN_WATCHOS = 0x0000_0030;
const LC_BUILD_VERSION = 0x0000_0032;

export interface MachOParserLimits {
  readonly maxFileBytes: number;
  readonly maxFatSlices: number;
  readonly maxLoadCommands: number;
  readonly maxLoadCommandBytes: number;
  readonly maxCommandStringBytes: number;
}

export const DEFAULT_MACHO_LIMITS: MachOParserLimits = {
  maxFileBytes: 512 * 1024 * 1024,
  maxFatSlices: 32,
  maxLoadCommands: 65_535,
  maxLoadCommandBytes: 64 * 1024 * 1024,
  maxCommandStringBytes: 64 * 1024,
};

interface ThinMagic {
  readonly bitness: MachBitness;
  readonly endianness: MachEndianness;
}

interface FatMagic {
  readonly bitness: MachBitness;
  readonly endianness: MachEndianness;
}

interface ExpectedFatArchitecture {
  readonly cpuType: number;
  readonly cpuSubtype: number;
}

function byteAt(bytes: Uint8Array, index: number): number {
  const value = bytes[index];
  if (value === undefined) {
    throw coreError(CoreErrorCode.MachOMalformed, "analyzing", "Mach-O file is truncated.", {
      offset: index,
    });
  }
  return value;
}

function identifyThinMagic(bytes: Uint8Array, offset = 0): ThinMagic | undefined {
  if (offset + 4 > bytes.byteLength) {
    return undefined;
  }

  const signature = [
    byteAt(bytes, offset),
    byteAt(bytes, offset + 1),
    byteAt(bytes, offset + 2),
    byteAt(bytes, offset + 3),
  ].join(",");

  switch (signature) {
    case "206,250,237,254":
      return { bitness: 32, endianness: "little" };
    case "207,250,237,254":
      return { bitness: 64, endianness: "little" };
    case "254,237,250,206":
      return { bitness: 32, endianness: "big" };
    case "254,237,250,207":
      return { bitness: 64, endianness: "big" };
    default:
      return undefined;
  }
}

function identifyFatMagic(bytes: Uint8Array): FatMagic | undefined {
  if (bytes.byteLength < 4) {
    return undefined;
  }

  const signature = [byteAt(bytes, 0), byteAt(bytes, 1), byteAt(bytes, 2), byteAt(bytes, 3)].join(",");
  switch (signature) {
    case "202,254,186,190":
      return { bitness: 32, endianness: "big" };
    case "190,186,254,202":
      return { bitness: 32, endianness: "little" };
    case "202,254,186,191":
      return { bitness: 64, endianness: "big" };
    case "191,186,254,202":
      return { bitness: 64, endianness: "little" };
    default:
      return undefined;
  }
}

function littleEndian(endianness: MachEndianness): boolean {
  return endianness === "little";
}

function checkedEnd(offset: number, length: number, limit: number, label: string): number {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > limit ||
    length > limit - offset
  ) {
    throw coreError(CoreErrorCode.MachOMalformed, "analyzing", `${label} is outside the Mach-O slice.`, {
      offset,
      length,
      limit,
    });
  }
  return offset + length;
}

function readUint32(view: DataView, offset: number, endianness: MachEndianness): number {
  checkedEnd(offset, 4, view.byteLength, "32-bit field");
  return view.getUint32(offset, littleEndian(endianness));
}

function readInt32(view: DataView, offset: number, endianness: MachEndianness): number {
  checkedEnd(offset, 4, view.byteLength, "32-bit field");
  return view.getInt32(offset, littleEndian(endianness));
}

function readUint64AsNumber(
  view: DataView,
  offset: number,
  endianness: MachEndianness,
  label: string,
): number {
  checkedEnd(offset, 8, view.byteLength, label);
  const value = view.getBigUint64(offset, littleEndian(endianness));
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw coreError(CoreErrorCode.MachOMalformed, "analyzing", `${label} exceeds the safe integer range.`, {
      value: value.toString(),
    });
  }
  return Number(value);
}

function packedVersion(value: number): string {
  const major = (value >>> 16) & 0xffff;
  const minor = (value >>> 8) & 0xff;
  const patch = value & 0xff;
  return `${major}.${minor}.${patch}`;
}

function architectureName(cpuType: number, cpuSubtype: number): MachArchitecture {
  if ((cpuType >>> 0) === CPU_TYPE_X86_64) {
    return "x86_64";
  }
  if ((cpuType >>> 0) === CPU_TYPE_ARM64) {
    return ((cpuSubtype >>> 0) & CPU_SUBTYPE_MASK) === CPU_SUBTYPE_ARM64E
      ? "arm64e"
      : "arm64";
  }
  return "unknown";
}

function fileTypeName(fileType: number): MachFileTypeName {
  const names: Readonly<Record<number, MachFileTypeName>> = {
    0x1: "object",
    0x2: "execute",
    0x3: "fvmlib",
    0x4: "core",
    0x5: "preload",
    0x6: "dylib",
    0x7: "dylinker",
    0x8: "bundle",
    0x9: "dylib-stub",
    0xa: "dsym",
    0xb: "kext-bundle",
    0xc: "fileset",
  };
  return names[fileType] ?? "unknown";
}

function platformName(platform: number): string {
  const names: Readonly<Record<number, string>> = {
    1: "macOS",
    2: "iOS",
    3: "tvOS",
    4: "watchOS",
    5: "bridgeOS",
    6: "Mac Catalyst",
    7: "iOS Simulator",
    8: "tvOS Simulator",
    9: "watchOS Simulator",
    10: "DriverKit",
    11: "visionOS",
    12: "visionOS Simulator",
  };
  return names[platform] ?? `unknown(${platform})`;
}

function readCommandString(
  bytes: Uint8Array,
  commandOffset: number,
  commandSize: number,
  stringOffset: number,
  limits: MachOParserLimits,
  label: string,
  minimumStringOffset: number,
): string {
  if (stringOffset < minimumStringOffset || stringOffset >= commandSize) {
    throw coreError(CoreErrorCode.MachOMalformed, "analyzing", `${label} offset is invalid.`, {
      commandOffset,
      commandSize,
      stringOffset,
    });
  }

  const start = commandOffset + stringOffset;
  const commandEnd = commandOffset + commandSize;
  const maximumEnd = Math.min(commandEnd, start + limits.maxCommandStringBytes + 1);
  let end = start;
  while (end < maximumEnd && byteAt(bytes, end) !== 0) {
    end += 1;
  }

  if (end >= commandEnd || end >= maximumEnd) {
    throw coreError(CoreErrorCode.MachOMalformed, "analyzing", `${label} is not NUL-terminated within limits.`, {
      commandOffset,
      commandSize,
      stringOffset,
      maxCommandStringBytes: limits.maxCommandStringBytes,
    });
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start, end));
  } catch (error) {
    throw coreError(CoreErrorCode.MachOMalformed, "analyzing", `${label} is not valid UTF-8.`, {
      commandOffset,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function dylibKind(command: number): MachDylibKind | undefined {
  switch (command >>> 0) {
    case LC_LOAD_DYLIB:
      return "load";
    case LC_LOAD_WEAK_DYLIB:
      return "weak";
    case LC_REEXPORT_DYLIB:
      return "reexport";
    case LC_LOAD_UPWARD_DYLIB:
      return "upward";
    default:
      return undefined;
  }
}

function minimumVersionCommandName(command: number): string | undefined {
  const names: Readonly<Record<number, string>> = {
    [LC_VERSION_MIN_MACOSX]: "LC_VERSION_MIN_MACOSX",
    [LC_VERSION_MIN_IPHONEOS]: "LC_VERSION_MIN_IPHONEOS",
    [LC_VERSION_MIN_TVOS]: "LC_VERSION_MIN_TVOS",
    [LC_VERSION_MIN_WATCHOS]: "LC_VERSION_MIN_WATCHOS",
  };
  return names[command >>> 0];
}

function parseThinSlice(
  allBytes: Uint8Array,
  sliceOffset: number,
  sliceSize: number,
  limits: MachOParserLimits,
  expected?: ExpectedFatArchitecture,
): MachOSliceAnalysis {
  checkedEnd(sliceOffset, sliceSize, allBytes.byteLength, "Fat Mach-O slice");
  const magic = identifyThinMagic(allBytes, sliceOffset);
  if (magic === undefined) {
    throw coreError(CoreErrorCode.MachOMalformed, "analyzing", "Fat entry does not contain a thin Mach-O.", {
      sliceOffset,
      sliceSize,
    });
  }

  const headerSize = magic.bitness === 64 ? 32 : 28;
  if (sliceSize < headerSize) {
    throw coreError(CoreErrorCode.MachOMalformed, "analyzing", "Mach-O header is truncated.", {
      sliceOffset,
      sliceSize,
      headerSize,
    });
  }

  const bytes = allBytes.subarray(sliceOffset, sliceOffset + sliceSize);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cpuType = readInt32(view, 4, magic.endianness);
  const cpuSubtype = readInt32(view, 8, magic.endianness);
  const fileType = readUint32(view, 12, magic.endianness);
  const commandCount = readUint32(view, 16, magic.endianness);
  const commandBytes = readUint32(view, 20, magic.endianness);
  const flags = readUint32(view, 24, magic.endianness);

  if (expected !== undefined) {
    const cpuMatches = (cpuType >>> 0) === (expected.cpuType >>> 0);
    const subtypeMatches = (cpuSubtype >>> 0) === (expected.cpuSubtype >>> 0);
    if (!cpuMatches || !subtypeMatches) {
      throw coreError(
        CoreErrorCode.MachOMalformed,
        "analyzing",
        "Fat architecture metadata does not match its thin Mach-O header.",
        {
          sliceOffset,
          expectedCpuType: expected.cpuType,
          actualCpuType: cpuType,
          expectedCpuSubtype: expected.cpuSubtype,
          actualCpuSubtype: cpuSubtype,
        },
      );
    }
  }

  if (commandCount > limits.maxLoadCommands) {
    throw coreError(
      CoreErrorCode.MachOMalformed,
      "analyzing",
      "Mach-O load command count exceeds the configured limit.",
      { commandCount, maxLoadCommands: limits.maxLoadCommands },
    );
  }
  if (commandBytes > limits.maxLoadCommandBytes) {
    throw coreError(
      CoreErrorCode.MachOMalformed,
      "analyzing",
      "Mach-O load command bytes exceed the configured limit.",
      { commandBytes, maxLoadCommandBytes: limits.maxLoadCommandBytes },
    );
  }

  const commandsEnd = checkedEnd(headerSize, commandBytes, sliceSize, "Mach-O load command table");
  let cursor = headerSize;
  const buildVersions: MachBuildVersion[] = [];
  const minimumVersions: MachMinimumVersion[] = [];
  const dylibs: MachDylibReference[] = [];
  const rpaths: string[] = [];
  const codeSignatures: MachCodeSignatureInfo[] = [];
  const encryption: MachEncryptionInfo[] = [];

  for (let index = 0; index < commandCount; index += 1) {
    checkedEnd(cursor, 8, commandsEnd, "Mach-O load command header");
    const command = readUint32(view, cursor, magic.endianness) >>> 0;
    const commandSize = readUint32(view, cursor + 4, magic.endianness);
    const commandAlignment = magic.bitness === 64 ? 8 : 4;
    if (commandSize < 8 || commandSize % commandAlignment !== 0) {
      throw coreError(CoreErrorCode.MachOMalformed, "analyzing", "Mach-O load command size is invalid.", {
        index,
        command,
        commandSize,
      });
    }
    checkedEnd(cursor, commandSize, commandsEnd, "Mach-O load command");

    const kind = dylibKind(command);
    if (kind !== undefined) {
      if (commandSize < 24) {
        throw coreError(CoreErrorCode.MachOMalformed, "analyzing", "Mach-O dylib command is truncated.", {
          index,
          commandSize,
        });
      }
      const nameOffset = readUint32(view, cursor + 8, magic.endianness);
      dylibs.push({
        kind,
        path: readCommandString(bytes, cursor, commandSize, nameOffset, limits, "Dylib path", 24),
        timestamp: readUint32(view, cursor + 12, magic.endianness),
        currentVersion: packedVersion(readUint32(view, cursor + 16, magic.endianness)),
        compatibilityVersion: packedVersion(readUint32(view, cursor + 20, magic.endianness)),
      });
    } else if (command === LC_RPATH) {
      if (commandSize < 12) {
        throw coreError(CoreErrorCode.MachOMalformed, "analyzing", "LC_RPATH is truncated.", {
          index,
          commandSize,
        });
      }
      const pathOffset = readUint32(view, cursor + 8, magic.endianness);
      rpaths.push(readCommandString(bytes, cursor, commandSize, pathOffset, limits, "RPATH", 12));
    } else if (command === LC_BUILD_VERSION) {
      if (commandSize < 24) {
        throw coreError(CoreErrorCode.MachOMalformed, "analyzing", "LC_BUILD_VERSION is truncated.", {
          index,
          commandSize,
        });
      }
      const platform = readUint32(view, cursor + 8, magic.endianness);
      const minimumOs = readUint32(view, cursor + 12, magic.endianness);
      const sdk = readUint32(view, cursor + 16, magic.endianness);
      const toolCount = readUint32(view, cursor + 20, magic.endianness);
      if (toolCount > Math.floor((commandSize - 24) / 8)) {
        throw coreError(
          CoreErrorCode.MachOMalformed,
          "analyzing",
          "LC_BUILD_VERSION tool table exceeds its command bounds.",
          { index, commandSize, toolCount },
        );
      }
      buildVersions.push({
        platform,
        platformName: platformName(platform),
        minimumOs: packedVersion(minimumOs),
        sdk: packedVersion(sdk),
        toolCount,
      });
    } else {
      const minimumCommand = minimumVersionCommandName(command);
      if (minimumCommand !== undefined) {
        if (commandSize < 16) {
          throw coreError(
            CoreErrorCode.MachOMalformed,
            "analyzing",
            `${minimumCommand} is truncated.`,
            { index, commandSize },
          );
        }
        minimumVersions.push({
          command: minimumCommand,
          version: packedVersion(readUint32(view, cursor + 8, magic.endianness)),
          sdk: packedVersion(readUint32(view, cursor + 12, magic.endianness)),
        });
      } else if (command === LC_CODE_SIGNATURE) {
        if (commandSize < 16) {
          throw coreError(CoreErrorCode.MachOMalformed, "analyzing", "LC_CODE_SIGNATURE is truncated.", {
            index,
            commandSize,
          });
        }
        const dataOffset = readUint32(view, cursor + 8, magic.endianness);
        const dataSize = readUint32(view, cursor + 12, magic.endianness);
        checkedEnd(dataOffset, dataSize, sliceSize, "Mach-O code signature blob");
        if (dataSize === 0 || dataOffset < commandsEnd) {
          throw coreError(
            CoreErrorCode.MachOMalformed,
            "analyzing",
            "Mach-O code signature blob is empty or overlaps headers/load commands.",
            { index, dataOffset, dataSize, commandsEnd },
          );
        }
        codeSignatures.push({ dataOffset, dataSize });
      } else if (command === LC_ENCRYPTION_INFO || command === LC_ENCRYPTION_INFO_64) {
        const minimumSize = command === LC_ENCRYPTION_INFO_64 ? 24 : 20;
        if (commandSize < minimumSize) {
          throw coreError(
            CoreErrorCode.MachOMalformed,
            "analyzing",
            "Mach-O encryption command is truncated.",
            { index, commandSize, minimumSize },
          );
        }
        const cryptOffset = readUint32(view, cursor + 8, magic.endianness);
        const cryptSize = readUint32(view, cursor + 12, magic.endianness);
        const cryptId = readUint32(view, cursor + 16, magic.endianness);
        checkedEnd(cryptOffset, cryptSize, sliceSize, "Mach-O encrypted range");
        encryption.push({
          command:
            command === LC_ENCRYPTION_INFO_64
              ? "LC_ENCRYPTION_INFO_64"
              : "LC_ENCRYPTION_INFO",
          cryptOffset,
          cryptSize,
          cryptId,
          encrypted: cryptId !== 0,
        });
      }
    }

    cursor += commandSize;
  }

  if (cursor !== commandsEnd) {
    throw coreError(
      CoreErrorCode.MachOMalformed,
      "analyzing",
      "Mach-O sizeofcmds does not equal the parsed command sizes.",
      { parsedEnd: cursor, declaredEnd: commandsEnd },
    );
  }

  return {
    offset: sliceOffset,
    size: sliceSize,
    bitness: magic.bitness,
    endianness: magic.endianness,
    cpuType,
    cpuSubtype,
    architecture: architectureName(cpuType, cpuSubtype),
    fileType,
    fileTypeName: fileTypeName(fileType),
    commandCount,
    commandBytes,
    flags,
    buildVersions,
    minimumVersions,
    dylibs,
    rpaths,
    codeSignatures,
    encryption,
  };
}

function assertInputLimits(bytes: Uint8Array, limits: MachOParserLimits): void {
  if (bytes.byteLength > limits.maxFileBytes) {
    throw coreError(
      CoreErrorCode.LimitFileBytes,
      "analyzing",
      "Mach-O file exceeds the configured parser limit.",
      { fileBytes: bytes.byteLength, maxFileBytes: limits.maxFileBytes },
    );
  }
}

export function parseMachO(
  bytes: Uint8Array,
  limits: MachOParserLimits = DEFAULT_MACHO_LIMITS,
): MachOAnalysis {
  assertInputLimits(bytes, limits);
  const thinMagic = identifyThinMagic(bytes);
  if (thinMagic !== undefined) {
    return {
      kind: "thin",
      slices: [parseThinSlice(bytes, 0, bytes.byteLength, limits)],
    };
  }

  const fatMagic = identifyFatMagic(bytes);
  if (fatMagic === undefined) {
    throw coreError(CoreErrorCode.NotMachO, "analyzing", "Input is not a recognized Mach-O file.");
  }

  if (bytes.byteLength < 8) {
    throw coreError(CoreErrorCode.MachOMalformed, "analyzing", "Fat Mach-O header is truncated.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sliceCount = readUint32(view, 4, fatMagic.endianness);
  if (sliceCount === 0 || sliceCount > limits.maxFatSlices) {
    throw coreError(
      CoreErrorCode.MachOMalformed,
      "analyzing",
      "Fat Mach-O slice count is invalid or exceeds the configured limit.",
      { sliceCount, maxFatSlices: limits.maxFatSlices },
    );
  }

  const architectureEntrySize = fatMagic.bitness === 64 ? 32 : 20;
  const tableBytes = sliceCount * architectureEntrySize;
  const tableEnd = checkedEnd(8, tableBytes, bytes.byteLength, "Fat Mach-O architecture table");
  const descriptors: Array<{
    cpuType: number;
    cpuSubtype: number;
    offset: number;
    size: number;
    align: number;
  }> = [];

  for (let index = 0; index < sliceCount; index += 1) {
    const cursor = 8 + index * architectureEntrySize;
    const cpuType = readInt32(view, cursor, fatMagic.endianness);
    const cpuSubtype = readInt32(view, cursor + 4, fatMagic.endianness);
    const offset =
      fatMagic.bitness === 64
        ? readUint64AsNumber(view, cursor + 8, fatMagic.endianness, "Fat slice offset")
        : readUint32(view, cursor + 8, fatMagic.endianness);
    const size =
      fatMagic.bitness === 64
        ? readUint64AsNumber(view, cursor + 16, fatMagic.endianness, "Fat slice size")
        : readUint32(view, cursor + 12, fatMagic.endianness);
    const align = readUint32(
      view,
      cursor + (fatMagic.bitness === 64 ? 24 : 16),
      fatMagic.endianness,
    );

    if (align > 31) {
      throw coreError(CoreErrorCode.MachOMalformed, "analyzing", "Fat slice alignment is unreasonable.", {
        index,
        align,
      });
    }
    const alignment = 2 ** align;
    if (offset % alignment !== 0) {
      throw coreError(CoreErrorCode.MachOMalformed, "analyzing", "Fat slice offset is misaligned.", {
        index,
        offset,
        align,
      });
    }
    if (offset < tableEnd) {
      throw coreError(
        CoreErrorCode.MachOMalformed,
        "analyzing",
        "Fat slice overlaps the architecture table.",
        { index, offset, tableEnd },
      );
    }
    checkedEnd(offset, size, bytes.byteLength, "Fat Mach-O slice");
    descriptors.push({ cpuType, cpuSubtype, offset, size, align });
  }

  const ordered = [...descriptors].sort((left, right) => left.offset - right.offset);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    if (previous.offset + previous.size > current.offset) {
      throw coreError(CoreErrorCode.MachOMalformed, "analyzing", "Fat Mach-O slices overlap.", {
        firstOffset: previous.offset,
        firstSize: previous.size,
        secondOffset: current.offset,
      });
    }
  }

  const slices = descriptors.map((descriptor) =>
    parseThinSlice(bytes, descriptor.offset, descriptor.size, limits, {
      cpuType: descriptor.cpuType,
      cpuSubtype: descriptor.cpuSubtype,
    }),
  );

  return { kind: "fat", slices };
}
