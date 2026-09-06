import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  DARLING_ASSET_SHA256,
  DARLING_DEB_FILES,
  DARLING_PACKAGE_VERSION,
  DARLING_RELEASE_TAG,
  DarlingInstaller,
  type InstallerProcessRequest,
  type InstallerProcessResult,
  isManagedMarker,
  isWsl2Distribution,
  isWslVersionSupported,
  parseQuietWslDistributions,
  validateDarlingDebListing,
} from "../../electron/darling-installer";
import type { SevenZipListing } from "../../electron/core/index";

function result(stdout = "", exitCode = 0, stderr = ""): InstallerProcessResult {
  return {
    exitCode,
    stdout: Buffer.from(stdout, "utf8"),
    stderr: Buffer.from(stderr, "utf8"),
  };
}

async function installerFixture(
  processRunner: (request: InstallerProcessRequest) => Promise<InstallerProcessResult>,
  fetchImpl?: typeof fetch,
): Promise<{ readonly installer: DarlingInstaller; readonly root: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "mvm-darling-installer-"));
  const systemRoot = path.join(root, "Windows");
  const userDataPath = path.join(root, "user-data");
  await mkdir(path.join(systemRoot, "System32"), { recursive: true });
  await mkdir(userDataPath, { recursive: true });
  await writeFile(path.join(systemRoot, "System32", "wsl.exe"), "fixture", "utf8");
  return {
    root,
    installer: new DarlingInstaller({
      userDataPath,
      resourcesRoot: path.join(root, "resources"),
      localAppData: path.join(root, "local-app-data"),
      systemRoot,
      platform: "win32",
      architecture: "x64",
      processRunner,
      ...(fetchImpl === undefined ? {} : { fetchImpl }),
    }),
  };
}

function cleanPreflightRunner(request: InstallerProcessRequest): Promise<InstallerProcessResult> {
  const args = [...request.args];
  if (args.length === 1 && args[0] === "--version") return Promise.resolve(result("WSL version: 2.6.3.0"));
  if (args.length === 1 && args[0] === "--help") return Promise.resolve(result("--name --location --no-launch"));
  if (args[0] === "--list" && args[1] === "--quiet") return Promise.resolve(result(""));
  if (args[0] === "--terminate" && args[1] === "MVM-Darling") return Promise.resolve(result());
  return Promise.reject(new Error(`Unexpected simulated WSL command: ${args.join(" ")}`));
}

function releaseListing(): SevenZipListing {
  return {
    archivePath: "C:\\cache\\debs_20260608.zip",
    archiveFormat: "zip",
    encryptedEntryCount: 0,
    entryCount: DARLING_DEB_FILES.length + 1,
    totalUnpackedBytes: 100,
    totalPackedBytes: 80,
    tool: {
      executablePath: "C:\\MVM\\7z.exe",
      version: "24.09",
      formats: ["zip"],
      source: "explicit",
    },
    entries: [
      {
        rawPath: "debs_20260609/",
        normalizedPath: "debs_20260609",
        kind: "directory",
        size: 0,
        encrypted: false,
      },
      ...DARLING_DEB_FILES.map((name) => ({
        rawPath: `debs_20260609/${name}`,
        normalizedPath: `debs_20260609/${name}`,
        kind: "file" as const,
        size: 1,
        encrypted: false,
      })),
    ],
  };
}

describe("Darling installer trust manifest", () => {
  it("pins the currently reviewed WSL release", () => {
    expect(DARLING_RELEASE_TAG).toBe("v0.1.20260608");
    expect(DARLING_PACKAGE_VERSION).toBe("0.1.20260609~noble");
    expect(DARLING_ASSET_SHA256).toMatch(/^[0-9a-f]{64}$/u);
    expect(DARLING_DEB_FILES).toHaveLength(21);
    expect(new Set(DARLING_DEB_FILES).size).toBe(21);
    expect(DARLING_DEB_FILES.every((name) => name.endsWith("~noble_amd64.deb"))).toBe(true);
  });

  it("accepts only the exact release ZIP directory and files", () => {
    expect(validateDarlingDebListing(releaseListing())).toHaveLength(21);

    const unexpected = releaseListing();
    const entries = [...unexpected.entries];
    const original = entries[1]!;
    entries[1] = { ...original, rawPath: "debs_20260609/extra.deb", normalizedPath: "debs_20260609/extra.deb" };
    expect(() => validateDarlingDebListing({ ...unexpected, entries })).toThrow(/unexpected package name/u);

    expect(() => validateDarlingDebListing({ ...unexpected, encryptedEntryCount: 1 })).toThrow(/21-package structure/u);
  });

  it("requires the exact MVM ownership marker", () => {
    const marker = {
      owner: "MVM",
      schema: 1,
      base: "ubuntu-24.04",
      darlingRelease: DARLING_RELEASE_TAG,
      darlingPackageVersion: DARLING_PACKAGE_VERSION,
      assetSha256: DARLING_ASSET_SHA256,
      status: "ready",
    };
    expect(isManagedMarker(marker)).toBe(true);
    expect(isManagedMarker({ ...marker, owner: "someone-else" })).toBe(false);
    expect(isManagedMarker({ ...marker, darlingRelease: "latest" })).toBe(false);
    expect(isManagedMarker({ ...marker, status: "unknown" })).toBe(false);
    const { status: _status, ...withoutStatus } = marker;
    expect(isManagedMarker(withoutStatus)).toBe(false);
  });
});

