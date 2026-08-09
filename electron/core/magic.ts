import { open, stat } from "node:fs/promises";

import { CoreErrorCode, coreError } from "./errors.js";
import type {
  DetectedFormat,
  MagicProbeResult,
  MagicSignal,
} from "./model.js";

const DEFAULT_HEAD_BYTES = 4096;
const DMG_TRAILER_BYTES = 512;

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.byteLength < signature.length) {
    return false;
  }

  return signature.every((value, index) => bytes[index] === value);
}

function matchesAt(
  bytes: Uint8Array,
  offset: number,
  signature: readonly number[],
): boolean {
  if (offset < 0 || offset + signature.length > bytes.byteLength) {
    return false;
  }

  return signature.every((value, index) => bytes[offset + index] === value);
}

function firstNonWhitespaceAscii(bytes: Uint8Array): string {
  let start = 0;
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) {
    start = 3;
  }

  while (start < bytes.byteLength) {
    const value = bytes[start];
    if (value === undefined || ![0x09, 0x0a, 0x0d, 0x20].includes(value)) {
      break;
    }
    start += 1;
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(
    bytes.subarray(start, Math.min(bytes.byteLength, start + 96)),
  );
}

function addSignal(
  signals: MagicSignal[],
  format: DetectedFormat,
  offset: number,
  detail?: string,
): void {
  if (!signals.some((signal) => signal.format === format && signal.offset === offset)) {
    signals.push({ format, offset, ...(detail === undefined ? {} : { detail }) });
  }
}

export function detectMagic(
  head: Uint8Array,
  tail: Uint8Array = new Uint8Array(),
  tailFileOffset = 0,
): MagicProbeResult {
  const signals: MagicSignal[] = [];

  if (
    startsWith(head, [0xce, 0xfa, 0xed, 0xfe]) ||
    startsWith(head, [0xcf, 0xfa, 0xed, 0xfe]) ||
    startsWith(head, [0xfe, 0xed, 0xfa, 0xce]) ||
    startsWith(head, [0xfe, 0xed, 0xfa, 0xcf])
  ) {
    addSignal(signals, "macho-thin", 0);
  }

  if (
    startsWith(head, [0xca, 0xfe, 0xba, 0xbe]) ||
    startsWith(head, [0xbe, 0xba, 0xfe, 0xca]) ||
    startsWith(head, [0xca, 0xfe, 0xba, 0xbf]) ||
    startsWith(head, [0xbf, 0xba, 0xfe, 0xca])
  ) {
    addSignal(signals, "macho-fat", 0);
  }

  if (startsWith(head, [0x78, 0x61, 0x72, 0x21])) {
    addSignal(signals, "xar", 0);
  }
  if (
    startsWith(head, [0x30, 0x37, 0x30, 0x37, 0x30, 0x31]) ||
    startsWith(head, [0x30, 0x37, 0x30, 0x37, 0x30, 0x32]) ||
    startsWith(head, [0x30, 0x37, 0x30, 0x37, 0x30, 0x37])
  ) {
    addSignal(signals, "cpio", 0);
  }
  if (startsWith(head, [0x70, 0x62, 0x7a, 0x78])) {
    addSignal(signals, "pbzx", 0);
  }
  if (startsWith(head, [0x62, 0x70, 0x6c, 0x69, 0x73, 0x74, 0x30, 0x30])) {
    addSignal(signals, "plist-binary", 0);
  }

  const asciiPrefix = firstNonWhitespaceAscii(head);
  if (asciiPrefix.startsWith("<?xml") || asciiPrefix.startsWith("<plist")) {
    addSignal(signals, "plist-xml", 0);
  } else if (asciiPrefix.startsWith("{") || asciiPrefix.startsWith("(")) {
    addSignal(signals, "plist-openstep", 0);
  }

  if (startsWith(head, [0x1f, 0x8b])) {
    addSignal(signals, "gzip", 0);
  }
  if (startsWith(head, [0x42, 0x5a, 0x68])) {
    addSignal(signals, "bzip2", 0);
  }
  if (startsWith(head, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) {
    addSignal(signals, "xz", 0);
  }
  if (startsWith(head, [0x28, 0xb5, 0x2f, 0xfd])) {
    addSignal(signals, "zstd", 0);
  }
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
    addSignal(signals, "zip", 0);
  }

  if (matchesAt(head, 32, [0x4e, 0x58, 0x53, 0x42])) {
    addSignal(signals, "apfs", 32, "NXSB container superblock");
  }
  if (matchesAt(head, 1024, [0x42, 0x44])) {
    addSignal(signals, "hfs", 1024, "HFS volume header");
  }
  if (matchesAt(head, 1024, [0x48, 0x2b])) {
    addSignal(signals, "hfsplus", 1024, "HFS+ volume header");
  }
  if (matchesAt(head, 1024, [0x48, 0x58])) {
    addSignal(signals, "hfsx", 1024, "HFSX volume header");
  }

  if (tail.byteLength === DMG_TRAILER_BYTES && startsWith(tail, [0x6b, 0x6f, 0x6c, 0x79])) {
    addSignal(signals, "dmg", tailFileOffset);
  }

  return {
    primary: signals[0]?.format ?? "unknown",
    signals,
  };
}

export async function probeFileMagic(filePath: string): Promise<MagicProbeResult> {
  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch (error) {
    throw coreError(CoreErrorCode.InputNotFound, "probing", "Input file was not found.", {
      filePath,
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  if (!fileStats.isFile()) {
    throw coreError(CoreErrorCode.FormatUnknown, "probing", "Magic probing requires a regular file.", {
      filePath,
    });
  }

  const handle = await open(filePath, "r");
  try {
    const before = await handle.stat();
    const headLength = Math.min(DEFAULT_HEAD_BYTES, before.size);
    const head = Buffer.alloc(headLength);
    if (headLength > 0) {
      await handle.read(head, 0, headLength, 0);
    }

    const tailLength = Math.min(DMG_TRAILER_BYTES, before.size);
    const tail = Buffer.alloc(tailLength);
    if (tailLength > 0) {
      await handle.read(tail, 0, tailLength, before.size - tailLength);
    }

    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw coreError(
        CoreErrorCode.InputChanged,
        "probing",
        "Input file changed while its magic bytes were being inspected.",
        { filePath },
      );
    }

    return detectMagic(head, tail, before.size - tailLength);
  } finally {
    await handle.close();
  }
}
