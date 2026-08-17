import { exec } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import fg from "fast-glob";
import { type SimpleGit, simpleGit } from "simple-git";
import { loadCanonicalRepoConfig } from "../config/loader.js";
import type { CanonicalRepoConfig } from "../config/schema.js";
import type { Source } from "../schemas/lockfile.js";
import { removeTempDir } from "../utils/fs.js";
import { redactGitCredentials } from "../utils/git.js";
import { validateAgentFrontmatter } from "./agents.js";
import { readLockfile } from "./lockfile.js";
import {
  type CheckManagedFilesOptions,
  checkAllManagedFiles,
  computeContentHash,
  fileMatchesCanonical,
  getManagedMetadata,
  isManaged,
  type ManagedFileCheckResult,
  skillMatchesCanonical,
  stripManagedMetadata,
  validateSkillFrontmatter,
} from "./managed-content.js";
import {
  computeGlobalBlockHash,
  parseAgentsMd,
  parseGlobalBlockMetadata,
  stripMetadataComments,
} from "./markers.js";
import {
  evaluateChange,
  type MergeDecision,
  type ProposeConflict,
  resolveMergeBase,
  StaleBaseError,
  verifyBaseCommit,
} from "./propose-merge.js";
import { getSkillsDir, getUserInstructionsFile } from "./targets.js";
import { getUserPaths } from "./user-scope.js";

const execAsync = promisify(exec);

/**
 * Where the local copy being proposed lives: a synced repo (`repo`, the
 * default) or the per-user projection under the home dir (`user`).
 *
 * User scope works because every per-user path is exactly
 * `<homeDir>/<the repo-scope relative path>` — the same trick `user-scope.ts`
 * uses to reuse the repo-scope sync functions. So detection, canonical path
 * mapping and the three-way rebase are shared verbatim; only the target dir,
 * the instructions file(s), and the PR provenance differ.
 */
export type ProposeScope = "repo" | "user";

/** Where to look for the local copy, per scope. */
function resolveProposeDir(options: {
  scope?: ProposeScope | undefined;
  cwd?: string | undefined;
  home?: string | undefined;
}): string {
  if (options.scope === "user") return options.home ?? os.homedir();
  return options.cwd ?? process.cwd();
}

/**
 * Files carrying the global block, relative to the target dir.
 *
 * Repo scope has exactly one (the root `AGENTS.md`). User scope projects the
 * same block into each harness's own per-user file, so every synced target
 * contributes one — Claude first, making it the preferred proposal source when
 * both copies changed identically.
 */
function instructionsFilesForScope(scope: ProposeScope, targets: string[]): string[] {
  if (scope !== "user") return ["AGENTS.md"];
  const claudeFirst = [...targets].sort((a, b) => Number(b === "claude") - Number(a === "claude"));
  return [...new Set(claudeFirst.map(getUserInstructionsFile))];
}

/**
 * Raised when the same company block drifted *differently* in two per-user
 * harness files, so there is no single edit to propose. Shipping one silently
 * would drop the other — the same silent-loss failure `StaleBaseError` guards
 * against upstream.
 */
export class DivergentInstructionsError extends Error {
  constructor(public readonly paths: string[]) {
    super(
      `Your instructions block was edited differently in ${paths.length} files (${paths.join(", ")}) — propose one of them with --files`,
    );
    this.name = "DivergentInstructionsError";
  }
}

/**
 * A single proposed change mapped from downstream to canonical.
 */
export interface ProposedChange {
  /** Downstream file path (relative to target dir) */
  downstreamPath: string;
  /** Canonical file path (relative to canonical root) */
  canonicalPath: string;
  /**
   * Content to write in canonical. For markdown files this is the metadata-stripped
   * string; for skill-asset files (non-SKILL.md, possibly binary) this is the raw
   * bytes read from disk.
   */
  content: string | Buffer;
  /** Type of content */
  type: "skill" | "skill-asset" | "rule" | "agent" | "agents-md-global";
  /**
   * True when `content` is a three-way merge of the local copy onto canonical
   * HEAD rather than the local copy verbatim — canonical moved since the sync
   * and the two sets of edits were reconciled. Surfaced in the PR body.
   */
  rebased?: boolean | undefined;
}

export interface ProposeOptions {
  /** Working directory (default: process.cwd()). Repo scope only. */
  cwd?: string | undefined;
  /** Distribution scope of the local copy (default: "repo"). */
  scope?: ProposeScope | undefined;
  /** Home directory for `scope: "user"` (default: os.homedir()). For testability. */
  home?: string | undefined;
  /** Only propose specific files (glob patterns relative to the target dir) */
  files?: string[] | undefined;
  /**
   * Resolve conflicts by taking the local copy instead of aborting.
   * Reconciliation still runs, so cleanly-mergeable files are still merged —
   * forcing one file must not silently revert canonical's work in the others.
   */
  override?: boolean | undefined;
}

/** Context about where the proposed changes originated */
export interface DownstreamContext {
  /** Scope the changes came from (default: "repo"). */
  scope?: ProposeScope | undefined;
  /** Repository name (basename of git root). Repo scope only. */
  repoName?: string | undefined;
  /** Current commit SHA — the repo's HEAD, or the `~/.agconf` store's at user scope */
  commitSha?: string | undefined;
  /** Git author name */
  authorName?: string | undefined;
  /** Git author email */
  authorEmail?: string | undefined;
}

export interface ProposeResult {
  /** List of proposed changes */
  changes: ProposedChange[];
  /** Source info from lockfile */
  source: Source;
  /** Marker prefix */
  markerPrefix?: string | undefined;
  /** Context about the downstream repo */
  downstream: DownstreamContext;
  /**
   * Canonical clone created during detection (used to diff non-SKILL.md
   * skill files). Reused by applyProposedChanges when present so we don't
   * clone twice in the full propose flow.
   */
  canonicalCloneDir?: string | undefined;
  /**
   * Canonical commit the downstream repo was synced from — the base every
   * change was reconciled against. Recorded in the PR body so a reviewer can
   * see what the proposal was rebased onto.
   */
  baseSha?: string | undefined;
  /**
   * Downstream paths that were examined but contributed nothing, because the
   * only difference from canonical HEAD was canonical's own change. Surfaced so
   * "nothing to propose" doesn't look like "nothing was looked at".
   */
  dropped?: string[] | undefined;
}

/**
 * Canonical-side destination directories, resolved from the canonical config
 * with the conventional defaults. Used to map downstream paths
 * (`.{target}/skills|rules|agents`, AGENTS.md) back to their canonical
 * locations when proposing changes upstream.
 */
interface CanonicalDirs {
  skillsDir: string;
  rulesDir: string;
  agentsDir: string;
  instructions: string;
}

function resolveCanonicalDirs(config: CanonicalRepoConfig | undefined): CanonicalDirs {
  return {
    skillsDir: config?.content.skills_dir ?? "skills",
    rulesDir: config?.content.rules_dir ?? "rules",
    agentsDir: config?.content.agents_dir ?? "agents",
    instructions: config?.content.instructions ?? "instructions/AGENTS.md",
  };
}

