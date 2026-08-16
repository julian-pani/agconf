import * as os from "node:os";
import pc from "picocolors";
import { getSyncStatusSafe } from "../core/sync.js";
import {
  checkUserScope,
  getUserPaths,
  StoreBusyError,
  syncUserScope,
  type UserSyncResult,
} from "../core/user-scope.js";
import { compareVersions, getLatestReleaseSafe } from "../core/version.js";
import { removeTempDir } from "../utils/fs.js";
import { createLogger } from "../utils/logger.js";
import {
  parseAndValidateTargets,
  resolveSource,
  resolveVersion,
  type SharedSyncOptions,
} from "./shared.js";

export interface UserScopeSyncOptions extends SharedSyncOptions {
  /** Home directory override (default: os.homedir()). For testability. */
  home?: string;
}

/** Thrown when a user-scope sync has no source (no flag, no store lockfile). */
export class NoUserScopeSourceError extends Error {
  constructor() {
    super(
      "No canonical source. Pass --source <owner/repo> or --local [path] the first time you sync at user scope.",
    );
    this.name = "NoUserScopeSourceError";
  }
}

export interface RunUserScopeSyncResult {
  /** The sync result, or null when skipped because already up to date. */
  result: UserSyncResult | null;
  upToDate: boolean;
  pinnedVersion?: string | undefined;
}

/**
 * Resolve the source (from flags or the store lockfile) and project it into the
 * user scope — the print-free core shared by `sync --scope user` and `autosync`.
 * Throws {@link NoUserScopeSourceError} when there is no source to sync from.
 *
 * With `skipIfUpToDate`, returns early (no clone, no writes) when the store is
 * already at or ahead of the latest canonical version — the auto-sync fast path.
 */
export async function runUserScopeSync(
  options: UserScopeSyncOptions & { skipIfUpToDate?: boolean; throwOnResolveError?: boolean },
): Promise<RunUserScopeSyncResult> {
  const homeDir = options.home ?? os.homedir();
  // Safe read: a corrupt store lockfile degrades to "not synced" (self-heals on
  // this sync) rather than throwing out of the unattended runner.
  const status = await getSyncStatusSafe(homeDir);

  const targetsFromLockfile = status.lockfile?.content.targets;
  const targets = await parseAndValidateTargets(
    options.target ?? (targetsFromLockfile?.length ? targetsFromLockfile : undefined),
  );

  // Recover the source from the store lockfile on re-sync (GitHub or local).
  let sourceRepo = options.source;
  let localOpt = options.local;
  if (!sourceRepo && localOpt === undefined && status.lockfile) {
    if (status.lockfile.source.type === "github") {
      sourceRepo = status.lockfile.source.repository;
    } else if (status.lockfile.source.type === "local") {
      localOpt = status.lockfile.source.path;
    }
  }
  if (!sourceRepo && localOpt === undefined) {
    throw new NoUserScopeSourceError();
  }

  const optionsWithSource: SharedSyncOptions = {
    ...options,
    ...(sourceRepo ? { source: sourceRepo } : {}),
    ...(localOpt !== undefined ? { local: localOpt } : {}),
  };
  const resolvedVersion = await resolveVersion(optionsWithSource, status, "sync", sourceRepo);

  // Fast path for auto-sync: the store is already current, so don't clone/write.
  const pinned = status.lockfile?.pinned_version;
  if (
    options.skipIfUpToDate &&
    pinned &&
    resolvedVersion.version &&
    compareVersions(pinned, resolvedVersion.version) >= 0
  ) {
    return { result: null, upToDate: true, pinnedVersion: pinned };
  }

  const { resolvedSource, tempDir } = await resolveSource(
    optionsWithSource,
    resolvedVersion,
    options.throwOnResolveError,
  );
  try {
    const result = await syncUserScope(resolvedSource, {
      targets,
      homeDir,
      ...(resolvedVersion.version ? { pinnedVersion: resolvedVersion.version } : {}),
    });
    return { result, upToDate: false, pinnedVersion: resolvedVersion.version };
  } finally {
    if (tempDir) await removeTempDir(tempDir);
  }
}

export interface FreshnessProbe {
  /** The store is behind canonical's latest release. */
  behind: boolean;
  /** The store's currently-synced version (when known). */
  current?: string;
  /** Canonical's latest release version (when known). */
  latest?: string;
}

export interface ProbeFreshnessOptions {
  /** Home directory (default: os.homedir()). */
  home?: string;
  /** Abort the network lookup after this many ms (default 3000). */
  timeoutMs?: number;
  /** Test seam: resolve canonical's latest version (default: a bounded GH lookup). */
  fetchLatest?: (repo: string, timeoutMs: number) => Promise<string | null>;
}

/**
 * Cheap, bounded, NON-BLOCKING freshness check: compare the store's synced
 * version against canonical's latest RELEASE via a lightweight, abortable API
 * lookup (NOT a clone, and NOT the blocking `execSync`/unbounded-fetch path in
 * `resolveVersion`). Only meaningful for a GitHub source; a local source, no
 * releases, missing token, offline, or a timeout all return `{ behind: false }`.
 * Never throws — used at session start to decide whether to nudge the developer.
 */
