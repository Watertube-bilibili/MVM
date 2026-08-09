import path from "node:path";

import { CoreErrorCode, coreError } from "./errors.js";
import type {
  ArchiveEntryDescriptor,
  ArchivePreflightSummary,
} from "./model.js";

export const UnsafePathReason = {
  Empty: "EMPTY_PATH",
  Nul: "NUL_CHARACTER",
  Control: "CONTROL_CHARACTER",
  Absolute: "ABSOLUTE_PATH",
  Drive: "WINDOWS_DRIVE_PATH",
  Unc: "UNC_PATH",
  Backslash: "BACKSLASH_SEPARATOR",
  Traversal: "PARENT_TRAVERSAL",
  EmptyComponent: "EMPTY_COMPONENT",
  AlternateDataStream: "NTFS_ALTERNATE_DATA_STREAM",
  ReservedName: "WINDOWS_RESERVED_NAME",
  TrailingDotOrSpace: "TRAILING_DOT_OR_SPACE",
  ComponentTooLong: "COMPONENT_TOO_LONG",
  PathTooLong: "PATH_TOO_LONG",
} as const;

export type UnsafePathReason =
  (typeof UnsafePathReason)[keyof typeof UnsafePathReason];

export interface ArchivePathLimits {
  readonly maxPathBytes: number;
  readonly maxComponentBytes: number;
  readonly maxEntries: number;
  readonly maxExpandedBytes: number;
}

export const DEFAULT_ARCHIVE_PATH_LIMITS: ArchivePathLimits = {
  maxPathBytes: 4096,
  maxComponentBytes: 255,
  maxEntries: 250_000,
  maxExpandedBytes: 32 * 1024 * 1024 * 1024,
};

export interface ArchivePathValidation {
  readonly safe: boolean;
  readonly rawPath: string;
  readonly normalizedPath?: string;
  readonly reasons: readonly UnsafePathReason[];
}

export interface LinkTargetValidation extends ArchivePathValidation {
  readonly resolvedTarget?: string;
}

export type ArchiveLinkTargetMode = "relative" | "archive-root";

const RESERVED_WINDOWS_COMPONENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const WINDOWS_DRIVE_PREFIX = /^[a-z]:/iu;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function uniqueReasons(reasons: readonly UnsafePathReason[]): UnsafePathReason[] {
  return [...new Set(reasons)];
}

export function validateArchivePath(
  rawPath: string,
  limits: Pick<ArchivePathLimits, "maxPathBytes" | "maxComponentBytes"> =
    DEFAULT_ARCHIVE_PATH_LIMITS,
): ArchivePathValidation {
  const reasons: UnsafePathReason[] = [];

  if (rawPath.length === 0) {
    reasons.push(UnsafePathReason.Empty);
  }
  if (rawPath.includes("\0")) {
    reasons.push(UnsafePathReason.Nul);
  }
  if (CONTROL_CHARACTER.test(rawPath)) {
    reasons.push(UnsafePathReason.Control);
  }
  if (rawPath.startsWith("/")) {
    reasons.push(UnsafePathReason.Absolute);
  }
  if (rawPath.startsWith("\\\\") || rawPath.startsWith("//")) {
    reasons.push(UnsafePathReason.Unc);
  }
  if (WINDOWS_DRIVE_PREFIX.test(rawPath)) {
    reasons.push(UnsafePathReason.Drive);
  }
  if (rawPath.includes("\\")) {
    reasons.push(UnsafePathReason.Backslash);
  }
  if (utf8Bytes(rawPath) > limits.maxPathBytes) {
    reasons.push(UnsafePathReason.PathTooLong);
  }

  const withoutTrailingSlash = rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
  const rawComponents = withoutTrailingSlash.split("/");
  const normalizedComponents: string[] = [];

  for (const [index, component] of rawComponents.entries()) {
    // Dot segments are aliases of the same filesystem location.  Canonicalize
    // them everywhere (not just an initial "./") so collision checks cannot
    // be bypassed with paths such as Foo/./Info.plist.
    if (component === ".") {
      continue;
    }
    if (component === "..") {
      reasons.push(UnsafePathReason.Traversal);
      continue;
    }
    if (component.length === 0) {
      if (!(index === 0 && rawPath.length === 0)) {
        reasons.push(UnsafePathReason.EmptyComponent);
      }
      continue;
    }
    if (component.includes(":")) {
      reasons.push(UnsafePathReason.AlternateDataStream);
    }
    if (component.endsWith(".") || component.endsWith(" ")) {
      reasons.push(UnsafePathReason.TrailingDotOrSpace);
    }
    if (RESERVED_WINDOWS_COMPONENT.test(component)) {
      reasons.push(UnsafePathReason.ReservedName);
    }
    if (utf8Bytes(component) > limits.maxComponentBytes) {
      reasons.push(UnsafePathReason.ComponentTooLong);
    }
    normalizedComponents.push(component);
  }

  const normalizedPath = normalizedComponents.join("/");
  if (normalizedPath.length === 0) {
    reasons.push(UnsafePathReason.Empty);
  }

  const deduplicated = uniqueReasons(reasons);
  return {
    safe: deduplicated.length === 0,
    rawPath,
    ...(normalizedPath.length === 0 ? {} : { normalizedPath }),
    reasons: deduplicated,
  };
}

