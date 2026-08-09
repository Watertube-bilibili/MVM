import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { buildBinary } from "plist";

import { DirectAppAnalyzer } from "../../electron/core/app-analyzer.js";
import { CoreAnalysisError, CoreErrorCode } from "../../electron/core/errors.js";
import {
  isPlistDictionary,
  PlistV5Adapter,
  type InfoPlistAdapter,
  type PlistValue,
} from "../../electron/core/plist.js";
import { preflightArchiveEntries } from "../../electron/core/safe-path.js";
import { parseSevenZipSlt } from "../../electron/core/sevenzip.js";
import { INFO_PLIST_XML, makeFatMachO } from "./fixtures.js";

class FixturePlistAdapter implements InfoPlistAdapter {
  public readonly id = "fixture";

  public constructor(private readonly executable = "MVMFixture") {}

  public async parse(data: Uint8Array): Promise<PlistValue> {
    assert.match(Buffer.from(data).toString("utf8"), /<plist/u);
    return {
      CFBundleIdentifier: "dev.mvm.fixture",
      CFBundleName: "MVM Fixture",
      CFBundleExecutable: this.executable,
      CFBundlePackageType: "APPL",
      CFBundleShortVersionString: "1.2.3",
      LSMinimumSystemVersion: "12.6",
      LSArchitecturePriority: ["arm64", "x86_64"],
    };
  }
}

async function makeFixtureApp(root: string): Promise<string> {
  const appPath = path.join(root, "Fixture.app");
  const contentsPath = path.join(appPath, "Contents");
  const macOsPath = path.join(contentsPath, "MacOS");
  await mkdir(macOsPath, { recursive: true });
  await writeFile(path.join(contentsPath, "Info.plist"), INFO_PLIST_XML, "utf8");
  await writeFile(path.join(macOsPath, "MVMFixture"), makeFatMachO());
  return appPath;
}

test("direct .app analyzer connects Info.plist metadata to its main Mach-O", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mvm-core-app-"));
  try {
    const appPath = await makeFixtureApp(root);

    const result = await new DirectAppAnalyzer().analyze(appPath);

    assert.equal(result.metadata.bundleIdentifier, "dev.mvm.fixture");
    assert.equal(result.metadata.executable, "MVMFixture");
    assert.deepEqual(result.metadata.architecturePriority, ["arm64", "x86_64"]);
    assert.deepEqual(
      result.mainExecutable.slices.map((slice) => slice.architecture),
      ["x86_64", "arm64e"],
    );
    assert.equal(result.launchability, "not-tested");
    assert.deepEqual(result.findings, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("direct .app analyzer rejects path syntax in CFBundleExecutable", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mvm-core-app-"));
  try {
    const appPath = await makeFixtureApp(root);

    await assert.rejects(
      new DirectAppAnalyzer({
        plistAdapter: new FixturePlistAdapter("../outside"),
      }).analyze(appPath),
      (error: unknown) =>
        error instanceof CoreAnalysisError && error.code === CoreErrorCode.AppLayoutInvalid,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("plist v5 adapter parses the synthetic XML fixture", async () => {
  const parsed = await new PlistV5Adapter().parse(Buffer.from(INFO_PLIST_XML, "utf8"));
  assert.equal(isPlistDictionary(parsed), true);
  if (isPlistDictionary(parsed)) {
    assert.equal(parsed.CFBundleExecutable, "MVMFixture");
  }
});

test("plist v5 adapter keeps binary plist data on the binary API path", async () => {
  const binary = buildBinary({
    CFBundleIdentifier: "dev.mvm.binary-fixture",
    CFBundleExecutable: "BinaryFixture",
  });
  const parsed = await new PlistV5Adapter().parse(binary);

  assert.equal(isPlistDictionary(parsed), true);
  if (isPlistDictionary(parsed)) {
    assert.equal(parsed.CFBundleExecutable, "BinaryFixture");
  }
});

const SAFE_SLT = `Path = fixture.dmg
Type = Dmg
Physical Size = 4096

----------
Path = Fixture.app
Size = 0
Packed Size = 0
Folder = +
Attributes = D
Encrypted = -

Path = Fixture.app\\Contents\\Info.plist
Size = 512
Packed Size = 180
Attributes = A
Encrypted = -

Path = Fixture.app\\Contents\\Frameworks\\Foo.framework\\Versions\\Nested\\Current
Size = 0
Packed Size =
Attributes = A
Symbolic Link = ../A
Encrypted = -
`;

test("7-Zip -slt parser canonicalizes paths and feeds a no-write preflight", () => {
  const parsed = parseSevenZipSlt(SAFE_SLT);

  assert.equal(parsed.archiveFormat, "Dmg");
  assert.equal(parsed.entries.length, 3);
  assert.equal(parsed.entries[1]?.toolReportedPath, "Fixture.app\\Contents\\Info.plist");
  assert.equal(parsed.entries[1]?.normalizedPath, "Fixture.app/Contents/Info.plist");
  assert.equal(parsed.entries[2]?.kind, "symlink");
  assert.equal(parsed.entries[2]?.linkTarget, "../A");

  const summary = preflightArchiveEntries(parsed.entries);
  assert.equal(summary.entryCount, 3);
  assert.equal(summary.totalUnpackedBytes, 512);
  assert.equal(summary.totalPackedBytes, 180);
});

test("7-Zip -slt parser rejects traversal before any extraction is attempted", () => {
  const output = `Path = fixture.pkg
Type = Xar

Path = ..\\outside.exe
Size = 1
Packed Size = 1
Attributes = A
Encrypted = -
`;

  assert.throws(
    () => parseSevenZipSlt(output),
    (error: unknown) =>
      error instanceof CoreAnalysisError && error.code === CoreErrorCode.UnsafePath,
  );
});

test("7-Zip -slt parser fails closed on empty, garbage, partial, or duplicate output", () => {
  const outputs = [
    "",
    "this is not technical listing output",
    "Path = suspicious.app\\payload\nMethod = Copy\n",
    "Path = one\nSize = 1\nSize = 2\n",
  ];

  for (const output of outputs) {
    assert.throws(
      () => parseSevenZipSlt(output),
      (error: unknown) =>
        error instanceof CoreAnalysisError && error.code === CoreErrorCode.ImportToolOutputInvalid,
    );
  }
});
