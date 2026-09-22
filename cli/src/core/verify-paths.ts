/**
 * Path guard for automated syncs.
 *
 * `agconf sync` running in CI is followed by a blanket `git add -A`, so whatever
 * the sync left in the working tree is what gets committed — with the `direct`
 * commit strategy, without any human review. This module answers the one
 * question that makes that defensible: *did the sync change anything it has no
 * business changing?*
 *
 * The allowlist is deliberately **coarse** — whole directories agconf owns,
 * rather than the exact managed file set. Two reasons: it stays readable by a
 * skeptical user in the workflow log, and it does not depend on the lockfile
 * being correct, so it still holds when agconf itself has a bug. It bounds the
 * blast radius; it does not certify every individual write.
 *
 * The list is fixed: there is no way to widen it from configuration. A path
 * outside it means the canonical content is writing somewhere it should not, or
 * agconf has a bug — both of which want reporting rather than suppressing.
 *
 * In CI the same rule is enforced by the sync workflow itself, which spells the
 * allowlist out in shell so a reader can audit it without trusting this code
 * (see `generateSyncWorkflow` in `commands/canonical.ts`). This module is the
 * local equivalent — `agconf verify-paths` before a hand-run sync — and a test
 * pins the two lists together so neither can drift.
 */

import { type SimpleGit, simpleGit } from "simple-git";
import { readLockfileSafe } from "./lockfile.js";
import { DEFAULT_MARKER_PREFIX } from "./markers.js";
import { getManagedWorkflowFilenames } from "./workflows.js";

/**
 * Paths agconf writes in a downstream repo, independent of the marker prefix.
 *
 * `.pre-commit-config.yaml` is on the list because `sync` installs the
 * pre-commit hook, and in a repo using the pre-commit framework that means
 * registering an `agconf-check` hook in that config rather than writing
 * `.git/hooks/pre-commit` (which is untracked and so never shows up here).
 */
export const BASE_ALLOWED_PATHS = [
  "AGENTS.md",
  "CLAUDE.md",
  ".agconf/**",
  ".claude/**",
  ".codex/**",
  ".agents/**",
  ".pre-commit-config.yaml",
  ".pre-commit-config.yml",
];

/** A working-tree change that falls outside the allowlist. */
export interface PathViolation {
  /** Repo-relative POSIX path. */
  path: string;
  /** Human-readable change kind ("modified", "deleted", "untracked", ...). */
  change: string;
}

export interface VerifyPathsResult {
  /** Allowlist patterns applied, in the order they were resolved. */
  patterns: string[];
  /** Changed paths that matched the allowlist. */
  allowed: string[];
  /** Changed paths that did not. Non-empty means the sync overstepped. */
  violations: PathViolation[];
}

/**
 * Match a repo-relative path against one coarse allowlist pattern.
 *
 * Two shapes, matching the workflow's shell copy exactly: a directory prefix
 * (`dir/**`) covering everything beneath it, and an exact file path. No other
 * wildcards — a guard is only worth as much as a reader's ability to predict
 * what it lets through.
 */
export function matchesAllowedPath(filePath: string, pattern: string): boolean {
  if (pattern.endsWith("/**")) {
    return filePath.startsWith(pattern.slice(0, -2));
  }
  return filePath === pattern;
}

/**
 * Resolve the allowlist for a repo: the base paths, the two workflow files
 * (named after the repo's marker prefix), and any downstream additions.
 */
export async function resolveAllowedPaths(repoRoot: string): Promise<string[]> {
  // Best-effort: a repo synced before the lockfile recorded a marker prefix
  // falls back to the default, which is what it would have used anyway.
  const lockfile = await readLockfileSafe(repoRoot);
  const markerPrefix = lockfile?.lockfile.content.marker_prefix ?? DEFAULT_MARKER_PREFIX;

  const workflowPaths = getManagedWorkflowFilenames(markerPrefix).map(
    (filename) => `.github/workflows/${filename}`,
  );

  return [...BASE_ALLOWED_PATHS, ...workflowPaths];
}

/** Map a git status code pair to a readable change kind. */
function describeChange(index: string, workingDir: string): string {
  const code = index.trim() || workingDir.trim();
  switch (code) {
    case "?":
      return "untracked";
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "type changed";
    case "U":
      return "unmerged";
    default:
      return code || "changed";
  }
}

/**
 * Collect every path the working tree reports as changed — staged, unstaged and
 * untracked alike. A rename contributes both of its sides, so moving a file out
 * of an allowed directory is caught as well as moving one in.
 */
async function collectChangedPaths(repoRoot: string): Promise<Map<string, string>> {
  const git: SimpleGit = simpleGit(repoRoot);
  // NUL-delimited records, matching the workflow's own guard. simple-git's
  // status() parser trims each line, which reports a file literally named
  // "AGENTS.md " as the allowed path "AGENTS.md" — a false pass.
  const raw = await git.raw(["status", "--porcelain", "-uall", "-z"]);
  const records = raw.split("\0");

  const changes = new Map<string, string>();
  for (let i = 0; i < records.length; i++) {
    const entry = records[i];
    if (!entry) continue;
    const index = entry[0] ?? "";
    const workingDir = entry[1] ?? "";
    const filePath = entry.slice(3);
    // A rename or copy is followed by a second record holding the original
    // path, so moving a file out of an allowed directory is caught too.
    if (index === "R" || index === "C") {
      const origin = records[++i];
      if (origin) changes.set(origin, "renamed from");
    }
    changes.set(filePath, describeChange(index, workingDir));
  }
  return changes;
}

/**
 * Verify that every working-tree change in `repoRoot` falls inside the paths
 * agconf owns. Callers treat a non-empty `violations` as fatal: the sync must
 * not be committed, in full or in part.
 */
export async function verifyChangedPaths(repoRoot: string): Promise<VerifyPathsResult> {
  const patterns = await resolveAllowedPaths(repoRoot);
  const changes = await collectChangedPaths(repoRoot);

  const allowed: string[] = [];
  const violations: PathViolation[] = [];

  for (const [filePath, change] of [...changes].sort(([a], [b]) => a.localeCompare(b))) {
    if (patterns.some((pattern) => matchesAllowedPath(filePath, pattern))) {
      allowed.push(filePath);
    } else {
      violations.push({ path: filePath, change });
    }
  }

  return { patterns, allowed, violations };
}
