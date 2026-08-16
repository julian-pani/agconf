/**
 * User-scope sync: project the canonical company content into a developer's
 * per-user harness locations instead of committing it into every repo.
 *
 * - **instructions** (global block): `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`
 * - **skills**: `~/.claude/skills/`, `~/.agents/skills/` (Codex)
 * - **subagents**: `~/.claude/agents/*.md`, `~/.codex/agents/*.toml`
 * - **rules**: `~/.claude/rules/*.md` (Claude); a rules section inside
 *   `~/.codex/AGENTS.md` (Codex)
 *
 * These per-user paths are exactly `<homeDir>/<the repo-scope relative path>`,
 * so skills/agents/rules reuse the repo-scope sync functions with
 * `targetDir = homeDir` — no separate placement logic. agconf owns only its
 * marker block / managed files; the developer's own content is preserved. The
 * company block is pure canonical (same hashing as repo scope), so freshness
 * verification reuses `hasGlobalBlockChanges` and the managed-file checks.
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
import fg from "fast-glob";
import { toMetadataPrefix } from "../utils/prefix.js";
import { readLockfileSafe, writeLockfile } from "./lockfile.js";
import {
  checkAgentFiles,
  checkCodexAgentFiles,
  checkRuleFiles,
  checkSkillFiles,
  type ExpectedManagedContent,
  findOrphanedManagedFiles,
} from "./managed-content.js";
import {
  buildGlobalBlock,
  computeGlobalBlockHash,
  getMarkers,
  hasGlobalBlockChanges,
  hasRulesSectionChanges,
  isAgentsMdManaged,
  parseRulesSection,
} from "./markers.js";
import type { ResolvedSource } from "./source.js";
import {
  deleteOrphanedAgents,
  deleteOrphanedRules,
  deleteOrphanedSkills,
  detectUnmanagedCollisions,
  findOrphanedAgents,
  findOrphanedRules,
  findOrphanedSkills,
  syncAgents,
  syncRules,
  syncSkillsToTarget,
} from "./sync.js";
import { getSkillsDir, getTargetConfig, type Target } from "./targets.js";

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
 * Top-level skill directory names in the canonical skills dir. A missing dir
 * yields `[]` (fast-glob does not throw on a nonexistent cwd); a real read error
 * propagates rather than being swallowed — the same fail-safe stance as repo
 * scope, so a transient error can never masquerade as "0 skills" and trigger
 * orphan cleanup that deletes every managed skill.
 */
