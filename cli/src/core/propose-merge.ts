import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import type { Source } from "../schemas/lockfile.js";
import { createTempDir, removeTempDir } from "../utils/fs.js";

const execFileAsync = promisify(execFile);

/** Generous cap so binary skill assets (images, archives) survive `git cat-file`. */
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Run git and return raw stdout bytes.
 *
 * `promisify(execFile)` types stdout as `string` regardless of the encoding
 * option, so the buffer form needs a cast.
 */
async function gitBytes(cwd: string, args: string[]): Promise<Buffer> {
  const result = (await execFileAsync("git", args, {
    cwd,
    encoding: "buffer",
    maxBuffer: GIT_MAX_BUFFER,
  })) as unknown as { stdout: Buffer };
  return result.stdout;
}

/**
 * The canonical content a downstream file was synced from — the common ancestor
 * of the local copy and canonical HEAD.
 */
export interface MergeBase {
  /**
   * False when the base commit cannot be resolved at all: the lockfile has no
   * `commit_sha` (local sources outside git), canonical was force-pushed, or
   * the sync came from a ref this clone doesn't contain. Without it there is
   * nothing to merge against and callers fall back to hash comparison.
   */
  available: boolean;
  /** Base content, or null when the file did not exist at the base commit. */
  content: Buffer | null;
}

const UNAVAILABLE_BASE: MergeBase = { available: false, content: null };

/**
 * Resolve the content a path had at the commit the downstream repo synced from.
 *
 * Reads out of the canonical clone that detection already created, so this costs
 * one `git cat-file` per proposed file and no extra network access.
 */
export async function resolveMergeBase(
  cloneDir: string,
  source: Source,
  canonicalPath: string,
  commitVerified?: boolean,
): Promise<MergeBase> {
  const sha = source.commit_sha;
  if (!sha) return UNAVAILABLE_BASE;

  // The commit check is invariant across paths, so callers reconciling many
  // files verify once and pass the answer in.
  if (!(commitVerified ?? (await verifyBaseCommit(cloneDir, sha)))) {
    return UNAVAILABLE_BASE;
  }

  // Probe for existence separately from reading. Folding the two together would
  // let a read failure (oversized blob, git crash) masquerade as positive
  // knowledge that the path did not exist at the base commit.
  try {
    await execFileAsync("git", ["cat-file", "-e", `${sha}:${canonicalPath}`], { cwd: cloneDir });
  } catch {
    return { available: true, content: null };
  }

  try {
    return {
      available: true,
      content: await gitBytes(cloneDir, ["cat-file", "blob", `${sha}:${canonicalPath}`]),
    };
  } catch {
    // The blob exists but couldn't be read — no base we can trust.
    return UNAVAILABLE_BASE;
  }
}

/** Whether the commit the downstream repo synced from is present in this clone. */
export async function verifyBaseCommit(cloneDir: string, sha: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: cloneDir });
    return true;
  } catch {
    // Force-pushed, shallow clone, or synced from a ref this clone lacks.
    return false;
  }
}

/** NUL bytes mean the content isn't line-oriented, so no textual merge. */
function isBinary(content: Buffer): boolean {
  return content.includes(0);
}

export interface ThreeWayResult {
  /** Merged content, or null when the merge did not succeed. */
  merged: Buffer | null;
  conflicted: boolean;
  /** Why the merge failed — drives the message the user sees. */
  reason?: "binary" | "overlap" | "failed";
}

/**
 * Three-way merge via `git merge-file`, the same machinery git itself uses.
 *
 * `-p` writes the result to stdout and leaves the inputs untouched. Its exit
 * status is the number of conflicts (1..127), while 128+ signals git itself
 * failed — distinguished so the caller can say which happened.
 */
export async function threeWayMerge(
  base: Buffer,
  ours: Buffer,
  theirs: Buffer,
): Promise<ThreeWayResult> {
  if (isBinary(base) || isBinary(ours) || isBinary(theirs)) {
    return { merged: null, conflicted: true, reason: "binary" };
  }

  const dir = await createTempDir("agconf-merge-");
  try {
    const paths = {
      ours: path.join(dir, "ours"),
      base: path.join(dir, "base"),
      theirs: path.join(dir, "theirs"),
    };
    await fs.writeFile(paths.ours, ours);
    await fs.writeFile(paths.base, base);
    await fs.writeFile(paths.theirs, theirs);

    try {
      const merged = await gitBytes(dir, [
        "merge-file",
        "-p",
        "-L",
        "local",
        "-L",
        "base",
        "-L",
        "canonical",
        paths.ours,
        paths.base,
        paths.theirs,
      ]);
      return { merged, conflicted: false };
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      const overlap = typeof code === "number" && code > 0 && code < 128;
      return { merged: null, conflicted: true, reason: overlap ? "overlap" : "failed" };
    }
  } finally {
    await removeTempDir(dir);
  }
}

