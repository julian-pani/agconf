import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type Lockfile, LockfileSchema, type Source } from "../schemas/lockfile.js";

// Injected at build time by tsup
declare const __BUILD_COMMIT__: string;

const CONFIG_DIR = ".agent-conf";
const LOCKFILE_NAME = "lockfile.json";
const CLI_VERSION = "1.0.0";

/**
 * Gets the git commit SHA the CLI was built from.
 */
export function getBuildCommit(): string {
  return typeof __BUILD_COMMIT__ !== "undefined" ? __BUILD_COMMIT__ : "unknown";
}

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
    },
    cli_version: CLI_VERSION,
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
  return CLI_VERSION;
}

export interface VersionMismatch {
  cliCommit: string;
  lockfileCommit: string;
}

/**
 * Checks if the CLI's build commit matches the lockfile's source commit.
 * Returns mismatch info if they differ (CLI is outdated), null otherwise.
 */
export async function checkCliVersionMismatch(targetDir: string): Promise<VersionMismatch | null> {
  const lockfile = await readLockfile(targetDir);

  // No lockfile means first sync - no mismatch
  if (!lockfile) {
    return null;
  }

  // Only check for GitHub sources (local doesn't have a meaningful commit to compare)
  if (lockfile.source.type !== "github") {
    return null;
  }

  const cliCommit = getBuildCommit();
  const lockfileCommit = lockfile.source.commit_sha;

  // If CLI commit is unknown, we can't compare
  if (cliCommit === "unknown") {
    return null;
  }

  // Check if commits match (compare first 7 chars for short SHA compatibility)
  const cliShort = cliCommit.slice(0, 7);
  const lockfileShort = lockfileCommit.slice(0, 7);

  if (cliShort !== lockfileShort) {
    return {
      cliCommit: cliShort,
      lockfileCommit: lockfileShort,
    };
  }

  return null;
}
