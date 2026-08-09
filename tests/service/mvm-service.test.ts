import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { afterEach, describe, expect, test } from "vitest";

import { createStructureFixture } from "../../electron/fixture-builder.js";
import { MvmService, parseWsl2Distributions } from "../../electron/mvm-service.js";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mvm-service-test-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root && path.basename(root).startsWith("mvm-service-test-")) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

describe("MvmService integration", () => {
  test("creates a real local structure fixture and analyzes both slices", async () => {
    const root = await temporaryRoot();
    const service = new MvmService(path.join(root, "state"), path.resolve("resources"));

    const result = await service.createFixture();

    expect(result.error).toBeUndefined();
    expect(result.app?.isFixture).toBe(true);
    expect(result.app?.architectures.map((slice) => slice.name)).toEqual(["x86_64", "arm64"]);
    expect(result.app?.frameworks).toEqual(["AppKit", "Foundation"]);
    expect(result.app?.findings.some((finding) => finding.code === "SOURCE_FIXTURE")).toBe(true);
    expect(result.app?.findings.some((finding) => finding.code === "FIXTURE_NOT_LAUNCHABLE")).toBe(true);
    expect(service.reportJson(result.app!.id)).toContain("io.mvm.report.v1");
  }, 30_000);

  test("imports a ZIP by materializing only Info.plist and the main executable", async () => {
    const root = await temporaryRoot();
    const sourceRoot = path.join(root, "source");
    await mkdir(sourceRoot, { recursive: true });
    const originalBundle = await createStructureFixture(sourceRoot);
    await rename(originalBundle, path.join(sourceRoot, "-Probe.app"));
    const archivePath = path.join(root, "MVM-Probe.zip");
    const sevenZip = path.resolve("resources", "runtime", "7zip", "7z.exe");
    await execFileAsync(sevenZip, ["a", "-tzip", archivePath, "--", "-Probe.app"], {
      cwd: sourceRoot,
      windowsHide: true,
    });
    const service = new MvmService(path.join(root, "state"), path.resolve("resources"));

    const result = await service.importPath(archivePath);

    expect(result.error).toBeUndefined();
    expect(result.app?.sourceKind).toBe("zip");
    expect(result.app?.displayName).toBe("MVM Probe");
    expect(result.app?.architectures).toHaveLength(2);
    expect(result.app?.sourceSha256).toMatch(/^[a-f0-9]{64}$/u);
  }, 30_000);

  test("hashes the complete direct bundle and keeps distinct source paths", async () => {
    const root = await temporaryRoot();
    const firstRoot = path.join(root, "first");
    const secondRoot = path.join(root, "second");
    const stateRoot = path.join(root, "state");
    await Promise.all([mkdir(firstRoot, { recursive: true }), mkdir(secondRoot, { recursive: true }), mkdir(stateRoot, { recursive: true })]);
    const firstBundle = await createStructureFixture(firstRoot);
    const secondBundle = await createStructureFixture(secondRoot);
    await Promise.all([
      mkdir(path.join(firstBundle, "Contents", "Resources"), { recursive: true }),
      mkdir(path.join(secondBundle, "Contents", "Resources"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(firstBundle, "Contents", "Resources", "payload.txt"), "first", "utf8"),
      writeFile(path.join(secondBundle, "Contents", "Resources", "payload.txt"), "second", "utf8"),
    ]);
    const service = new MvmService(stateRoot, path.resolve("resources"));

    const first = await service.importPath(firstBundle);
    const second = await service.importPath(secondBundle);

    expect(first.app?.sourceSha256).not.toBe(second.app?.sourceSha256);
    expect(service.snapshot().apps).toHaveLength(2);
  }, 30_000);

  test("isolates malformed persisted records instead of crashing snapshot", async () => {
    const root = await temporaryRoot();
    const stateRoot = path.join(root, "state");
    await mkdir(stateRoot, { recursive: true });
    await writeFile(
      path.join(stateRoot, "mvm-state.json"),
      JSON.stringify({ schemaVersion: 1, apps: [{ id: "broken", bundlePath: "C:\\broken" }], events: [] }),
      "utf8",
    );
    const service = new MvmService(stateRoot, path.resolve("resources"));

    await service.initialize();

    expect(service.snapshot().apps).toEqual([]);
    expect(service.snapshot().events[0]?.title).toBe("已隔离无效本地状态");
  }, 30_000);

  test("rejects UNC paths before filesystem access", async () => {
    const root = await temporaryRoot();
    const service = new MvmService(path.join(root, "state"), path.resolve("resources"));

    const result = await service.importPath("\\\\server\\share\\Probe.app");

    expect(result.error?.code).toBe("INPUT_DEVICE_PATH_REJECTED");
  });

  test("removes the managed input copy after a failed archive import", async () => {
    const root = await temporaryRoot();
    const stateRoot = path.join(root, "state");
    const fakeArchive = path.join(root, "broken.zip");
    await writeFile(fakeArchive, "not a zip", "utf8");
    const service = new MvmService(stateRoot, path.resolve("resources"));

    const result = await service.importPath(fakeArchive);

    expect(result.error?.code).toBe("EXTENSION_MAGIC_MISMATCH");
    expect(await readdir(path.join(stateRoot, "imports"))).toEqual([]);
  });
});

describe("WSL probe parsing", () => {
  test("selects only VERSION 2 distributions", () => {
    const output = "  NAME            STATE           VERSION\r\n* Ubuntu          Running         2\r\n  Legacy          Stopped         1\r\n  docker-desktop  Running         2\r\n";
    expect(parseWsl2Distributions(output)).toEqual(["Ubuntu"]);
  });
});
