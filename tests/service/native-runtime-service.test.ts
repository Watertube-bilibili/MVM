import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { copyFile, mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { afterEach, describe, expect, test } from "vitest";

import { createStructureFixture } from "../../electron/fixture-builder.js";
import { MvmService } from "../../electron/mvm-service.js";
import { parseMachOImage } from "../../electron/native-runtime/index.js";

const execFileAsync = promisify(execFile);
const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mvm-native-service-test-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop();
    if (root && path.basename(root).startsWith("mvm-native-service-test-")) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

describe("MvmService native Windows runtime", () => {
  test("executes the first-party LC_MAIN fixture to 42 without a WSL backend", async () => {
    const root = await temporaryRoot();
    const service = new MvmService(path.join(root, "state"), path.resolve("resources"), {showAlert:async()=>0});

    const imported = await service.createFixture();
    expect(imported.error).toBeUndefined();
    expect(imported.app?.launchability).toBe("blocked");

    const result = await service.runNative(imported.app!.id);

    expect(result).toMatchObject({
      status: "completed",
      code: "OK",
      backend: "native-windows-ir",
      returnValue: "42",
      exitCode: 42,
    });
    expect(result.executedInstructionCount).toBeGreaterThan(0);
    expect(service.snapshot().runtime.selectedBackend).toBe("native-windows");
    expect(service.snapshot().events[0]?.title).toBe("Mac 应用运行结束");
    expect(result.dialogsShown).toBe(1);
    expect(result.stdout).toContain("NSAlert host bridge completed.");
  }, 30_000);

  test("returns a bounded result for an unknown app id", async () => {
    const root = await temporaryRoot();
    const service = new MvmService(path.join(root, "state"), path.resolve("resources"));

    const result = await service.runNative("missing-app");

    expect(result).toMatchObject({
      status: "blocked",
      code: "APP_RECORD_NOT_FOUND",
      translatedInstructionCount: 0,
      executedInstructionCount: 0,
    });
  });

  test("keeps an imported record when guest code is unsupported", async () => {
    const root = await temporaryRoot();
    const sourceRoot = path.join(root, "source");
    const bundlePath = await createStructureFixture(sourceRoot);
    const executablePath = path.join(bundlePath, "Contents", "MacOS", "MVMProbe");
    const executable = await readFile(executablePath);
    const image = parseMachOImage(executable);
    executable[image.entryFileOffset] = 0x62;
    await writeFile(executablePath, executable);
    const service = new MvmService(path.join(root, "state"), path.resolve("resources"));

    const imported = await service.importPath(bundlePath);
    const result = await service.runNative(imported.app!.id);

    expect(result.status).toBe("unsupported");
    expect(result.code).toBe("UNSUPPORTED_OPCODE");
    expect(service.snapshot().apps.some((app) => app.id === imported.app!.id)).toBe(true);
    expect(service.snapshot().events[0]?.title).toBe("Windows 兼容引擎暂不支持");
  }, 30_000);

  test("imports and runs the exact direct bundle in one gated operation", async () => {
    const root = await temporaryRoot();
    const bundlePath = await createStructureFixture(path.join(root, "source"));
    const service = new MvmService(path.join(root, "state"), path.resolve("resources"));

    const result = await service.importAndRunNative(bundlePath);

    expect(result.importResult.app?.id).toBe(result.runResult?.appId);
    expect(result.runResult).toMatchObject({
      status: "completed",
      returnValue: "42",
      exitCode: 42,
    });
  }, 30_000);

  test("imports compiled code and resources from ZIP and runs its NSAlert", async () => {
    const root = await temporaryRoot();
    const sourceRoot = path.join(root, "source");
    await mkdir(sourceRoot, { recursive: true });
    const originalBundle = await createStructureFixture(sourceRoot);
    await copyFile(path.resolve('resources/samples/MVMProbe'),path.join(originalBundle,'Contents/MacOS/MVMProbe'));
    await mkdir(path.join(originalBundle,'Contents/Resources'),{recursive:true});
    await writeFile(path.join(originalBundle,'Contents/Resources/message.txt'),'ZIP resources reached the Mac executable.');
    await rename(originalBundle, path.join(sourceRoot, "Probe.app"));
    const archivePath = path.join(root, "Probe.zip");
    await execFileAsync(
      path.resolve("resources", "runtime", "7zip", "7z.exe"),
      ["a", "-tzip", archivePath, "--", "Probe.app"],
      { cwd: sourceRoot, windowsHide: true },
    );
    const service = new MvmService(path.join(root, "state"), path.resolve("resources"), {showAlert:async()=>0});

    const result = await service.importAndRunNative(archivePath);

    expect(result.importResult.app?.findings.some((finding) => finding.code === "ARCHIVE_STATIC_IMPORT_ONLY")).toBe(true);
    expect(result.runResult).toMatchObject({
      status: "completed",
      returnValue: "42",
      exitCode: 42,
      dialogsShown: 1,
    });
    expect(result.runResult?.stdout).toContain('ZIP resources reached the Mac executable.');
  }, 30_000);

  test("persists the terminal native event", async () => {
    const root = await temporaryRoot();
    const stateRoot = path.join(root, "state");
    const service = new MvmService(stateRoot, path.resolve("resources"), {showAlert:async()=>0});
    const imported = await service.createFixture();
    await service.runNative(imported.app!.id);

    const restored = new MvmService(stateRoot, path.resolve("resources"));
    await restored.initialize();

    expect(restored.snapshot().events.some((event) => event.title === "Mac 应用运行结束")).toBe(true);
  }, 30_000);
});