export function validateArchiveLinkTarget(
  entryPath: string,
  rawTarget: string,
  limits: Pick<ArchivePathLimits, "maxPathBytes" | "maxComponentBytes"> =
    DEFAULT_ARCHIVE_PATH_LIMITS,
  mode: ArchiveLinkTargetMode = "relative",
): LinkTargetValidation {
  const directValidation = validateArchivePath(rawTarget, limits);
  // A relative link may legitimately contain ".." (for example a framework
  // link under Versions/Current).  Whether that traversal is safe can only be
  // decided after resolving it against the link's parent.  Retain every other
  // lexical rejection here and add Traversal below only if resolution escapes
  // the virtual extraction root.
  const reasons: UnsafePathReason[] = mode === "relative"
    ? directValidation.reasons.filter((reason) => reason !== UnsafePathReason.Traversal)
    : [...directValidation.reasons];

  if (rawTarget.startsWith("/") || WINDOWS_DRIVE_PREFIX.test(rawTarget)) {
    reasons.push(UnsafePathReason.Absolute);
  }

  const entryValidation = validateArchivePath(entryPath, limits);
  if (!entryValidation.safe || entryValidation.normalizedPath === undefined) {
    return {
      safe: false,
      rawPath: rawTarget,
      reasons: uniqueReasons([...reasons, ...entryValidation.reasons]),
    };
  }


  if (mode === "archive-root") {
    const deduplicated = uniqueReasons(reasons);
    return {
      safe: deduplicated.length === 0,
      rawPath: rawTarget,
      ...(directValidation.normalizedPath === undefined
        ? {}
        : {
            normalizedPath: directValidation.normalizedPath,
            resolvedTarget: directValidation.normalizedPath,
          }),
      reasons: deduplicated,
    };
  }

  const stack = entryValidation.normalizedPath.split("/").slice(0, -1);
  for (const component of rawTarget.split("/")) {
    if (component === "" || component === ".") {
      continue;
    }
    if (component === "..") {
      if (stack.length === 0) {
        reasons.push(UnsafePathReason.Traversal);
      } else {
        stack.pop();
      }
      continue;
    }
    stack.push(component);
  }

  const resolvedTarget = stack.join("/");
  const resolvedValidation = validateArchivePath(resolvedTarget, limits);
  reasons.push(...resolvedValidation.reasons);
  const deduplicated = uniqueReasons(reasons);

  return {
    safe: deduplicated.length === 0,
    rawPath: rawTarget,
    ...(directValidation.normalizedPath === undefined
      ? {}
      : { normalizedPath: directValidation.normalizedPath }),
    ...(resolvedTarget.length === 0 ? {} : { resolvedTarget }),
    reasons: deduplicated,
  };
}

function windowsCollisionKey(normalizedPath: string): string {
  return normalizedPath.normalize("NFC").toLowerCase();
}