async function discoverSkillNames(skillsPath: string): Promise<string[]> {
  const dirs = await fg("*/", { cwd: skillsPath, onlyDirectories: true, deep: 1 });
  return dirs.map((d) => d.replace(/\/$/, "")).sort();
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
  // Only the generated header (block + personal line) is blank-line-normalized;
  // the user's own content (`rest`) is appended verbatim so their intentional
  // spacing is preserved.
  const personal = opts.personalLine ? `${opts.personalLine}\n\n` : "";
  const header = `${block}\n\n${personal}`.replace(/\n{3,}/g, "\n\n");
  const rest = existing.trim() ? `${existing.trim()}\n` : "";
  return `${header}${rest}`.trimEnd() + "\n";
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

/**
 * Copy each given home-relative path (a file or, for skills, a directory) into
 * the timestamped backup set before a projection overwrites it or orphan cleanup
 * deletes it. Used for three destructive cases at user scope: the developer's own
 * divergent *unmanaged* content, a *managed* file they edited locally, and files
 * about to be orphan-deleted. Unlike repo scope — which aborts on a divergent
 * unmanaged file unless `--override` — user scope runs unattended, so it never
 * aborts: it preserves the original in the git-tracked store, then proceeds
 * (INV-4: no destructive write without a backup). Best-effort and deduped; a
 * missing/unreadable source is skipped, never blocking the sync.
 */
async function backupPaths(
  backupsDir: string,
  homeDir: string,
  relPaths: string[],
  stamp: string,
): Promise<string[]> {
  const backedUp: string[] = [];
  for (const relPath of [...new Set(relPaths)]) {
    const src = path.join(homeDir, relPath);
    const dest = path.join(backupsDir, stamp, relPath);
    try {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.cp(src, dest, { recursive: true });
      backedUp.push(dest);
    } catch {
      // Best-effort: a missing/unreadable source must not break the sync.
    }
  }
  return backedUp;
}

/**
 * Machine-local artifacts in the store that should not be versioned. The store
 * is `git init`'d and committed for readable diffs of the *company block* and
 * lockfile; backups, logs, and autosync run-state are transient noise.
 */
const STORE_GITIGNORE = `# agconf store — machine-local artifacts (do not version)
backups/
logs/
autosync-state.json
.lock
`;

/** Write the store's .gitignore once (idempotent; leaves an edited one alone). */
async function ensureStoreGitignore(storeDir: string): Promise<void> {
  const gitignorePath = path.join(storeDir, ".gitignore");
  if (await pathExists(gitignorePath)) return;
  await fs.writeFile(gitignorePath, STORE_GITIGNORE, "utf-8");
}

/** A user-scope sync could not start because another one holds the store lock. */
export class StoreBusyError extends Error {
  constructor() {
    super("Another agconf user-scope sync is already running");
    this.name = "StoreBusyError";
  }
}

/** How long a held lock is considered stale (a crashed run) and may be stolen. */
const LOCK_STALE_MS = 10 * 60_000;

interface StoreLock {
  release: () => Promise<void>;
}

/**
 * Acquire an exclusive advisory lock on the store so the two unattended triggers
 * (session-start + a scheduled run) and a manual sync can never mutate the
 * harness files / lockfile / git store concurrently. Uses an atomic O_EXCL
 * create; a lock older than {@link LOCK_STALE_MS} (a crashed holder) is stolen.
 * Returns null if a live lock is held. `nowMs` is injectable for tests.
 */
async function acquireStoreLock(storeDir: string, nowMs: number): Promise<StoreLock | null> {
  const lockPath = path.join(storeDir, ".lock");
  await fs.mkdir(storeDir, { recursive: true });
  const release = async () => {
    await fs.rm(lockPath, { force: true });
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await fs.open(lockPath, "wx"); // O_CREAT | O_EXCL — atomic
      await fh.write(String(nowMs));
      await fh.close();
      return { release };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const heldMs = Number((await fs.readFile(lockPath, "utf-8").catch(() => "")) || "0");
      if (!heldMs || nowMs - heldMs > LOCK_STALE_MS) {
        await fs.rm(lockPath, { force: true }); // stale — steal it, then retry once
        continue;
      }
      return null; // held by a live run
    }
  }
  return null;
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
  /** Skill names projected to user scope. */
  skills: string[];
  /** Rule relative paths projected. */
  rules: string[];
  /** Agent relative paths projected. */
  agents: string[];
  /** Content removed as orphans (deleted from canonical since the last sync). */
  removed: { skills: string[]; rules: string[]; agents: string[] };
  /**
   * Absolute paths of pre-overwrite backups taken for the developer's own
   * divergent, unmanaged skill/rule/agent content (empty in the common case).
   */
  contentBackups: string[];
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
 * Project the canonical company content into the developer's per-user harness
 * files and record the result in the `~/.agconf` store. Serialized by an advisory
 * store lock so the unattended triggers (session-start + a scheduled run) and a
 * manual sync can never mutate the harness files / lockfile / git store
 * concurrently. Throws {@link StoreBusyError} if another run holds the lock.
 */
export async function syncUserScope(
  source: ResolvedSource,
  options: UserSyncOptions,
): Promise<UserSyncResult> {
  const homeDir = options.homeDir ?? os.homedir();
  const { storeDir } = getUserPaths(homeDir);
  const parsedNow = Date.parse(options.now ?? "");
  const nowMs = Number.isNaN(parsedNow) ? Date.now() : parsedNow;
  const lock = await acquireStoreLock(storeDir, nowMs);
  if (!lock) throw new StoreBusyError();
  try {
    return await syncUserScopeLocked(source, options);
  } finally {
    await lock.release();
  }
}

async function syncUserScopeLocked(
  source: ResolvedSource,
  options: UserSyncOptions,
): Promise<UserSyncResult> {
  const homeDir = options.homeDir ?? os.homedir();
  const paths = getUserPaths(homeDir);
  const markerPrefix = source.markerPrefix;
  const stamp = (options.now ?? new Date().toISOString()).replace(/[:.]/g, "-");

  const canonical = (await fs.readFile(source.agentsMdPath, "utf-8")).trim();
  const metadataPrefix = toMetadataPrefix(markerPrefix);
  // Previous user lockfile — its content lists drive orphan cleanup after sync.
  // A corrupt store lockfile reads as "none" so the sync self-heals (rewrites it)
  // instead of throwing, and orphan cleanup sees an empty previous set (deletes
  // nothing) rather than misfiring.
  const previous = (await readLockfileSafe(homeDir))?.lockfile;

  await fs.mkdir(paths.storeDir, { recursive: true });
  await ensureStoreGitignore(paths.storeDir);
  await fs.writeFile(paths.globalMdPath, `${canonical}\n`, "utf-8");
  const userMdCreated = await scaffoldUserMd(paths.userMdPath);

  const files: UserSyncFileResult[] = [];
  for (const target of options.targets) {
    const filePath = getUserInstructionFile(homeDir, target);
    const existing = await readIfExists(filePath);
    const created = existing === null;
    const existingContent = existing ?? "";

    // Back up the instruction file if its managed block drifted / is unmanaged,
    // or (Codex) if the rules section embedded in the same file drifted — since
    // the rules projection below would otherwise overwrite that edit unbacked.
    const rulesSectionDrift =
      target === "codex" &&
      parseRulesSection(existingContent, { prefix: markerPrefix }).hasMarkers &&
      hasRulesSectionChanges(existingContent, { prefix: markerPrefix });
    let backedUp: string | undefined;
    if (!created && (needsBackup(existingContent, markerPrefix) || rulesSectionDrift)) {
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

  // Content projection (skills/agents/rules). Guard first: back up anything the
  // projection would overwrite that carries the developer's own work — a
  // divergent *unmanaged* file (from the collision guard) OR a *managed* file
  // they edited locally (drift, from the check helpers). Byte-identical managed
  // files are left alone (canonical owns them; nothing is lost). INV-4.
  const skills = await discoverSkillNames(source.skillsPath);
  const metaOpt = { metadataPrefix };
  const collisions = await detectUnmanagedCollisions(
    homeDir,
    source,
    options.targets,
    skills,
    metadataPrefix,
    Boolean(source.agentsPath),
  );
  const driftedManaged: string[] = [];
  for (const s of await checkSkillFiles(homeDir, options.targets, metaOpt)) {
    if (s.isManaged && s.hasChanges) driftedManaged.push(path.dirname(s.path)); // the skill dir
  }
  for (const r of await checkRuleFiles(homeDir, options.targets, metaOpt)) {
    if (r.isManaged && r.hasChanges) driftedManaged.push(r.path);
  }
  if (options.targets.includes("claude")) {
    for (const a of await checkAgentFiles(homeDir, metaOpt)) {
      if (a.isManaged && a.hasChanges) driftedManaged.push(a.path);
    }
  }
  if (options.targets.includes("codex")) {
    for (const a of await checkCodexAgentFiles(homeDir, metaOpt)) {
      if (a.isManaged && a.hasChanges) driftedManaged.push(a.path);
    }
  }
  const contentBackups = await backupPaths(
    paths.backupsDir,
    homeDir,
    [...collisions.conflicts.map((c) => c.path), ...driftedManaged],
    stamp,
  );

  // Skills → user dirs. The per-target skill sync writes to
  // `<homeDir>/<config.skillsDir>` — i.e. ~/.claude/skills and ~/.agents/skills.
  for (const target of options.targets) {
    await syncSkillsToTarget(
      homeDir,
      source.skillsPath,
      skills,
      getTargetConfig(target),
      markerPrefix,
    );
  }

  // Subagents → ~/.claude/agents/*.md and ~/.codex/agents/*.toml.
  let agents: string[] = [];
  let agentsHash = "";
  if (source.agentsPath) {
    const result = await syncAgents({
      sourceAgentsPath: source.agentsPath,
      targetDir: homeDir,
      targets: options.targets,
      metadataPrefix,
    });
    agents = result.agents.map((a) => a.relativePath);
    agentsHash = result.contentHash;
  }

  // Rules → Claude ~/.claude/rules/*.md; Codex a rules section inside
  // ~/.codex/AGENTS.md (which already holds the projected global block).
  let rules: string[] = [];
  let rulesHash = "";
  if (source.rulesPath) {
    const codexFile = getUserInstructionFile(homeDir, "codex");
    const codexContent = options.targets.includes("codex")
      ? ((await readIfExists(codexFile)) ?? "")
      : "";
    const result = await syncRules({
      sourceRulesPath: source.rulesPath,
      targetDir: homeDir,
      targets: options.targets,
      markerPrefix,
      metadataPrefix,
      agentsMdContent: codexContent,
    });
    rules = result.rules.map((r) => r.relativePath);
    rulesHash = result.contentHash;
    if (result.updatedAgentsMd && options.targets.includes("codex")) {
      await fs.writeFile(codexFile, result.updatedAgentsMd, "utf-8");
    }
  }

  // User lockfile lands at ~/.agconf/lockfile.json (writeLockfile keys off <dir>/.agconf).
  const lockfileOptions: Parameters<typeof writeLockfile>[1] = {
    source: source.source,
    globalBlockContent: canonical,
    skills,
    targets: options.targets,
    markerPrefix,
  };
  if (options.pinnedVersion) lockfileOptions.pinnedVersion = options.pinnedVersion;
  if (rules.length > 0) {
    lockfileOptions.rules = { files: rules, content_hash: rulesHash };
  }
  if (agents.length > 0) {
    lockfileOptions.agents = { files: agents, content_hash: agentsHash };
  }
  await writeLockfile(homeDir, lockfileOptions);

  // Orphan cleanup: content dropped from canonical is removed from user scope
  // (auto — the store is git-tracked and backed up, so no prompt is needed).
  const prevSkills = previous?.content.skills ?? [];
  const prevRules = previous?.content.rules?.files ?? [];
  const prevAgents = previous?.content.agents?.files ?? [];
  const orphanSkills = findOrphanedSkills(prevSkills, skills);
  const orphanRules = findOrphanedRules(prevRules, rules);
  const orphanAgents = findOrphanedAgents(prevAgents, agents);

  // Back up every orphaned managed file before deleting it (INV-4). Per-target
  // paths that don't exist on disk are skipped by backupPaths.
  const orphanRelPaths: string[] = [];
  for (const name of orphanSkills) {
    for (const t of options.targets) orphanRelPaths.push(path.join(getSkillsDir(t), name));
  }
  for (const rp of orphanRules) orphanRelPaths.push(path.join(".claude", "rules", rp));
  for (const ap of orphanAgents) {
    orphanRelPaths.push(path.join(".claude", "agents", ap));
    orphanRelPaths.push(path.join(".codex", "agents", ap.replace(/\.md$/, ".toml")));
  }
  await backupPaths(paths.backupsDir, homeDir, orphanRelPaths, stamp);

  const orphanOpt = { metadataPrefix };
  const removedSkills = await deleteOrphanedSkills(
    homeDir,
    orphanSkills,
    options.targets,
    prevSkills,
    orphanOpt,
  );
  const removedRules = await deleteOrphanedRules(
    homeDir,
    orphanRules,
    options.targets,
    prevRules,
    orphanOpt,
  );
  const removedAgents = await deleteOrphanedAgents(
    homeDir,
    orphanAgents,
    options.targets,
    prevAgents,
    orphanOpt,
  );

  // Rotate once, after all of this run's backups (instruction + content + orphan)
  // have landed in the same timestamped set.
  await rotateBackups(paths.backupsDir);

  const committed = await commitStore(paths.storeDir, `agconf: user-scope sync ${stamp}`);

  return {
    storeDir: paths.storeDir,
    files,
    userMdCreated,
    committed,
    globalBlockHash: computeGlobalBlockHash(canonical),
    skills,
    rules,
    agents,
    removed: {
      skills: removedSkills.deleted,
      rules: removedRules.deleted,
      agents: removedAgents.deleted,
    },
    contentBackups,
  };
}

export interface UserCheckResult {
  hasLockfile: boolean;
  /** Files whose managed block/content was edited (absolute paths). */
  modified: Array<{ target: Target; path: string }>;
  /** Files tracked in the lockfile but absent on disk (absolute paths). */
  missing: Array<{ target: Target; path: string }>;
  /**
   * Managed skill/rule/agent files still on disk that the lockfile no longer
   * lists — dropped from canonical but never cleaned up (absolute paths).
   */
  ghosts: Array<{ target: Target; path: string }>;
  ok: boolean;
}

/**
 * Verify the integrity of the user-scope managed block in each harness file
 * against the store lockfile. Mirrors the downstream `check`, at user scope.
 */
export async function checkUserScope(options: { homeDir?: string }): Promise<UserCheckResult> {
  const homeDir = options.homeDir ?? os.homedir();
  const lock = await readLockfileSafe(homeDir);
  if (!lock) {
    return { hasLockfile: false, modified: [], missing: [], ghosts: [], ok: true };
  }

  const markerPrefix = lock.lockfile.content.marker_prefix ?? "agconf";
  const targets = (lock.lockfile.content.targets ?? ["claude"]) as Target[];
  const modified: UserCheckResult["modified"] = [];
  const missing: UserCheckResult["missing"] = [];
  const ghosts: UserCheckResult["ghosts"] = [];

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

  // Skills / rules / agents drift — reuse the repo-scope managed-file checks at
  // homeDir (the per-user paths line up: ~/.claude/skills, ~/.agents/skills,
  // etc.). Their paths are relative to homeDir; absolutize so every reported
  // path is consistent with the instruction-file entries above.
  const metaOpt = { metadataPrefix: toMetadataPrefix(markerPrefix) };
  const inferTarget = (p: string): Target =>
    p.includes(".codex") || p.includes(".agents") ? "codex" : "claude";
  const abs = (p: string): string => path.join(homeDir, p);

  for (const s of await checkSkillFiles(homeDir, targets, metaOpt)) {
    if (s.isManaged && s.hasChanges)
      modified.push({ target: inferTarget(s.path), path: abs(s.path) });
  }
  for (const r of await checkRuleFiles(homeDir, targets, metaOpt)) {
    if (r.isManaged && r.hasChanges) modified.push({ target: "claude", path: abs(r.path) });
  }
  if (targets.includes("claude")) {
    for (const a of await checkAgentFiles(homeDir, metaOpt)) {
      if (a.isManaged && a.hasChanges) modified.push({ target: "claude", path: abs(a.path) });
    }
  }
  if (targets.includes("codex")) {
    for (const a of await checkCodexAgentFiles(homeDir, metaOpt)) {
      if (a.isManaged && a.hasChanges) modified.push({ target: "codex", path: abs(a.path) });
    }
    // Codex rules live in a section inside ~/.codex/AGENTS.md.
    const codexContent = await readIfExists(getUserInstructionFile(homeDir, "codex"));
    if (
      codexContent &&
      parseRulesSection(codexContent, { prefix: markerPrefix }).hasMarkers &&
      hasRulesSectionChanges(codexContent, { prefix: markerPrefix })
    ) {
      modified.push({ target: "codex", path: getUserInstructionFile(homeDir, "codex") });
    }
  }

  // Reconcile managed files on disk against the lockfile's expected set: ghosts
  // (dropped from canonical but never cleaned up) and content missing (a tracked
  // skill/rule/agent deleted from disk). Mirrors the repo-scope `check`.
  const expected: ExpectedManagedContent = {
    skills: lock.lockfile.content.skills ?? [],
    rules: lock.lockfile.content.rules?.files ?? [],
    agents: lock.lockfile.content.agents?.files ?? [],
  };
  const orphans = await findOrphanedManagedFiles(homeDir, targets, expected, metaOpt);
  for (const g of orphans.ghosts) ghosts.push({ target: inferTarget(g.path), path: abs(g.path) });
  for (const m of orphans.missing) missing.push({ target: inferTarget(m.path), path: abs(m.path) });

  return {
    hasLockfile: true,
    modified,
    missing,
    ghosts,
    ok: modified.length === 0 && missing.length === 0 && ghosts.length === 0,
  };
}
