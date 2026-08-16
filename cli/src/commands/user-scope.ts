import * as os from "node:os";
import pc from "picocolors";
import { getSyncStatus } from "../core/sync.js";
import { checkUserScope, getUserPaths, StoreBusyError, syncUserScope } from "../core/user-scope.js";
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

  // The user store lockfile (~/.agconf/lockfile.json) records the source/version.
  const status = await getSyncStatus(homeDir);

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
    logger.error(
      "No canonical source. Pass --source <owner/repo> or --local [path] the first time you sync at user scope.",
    );
    process.exit(1);
  }

  const optionsWithSource: SharedSyncOptions = {
    ...options,
    ...(sourceRepo ? { source: sourceRepo } : {}),
    ...(localOpt !== undefined ? { local: localOpt } : {}),
  };
  const resolvedVersion = await resolveVersion(optionsWithSource, status, "sync", sourceRepo);
  const { resolvedSource, tempDir } = await resolveSource(optionsWithSource, resolvedVersion);

  try {
    let result: Awaited<ReturnType<typeof syncUserScope>>;
    try {
      result = await syncUserScope(resolvedSource, {
        targets,
        homeDir,
        ...(resolvedVersion.version ? { pinnedVersion: resolvedVersion.version } : {}),
      });
    } catch (err) {
      if (err instanceof StoreBusyError) {
        logger.error(`${err.message} — try again in a moment.`);
        return;
      }
      throw err;
    }

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
    console.log();
  } finally {
    if (tempDir) await removeTempDir(tempDir);
  }
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
    console.log(pc.dim("Run `agconf sync --scope user` to restore company standards."));
    console.log();
  }
  return true;
}
