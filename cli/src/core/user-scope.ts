/**
 * User-scope sync: project the canonical **global instructions block** into a
 * developer's per-user harness files instead of committing it into every repo.
 *
 * - Claude: `~/.claude/CLAUDE.md`
 * - Codex:  `~/.codex/AGENTS.md`
 *
 * agconf owns only its marker block (`<!-- {prefix}:global:start/end -->`) in
 * those files; everything else (the developer's personal instructions) is
 * preserved. The company block is pure canonical content — identical to the
 * repo-scope global block — so freshness verification reuses the same marker
 * hashing (`hasGlobalBlockChanges`).
 *
 * A git-tracked store at `~/.agconf/` holds the user lockfile, a `global.md`
 * mirror (for readable `git diff`s across updates), a never-overwritten
 * `USER.md` (the personal layer), and timestamped `backups/` of any drifted or
 * unmanaged harness file that a projection would overwrite.
 *
 * All paths derive from an injectable `homeDir` so this is testable against a
 * temp directory. See cli/docs/DISTRIBUTION_SCOPES.md (F1/F3/F4).
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { readLockfile, writeLockfile } from "./lockfile.js";
import {
  buildGlobalBlock,
  computeGlobalBlockHash,
  getMarkers,
  hasGlobalBlockChanges,
  isAgentsMdManaged,
} from "./markers.js";
import type { ResolvedSource } from "./source.js";
import type { Target } from "./targets.js";

const execFileAsync = promisify(execFile);

/** How many timestamped backup directories to retain in the store. */
const MAX_BACKUPS = 10;

/** Per-user harness instruction file, relative to the home directory. */
const USER_INSTRUCTION_FILE: Record<Target, string> = {
  claude: path.join(".claude", "CLAUDE.md"),
  codex: path.join(".codex", "AGENTS.md"),
};

/**
 * Personal-layer reference appended once beneath the company block on first
 * projection (then left alone / user-owned). Claude natively imports it; Codex
 * has no import, so it gets a plain instruction to read the file.
 */
const PERSONAL_LINE: Record<Target, string> = {
  claude: "@~/.agconf/USER.md",
  codex: "For personal preferences, read ~/.agconf/USER.md if it exists.",
};

const USER_MD_SCAFFOLD = `# Personal agent instructions

This file is yours. agconf created it once and will never overwrite it.
Put your personal preferences here — they layer on top of the company standards
that agconf manages in the block above (Claude imports this file; on Codex it is
referenced by a note).
`;

export interface UserPaths {
  homeDir: string;
  /** The git-tracked store: ~/.agconf */
  storeDir: string;
  /** Canonical global-content mirror in the store (for readable diffs). */
  globalMdPath: string;
  /** Never-overwritten personal file. */
  userMdPath: string;
  /** Timestamped pre-overwrite backups. */
  backupsDir: string;
}

export function getUserPaths(homeDir: string = os.homedir()): UserPaths {
  const storeDir = path.join(homeDir, ".agconf");
  return {
    homeDir,
    storeDir,
    globalMdPath: path.join(storeDir, "global.md"),
    userMdPath: path.join(storeDir, "USER.md"),
    backupsDir: path.join(storeDir, "backups"),
  };
}

/** Absolute path of a target's per-user instruction file. */
export function getUserInstructionFile(homeDir: string, target: Target): string {
  return path.join(homeDir, USER_INSTRUCTION_FILE[target]);
}

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Upsert the canonical global block into an existing file, preserving all other
 * content. On first projection (no existing block) the block is prepended, with
 * `personalLine` beneath it; on re-sync only the block region is replaced.
 * Pure function — safe to unit test.
 */
