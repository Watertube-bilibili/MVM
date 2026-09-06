import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  NativeFileBridge,
  NativeFileBridgeCode,
  NativeFileBridgeError,
} from "../../electron/native-runtime/index.js";

function hasBridgeCode(code: string): (error: unknown) => boolean {
  return (error: unknown): boolean =>
    error instanceof NativeFileBridgeError && error.code === code;
}

test("NativeFileBridge reads only explicit guest-relative paths", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "mvm-bridge-read-"));
  try {
    await mkdir(path.join(temporaryRoot, "Documents"));
    await writeFile(path.join(temporaryRoot, "Documents", "hello.txt"), "hello");
    const bridge = new NativeFileBridge({ rootPath: temporaryRoot });

    const bytes = await bridge.readFile("Documents/hello.txt");
    assert.equal(Buffer.from(bytes).toString("utf8"), "hello");
    assert.equal(bridge.totalBytesRead, 5);
    assert.equal(bridge.mount.readOnly, true);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("NativeFileBridge rejects traversal, absolute, UNC, device, ADS, and NUL paths", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "mvm-bridge-path-"));
  try {
    const bridge = new NativeFileBridge({ rootPath: temporaryRoot });
    const rejected = [
      "../outside.txt",
      "folder/../../outside.txt",
      "C:\\Windows\\win.ini",
      "\\\\server\\share\\file",
      "\\\\?\\C:\\Windows\\win.ini",
      "safe.txt:stream",
      "NUL.txt",
      "bad\0name",
    ];
    for (const guestPath of rejected) {
      await assert.rejects(
        bridge.resolveGuestPath(guestPath),
        hasBridgeCode(NativeFileBridgeCode.GuestPathInvalid),
      );
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("NativeFileBridge rejects a symlink or junction that resolves outside its root", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "mvm-bridge-link-"));
  try {
    const root = path.join(temporaryRoot, "root");
    const outside = path.join(temporaryRoot, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.txt"), "secret");
    await symlink(outside, path.join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
    const bridge = new NativeFileBridge({ rootPath: root });

    await assert.rejects(
      bridge.readFile("escape/secret.txt"),
      hasBridgeCode(NativeFileBridgeCode.PathEscape),
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("NativeFileBridge enforces per-file and cumulative byte limits", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "mvm-bridge-limit-"));
  try {
    await writeFile(path.join(temporaryRoot, "a.bin"), Buffer.alloc(5, 1));
    await writeFile(path.join(temporaryRoot, "b.bin"), Buffer.alloc(5, 2));

    const perFile = new NativeFileBridge({
      rootPath: temporaryRoot,
      maxFileBytes: 4,
      maxTotalBytes: 8,
    });
    await assert.rejects(
      perFile.readFile("a.bin"),
      hasBridgeCode(NativeFileBridgeCode.FileTooLarge),
    );

    const cumulative = new NativeFileBridge({
      rootPath: temporaryRoot,
      maxFileBytes: 5,
      maxTotalBytes: 8,
    });
    await cumulative.readFile("a.bin");
    await assert.rejects(
      cumulative.readFile("b.bin"),
      hasBridgeCode(NativeFileBridgeCode.TotalLimit),
    );
    assert.equal(cumulative.totalBytesRead, 5);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("NativeFileBridge refuses relative roots", () => {
  assert.throws(
    () => new NativeFileBridge({ rootPath: "relative-root" }),
    hasBridgeCode(NativeFileBridgeCode.RootInvalid),
  );
});
