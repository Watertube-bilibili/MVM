import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";

const CPU_TYPE_X86_64 = 0x0100_0007;
const CPU_TYPE_ARM64 = 0x0100_000c;
const LC_LOAD_DYLIB = 0x0000_000c;
const LC_RPATH = 0x8000_001c;
const LC_CODE_SIGNATURE = 0x0000_001d;
const LC_ENCRYPTION_INFO_64 = 0x0000_002c;
const LC_BUILD_VERSION = 0x0000_0032;

function align(value: number, multiple: number): number {
  return Math.ceil(value / multiple) * multiple;
}

function packedVersion(major: number, minor: number, patch: number): number {
  return ((major & 0xffff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

function fixedCommand(command: number, size: number): Buffer {
  const bytes = Buffer.alloc(size);
  bytes.writeUInt32LE(command >>> 0, 0);
  bytes.writeUInt32LE(size, 4);
  return bytes;
}

function stringCommand(command: number, stringOffset: number, value: string): Buffer {
  const encoded = Buffer.from(`${value}\0`, "utf8");
  const size = align(stringOffset + encoded.byteLength, 8);
  const bytes = fixedCommand(command, size);
  encoded.copy(bytes, stringOffset);
  return bytes;
}

function dylibCommand(dylibPath: string): Buffer {
  const bytes = stringCommand(LC_LOAD_DYLIB, 24, dylibPath);
  bytes.writeUInt32LE(24, 8);
  bytes.writeUInt32LE(0, 12);
  bytes.writeUInt32LE(packedVersion(1, 0, 0), 16);
  bytes.writeUInt32LE(packedVersion(1, 0, 0), 20);
  return bytes;
}

function makeThinMachO(architecture: "x86_64" | "arm64"): Buffer {
  const commands: Buffer[] = [];

  const buildVersion = fixedCommand(LC_BUILD_VERSION, 24);
  buildVersion.writeUInt32LE(1, 8);
  buildVersion.writeUInt32LE(packedVersion(13, 0, 0), 12);
  buildVersion.writeUInt32LE(packedVersion(15, 0, 0), 16);
  buildVersion.writeUInt32LE(0, 20);
  commands.push(buildVersion);

  commands.push(dylibCommand("/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit"));
  commands.push(dylibCommand("/System/Library/Frameworks/Foundation.framework/Versions/C/Foundation"));

  const rpath = stringCommand(LC_RPATH, 12, "@executable_path/../Frameworks");
  rpath.writeUInt32LE(12, 8);
  commands.push(rpath);

  const signature = fixedCommand(LC_CODE_SIGNATURE, 16);
  commands.push(signature);

  const encryption = fixedCommand(LC_ENCRYPTION_INFO_64, 24);
  encryption.writeUInt32LE(0, 16);
  commands.push(encryption);

  const commandBytes = commands.reduce((sum, command) => sum + command.byteLength, 0);
  const payloadOffset = 32 + commandBytes;
  const payload = Buffer.from([0xfa, 0xde, 0x0c, 0xc0, 0, 0, 0, 0]);
  signature.writeUInt32LE(payloadOffset, 8);
  signature.writeUInt32LE(4, 12);
  encryption.writeUInt32LE(payloadOffset + 4, 8);
  encryption.writeUInt32LE(4, 12);

  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeed_facf, 0);
  header.writeInt32LE(architecture === "x86_64" ? CPU_TYPE_X86_64 : CPU_TYPE_ARM64, 4);
  header.writeInt32LE(0, 8);
  header.writeUInt32LE(2, 12);
  header.writeUInt32LE(commands.length, 16);
  header.writeUInt32LE(commandBytes, 20);
  header.writeUInt32LE(0x0020_0085, 24);
  header.writeUInt32LE(0, 28);

  return Buffer.concat([header, ...commands, payload]);
}

function makeUniversalMachO(): Buffer {
  const slices = [makeThinMachO("x86_64"), makeThinMachO("arm64")];
  const tableBytes = 8 + slices.length * 20;
  let nextOffset = align(tableBytes, 4);
  const offsets = slices.map((slice) => {
    const offset = nextOffset;
    nextOffset = align(offset + slice.byteLength, 4);
    return offset;
  });
  const bytes = Buffer.alloc(nextOffset);
  bytes.writeUInt32BE(0xcafe_babe, 0);
  bytes.writeUInt32BE(slices.length, 4);

  slices.forEach((slice, index) => {
    const row = 8 + index * 20;
    bytes.writeInt32BE(slice.readInt32LE(4), row);
    bytes.writeInt32BE(slice.readInt32LE(8), row + 4);
    bytes.writeUInt32BE(offsets[index]!, row + 8);
    bytes.writeUInt32BE(slice.byteLength, row + 12);
    bytes.writeUInt32BE(2, row + 16);
    slice.copy(bytes, offsets[index]!);
  });
  return bytes;
}

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>io.mvm.fixture.probe</string>
  <key>CFBundleName</key><string>MVM Probe</string>
  <key>CFBundleDisplayName</key><string>MVM Probe</string>
  <key>CFBundleExecutable</key><string>MVMProbe</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSArchitecturePriority</key>
  <array><string>arm64</string><string>x86_64</string></array>
</dict>
</plist>
`;

export async function createStructureFixture(fixturesRoot: string): Promise<string> {
  const bundlePath = path.join(fixturesRoot, "MVM Probe.app");
  const contentsPath = path.join(bundlePath, "Contents");
  const macOsPath = path.join(contentsPath, "MacOS");
  await rm(bundlePath, { recursive: true, force: true });
  await mkdir(macOsPath, { recursive: true });
  await writeFile(path.join(contentsPath, "Info.plist"), INFO_PLIST, "utf8");
  await writeFile(path.join(macOsPath, "MVMProbe"), makeUniversalMachO());
  return bundlePath;
}