/**
 * Detect modified managed files and build proposed changes for the canonical repo.
 *
 * For SKILL.md / rules / agents / AGENTS.md the modification check runs against
 * each file's own embedded hash (frontmatter or marker metadata) — no canonical
 * access required.
 *
 * For non-SKILL.md files inside a managed skill directory (references/,
 * scripts/, etc.) we treat *every* file as managed-by-association with its
 * skill. There is no frontmatter to inspect, so we clone the canonical repo
 * once and byte-compare each downstream file against its canonical sibling.
 * Files that differ — or that exist downstream but not in canonical — become
 * proposed `skill-asset` changes. The clone is handed back via
 * `ProposeResult.canonicalCloneDir` so `applyProposedChanges` can reuse it.
 */
export async function detectProposedChanges(options: ProposeOptions = {}): Promise<ProposeResult> {
  const scope: ProposeScope = options.scope ?? "repo";
  const targetDir = resolveProposeDir(options);

  const lockfileResult = await readLockfile(targetDir);
  if (!lockfileResult) {
    throw new Error(
      scope === "user"
        ? "Not synced at user scope. Run 'agconf sync --scope user' first."
        : "No lockfile found. Run 'agconf init' first.",
    );
  }

  const { lockfile } = lockfileResult;
  const targets = lockfile.content.targets ?? ["claude"];
  const markerPrefix = lockfile.content.marker_prefix;
  const source = lockfile.source;

  const checkOptions: CheckManagedFilesOptions = {
    ...(markerPrefix ? { markerPrefix, metadataPrefix: markerPrefix } : {}),
    instructionsFiles: instructionsFilesForScope(scope, targets),
  };

  const allFiles = await checkAllManagedFiles(targetDir, targets, checkOptions);

  // SKILL.md / rules / agents / AGENTS.md: existing self-hashing detection.
  // For skills, `hasChanges` is true when EITHER the SKILL.md body OR a sibling
  // asset was modified. We only want to ship SKILL.md to canonical when its
  // body actually changed — the per-file asset diffs are emitted by the
  // canonical-diff pass below. Otherwise the SKILL.md change would round-trip
  // to a no-op commit (managed metadata gets stripped before shipping).
  const filterRegexes = (options.files ?? []).map((pattern) => new RegExp(pattern));
  const matchesFilter = (relPath: string): boolean =>
    filterRegexes.length === 0 || filterRegexes.some((re) => re.test(relPath));

  const preFilter = allFiles.filter((f) => {
    if (!f.hasChanges) return false;
    if (f.type === "skill" && f.contentChanged === false) return false;
    return matchesFilter(f.path);
  });

  // User scope projects one global block per target, so an edit to the shared
  // company block surfaces once per harness file. Collapse them to a single
  // proposal (or refuse, if they drifted apart).
  const instructionsDropped: string[] = [];
  const filesToPropose = await collapseInstructionFiles(
    targetDir,
    preFilter,
    markerPrefix,
    instructionsDropped,
  );

  // Non-SKILL.md files inside managed skill dirs are diffed against canonical.
  // Deduped: checkAllManagedFiles reports a skill once per target it is synced
  // to, while detectSkillAssetChanges diffs a skill name once (it returns at the
  // first target whose skill dir exists). One pass per name is all that is used.
  const managedSkillNames = [
    ...new Set(
      allFiles
        .filter((f) => f.type === "skill" && f.isManaged && f.skillName)
        .map((f) => f.skillName as string),
    ),
  ];

  // Clone canonical (once) whenever there is anything to propose so the
  // canonical-side destination paths honor the configured content dirs
  // (skills_dir/rules_dir/agents_dir/instructions). The clone is handed back via
  // ProposeResult.canonicalCloneDir so applyProposedChanges can reuse it.
  let canonicalCloneDir: string | undefined;
  let dirs = resolveCanonicalDirs(undefined);
  if (filesToPropose.length > 0 || managedSkillNames.length > 0) {
    canonicalCloneDir = await cloneCanonicalForDetect(source);
  }

  // Past this point the clone exists on disk. Only the success path below hands
  // it to the caller (as ProposeResult.canonicalCloneDir, for
  // applyProposedChanges to reuse); every abort — a conflict, a malformed
  // canonical config, an unreadable file — has to dispose of it or it leaks
  // into TMPDIR forever. Hence catch-and-rethrow rather than finally.
  try {
    if (canonicalCloneDir) {
      dirs = resolveCanonicalDirs(await loadCanonicalRepoConfig(canonicalCloneDir));
    }

    // Reconciliation needs the clone; without it there is nothing to propose and
    // so nothing to reconcile.
    const reconcile: ReconcileContext | null = canonicalCloneDir
      ? {
          cloneDir: canonicalCloneDir,
          source,
          metaOpts: markerPrefix ? { metadataPrefix: markerPrefix } : {},
          // The base commit is the same for every file, so check it once.
          commitVerified: source.commit_sha
            ? await verifyBaseCommit(canonicalCloneDir, source.commit_sha)
            : false,
          forceConflicts: options.override === true,
        }
      : null;

    const changes: ProposedChange[] = [];
    const conflicts: ProposeConflict[] = [];
    const dropped: string[] = [...instructionsDropped];

    for (const file of filesToPropose) {
      const change = await buildProposedChange(targetDir, file, markerPrefix, dirs);
      if (!change) continue;
      if (!reconcile) {
        changes.push(change);
        continue;
      }
      const decision = await reconcileChange(change, reconcile, {
        syncedHash: () => readSyncedHash(targetDir, file, markerPrefix),
      });
      collectDecision(decision, change, { changes, conflicts, dropped, reconcile });
    }

    if (canonicalCloneDir) {
      for (const skillName of managedSkillNames) {
        const assetChanges = await detectSkillAssetChanges(
          targetDir,
          targets,
          skillName,
          canonicalCloneDir,
          dirs.skillsDir,
          { reconcile, conflicts, dropped, matchesFilter },
        );
        changes.push(...assetChanges);
      }
    }

    if (conflicts.length > 0) {
      throw new StaleBaseError(conflicts);
    }

    // Gather originating context
    const downstream = await getOriginContext(scope, targetDir);

    return {
      changes,
      source,
      markerPrefix,
      downstream,
      canonicalCloneDir,
      baseSha: source.commit_sha,
      dropped,
    };
  } catch (error) {
    await discardCanonicalClone(canonicalCloneDir);
    throw error;
  }
}

/**
 * Reduce the modified instruction files to at most one proposable entry.
 *
 * At repo scope there is only ever one, so this is a pass-through. At user scope
 * the same company block is projected into every target's per-user file, so
 * editing it shows up once per harness. Identical edits collapse to the first
 * file (Claude, per `instructionsFilesForScope`) and the rest are reported as
 * dropped; differing edits raise {@link DivergentInstructionsError} rather than
 * silently shipping one and discarding the other.
 *
 * `--files` is applied before this runs, so a user who really does want one
 * specific copy can select it and bypass the divergence check.
 */
