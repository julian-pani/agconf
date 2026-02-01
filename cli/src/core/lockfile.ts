import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type Lockfile, LockfileSchema, type Source } from "../schemas/lockfile.js";

// Injected at build time by tsup
declare const __BUILD_VERSION__: string;

const CONFIG_DIR = ".agent-conf";
const LOCKFILE_NAME = "lockfile.json";

export function getLockfilePath(targetDir: string): string {
  return path.join(targetDir, CONFIG_DIR, LOCKFILE_NAME);
}

export async function readLockfile(targetDir: string): Promise<Lockfile | null> {
  const lockfilePath = getLockfilePath(targetDir);

  try {
    const content = await fs.readFile(lockfilePath, "utf-8");
    const parsed: unknown = JSON.parse(content);
    return LockfileSchema.parse(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export interface WriteLockfileOptions {
  source: Source;
  globalBlockContent: string;
  skills: string[];
  targets?: string[];
  pinnedVersion?: string;
  /** Marker prefix used for managed content (default: "agent-conf") */
  markerPrefix?: string;
}

export async function writeLockfile(
  targetDir: string,
  options: WriteLockfileOptions,
): Promise<Lockfile> {
  const lockfilePath = getLockfilePath(targetDir);

  const lockfile: Lockfile = {
    version: "1",
    pinned_version: options.pinnedVersion,
    synced_at: new Date().toISOString(),
    source: options.source,
    content: {
      agents_md: {
        global_block_hash: hashContent(options.globalBlockContent),
        merged: true,
      },
      skills: options.skills,
      targets: options.targets ?? ["claude"],
      marker_prefix: options.markerPrefix,
    },
    cli_version: getCliVersion(),
  };

  await fs.mkdir(path.dirname(lockfilePath), { recursive: true });
  await fs.writeFile(lockfilePath, `${JSON.stringify(lockfile, null, 2)}\n`, "utf-8");

  return lockfile;
}

export function hashContent(content: string): string {
  const hash = createHash("sha256").update(content).digest("hex");
  return `sha256:${hash.slice(0, 12)}`;
}

export function getCliVersion(): string {
  return typeof __BUILD_VERSION__ !== "undefined" ? __BUILD_VERSION__ : "0.0.0";
}

export interface VersionMismatch {
  currentVersion: string;
  lockfileVersion: string;
}

/**
 * Checks if the installed CLI version is older than the version used to sync.
 * Returns mismatch info if CLI is outdated, null otherwise.
 */
export async function checkCliVersionMismatch(targetDir: string): Promise<VersionMismatch | null> {
  const lockfile = await readLockfile(targetDir);

  // No lockfile means first sync - no mismatch
  if (!lockfile) {
    return null;
  }

  const currentVersion = getCliVersion();
  const lockfileVersion = lockfile.cli_version;

  // Can't compare if either version is missing/invalid
  if (!currentVersion || !lockfileVersion) {
    return null;
  }

  // Compare versions: warn if lockfile was synced with a newer CLI
  // Simple semver comparison (major.minor.patch)
  const current = currentVersion.split(".").map(Number);
  const lockfile_ = lockfileVersion.split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    if ((lockfile_[i] || 0) > (current[i] || 0)) {
      return {
        currentVersion,
        lockfileVersion,
      };
    }
    if ((current[i] || 0) > (lockfile_[i] || 0)) {
      return null; // Current is newer, no warning needed
    }
  }

  return null; // Versions are equal
}
