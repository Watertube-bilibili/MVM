import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  NativeRuntimeCode,
  runMachOBytes,
  runMachOExecutable,
} from "../../electron/native-runtime/index.js";
import {
  ENTRY_OFFSET,
  LC_MAIN_OFFSET,
  makeFatExecutable,
  makeThinX64Executable,
  RETURN_42_PROGRAM,
} from "./fixtures.js";

test("LC_MAIN is decoded to MVM IR and returns 42 without native execution", () => {
  const result = runMachOBytes(makeThinX64Executable(RETURN_42_PROGRAM));

  assert.equal(result.status, "completed");
  if (result.status !== "completed") {
    return;
  }
  assert.equal(result.returnValue, "42");
  assert.equal(result.exitCode, 42);
  assert.equal(result.entryOffset, ENTRY_OFFSET);
  assert.equal(result.entryFileOffset, ENTRY_OFFSET);
  assert.equal(result.translatedInstructionCount, 13);
  assert.equal(result.executedInstructionCount, 13);
});

test("fat Mach-O validation selects and reports the x86_64 slice", () => {
  const fixture = makeFatExecutable(RETURN_42_PROGRAM);
  const result = runMachOBytes(fixture.bytes);

  assert.equal(result.status, "completed");
  assert.equal(result.selectedSliceOffset, fixture.x64Offset);
  assert.equal(result.selectedSliceSize, fixture.x64Size);
  assert.equal(result.entryFileOffset, fixture.x64Offset + ENTRY_OFFSET);
});

test("byte-swapped fat Mach-O selects the x86_64 slice", () => {
  const fixture = makeFatExecutable(RETURN_42_PROGRAM, "little");
  const result = runMachOBytes(fixture.bytes);

  assert.equal(result.status, "completed");
  assert.equal(result.selectedSliceOffset, fixture.x64Offset);
  assert.equal(result.selectedSliceSize, fixture.x64Size);
});

test("fat Mach-O validation blocks overlapping slices before selection", () => {
  const fixture = makeFatExecutable(RETURN_42_PROGRAM);
  fixture.bytes.writeUInt32BE(fixture.armOffset, 36);
  const result = runMachOBytes(fixture.bytes);

  assert.equal(result.status, "blocked");
  assert.equal(result.code, NativeRuntimeCode.MachOMalformed);
});

test("LC_MAIN outside the executable __TEXT mapping is blocked", () => {
  const bytes = makeThinX64Executable([0xc3]);
  bytes.writeBigUInt64LE(BigInt(bytes.byteLength + 1), LC_MAIN_OFFSET + 8);
  const result = runMachOBytes(bytes);

  assert.equal(result.status, "blocked");
  assert.equal(result.code, NativeRuntimeCode.EntryPointInvalid);
});

test("a physically truncated load-command table is blocked", () => {
  const bytes = makeThinX64Executable([0xc3]).subarray(0, LC_MAIN_OFFSET + 8);
  const result = runMachOBytes(bytes);

  assert.equal(result.status, "blocked");
  assert.equal(result.code, NativeRuntimeCode.MachOMalformed);
});

test("truncated instructions are blocked at the __TEXT address boundary", () => {
  const result = runMachOBytes(makeThinX64Executable([0xb8, 0x01, 0x02]));

  assert.equal(result.status, "blocked");
  assert.equal(result.code, NativeRuntimeCode.AddressBounds);
});

test("unknown opcodes fail closed as unsupported before execution", () => {
  const result = runMachOBytes(makeThinX64Executable([0x62, 0xc3]));

  assert.equal(result.status, "unsupported");
  assert.equal(result.code, NativeRuntimeCode.UnsupportedOpcode);
  assert.equal(result.executedInstructionCount, 0);
});

test("syscall and software interrupt instructions are explicitly blocked", () => {
  for (const code of [[0x0f, 0x05, 0xc3], [0x48, 0x0f, 0x05, 0xc3], [0xcd, 0x80, 0xc3]]) {
    const result = runMachOBytes(makeThinX64Executable(code));
    assert.equal(result.status, "blocked");
    assert.equal(result.code, NativeRuntimeCode.ForbiddenInstruction);
    assert.equal(result.executedInstructionCount, 0);
  }
});

test("instruction budget stops a translated program deterministically", () => {
  const result = runMachOBytes(makeThinX64Executable([0x90, 0x90, 0x90, 0xc3]), {
    instructionBudget: 2,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.code, NativeRuntimeCode.InstructionBudgetExceeded);
  assert.equal(result.executedInstructionCount, 2);
});

test("Mach-O file byte limit is enforced before parsing", () => {
  const result = runMachOBytes(makeThinX64Executable([0xc3]), { maxFileBytes: 64 });

  assert.equal(result.status, "blocked");
  assert.equal(result.code, NativeRuntimeCode.FileTooLarge);
});

test("isolated stack bounds and stack balance are enforced", () => {
  const overflow = runMachOBytes(makeThinX64Executable([0x48, 0x83, 0xec, 0x7f, 0xc3]), {
    stackBytes: 64,
  });
  assert.equal(overflow.status, "blocked");
  assert.equal(overflow.code, NativeRuntimeCode.StackBounds);

  const unbalanced = runMachOBytes(makeThinX64Executable([0x55, 0xc3]));
  assert.equal(unbalanced.status, "blocked");
  assert.equal(unbalanced.code, NativeRuntimeCode.UnbalancedStack);
});

test("file entry point performs a bounded stable read and reports a read-only mount", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "mvm-native-run-"));
  try {
    const appRoot = path.join(temporaryRoot, "Fixture.app");
    const executablePath = path.join(appRoot, "Contents", "MacOS", "Fixture");
    await mkdir(path.dirname(executablePath), { recursive: true });
    await writeFile(executablePath, makeThinX64Executable(RETURN_42_PROGRAM));

    const result = await runMachOExecutable(executablePath, {
      executableRoot: appRoot,
      fileBridgeRoot: appRoot,
      instructionBudget: 100,
    });

    assert.equal(result.status, "completed");
    assert.equal(result.mount?.hostRoot, appRoot);
    assert.equal(result.mount?.readOnly, true);
    assert.equal(result.mount?.guestRoot, "/mvm/shared");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("file entry point rejects a symbolic-link executable", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "mvm-native-link-"));
  try {
    const target = path.join(temporaryRoot, "target");
    const link = path.join(temporaryRoot, "link");
    if (process.platform === "win32") {
      await mkdir(target);
      await symlink(target, link, "junction");
    } else {
      await writeFile(target, makeThinX64Executable([0xc3]));
      await symlink(target, link, "file");
    }

    const result = await runMachOExecutable(link, { executableRoot: temporaryRoot });
    assert.equal(result.status, "blocked");
    assert.equal(result.code, NativeRuntimeCode.InputInvalid);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