export function projectGlobalBlock(
  existing: string,
  canonicalContent: string,
  opts: { markerPrefix: string; personalLine?: string },
): string {
  const markers = getMarkers(opts.markerPrefix);
  const block = buildGlobalBlock(canonicalContent, {}, { prefix: opts.markerPrefix });

  const startIdx = existing.indexOf(markers.globalStart);
  const endIdx = existing.indexOf(markers.globalEnd);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    // Replace the existing managed block in place; keep everything around it.
    const before = existing.slice(0, startIdx);
    const after = existing.slice(endIdx + markers.globalEnd.length);
    return `${before}${block}${after}`;
  }

  // Fresh file (or no managed block yet): prepend the block + personal line.
  const personal = opts.personalLine ? `${opts.personalLine}\n\n` : "";
  const rest = existing.trim() ? `${existing.trim()}\n` : "";
  return `${block}\n\n${personal}${rest}`.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** Whether a to-be-overwritten file should be backed up first: it exists and is
 * either unmanaged (has content but no agconf block) or has manual drift. */
function needsBackup(existing: string, markerPrefix: string): boolean {
  if (existing.trim() === "") return false;
  if (!isAgentsMdManaged(existing, { prefix: markerPrefix })) return true; // unmanaged content
  return hasGlobalBlockChanges(existing, { prefix: markerPrefix }); // managed but edited
}

async function backupFile(
  backupsDir: string,
  target: Target,
  filePath: string,
  content: string,
  stamp: string,
): Promise<string> {
  const dir = path.join(backupsDir, stamp);
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, `${target}-${path.basename(filePath)}`);
  await fs.writeFile(dest, content, "utf-8");
  return dest;
}

/** Keep only the most recent MAX_BACKUPS timestamped backup directories. */
async function rotateBackups(backupsDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(backupsDir);
  } catch {
    return;
  }
  const dirs = entries.filter((e) => !e.startsWith(".")).sort(); // ISO stamps sort chronologically
  const excess = dirs.slice(0, Math.max(0, dirs.length - MAX_BACKUPS));
  for (const d of excess) {
    await fs.rm(path.join(backupsDir, d), { recursive: true, force: true });
  }
}

/** Create USER.md once. Returns true if it was created (never overwrites). */
async function scaffoldUserMd(userMdPath: string): Promise<boolean> {
  if (await pathExists(userMdPath)) return false;
  await fs.mkdir(path.dirname(userMdPath), { recursive: true });
  await fs.writeFile(userMdPath, USER_MD_SCAFFOLD, "utf-8");
  return true;
}

/** Best-effort: init the store as a git repo (once) and commit any changes. */
async function commitStore(storeDir: string, message: string): Promise<boolean> {
  try {
    if (!(await pathExists(path.join(storeDir, ".git")))) {
      await execFileAsync("git", ["init", "-q"], { cwd: storeDir });
    }
    await execFileAsync("git", ["add", "-A"], { cwd: storeDir });
    const status = await execFileAsync("git", ["status", "--porcelain"], { cwd: storeDir });
    if (!status.stdout.trim()) return false;
    await execFileAsync(
      "git",
      [
        "-c",
        "user.email=agconf@local",
        "-c",
        "user.name=agconf",
        "commit",
        "-q",
        "--no-verify",
        "-m",
        message,
      ],
      { cwd: storeDir },
    );
    return true;
  } catch {
    return false; // git unavailable or misconfigured — non-fatal
  }
}

export interface UserSyncFileResult {
  target: Target;
  path: string;
  created: boolean;
  changed: boolean;
  /** Absolute path of the pre-overwrite backup, if one was taken. */
  backedUp?: string;
}

export interface UserSyncResult {
  storeDir: string;
  files: UserSyncFileResult[];
  userMdCreated: boolean;
  committed: boolean;
  globalBlockHash: string;
}

export interface UserSyncOptions {
  targets: Target[];
  /** Home directory (default: os.homedir()). For testability. */
  homeDir?: string;
  pinnedVersion?: string;
  /** ISO timestamp for backups (default: now). For deterministic tests. */
  now?: string;
}

/**
 * Project the canonical global block into the developer's per-user harness files
 * and record the result in the `~/.agconf` store.
 */