export async function probeUserScopeFreshness(
  options: ProbeFreshnessOptions = {},
): Promise<FreshnessProbe> {
  const homeDir = options.home ?? os.homedir();
  const timeoutMs = options.timeoutMs ?? 3000;
  const fetchLatest =
    options.fetchLatest ??
    (async (repo, ms) => (await getLatestReleaseSafe(repo, ms))?.version ?? null);
  try {
    const status = await getSyncStatusSafe(homeDir);
    const pinned = status.lockfile?.pinned_version;
    if (!status.lockfile || !pinned || status.lockfile.source.type !== "github") {
      return { behind: false };
    }
    const latest = await fetchLatest(status.lockfile.source.repository, timeoutMs);
    if (!latest) return { behind: false };
    return { behind: compareVersions(pinned, latest) < 0, current: pinned, latest };
  } catch {
    return { behind: false };
  }
}

/**
 * `agconf sync --scope user`: project the canonical global block into the
 * developer's per-user harness files (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`)
 * and record the result in the `~/.agconf` store. Reuses the repo-scope source
 * and version resolution, but reads the recorded source from the user store
 * lockfile instead of a repo lockfile.
 */
export async function syncUserScopeCommand(options: UserScopeSyncOptions): Promise<void> {
  const logger = createLogger();
  const homeDir = options.home ?? os.homedir();

  let result: UserSyncResult | null;
  try {
    result = (await runUserScopeSync(options)).result;
  } catch (error) {
    if (error instanceof NoUserScopeSourceError) {
      logger.error(error.message);
      process.exit(1);
    }
    if (error instanceof StoreBusyError) {
      // Explicit user command — exit non-zero so scripts don't proceed on a sync
      // that never ran (the unattended runner logs result=locked and exits 0).
      logger.error(`${error.message} — try again in a moment.`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  if (!result) return; // only reachable via the skipIfUpToDate fast path (unused here)

  console.log();
  console.log(pc.bold("agconf sync --scope user"));
  console.log(pc.dim(`Store: ${result.storeDir}`));
  console.log();
  for (const f of result.files) {
    const tag = f.created
      ? pc.green("created ")
      : f.changed
        ? pc.cyan("updated ")
        : pc.dim("unchanged");
    console.log(`  ${tag} ${f.path}${f.backedUp ? pc.dim("  (original backed up)") : ""}`);
  }
  if (result.userMdCreated) {
    console.log(pc.dim(`  scaffolded ${getUserPaths(homeDir).userMdPath} (your personal layer)`));
  }
  // Content summary, so the skills/agents/rules written into ~/.claude, ~/.codex
  // aren't invisible (only the instruction files show above).
  for (const [label, n] of [
    ["skills", result.skills.length],
    ["agents", result.agents.length],
    ["rules", result.rules.length],
  ] as const) {
    if (n > 0) console.log(pc.dim(`  ${label}: ${n} synced`));
  }
  const removed = [
    result.removed.skills.length ? `${result.removed.skills.length} skill(s)` : "",
    result.removed.rules.length ? `${result.removed.rules.length} rule(s)` : "",
    result.removed.agents.length ? `${result.removed.agents.length} agent(s)` : "",
  ].filter(Boolean);
  if (removed.length > 0) {
    console.log(pc.yellow(`  removed (dropped from canonical): ${removed.join(", ")}`));
  }
  if (result.contentBackups.length > 0) {
    console.log();
    console.log(
      pc.dim(
        `  backed up ${result.contentBackups.length} of your own file(s) to ${getUserPaths(homeDir).backupsDir} before overwriting`,
      ),
    );
  }
  console.log();
  console.log(
    result.committed
      ? pc.dim("Committed to the ~/.agconf git store (run `git -C ~/.agconf log` to see diffs).")
      : pc.dim("Store written (git commit skipped)."),
  );
  console.log(
    pc.dim("Tip: `agconf autosync --install` keeps this fresh automatically at session start."),
  );
  console.log();
}

export interface UserScopeCheckOptions {
  home?: string | undefined;
  quiet?: boolean | undefined;
}

/**
 * `agconf check --scope user`: verify the user-scope managed block in each
 * harness file against the store lockfile. Returns true if problems were found.
 */
export async function checkUserScopeCommand(options: UserScopeCheckOptions): Promise<boolean> {
  const homeDir = options.home ?? os.homedir();
  const result = await checkUserScope({ homeDir });

  if (!result.hasLockfile) {
    if (!options.quiet) {
      console.log();
      console.log(pc.yellow("Not synced at user scope"));
      console.log(pc.dim("Run `agconf sync --scope user` to project company standards per-user."));
      console.log();
    }
    return false;
  }

  if (result.ok) {
    if (!options.quiet) {
      console.log();
      console.log(`${pc.green("✓")} User-scope managed files are unchanged`);
      console.log();
    }
    return false;
  }

  if (!options.quiet) {
    console.log();
    console.log(`${pc.red("✗")} User-scope managed files are out of sync:`);
    for (const m of result.modified) console.log(`  ${pc.yellow("modified")} ${m.path}`);
    for (const m of result.missing) console.log(`  ${pc.yellow("missing ")} ${m.path}`);
    for (const g of result.ghosts) console.log(`  ${pc.yellow("orphaned")} ${g.path}`);
    // Offer propose before sync: sync overwrites managed files, so pointing only
    // at it would send the developer to discard the very edits they just made.
    if (result.modified.length > 0) {
      console.log(pc.dim("To send your edits to canonical: `agconf propose --scope user`."));
    }
    console.log(pc.dim("Run `agconf sync --scope user` to restore company standards."));
    console.log();
  }
  return true;
}