export type MergeDecision =
  | {
      kind: "propose";
      content: Buffer;
      /** True when the content shipped upstream is a merge, not the local copy verbatim. */
      rebased: boolean;
    }
  | { kind: "drop" }
  | { kind: "conflict"; reason: string };

export interface MergeInputs {
  /** Local content, already normalized to canonical's serialization. */
  ours: Buffer;
  /** Canonical HEAD content, or null when the path does not exist upstream. */
  theirs: Buffer | null;
  base: MergeBase;
  /**
   * Consulted only when `base` is unavailable: true when the file's embedded
   * sync hash proves canonical has moved since the sync, false when it proves
   * it has not, undefined when the file carries no hash at all (skill assets).
   */
  upstreamMoved?: boolean | undefined;
}

const REASONS = {
  staleNoBase:
    "canonical has changed since your last sync and the merge base is unavailable — run `agconf sync` first",
  deletedUpstream: "deleted in canonical since your last sync",
  addedUpstream: "added in canonical since your last sync, with different content",
  overlap: "your local edits overlap changes made in canonical since your last sync",
  binary: "binary content changed on both sides and cannot be merged",
  failed: "the three-way merge could not be run",
} as const;

/**
 * Decide what a single file should contribute to a proposal.
 *
 * The four outcomes, given base (canonical at sync time), ours (local) and
 * theirs (canonical HEAD):
 *
 *   base == theirs, ours != base   -> propose ours; upstream never moved
 *   base != theirs, ours != base   -> three-way merge, or conflict if they overlap
 *   base != theirs, ours == base   -> drop; the difference is entirely upstream's,
 *                                     and proposing ours would revert it
 *   ours == theirs                 -> drop; already upstream verbatim
 */
export async function evaluateChange(input: MergeInputs): Promise<MergeDecision> {
  const { ours, theirs, base } = input;

  if (theirs !== null && ours.equals(theirs)) {
    return { kind: "drop" };
  }

  if (!base.available) {
    if (input.upstreamMoved === true) {
      return { kind: "conflict", reason: REASONS.staleNoBase };
    }
    // Either provably fresh, or no signal to go on (skill assets carry no
    // metadata) — ship the local copy, as propose always has.
    return { kind: "propose", content: ours, rebased: false };
  }

  if (theirs === null) {
    return base.content === null
      ? { kind: "propose", content: ours, rebased: false }
      : { kind: "conflict", reason: REASONS.deletedUpstream };
  }

  if (base.content === null) {
    return { kind: "conflict", reason: REASONS.addedUpstream };
  }

  if (base.content.equals(theirs)) {
    return { kind: "propose", content: ours, rebased: false };
  }

  if (base.content.equals(ours)) {
    return { kind: "drop" };
  }

  const merge = await threeWayMerge(base.content, ours, theirs);
  if (merge.conflicted || merge.merged === null) {
    return { kind: "conflict", reason: REASONS[merge.reason ?? "overlap"] };
  }
  // A merge that reproduces canonical HEAD carries no proposal.
  if (merge.merged.equals(theirs)) {
    return { kind: "drop" };
  }
  return { kind: "propose", content: merge.merged, rebased: true };
}

/** A file that cannot be proposed without the user reconciling it first. */
export interface ProposeConflict {
  downstreamPath: string;
  canonicalPath: string;
  reason: string;
}

/**
 * Raised when one or more files can't be safely rebased onto canonical HEAD.
 *
 * The whole propose is aborted rather than shipping the clean subset: a partial
 * proposal looks complete to its author, which is the same silent-loss failure
 * this check exists to prevent.
 */
export class StaleBaseError extends Error {
  constructor(public readonly conflicts: ProposeConflict[]) {
    super(
      `Refusing to propose ${conflicts.length} file(s) that conflict with changes made in canonical since your last sync`,
    );
    this.name = "StaleBaseError";
  }
}