export async function syncUserScope(
  source: ResolvedSource,
  options: UserSyncOptions,
): Promise<UserSyncResult> {
  const homeDir = options.homeDir ?? os.homedir();
  const paths = getUserPaths(homeDir);
  const markerPrefix = source.markerPrefix;
  const stamp = (options.now ?? new Date().toISOString()).replace(/[:.]/g, "-");

  const canonical = (await fs.readFile(source.agentsMdPath, "utf-8")).trim();

  await fs.mkdir(paths.storeDir, { recursive: true });
  await fs.writeFile(paths.globalMdPath, `${canonical}\n`, "utf-8");
  const userMdCreated = await scaffoldUserMd(paths.userMdPath);

  const files: UserSyncFileResult[] = [];
  for (const target of options.targets) {
    const filePath = getUserInstructionFile(homeDir, target);
    const existing = await readIfExists(filePath);
    const created = existing === null;
    const existingContent = existing ?? "";

    let backedUp: string | undefined;
    if (!created && needsBackup(existingContent, markerPrefix)) {
      backedUp = await backupFile(paths.backupsDir, target, filePath, existingContent, stamp);
    }

    const newContent = projectGlobalBlock(existingContent, canonical, {
      markerPrefix,
      personalLine: PERSONAL_LINE[target],
    });
    const changed = newContent !== existingContent;
    if (changed) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, newContent, "utf-8");
    }
    files.push({ target, path: filePath, created, changed, ...(backedUp ? { backedUp } : {}) });
  }

  await rotateBackups(paths.backupsDir);

  // User lockfile lands at ~/.agconf/lockfile.json (writeLockfile keys off <dir>/.agconf).
  const lockfileOptions: Parameters<typeof writeLockfile>[1] = {
    source: source.source,
    globalBlockContent: canonical,
    skills: [],
    targets: options.targets,
    markerPrefix,
  };
  if (options.pinnedVersion) lockfileOptions.pinnedVersion = options.pinnedVersion;
  await writeLockfile(homeDir, lockfileOptions);

  const committed = await commitStore(paths.storeDir, `agconf: user-scope sync ${stamp}`);

  return {
    storeDir: paths.storeDir,
    files,
    userMdCreated,
    committed,
    globalBlockHash: computeGlobalBlockHash(canonical),
  };
}

export interface UserCheckResult {
  hasLockfile: boolean;
  /** Files whose managed block was edited or removed. */
  modified: Array<{ target: Target; path: string }>;
  /** Files tracked in the lockfile but absent on disk. */
  missing: Array<{ target: Target; path: string }>;
  ok: boolean;
}

/**
 * Verify the integrity of the user-scope managed block in each harness file
 * against the store lockfile. Mirrors the downstream `check`, at user scope.
 */
export async function checkUserScope(options: { homeDir?: string }): Promise<UserCheckResult> {
  const homeDir = options.homeDir ?? os.homedir();
  const lock = await readLockfile(homeDir);
  if (!lock) {
    return { hasLockfile: false, modified: [], missing: [], ok: true };
  }

  const markerPrefix = lock.lockfile.content.marker_prefix ?? "agconf";
  const targets = (lock.lockfile.content.targets ?? ["claude"]) as Target[];
  const modified: UserCheckResult["modified"] = [];
  const missing: UserCheckResult["missing"] = [];

  for (const target of targets) {
    if (target !== "claude" && target !== "codex") continue;
    const filePath = getUserInstructionFile(homeDir, target);
    const content = await readIfExists(filePath);
    if (content === null) {
      missing.push({ target, path: filePath });
      continue;
    }
    // Managed block removed, or content edited away from the stored hash.
    if (
      !isAgentsMdManaged(content, { prefix: markerPrefix }) ||
      hasGlobalBlockChanges(content, { prefix: markerPrefix })
    ) {
      modified.push({ target, path: filePath });
    }
  }

  return {
    hasLockfile: true,
    modified,
    missing,
    ok: modified.length === 0 && missing.length === 0,
  };
}