async function collapseInstructionFiles(
  targetDir: string,
  files: ManagedFileCheckResult[],
  markerPrefix: string | undefined,
  dropped: string[],
): Promise<ManagedFileCheckResult[]> {
  const instructions = files.filter((f) => f.type === "agents");
  if (instructions.length <= 1) return files;

  const markerOptions = markerPrefix ? { prefix: markerPrefix } : {};
  const blocks = await Promise.all(
    instructions.map(async (f) => {
      const content = await fs.readFile(path.join(targetDir, f.path), "utf-8");
      const parsed = parseAgentsMd(content, markerOptions);
      return parsed.globalBlock ? stripMetadataComments(parsed.globalBlock) : null;
    }),
  );

  const [first, ...rest] = blocks;
  if (rest.some((b) => b !== first)) {
    throw new DivergentInstructionsError(instructions.map((f) => f.path));
  }

  const [keep, ...redundant] = instructions;
  dropped.push(...redundant.map((f) => f.path));
  return files.filter((f) => f.type !== "agents" || f === keep);
}

/** Everything reconciliation needs to compare a change against canonical. */
interface ReconcileContext {
  /** Canonical clone created during detection — holds both HEAD and history. */
  cloneDir: string;
  source: Source;
  metaOpts: MetaOpts;
  /** Whether the sync-time commit is present in the clone, resolved once per run. */
  commitVerified: boolean;
  /**
   * `--override`: resolve conflicts by taking the local copy instead of
   * aborting. Reconciliation still runs, so files that merge cleanly are still
   * merged and files the local repo never touched are still dropped — forcing
   * one file must not quietly revert canonical's changes in the others.
   */
  forceConflicts: boolean;
}

/**
 * Put canonical-side content into the same serialization as the proposed
 * content, so a frontmatter round-trip can't read as a real edit.
 *
 * `buildProposedChange` ships `stripManagedMetadata` output for markdown and a
 * trimmed block for AGENTS.md, both of which re-serialize YAML; canonical files
 * on disk are raw. Running both sides through the matching transform keeps
 * comparisons and merges honest.
 */
function normalizeCanonical(raw: Buffer, type: ProposedChange["type"], metaOpts: MetaOpts): Buffer {
  if (type === "skill-asset") return raw;
  const text = raw.toString("utf-8");
  if (type === "agents-md-global") return Buffer.from(text.trim(), "utf-8");
  return Buffer.from(stripManagedMetadata(text, metaOpts), "utf-8");
}

function toBuffer(content: string | Buffer): Buffer {
  return typeof content === "string" ? Buffer.from(content, "utf-8") : content;
}

/**
 * The hash a downstream file recorded at sync time — i.e. what canonical's copy
 * hashed to back then. Comparing it against canonical HEAD is the only
 * staleness signal available when the merge base can't be resolved.
 */
async function readSyncedHash(
  targetDir: string,
  file: ManagedFileCheckResult,
  markerPrefix: string | undefined,
): Promise<string | undefined> {
  try {
    const content = await fs.readFile(path.join(targetDir, file.path), "utf-8");
    if (file.type === "agents") {
      const parsed = parseAgentsMd(content, markerPrefix ? { prefix: markerPrefix } : {});
      return parsed.globalBlock
        ? parseGlobalBlockMetadata(parsed.globalBlock).contentHash
        : undefined;
    }
    return getManagedMetadata(content, markerPrefix).contentHash;
  } catch {
    return undefined;
  }
}

/**
 * Reconcile one proposed change against canonical HEAD and the sync-time base.
 * See `evaluateChange` for the decision table.
 */
async function reconcileChange(
  change: ProposedChange,
  ctx: ReconcileContext,
  opts: {
    /** Lazily read — only the base-unavailable path needs it. */
    syncedHash?: (() => Promise<string | undefined>) | undefined;
    /** Canonical HEAD bytes the caller already read, to avoid a second read. */
    theirsRaw?: Buffer | null | undefined;
  } = {},
): Promise<MergeDecision> {
  const { cloneDir, source, metaOpts } = ctx;

  let theirsRaw: Buffer | null;
  if (opts.theirsRaw !== undefined) {
    theirsRaw = opts.theirsRaw;
  } else {
    try {
      theirsRaw = await fs.readFile(path.join(cloneDir, change.canonicalPath));
    } catch {
      theirsRaw = null; // Path does not exist upstream
    }
  }

  const base = await resolveMergeBase(cloneDir, source, change.canonicalPath, ctx.commitVerified);

  return evaluateChange({
    ours: toBuffer(change.content),
    theirs: theirsRaw === null ? null : normalizeCanonical(theirsRaw, change.type, metaOpts),
    base: {
      available: base.available,
      content:
        base.content === null ? null : normalizeCanonical(base.content, change.type, metaOpts),
    },
    upstreamMoved: base.available
      ? undefined
      : upstreamMoved(await opts.syncedHash?.(), theirsRaw, change.type, metaOpts),
  });
}

/**
 * Whether canonical HEAD differs from what this file was synced from, judged
 * purely by the embedded hash. Undefined when there is nothing to compare —
 * skill assets carry no metadata, and an absent upstream file is not "moved".
 */
function upstreamMoved(
  syncedHash: string | undefined,
  theirsRaw: Buffer | null,
  type: ProposedChange["type"],
  metaOpts: MetaOpts,
): boolean | undefined {
  if (!syncedHash || theirsRaw === null) return undefined;
  const text = theirsRaw.toString("utf-8");
  const current =
    type === "agents-md-global" ? computeGlobalBlockHash(text) : computeContentHash(text, metaOpts);
  return current !== syncedHash;
}

/** Where a reconciled decision is recorded. All three lists are mutated. */
interface DecisionSink {
  changes: ProposedChange[];
  conflicts: ProposeConflict[];
  /** Downstream paths dropped because the delta belonged to canonical alone. */
  dropped: string[];
  reconcile: ReconcileContext;
}

/** Fold a merge decision into the running change/conflict/dropped lists. */
function collectDecision(
  decision: MergeDecision,
  change: ProposedChange,
  sink: DecisionSink,
): void {
  if (decision.kind === "drop") {
    sink.dropped.push(change.downstreamPath);
    return;
  }

  if (decision.kind === "conflict") {
    if (!sink.reconcile.forceConflicts) {
      sink.conflicts.push({
        downstreamPath: change.downstreamPath,
        canonicalPath: change.canonicalPath,
        reason: decision.reason,
      });
      return;
    }
    // --override: the local copy wins this file.
    sink.changes.push(change);
    return;
  }

  if (!decision.rebased) {
    sink.changes.push(change);
    return;
  }

  sink.changes.push({
    ...change,
    content: change.type === "skill-asset" ? decision.content : decision.content.toString("utf-8"),
    rebased: true,
  });
}