export function preflightArchiveEntries(
  entries: readonly ArchiveEntryDescriptor[],
  limits: ArchivePathLimits = DEFAULT_ARCHIVE_PATH_LIMITS,
): ArchivePreflightSummary {
  if (entries.length > limits.maxEntries) {
    throw coreError(
      CoreErrorCode.LimitEntryCount,
      "indexing",
      "Archive contains more entries than the configured safety limit.",
      { entryCount: entries.length, maxEntries: limits.maxEntries },
    );
  }

  let totalUnpackedBytes = 0;
  let totalPackedBytes = 0;
  const collisionMap = new Map<string, string>();
  const entryByCollisionKey = new Map<string, ArchiveEntryDescriptor>();

  for (const entry of entries) {
    const validation = validateArchivePath(entry.rawPath, limits);
    if (!validation.safe || validation.normalizedPath === undefined) {
      throw coreError(CoreErrorCode.UnsafePath, "indexing", "Archive contains an unsafe path.", {
        path: entry.rawPath,
        reasons: validation.reasons,
      });
    }

    if (validation.normalizedPath !== entry.normalizedPath) {
      throw coreError(
        CoreErrorCode.ImportToolOutputInvalid,
        "indexing",
        "Archive entry normalization is inconsistent.",
        {
          path: entry.rawPath,
          expected: validation.normalizedPath,
          actual: entry.normalizedPath,
        },
      );
    }

    if (entry.linkTarget !== undefined) {
      if (entry.kind !== "symlink" && entry.kind !== "hardlink") {
        throw coreError(
          CoreErrorCode.ImportToolOutputInvalid,
          "indexing",
          "Only symbolic-link and hard-link entries may declare a link target.",
          { path: entry.rawPath, kind: entry.kind },
        );
      }
      const target = validateArchiveLinkTarget(
        entry.normalizedPath,
        entry.linkTarget,
        limits,
        entry.kind === "hardlink" ? "archive-root" : "relative",
      );
      if (!target.safe) {
        throw coreError(CoreErrorCode.UnsafeLink, "indexing", "Archive contains an unsafe link.", {
          path: entry.rawPath,
          target: entry.linkTarget,
          reasons: target.reasons,
        });
      }
    } else if (entry.kind === "symlink" || entry.kind === "hardlink") {
      throw coreError(
        CoreErrorCode.ImportToolOutputInvalid,
        "indexing",
        "Link entry is missing its target.",
        { path: entry.rawPath, kind: entry.kind },
      );
    }

    const collisionKey = windowsCollisionKey(entry.normalizedPath);
    const previous = collisionMap.get(collisionKey);
    if (previous === entry.normalizedPath) {
      throw coreError(
        CoreErrorCode.DuplicateArchivePath,
        "indexing",
        "Archive contains the same normalized path more than once.",
        { path: entry.normalizedPath },
      );
    }
    if (previous !== undefined) {
      throw coreError(
        CoreErrorCode.WindowsPathCollision,
        "indexing",
        "Archive contains paths that collide on Windows.",
        { first: previous, second: entry.normalizedPath },
      );
    }
    collisionMap.set(collisionKey, entry.normalizedPath);
    entryByCollisionKey.set(collisionKey, entry);

    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw coreError(
        CoreErrorCode.ImportToolOutputInvalid,
        "indexing",
        "Archive entry has an invalid unpacked size.",
        { path: entry.rawPath, size: entry.size },
      );
    }

    totalUnpackedBytes += entry.size;
    if (!Number.isSafeInteger(totalUnpackedBytes)) {
      throw coreError(
        CoreErrorCode.LimitExpandedBytes,
        "indexing",
        "Archive expanded size exceeds the JavaScript safe integer range.",
      );
    }
    if (totalUnpackedBytes > limits.maxExpandedBytes) {
      throw coreError(
        CoreErrorCode.LimitExpandedBytes,
        "indexing",
        "Archive expanded size exceeds the configured safety limit.",
        { totalUnpackedBytes, maxExpandedBytes: limits.maxExpandedBytes },
      );
    }

    if (entry.packedSize !== undefined) {
      if (!Number.isSafeInteger(entry.packedSize) || entry.packedSize < 0) {
        throw coreError(
          CoreErrorCode.ImportToolOutputInvalid,
          "indexing",
          "Archive entry has an invalid packed size.",
          { path: entry.rawPath, packedSize: entry.packedSize },
        );
      }
      totalPackedBytes += entry.packedSize;
      if (!Number.isSafeInteger(totalPackedBytes)) {
        throw coreError(
          CoreErrorCode.ImportToolOutputInvalid,
          "indexing",
          "Archive packed size exceeds the JavaScript safe integer range.",
        );
      }
    }
  }

  // A file or link cannot also be an ancestor directory. Check this after the
  // complete set is indexed so the result is independent of archive order and
  // uses Windows case/Unicode collision semantics.
  for (const entry of entries) {
    if (entry.kind === "hardlink" && entry.linkTarget !== undefined) {
      const target = validateArchiveLinkTarget(
        entry.normalizedPath,
        entry.linkTarget,
        limits,
        "archive-root",
      );
      const targetEntry = target.resolvedTarget === undefined
        ? undefined
        : entryByCollisionKey.get(windowsCollisionKey(target.resolvedTarget));
      if (targetEntry === undefined || targetEntry.kind !== "file") {
        throw coreError(
          CoreErrorCode.ImportToolOutputInvalid,
          "indexing",
          "Hard-link target must name a regular file in the same archive.",
          {
            path: entry.normalizedPath,
            target: entry.linkTarget,
            targetKind: targetEntry?.kind ?? null,
          },
        );
      }
    }

    const components = entry.normalizedPath.split("/");
    for (let length = 1; length < components.length; length += 1) {
      const prefix = components.slice(0, length).join("/");
      const ancestor = entryByCollisionKey.get(windowsCollisionKey(prefix));
      if (ancestor !== undefined && ancestor.kind !== "directory") {
        throw coreError(
          CoreErrorCode.ArchivePathTypeConflict,
          "indexing",
          "Archive places a child beneath a non-directory entry.",
          {
            ancestor: ancestor.normalizedPath,
            ancestorKind: ancestor.kind,
            child: entry.normalizedPath,
          },
        );
      }
    }
  }

  return {
    entryCount: entries.length,
    totalUnpackedBytes,
    totalPackedBytes,
    entries,
  };
}

export function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
