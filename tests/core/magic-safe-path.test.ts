import assert from "node:assert/strict";
import { test } from "vitest";

import { CoreAnalysisError, CoreErrorCode } from "../../electron/core/errors.js";
import { detectMagic } from "../../electron/core/magic.js";
import type { ArchiveEntryDescriptor } from "../../electron/core/model.js";
import {
  preflightArchiveEntries,
  validateArchiveLinkTarget,
  validateArchivePath,
} from "../../electron/core/safe-path.js";
import { makeFatMachO, makeThinMachO } from "./fixtures.js";

function entry(rawPath: string, size = 0): ArchiveEntryDescriptor {
  const validation = validateArchivePath(rawPath);
  assert.equal(validation.safe, true);
  assert.ok(validation.normalizedPath);
  return {
    rawPath,
    normalizedPath: validation.normalizedPath,
    kind: "file",
    size,
    encrypted: false,
  };
}

test("magic detection identifies Mach-O, XAR, CPIO, plist, and DMG signals", () => {
  assert.equal(detectMagic(makeThinMachO()).primary, "macho-thin");
  assert.equal(detectMagic(makeFatMachO()).primary, "macho-fat");
  assert.equal(detectMagic(Buffer.from("xar!fixture")).primary, "xar");
  assert.equal(detectMagic(Buffer.from("070701fixture")).primary, "cpio");
  assert.equal(detectMagic(Buffer.from("bplist00fixture")).primary, "plist-binary");
  assert.equal(detectMagic(Buffer.from(" \n<plist version=\"1.0\"></plist>")).primary, "plist-xml");

  const dmgTail = Buffer.alloc(512);
  dmgTail.write("koly", 0, "ascii");
  assert.equal(detectMagic(Buffer.alloc(32), dmgTail).primary, "dmg");
});

test("archive path validation permits a normalized app path and strips leading ./", () => {
  const result = validateArchivePath("./Applications/Fixture.app/./Contents/Info.plist");

  assert.equal(result.safe, true);
  assert.equal(result.normalizedPath, "Applications/Fixture.app/Contents/Info.plist");
});

test("preflight rejects duplicate aliases after dot-segment normalization", () => {
  assert.throws(
    () => preflightArchiveEntries([
      entry("Fixture.app/Contents/Info.plist"),
      entry("Fixture.app/Contents/./Info.plist"),
    ]),
    (error: unknown) =>
      error instanceof CoreAnalysisError && error.code === CoreErrorCode.DuplicateArchivePath,
  );
});

test("preflight rejects children beneath a file or link pivot", () => {
  assert.throws(
    () => preflightArchiveEntries([entry("Tree/node"), entry("Tree/node/child")]),
    (error: unknown) =>
      error instanceof CoreAnalysisError && error.code === CoreErrorCode.ArchivePathTypeConflict,
  );

  const linkPath = entry("Tree/pivot");
  assert.throws(
    () => preflightArchiveEntries([
      entry("Tree/target"),
      { ...linkPath, kind: "symlink", linkTarget: "target" },
      entry("Tree/pivot/child"),
    ]),
    (error: unknown) =>
      error instanceof CoreAnalysisError && error.code === CoreErrorCode.ArchivePathTypeConflict,
  );
});

test("hard links use archive-root targets and reject parent traversal", () => {
  const source = entry("Tree/source");
  const link = entry("Tree/link");

  assert.throws(
    () => preflightArchiveEntries([
      source,
      { ...link, kind: "hardlink", linkTarget: "../source" },
    ]),
    (error: unknown) =>
      error instanceof CoreAnalysisError && error.code === CoreErrorCode.UnsafeLink,
  );

  assert.equal(preflightArchiveEntries([
    source,
    { ...link, kind: "hardlink", linkTarget: "Tree/source" },
  ]).entryCount, 2);
});

test("archive path validation rejects traversal and Windows aliases", () => {
  assert.equal(validateArchivePath("../escape").safe, false);
  assert.equal(validateArchivePath("C:/escape").safe, false);
  assert.equal(validateArchivePath("Fixture.app/file:stream").safe, false);
  assert.equal(validateArchivePath("Fixture.app/CON.txt").safe, false);
  assert.equal(validateArchivePath("Fixture.app/trailing. ").safe, false);
});

test("relative links may traverse internally but cannot escape extraction root", () => {
  const internal = validateArchiveLinkTarget(
    "Fixture.app/Contents/Frameworks/Foo.framework/Versions/Nested/Current",
    "../A",
  );
  assert.equal(internal.safe, true);
  assert.equal(
    internal.resolvedTarget,
    "Fixture.app/Contents/Frameworks/Foo.framework/Versions/A",
  );

  const escape = validateArchiveLinkTarget("Fixture.app/link", "../../outside");
  assert.equal(escape.safe, false);
});

test("preflight rejects case-insensitive and Unicode-normalization collisions", () => {
  assert.throws(
    () => preflightArchiveEntries([entry("Foo.app/A"), entry("foo.app/a")]),
    (error: unknown) =>
      error instanceof CoreAnalysisError && error.code === CoreErrorCode.WindowsPathCollision,
  );

  assert.throws(
    () => preflightArchiveEntries([entry("Cafe\u0301/file"), entry("Caf\u00e9/file")]),
    (error: unknown) =>
      error instanceof CoreAnalysisError && error.code === CoreErrorCode.WindowsPathCollision,
  );
});

test("preflight sums declared sizes and enforces the expanded-byte limit", () => {
  const entries = [entry("Fixture.app/one", 8), entry("Fixture.app/two", 13)];
  assert.equal(preflightArchiveEntries(entries).totalUnpackedBytes, 21);

  assert.throws(
    () => preflightArchiveEntries(entries, {
      maxEntries: 2,
      maxExpandedBytes: 20,
      maxPathBytes: 4096,
      maxComponentBytes: 255,
    }),
    (error: unknown) =>
      error instanceof CoreAnalysisError && error.code === CoreErrorCode.LimitExpandedBytes,
  );
});