/**
 * For a single managed skill, walk every non-SKILL.md file in the downstream
 * skill directory and emit a `skill-asset` change for each one whose bytes
 * differ from canonical (or that does not exist in canonical at all).
 *
 * When the skill is synced to multiple targets (e.g. claude + codex) the copies
 * are identical, so we only inspect the first target that has the directory.
 */
async function detectSkillAssetChanges(
  targetDir: string,
  targets: string[],
  skillName: string,
  canonicalCloneDir: string,
  skillsDir: string,
  ctx: AssetScanContext,
): Promise<ProposedChange[]> {
  const canonicalSkillDir = path.join(canonicalCloneDir, skillsDir, skillName);

  for (const target of targets) {
    const downstreamSkillDir = path.join(targetDir, getSkillsDir(target), skillName);
    try {
      await fs.access(downstreamSkillDir);
    } catch {
      continue; // Skill not synced to this target
    }

    return diffSkillDir(target, skillName, downstreamSkillDir, canonicalSkillDir, skillsDir, ctx);
  }
  return [];
}

interface AssetScanContext {
  /** Null only when there is no canonical clone to reconcile against. */
  reconcile: ReconcileContext | null;
  /** Collects files that can't be proposed without user action (mutated) */
  conflicts: ProposeConflict[];
  /** Collects files dropped as already-up-to-date (mutated) */
  dropped: string[];
  /**
   * The `--files` predicate. Applied before reconciliation so an excluded file
   * neither costs a git lookup nor aborts the propose on a conflict it would
   * never have contributed to.
   */
  matchesFilter: (relPath: string) => boolean;
}

/**
 * Assets carry no metadata, so a plain byte diff against canonical HEAD can't
 * tell "I edited this" from "canonical moved". Each differing file is therefore
 * run through the same reconciliation as metadata-bearing content, which
 * resolves that from the merge base.
 */
async function diffSkillDir(
  target: string,
  skillName: string,
  downstreamSkillDir: string,
  canonicalSkillDir: string,
  skillsDir: string,
  ctx: AssetScanContext,
): Promise<ProposedChange[]> {
  const changes: ProposedChange[] = [];

  const downstreamFiles = await fg("**/*", {
    cwd: downstreamSkillDir,
    onlyFiles: true,
    dot: true,
  });

  for (const relPath of downstreamFiles) {
    if (relPath === "SKILL.md") continue; // Handled by frontmatter-based detection

    const downstreamFull = path.join(downstreamSkillDir, relPath);
    const canonicalFull = path.join(canonicalSkillDir, relPath);

    let downstreamBytes: Buffer;
    try {
      downstreamBytes = await fs.readFile(downstreamFull);
    } catch {
      // File may have been removed between glob and read
      continue;
    }

    let canonicalBytes: Buffer | null = null;
    try {
      canonicalBytes = await fs.readFile(canonicalFull);
    } catch {
      // File doesn't exist in canonical — treat as a new addition downstream
    }

    if (canonicalBytes !== null && downstreamBytes.equals(canonicalBytes)) {
      continue;
    }

    // Use POSIX separators in canonical paths so the canonical commit is
    // platform-portable regardless of which OS the proposer is on.
    const downstreamPath = path.join(getSkillsDir(target), skillName, relPath);
    if (!ctx.matchesFilter(downstreamPath)) continue;

    const canonicalPath = `${skillsDir}/${skillName}/${relPath.split(path.sep).join("/")}`;

    const change: ProposedChange = {
      downstreamPath,
      canonicalPath,
      content: downstreamBytes,
      type: "skill-asset",
    };

    if (!ctx.reconcile) {
      changes.push(change);
      continue;
    }

    // Canonical HEAD is already in hand from the byte diff above, and assets
    // carry no embedded hash so there is no fallback signal to supply.
    const decision = await reconcileChange(change, ctx.reconcile, { theirsRaw: canonicalBytes });
    collectDecision(decision, change, {
      changes,
      conflicts: ctx.conflicts,
      dropped: ctx.dropped,
      reconcile: ctx.reconcile,
    });
  }

  return changes;
}

/** mkdtemp prefix for the temp dir every canonical clone lives in. */
const CLONE_TMP_PREFIX = "agconf-propose-";
/** Directory name of the clone itself, inside that temp dir. */
const CLONE_DIR_NAME = "canonical";

/** Create the mkdtemp base a canonical clone lives in, and the clone path inside it. */
async function createCloneDir(): Promise<string> {
  // mkdtemp atomically creates a uniquely-named dir, so concurrent propose
  // flows never collide on the same clone path.
  const tmpBase = await fs.mkdtemp(path.join(process.env.TMPDIR || "/tmp", CLONE_TMP_PREFIX));
  return path.join(tmpBase, CLONE_DIR_NAME);
}

/**
 * Delete a canonical clone and the temp dir it lives in.
 *
 * Callers own the clone's lifetime: every propose path that is not handing the
 * user a way back into the clone must call this, or the clone leaks into TMPDIR
 * for the life of the machine.
 *
 * Deliberately paranoid about what it removes, because it deletes the clone's
 * *parent* (the mkdtemp base) and so destroys more than the path it is given: a
 * `cloneDir` of `""` would resolve to `"."` — the working directory — and
 * `/tmp/anything` would resolve to `/tmp`. It therefore removes nothing unless
 * the path has the exact shape `createCloneDir` produces
 * (`<tmp>/agconf-propose-XXXX/canonical`). Anything else is silently ignored
 * rather than guessed at. Do not relax either check into a default.
 */
export async function discardCanonicalClone(cloneDir: string | undefined): Promise<void> {
  if (!cloneDir) return;
  if (path.basename(cloneDir) !== CLONE_DIR_NAME) return;
  const tmpBase = path.dirname(cloneDir);
  if (!path.basename(tmpBase).startsWith(CLONE_TMP_PREFIX)) return;
  await removeTempDir(tmpBase);
}

/**
 * Clone canonical to a temp dir for detection. The same clone is reused by
 * `applyProposedChanges` (it's threaded through `ProposeResult`) so we never
 * clone twice in a single propose flow.
 *
 * The caller owns the returned clone and must `discardCanonicalClone` it.
 */
async function cloneCanonicalForDetect(source: Source): Promise<string> {
  const cloneDir = await createCloneDir();
  await cloneCanonical(source, cloneDir);
  return cloneDir;
}

/**
 * Build a proposed change for a single modified file.
 * Maps downstream path → canonical path and strips metadata.
 */
