import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  CURRENT_LOCKFILE_VERSION,
  type Lockfile,
  LockfileSchema,
  type Source,
} from "../schemas/lockfile.js";
import { checkSchemaCompatibility, type SchemaCompatibility } from "./schema.js";

// Injected at build time by tsup
declare const __BUILD_VERSION__: string;

const CONFIG_DIR = ".agent-conf";
const LOCKFILE_NAME = "lockfile.json";

export function getLockfilePath(targetDir: string): string {
  return path.join(targetDir, CONFIG_DIR, LOCKFILE_NAME);
}

export interface ReadLockfileResult {
  lockfile: Lockfile;
  schemaCompatibility: SchemaCompatibility;
}

/**
 * Reads and validates the lockfile from a target directory.
 * Returns null if the lockfile doesn't exist.
 *
 * The result includes schema compatibility information that callers should check:
 * - If compatible is false, the CLI should refuse to proceed
 * - If warning is set, the CLI should display it but can continue
 */
export async function readLockfile(targetDir: string): Promise<ReadLockfileResult | null> {
  const lockfilePath = getLockfilePath(targetDir);

  try {
    const content = await fs.readFile(lockfilePath, "utf-8");
    const parsed: unknown = JSON.parse(content);
    const lockfile = LockfileSchema.parse(parsed);

    // Check schema compatibility
    const schemaCompatibility = checkSchemaCompatibility(lockfile.version);

    return { lockfile, schemaCompatibility };
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
  /** Rules content for lockfile tracking */
  rules?: {
    files: string[];
    content_hash: string;
  };
}

export async function writeLockfile(
  targetDir: string,
  options: WriteLockfileOptions,
): Promise<Lockfile> {
  const lockfilePath = getLockfilePath(targetDir);

  const lockfile: Lockfile = {
    version: CURRENT_LOCKFILE_VERSION,
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
      rules: options.rules,
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
 *
 * Note: This is for informational purposes only. The CLI version in lockfile
 * is optional and used for diagnostics, not for enforcing compatibility.
 * Schema version compatibility is enforced separately.
 */
export async function checkCliVersionMismatch(targetDir: string): Promise<VersionMismatch | null> {
  const result = await readLockfile(targetDir);

  // No lockfile means first sync - no mismatch
  if (!result) {
    return null;
  }

  const currentVersion = getCliVersion();
  const lockfileVersion = result.lockfile.cli_version;

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