describe("Darling WSL preflight parsing", () => {
  it("enforces WSL 2.4.4 or newer", () => {
    expect(isWslVersionSupported("WSL version: 2.4.4.0")).toBe(true);
    expect(isWslVersionSupported("WSL 2.6.3.0")).toBe(true);
    expect(isWslVersionSupported("WSL version: 2.4.3.0")).toBe(false);
    expect(isWslVersionSupported("not a version")).toBe(false);
  });

  it("parses UTF-16-like quiet names and verifies VERSION 2 exactly", () => {
    const quiet = "M\0V\0M\0-\0D\0a\0r\0l\0i\0n\0g\0\r\0\n\0U\0b\0u\0n\0t\0u\0\r\0\n\0";
    expect(parseQuietWslDistributions(quiet)).toEqual(["MVM-Darling", "Ubuntu"]);

    const verbose = "  NAME              STATE           VERSION\n* MVM-Darling       Stopped         2\n  Ubuntu            Running         2";
    expect(isWsl2Distribution(verbose, "MVM-Darling")).toBe(true);
    expect(isWsl2Distribution(verbose.replace("MVM-Darling       Stopped         2", "MVM-Darling       Stopped         1"), "MVM-Darling")).toBe(false);
    expect(isWsl2Distribution(verbose, "MVM-Darling-Other")).toBe(false);
    expect(isWsl2Distribution("MVM-Darling2      Stopped         2", "MVM-Darling")).toBe(false);
  });
});

describe("Darling installer orchestration", () => {
  it("generates an installable plan without mutating WSL", async () => {
    const calls: readonly string[][] = [];
    const mutableCalls = calls as string[][];
    const fixture = await installerFixture(async (request) => {
      mutableCalls.push([...request.args]);
      return await cleanPreflightRunner(request);
    });
    try {
      const plan = await fixture.installer.preflight();
      expect(plan).toMatchObject({
        canInstall: true,
        distributionName: "MVM-Darling",
        releaseTag: DARLING_RELEASE_TAG,
        packageVersion: DARLING_PACKAGE_VERSION,
      });
      expect(calls.some((args) => args.includes("--install"))).toBe(false);
      expect(calls.some((args) => args.includes("apt-get"))).toBe(false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("fails closed when a same-named distribution lacks the MVM marker", async () => {
    const fixture = await installerFixture(async (request) => {
      const args = [...request.args];
      if (args.length === 1 && args[0] === "--version") return result("WSL version: 2.6.3.0");
      if (args.length === 1 && args[0] === "--help") return result("--name --location --no-launch");
      if (args[0] === "--list" && args[1] === "--quiet") return result("MVM-Darling\nUbuntu\n");
      if (args[0] === "--list" && args[1] === "--verbose") return result("MVM-Darling       Stopped         2\nUbuntu            Running         2\n");
      if (args.includes("cat") && args.includes("/var/lib/mvm/runtime.json")) return result("", 1, "missing");
      throw new Error(`Unexpected simulated WSL command: ${args.join(" ")}`);
    });
    try {
      const plan = await fixture.installer.preflight();
      expect(plan.canInstall).toBe(false);
      expect(plan.blockers.join("\n")).toMatch(/没有有效的 MVM 所有权标记/u);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("cancels a pending pinned download without running WSL mutation commands", async () => {
    let notifyFetchStarted: (() => void) | undefined;
    const fetchStarted = new Promise<void>((resolve) => {
      notifyFetchStarted = resolve;
    });
    const fetchImpl = ((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      notifyFetchStarted?.();
      const signal = init?.signal;
      const cancel = (): void => {
        const error = new Error("simulated download cancel");
        error.name = "AbortError";
        reject(error);
      };
      if (signal?.aborted) cancel();
      else signal?.addEventListener("abort", cancel, { once: true });
    })) as typeof fetch;
    const calls: string[][] = [];
    const fixture = await installerFixture(async (request) => {
      calls.push([...request.args]);
      return await cleanPreflightRunner(request);
    }, fetchImpl);
    let jobId = "";
    fixture.installer.setProgressEmitter((progress) => {
      jobId = progress.jobId;
    });
    try {
      const installation = fixture.installer.install(true);
      await fetchStarted;
      expect(jobId).not.toBe("");
      expect(fixture.installer.cancel(jobId)).toBe(true);
      await expect(installation).resolves.toMatchObject({ completed: false, canceled: true });
      expect(calls.some((args) => args.includes("--install"))).toBe(false);
      expect(calls.some((args) => args.includes("apt-get"))).toBe(false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