async function buildProposedChange(
  targetDir: string,
  file: ManagedFileCheckResult,
  markerPrefix: string | undefined,
  dirs: CanonicalDirs,
): Promise<ProposedChange | null> {
  const fullPath = path.join(targetDir, file.path);
  const metadataOptions = markerPrefix ? { metadataPrefix: markerPrefix } : {};

  switch (file.type) {
    case "skill": {
      const content = await fs.readFile(fullPath, "utf-8");
      const stripped = stripManagedMetadata(content, metadataOptions);
      // .claude/skills/<name>/SKILL.md → <skills_dir>/<name>/SKILL.md
      const canonicalPath = file.path.replace(/^\.[^/]+\/skills\//, `${dirs.skillsDir}/`);
      return {
        downstreamPath: file.path,
        canonicalPath,
        content: stripped,
        type: "skill",
      };
    }

    case "rule": {
      const content = await fs.readFile(fullPath, "utf-8");
      const stripped = stripManagedMetadata(content, metadataOptions);
      // .claude/rules/<path> → <rules_dir>/<path>
      const canonicalPath = file.path.replace(/^\.[^/]+\/rules\//, `${dirs.rulesDir}/`);
      return {
        downstreamPath: file.path,
        canonicalPath,
        content: stripped,
        type: "rule",
      };
    }

    case "agent": {
      const content = await fs.readFile(fullPath, "utf-8");
      const stripped = stripManagedMetadata(content, metadataOptions);
      // .claude/agents/<name>.md → <agents_dir>/<name>.md
      const canonicalPath = file.path.replace(/^\.[^/]+\/agents\//, `${dirs.agentsDir}/`);
      return {
        downstreamPath: file.path,
        canonicalPath,
        content: stripped,
        type: "agent",
      };
    }

    case "agents": {
      // Extract the global block content from AGENTS.md
      const content = await fs.readFile(fullPath, "utf-8");
      const markerOptions = markerPrefix ? { prefix: markerPrefix } : {};
      const parsed = parseAgentsMd(content, markerOptions);
      if (!parsed.globalBlock) return null;
      const stripped = stripMetadataComments(parsed.globalBlock);
      return {
        downstreamPath: file.path,
        canonicalPath: dirs.instructions,
        content: stripped,
        type: "agents-md-global",
      };
    }

    default:
      // rules-section (codex concatenated) — not directly proposable
      return null;
  }
}

// =============================================================================
// New (unmanaged) content proposals
// =============================================================================
// The detection above only surfaces *modified managed* files (they carry an
// embedded hash from a previous sync). The functions below discover content
// authored locally that canonical has never seen — skills, rules, and agents
// with no agconf metadata — so it can be proposed upstream as a brand-new
// addition.

/**
 * A single discoverable new (unmanaged) content item that can be proposed to
 * canonical. Each candidate expands into one or more concrete `ProposedChange`
 * entries (a skill ships its SKILL.md plus every asset file; a rule or agent
 * ships a single file).
 */
export interface NewContentCandidate {
  type: "skill" | "rule" | "agent";
  /** Identifier: skill name, rule path (relative to rules dir), or agent file name */
  name: string;
  /** Downstream path shown to the user (skill dir, or rule/agent file), POSIX, relative to target dir */
  downstreamPath: string;
  /** Canonical destination (skill dir, or rule/agent file), POSIX, relative to canonical root */
  canonicalPath: string;
  /** Concrete file changes this candidate ships */
  changes: ProposedChange[];
}

interface DetectNewContentOptions {
  /** Working directory (default: process.cwd()). Repo scope only. */
  cwd?: string | undefined;
  /** Distribution scope of the local copy (default: "repo"). */
  scope?: ProposeScope | undefined;
  /** Home directory for `scope: "user"` (default: os.homedir()). For testability. */
  home?: string | undefined;
  /** Restrict discovery to this path (relative to the target dir or absolute) within a managed dir */
  path?: string | undefined;
}

/**
 * At user scope the managed dirs are the developer's *personal* ones
 * (`~/.claude/skills` holds their own skills alongside the company's), so a
 * blanket scan would offer private content up to the company repo. Repo scope
 * has no such mixing: `.claude/skills` in a synced repo is project content.
 */
const USER_SCOPE_NEW_REQUIRES_PATH =
  "`--new` at user scope requires a path (e.g. `agconf propose --new --scope user ~/.claude/skills/my-skill`) — " +
  "~/.claude also holds your personal skills, agents and rules, which must not be proposed to canonical wholesale.";

/**
 * Local content that already exists in canonical AND is byte-identical to it
 * (modulo managed metadata). It is not proposable — it is a round-trip awaiting
 * adoption: running `agconf sync` replaces the untracked local copy with the
 * managed (tracked) version. See the round-trip notes on `detectNewContent`.
 */
interface AdoptableItem {
  type: "skill" | "rule" | "agent";
  name: string;
  downstreamPath: string;
}

export interface DetectNewContentResult {
  /** New content discovered (collisions and invalid files excluded — see `warnings`/`adoptable`) */
  candidates: NewContentCandidate[];
  /**
   * Local content that already matches canonical and just needs `agconf sync`
   * to become managed (the common "I proposed this, it merged, I haven't synced
   * yet" case). Kept out of `candidates` so we don't re-propose a no-op.
   */
  adoptable: AdoptableItem[];
  /**
   * True when a path filter resolved to exactly one candidate, so the caller
   * can skip an interactive selection step and propose it directly.
   */
  autoSelect: boolean;
  /** Non-fatal messages (true conflicts, invalid frontmatter) for the caller to surface */
  warnings: string[];
  source: Source;
  markerPrefix?: string | undefined;
  downstream: DownstreamContext;
  /** Canonical clone created during detection; reused by applyProposedChanges */
  canonicalCloneDir?: string | undefined;
}

/** Metadata-prefix options shared by the helpers below. */
type MetaOpts = { metadataPrefix?: string };

/** A locally-discovered unmanaged file before canonical mapping/validation. */
interface RawNewCandidate {
  type: "skill" | "rule" | "agent";
  name: string;
  downstreamPath: string;
  target: string;
}

/**
 * Detect new (unmanaged) content that could be proposed to canonical.
 *
 * Runs in two passes so canonical is only cloned when there is something to
 * propose:
 *  1. Walk the downstream `.{target}/skills|rules|agents` dirs and collect every
 *     file that is NOT agconf-managed (no `agconf_managed` frontmatter). Apply
 *     the optional path filter here.
 *  2. If any candidates remain, clone canonical once, resolve its configured
 *     destination dirs (`skills_dir`/`rules_dir`/`agents_dir`), drop anything
 *     that fails frontmatter validation, and build the concrete `ProposedChange`
 *     set for each survivor.
 *
 * Round-trip handling: content that already exists upstream is NOT a candidate.
 * We compare it to canonical (modulo managed metadata) to tell two cases apart:
 *   - byte-identical  -> `adoptable`: a completed round trip awaiting `agconf
 *     sync`, which replaces the untracked local copy with the managed version.
 *   - differs         -> a true conflict, surfaced as a warning (sync would
 *     overwrite the local copy, so the diff should be proposed first).
 */
export async function detectNewContent(
  options: DetectNewContentOptions = {},
): Promise<DetectNewContentResult> {
  const scope: ProposeScope = options.scope ?? "repo";
  const targetDir = resolveProposeDir(options);

  // Refuse a blanket sweep of the developer's personal harness dirs.
  if (scope === "user" && !options.path) {
    throw new Error(USER_SCOPE_NEW_REQUIRES_PATH);
  }

  const lockfileResult = await readLockfile(targetDir);
  if (!lockfileResult) {
    throw new Error(
      scope === "user"
        ? "Not synced at user scope. Run 'agconf sync --scope user' first."
        : "No lockfile found. Run 'agconf init' first.",
    );
  }

  const { lockfile } = lockfileResult;
  const targets = lockfile.content.targets ?? ["claude"];
  const markerPrefix = lockfile.content.marker_prefix;
  const source = lockfile.source;
  const metaOpts: MetaOpts = markerPrefix ? { metadataPrefix: markerPrefix } : {};

  const downstream = await getOriginContext(scope, targetDir);

  // Pass 1: discover unmanaged local candidates (no canonical access yet).
  let raws = await discoverRawNewCandidates(targetDir, targets, metaOpts);

  if (options.path) {
    const filter = normalizeRelPath(targetDir, options.path);
    raws = raws.filter((r) => pathFilterMatches(r.downstreamPath, filter));
  }

  if (raws.length === 0) {
    return {
      candidates: [],
      adoptable: [],
      autoSelect: false,
      warnings: [],
      source,
      markerPrefix,
      downstream,
    };
  }

  // Pass 2: clone canonical once to resolve destination dirs + detect collisions.
  const canonicalCloneDir = await cloneCanonicalForDetect(source);

  // As in detectProposedChanges: the clone is handed to the caller only on the
  // success path, so anything that throws from here has to discard it first.
  try {
    const { skillsDir, rulesDir, agentsDir } = resolveCanonicalDirs(
      await loadCanonicalRepoConfig(canonicalCloneDir),
    );

    const candidates: NewContentCandidate[] = [];
    const adoptable: AdoptableItem[] = [];
    const warnings: string[] = [];

    for (const raw of raws) {
      const candidate = await buildNewCandidate(raw, {
        targetDir,
        canonicalCloneDir,
        skillsDir,
        rulesDir,
        agentsDir,
        metaOpts,
        adoptable,
        warnings,
      });
      if (candidate) candidates.push(candidate);
    }

    // Auto-select only when a path filter pinned things down to a single survivor.
    const autoSelect = Boolean(options.path) && candidates.length === 1;

    return {
      candidates,
      adoptable,
      autoSelect,
      warnings,
      source,
      markerPrefix,
      downstream,
      canonicalCloneDir,
    };
  } catch (error) {
    await discardCanonicalClone(canonicalCloneDir);
    throw error;
  }
}

interface BuildCandidateContext {
  targetDir: string;
  canonicalCloneDir: string;
  skillsDir: string;
  rulesDir: string;
  agentsDir: string;
  metaOpts: MetaOpts;
  /** Collects round-trip items (local already matches canonical) (mutated) */
  adoptable: AdoptableItem[];
  /** Collects conflict / validation messages (mutated) */
  warnings: string[];
}

/**
 * Map a raw candidate to a full `NewContentCandidate`, or return null when it
 * already exists upstream (recorded as adoptable or a conflict via `ctx`) or
 * fails frontmatter validation.
 */
async function buildNewCandidate(
  raw: RawNewCandidate,
  ctx: BuildCandidateContext,
): Promise<NewContentCandidate | null> {
  const { targetDir, canonicalCloneDir, metaOpts, adoptable, warnings } = ctx;

  if (raw.type === "skill") {
    const canonicalPath = `${ctx.skillsDir}/${raw.name}`;
    const skillDir = path.join(targetDir, getSkillsDir(raw.target), raw.name);
    const canonicalSkillDir = path.join(canonicalCloneDir, ctx.skillsDir, raw.name);
    if (await pathExists(canonicalSkillDir)) {
      if (await skillMatchesCanonical(skillDir, canonicalSkillDir, metaOpts)) {
        adoptable.push({ type: "skill", name: raw.name, downstreamPath: raw.downstreamPath });
      } else {
        warnings.push(conflictWarning("Skill", raw.name));
      }
      return null;
    }
    const skillMd = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf-8");
    const vErr = validateSkillFrontmatter(skillMd, raw.name, raw.downstreamPath);
    if (vErr) {
      warnings.push(`Skill "${raw.name}" skipped: ${vErr.errors.join("; ")}`);
      return null;
    }
    const changes = await buildNewSkillChanges(
      skillDir,
      raw.target,
      raw.name,
      ctx.skillsDir,
      metaOpts,
    );
    return {
      type: "skill",
      name: raw.name,
      downstreamPath: raw.downstreamPath,
      canonicalPath,
      changes,
    };
  }

  if (raw.type === "rule") {
    const canonicalPath = `${ctx.rulesDir}/${raw.name}`;
    const fullPath = path.join(targetDir, `.${raw.target}`, "rules", raw.name);
    const canonicalFullPath = path.join(canonicalCloneDir, ctx.rulesDir, raw.name);
    if (await pathExists(canonicalFullPath)) {
      if (await fileMatchesCanonical(fullPath, canonicalFullPath, metaOpts)) {
        adoptable.push({ type: "rule", name: raw.name, downstreamPath: raw.downstreamPath });
      } else {
        warnings.push(conflictWarning("Rule", raw.name));
      }
      return null;
    }
    const content = stripManagedMetadata(await fs.readFile(fullPath, "utf-8"), metaOpts);
    return {
      type: "rule",
      name: raw.name,
      downstreamPath: raw.downstreamPath,
      canonicalPath,
      changes: [{ downstreamPath: raw.downstreamPath, canonicalPath, content, type: "rule" }],
    };
  }

  // agent
  const canonicalPath = `${ctx.agentsDir}/${raw.name}`;
  const fullPath = path.join(targetDir, ".claude", "agents", raw.name);
  const canonicalFullPath = path.join(canonicalCloneDir, ctx.agentsDir, raw.name);
  if (await pathExists(canonicalFullPath)) {
    if (await fileMatchesCanonical(fullPath, canonicalFullPath, metaOpts)) {
      adoptable.push({ type: "agent", name: raw.name, downstreamPath: raw.downstreamPath });
    } else {
      warnings.push(conflictWarning("Agent", raw.name));
    }
    return null;
  }
  const rawContent = await fs.readFile(fullPath, "utf-8");
  const vErr = validateAgentFrontmatter(rawContent, raw.name);
  if (vErr) {
    warnings.push(`Agent "${raw.name}" skipped: ${vErr.errors.join("; ")}`);
    return null;
  }
  const content = stripManagedMetadata(rawContent, metaOpts);
  return {
    type: "agent",
    name: raw.name,
    downstreamPath: raw.downstreamPath,
    canonicalPath,
    changes: [{ downstreamPath: raw.downstreamPath, canonicalPath, content, type: "agent" }],
  };
}

function conflictWarning(label: string, name: string): string {
  return (
    `${label} "${name}" already exists in canonical and differs from your local copy — ` +
    "propose the change via a regular `agconf propose`, or run `agconf sync` to overwrite the local copy."
  );
}

/**
 * Walk the downstream managed dirs and collect every file that is NOT
 * agconf-managed. Skills are deduped by name and rules by path across targets
 * (the synced copies are identical); agents only exist for the Claude target.
 */
async function discoverRawNewCandidates(
  targetDir: string,
  targets: string[],
  metaOpts: MetaOpts,
): Promise<RawNewCandidate[]> {
  const seen = new Set<string>();
  const raws: RawNewCandidate[] = [];

  for (const target of targets) {
    const skillsRelDir = getSkillsDir(target);
    const skillsDir = path.join(targetDir, skillsRelDir);
    for (const sf of await globFiles(skillsDir, "*/SKILL.md")) {
      const name = path.dirname(sf);
      const key = `skill:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const content = await fs.readFile(path.join(skillsDir, sf), "utf-8");
      if (isManaged(content, metaOpts)) continue;
      raws.push({ type: "skill", name, downstreamPath: `${skillsRelDir}/${name}`, target });
    }
  }

  for (const target of targets) {
    const rulesDir = path.join(targetDir, `.${target}`, "rules");
    for (const rf of await globFiles(rulesDir, "**/*.md")) {
      const name = rf.split(path.sep).join("/");
      const key = `rule:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const content = await fs.readFile(path.join(rulesDir, rf), "utf-8");
      if (isManaged(content, metaOpts)) continue;
      raws.push({ type: "rule", name, downstreamPath: `.${target}/rules/${name}`, target });
    }
  }

  // Agents are only synced to the Claude target.
  if (targets.includes("claude")) {
    const agentsDir = path.join(targetDir, ".claude", "agents");
    for (const af of await globFiles(agentsDir, "*.md")) {
      const name = af.split(path.sep).join("/");
      const content = await fs.readFile(path.join(agentsDir, af), "utf-8");
      if (isManaged(content, metaOpts)) continue;
      raws.push({
        type: "agent",
        name,
        downstreamPath: `.claude/agents/${name}`,
        target: "claude",
      });
    }
  }

  return raws;
}

/**
 * Build the full change set for a brand-new skill: SKILL.md (metadata stripped,
 * a no-op when none is present) plus every sibling asset as raw bytes.
 */
async function buildNewSkillChanges(
  skillDir: string,
  target: string,
  skillName: string,
  skillsDir: string,
  metaOpts: MetaOpts,
): Promise<ProposedChange[]> {
  const changes: ProposedChange[] = [];
  for (const relPath of await globFiles(skillDir, "**/*")) {
    const posix = relPath.split(path.sep).join("/");
    const downstreamPath = `${getSkillsDir(target)}/${skillName}/${posix}`;
    const canonicalPath = `${skillsDir}/${skillName}/${posix}`;
    if (posix === "SKILL.md") {
      const content = stripManagedMetadata(
        await fs.readFile(path.join(skillDir, relPath), "utf-8"),
        metaOpts,
      );
      changes.push({ downstreamPath, canonicalPath, content, type: "skill" });
    } else {
      const content = await fs.readFile(path.join(skillDir, relPath));
      changes.push({ downstreamPath, canonicalPath, content, type: "skill-asset" });
    }
  }
  return changes;
}

/** Glob files under a directory, returning [] when the directory is absent. */
async function globFiles(cwd: string, pattern: string): Promise<string[]> {
  try {
    return await fg(pattern, { cwd, onlyFiles: true, dot: true });
  } catch {
    return [];
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

/** Normalize a user-supplied path to a POSIX path relative to the target dir. */
function normalizeRelPath(targetDir: string, p: string): string {
  const abs = path.isAbsolute(p) ? p : path.join(targetDir, p);
  return path.relative(targetDir, abs).split(path.sep).join("/").replace(/\/+$/, "");
}

/**
 * A candidate matches the filter when either is contained in the other: the
 * filter can be a parent dir (`.claude/skills`), the candidate's own path
 * (`.claude/skills/foo`), or a child of it (`.claude/skills/foo/SKILL.md`).
 */
function pathFilterMatches(candidatePath: string, filter: string): boolean {
  const c = candidatePath.replace(/\/+$/, "");
  return c === filter || c.startsWith(`${filter}/`) || filter.startsWith(`${c}/`);
}

export interface ApplyResult {
  /**
   * Path to the temporary canonical clone. Still on disk when this returns, and
   * the caller owns it: discard it with `discardCanonicalClone` unless
   * `manualCommands` is set (see below).
   */
  cloneDir: string;
  /** Branch name created */
  branch: string;
  /** Whether push succeeded */
  pushed: boolean;
  /** PR URL if created */
  prUrl?: string | undefined;
  /**
   * Manual commands to run if push or PR creation failed.
   *
   * When this is set, `cloneDir` MUST be left on disk — it holds the only copy
   * of the commit, and the commands run inside it. This is the one case where
   * retaining the clone is deliberate rather than a leak.
   */
  manualCommands?: string | undefined;
}

export interface ApplyOptions {
  /** Proposal title — used for branch name, commit message, and PR title */
  title: string;
  /** User-provided message appended to the default PR description */
  message?: string | undefined;
}

/**
 * Apply proposed changes to the canonical repository.
 * Clones canonical (or reuses the clone created during detection), creates a
 * branch, applies changes, pushes, opens PR.
 */
export async function applyProposedChanges(
  result: ProposeResult,
  options: ApplyOptions,
): Promise<ApplyResult> {
  const { source } = result;

  let cloneDir: string;
  if (result.canonicalCloneDir) {
    // Reuse the clone detect already created — saves a second clone in the
    // common detect-then-apply flow.
    cloneDir = result.canonicalCloneDir;
  } else {
    cloneDir = await createCloneDir();
    await cloneCanonical(source, cloneDir);
  }

  try {
    // Create branch from title
    const branch = generateBranchName(options.title);
    const git: SimpleGit = simpleGit(cloneDir);
    await git.checkoutLocalBranch(branch);

    // Apply changes
    for (const change of result.changes) {
      const targetPath = path.join(cloneDir, change.canonicalPath);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      if (typeof change.content === "string") {
        await fs.writeFile(targetPath, change.content, "utf-8");
      } else {
        await fs.writeFile(targetPath, change.content);
      }
    }

    // Commit using the title
    await git.add(".");
    await git.commit(options.title);

    // Try to push
    let pushed = false;
    let prUrl: string | undefined;
    let manualCommands: string | undefined;

    try {
      await git.push("origin", branch, ["--set-upstream"]);
      pushed = true;
    } catch {
      const pushCmd = `git push -u origin ${branch}`;
      const prCmd = buildGhPrCommand(branch, result, options);
      // KEEP THE CLONE. The commit exists only here, and these instructions
      // start with `cd <cloneDir>` — deleting it would point the user's only
      // route to recovery at a directory that no longer exists. The caller is
      // responsible for honoring this (see `manualCommands` on ApplyResult).
      manualCommands = [`cd ${cloneDir}`, pushCmd, "", "Then create a PR:", prCmd].join("\n");
      return { cloneDir, branch, pushed, manualCommands };
    }

    // Try to open PR (only for GitHub sources)
    if (source.type === "github") {
      try {
        const prCmd = buildGhPrCommand(branch, result, options);
        const { stdout } = await execAsync(prCmd, { cwd: cloneDir });
        prUrl = stdout.trim();
      } catch {
        const prCmd = buildGhPrCommand(branch, result, options);
        // KEEP THE CLONE, same reasoning: `gh pr create` has to run inside it.
        manualCommands = ["Branch was pushed successfully. To create a PR:", prCmd].join("\n");
      }
    }

    return { cloneDir, branch, pushed, prUrl, manualCommands };
  } catch (error) {
    // Nothing was handed back, so there is nothing for the user to retry in
    // the clone — drop it rather than leaking it into TMPDIR.
    await discardCanonicalClone(cloneDir);
    throw error;
  }
}

/**
 * Clone the canonical repository to a target directory.
 */
async function cloneCanonical(source: Source, targetDir: string): Promise<void> {
  if (source.type === "local") {
    const git: SimpleGit = simpleGit();
    await git.clone(source.path, targetDir);
    return;
  }

  // GitHub source — try gh CLI first, then git with token
  const { repository, ref } = source;

  const ghAvailable = await isGhAvailable();
  if (ghAvailable) {
    try {
      await execAsync(`gh repo clone ${repository} ${targetDir} -- --branch ${ref}`);
      return;
    } catch {
      // Fall through to git clone
    }
  }

  const token = process.env.GITHUB_TOKEN;
  const repoUrl = token
    ? `https://x-access-token:${token}@github.com/${repository}.git`
    : `https://github.com/${repository}.git`;

  const git: SimpleGit = simpleGit();
  try {
    await git.clone(repoUrl, targetDir, ["--branch", ref]);
  } catch (error) {
    // git's stderr can echo repoUrl with the embedded token — redact before
    // the error propagates to any caller that logs it.
    throw new Error(redactGitCredentials(error instanceof Error ? error.message : String(error)));
  }
}

async function isGhAvailable(): Promise<boolean> {
  try {
    await execAsync("gh --version");
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a proposal title into a valid git branch name slug.
 */
export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Cap at 50 chars (propose/ prefix adds 8 → 58 total) and trim trailing hyphen from truncation
  return slug.slice(0, 50).replace(/-+$/, "");
}

/**
 * Generate a branch name from a proposal title.
 */
export function generateBranchName(title: string): string {
  return `propose/${slugifyTitle(title)}`;
}

/**
 * Gather context about where the proposal came from.
 *
 * At user scope the target dir is the developer's *home* directory, so running
 * git there is wrong: usually it isn't a repo at all, and for anyone whose `~`
 * is a dotfiles repo it would report that repo's name and HEAD as the origin of
 * a company-standards proposal. The `~/.agconf` store is the honest answer —
 * it's the git repo that actually tracks the projected content.
 */
async function getOriginContext(
  scope: ProposeScope,
  targetDir: string,
): Promise<DownstreamContext> {
  if (scope === "user") {
    // The store dir's basename (".agconf") says nothing useful — the scope does.
    const { repoName: _ignored, ...ctx } = await readGitContext(getUserPaths(targetDir).storeDir);
    return { scope, ...ctx };
  }
  return { scope, ...(await readGitContext(targetDir)) };
}

/** Best-effort repo name / HEAD / author for a directory. Missing info is fine. */
async function readGitContext(dir: string): Promise<DownstreamContext> {
  const ctx: DownstreamContext = {};
  try {
    const git: SimpleGit = simpleGit(dir);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) return ctx;

    const root = await git.revparse(["--show-toplevel"]);
    ctx.repoName = path.basename(root.trim());

    const log = await git.log({ maxCount: 1 });
    ctx.commitSha = log.latest?.hash;

    const name = await git.getConfig("user.name");
    ctx.authorName = name.value ?? undefined;

    const email = await git.getConfig("user.email");
    ctx.authorEmail = email.value ?? undefined;
  } catch {
    // Best-effort — missing context is fine
  }
  return ctx;
}

/**
 * Build the default PR body with downstream context.
 */
function buildPrBody(result: ProposeResult, options: ApplyOptions): string {
  const { changes, downstream } = result;
  const lines: string[] = [];

  if (options.message) {
    lines.push(options.message, "", "---", "");
  }

  lines.push("## Changed files", "");
  for (const c of changes) {
    // Flag merged files explicitly: their content is not what the downstream
    // repo has on disk, so a reviewer should know it was reconciled.
    const note = c.rebased ? ", merged onto canonical HEAD" : "";
    lines.push(`- ${c.canonicalPath} (${c.type}${note})`);
  }

  lines.push("", "## Origin", "");
  if (downstream.scope === "user") {
    // No repo to name: these edits were made to the per-user projection, and
    // the ~/.agconf store is the git repo that tracks it.
    lines.push("- **Scope:** user (`~/.claude`, `~/.codex` via the `~/.agconf` store)");
    if (downstream.commitSha) {
      lines.push(`- **Store commit:** ${downstream.commitSha.slice(0, 12)}`);
    }
  } else {
    if (downstream.repoName) {
      lines.push(`- **Repository:** ${downstream.repoName}`);
    }
    if (downstream.commitSha) {
      lines.push(`- **Commit:** ${downstream.commitSha.slice(0, 12)}`);
    }
  }
  if (result.baseSha) {
    lines.push(`- **Synced from canonical:** ${result.baseSha.slice(0, 12)}`);
  }
  if (downstream.authorName) {
    const author = downstream.authorEmail
      ? `${downstream.authorName} <${downstream.authorEmail}>`
      : downstream.authorName;
    lines.push(`- **Author:** ${author}`);
  }

  return lines.join("\n");
}

/**
 * Build the gh pr create command string.
 */
function buildGhPrCommand(branch: string, result: ProposeResult, options: ApplyOptions): string {
  const body = buildPrBody(result, options);
  const { source } = result;

  const repo = source.type === "github" ? ` --repo ${source.repository}` : "";
  // Use single quotes to avoid shell interpreting backticks or special chars
  const escapedTitle = options.title.replace(/'/g, "'\\''");
  const escapedBody = body.replace(/'/g, "'\\''");
  return `gh pr create${repo} --head ${branch} --title '${escapedTitle}' --body '${escapedBody}'`;
}
