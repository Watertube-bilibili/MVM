import assert from "node:assert/strict";
import { test } from "vitest";

import { CoreAnalysisError, CoreErrorCode } from "../../electron/core/errors.js";
import { parseMachO } from "../../electron/core/macho.js";
import { makeFatMachO, makeThinMachO } from "./fixtures.js";

function hasCoreCode(expected: string): (error: unknown) => boolean {
  return (error: unknown): boolean =>
    error instanceof CoreAnalysisError && error.code === expected;
}

function findLoadCommand(bytes: Buffer, wanted: number): number {
  const commandCount = bytes.readUInt32LE(16);
  let cursor = 32;
  for (let index = 0; index < commandCount; index += 1) {
    if (bytes.readUInt32LE(cursor) === (wanted >>> 0)) {
      return cursor;
    }
    cursor += bytes.readUInt32LE(cursor + 4);
  }
  throw new Error(`Load command 0x${wanted.toString(16)} was not found.`);
}

test("strict thin Mach-O parser exposes compatibility-relevant commands", () => {
  const result = parseMachO(makeThinMachO({ architecture: "x86_64", encrypted: true }));

  assert.equal(result.kind, "thin");
  assert.equal(result.slices.length, 1);
  const slice = result.slices[0]!;
  assert.equal(slice.architecture, "x86_64");
  assert.equal(slice.fileTypeName, "execute");
  assert.deepEqual(slice.dylibs.map((item) => item.kind), [
    "load",
    "weak",
    "reexport",
    "upward",
  ]);
  assert.equal(slice.dylibs[0]?.currentVersion, "2.3.4");
  assert.deepEqual(slice.rpaths, ["@executable_path/../Frameworks"]);
  assert.deepEqual(slice.buildVersions[0], {
    platform: 1,
    platformName: "macOS",
    minimumOs: "13.1.0",
    sdk: "14.0.0",
    toolCount: 0,
  });
  assert.equal(slice.minimumVersions[0]?.command, "LC_VERSION_MIN_MACOSX");
  assert.equal(slice.minimumVersions[0]?.version, "12.6.0");
  assert.equal(slice.codeSignatures.length, 1);
  assert.equal(slice.codeSignatures[0]?.dataSize, 4);
  assert.equal(slice.encryption[0]?.command, "LC_ENCRYPTION_INFO_64");
  assert.equal(slice.encryption[0]?.encrypted, true);
});

test("fat Mach-O parser validates and reports x86_64 and arm64e slices", () => {
  const result = parseMachO(makeFatMachO());

  assert.equal(result.kind, "fat");
  assert.deepEqual(result.slices.map((slice) => slice.architecture), ["x86_64", "arm64e"]);
});

test("thin Mach-O parser distinguishes arm64 from arm64e", () => {
  const arm64 = parseMachO(makeThinMachO({ architecture: "arm64" }));
  const arm64e = parseMachO(makeThinMachO({ architecture: "arm64e" }));

  assert.equal(arm64.slices[0]?.architecture, "arm64");
  assert.equal(arm64e.slices[0]?.architecture, "arm64e");
});

test("Mach-O parser rejects an invalid load-command size", () => {
  const bytes = makeThinMachO();
  bytes.writeUInt32LE(6, 32 + 4);

  assert.throws(
    () => parseMachO(bytes),
    hasCoreCode(CoreErrorCode.MachOMalformed),
  );
});

test("Mach-O parser rejects out-of-bounds code signature blobs", () => {
  const bytes = makeThinMachO();
  const command = findLoadCommand(bytes, 0x1d);
  bytes.writeUInt32LE(bytes.byteLength - 1, command + 8);
  bytes.writeUInt32LE(64, command + 12);

  assert.throws(
    () => parseMachO(bytes),
    hasCoreCode(CoreErrorCode.MachOMalformed),
  );
});

test("fat Mach-O parser rejects overlapping slices", () => {
  const bytes = makeFatMachO();
  const firstOffset = bytes.readUInt32BE(8 + 8);
  bytes.writeUInt32BE(firstOffset, 8 + 20 + 8);

  assert.throws(
    () => parseMachO(bytes),
    hasCoreCode(CoreErrorCode.MachOMalformed),
  );
});
