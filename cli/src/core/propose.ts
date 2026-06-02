import { exec } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import fg from "fast-glob";
import { type SimpleGit, simpleGit } from "simple-git";
import { loadCanonicalRepoConfig } from "../config/loader.js";
import type { Source } from "../schemas/lockfile.js";
import { validateAgentFrontmatter } from "./agents.js";
import { readLockfile } from "./lockfile.js";
import {
  type CheckManagedFilesOptions,
  checkAllManagedFiles,
  fileMatchesCanonical,
  isManaged,
  type ManagedFileCheckResult,
  skillMatchesCanonical,
  stripManagedMetadata,
  validateSkillFrontmatter,
} from "./managed-content.js";
import { parseAgentsMd, stripMetadataComments } from "./markers.js";

const execAsync = promisify(exec);

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
}

export interface ProposeOptions {
  /** Working directory (default: process.cwd()) */
  cwd?: string | undefined;
  /** Only propose specific files (glob patterns relative to cwd) */
  files?: string[] | undefined;
}

/** Context about the downstream repo where changes originated */
export interface DownstreamContext {
  /** Repository name (basename of git root) */
  repoName?: string | undefined;
  /** Current commit SHA */
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
  const targetDir = options.cwd ?? process.cwd();

  const lockfileResult = await readLockfile(targetDir);
  if (!lockfileResult) {
    throw new Error("No lockfile found. Run 'agconf init' first.");
  }

  const { lockfile } = lockfileResult;
  const targets = lockfile.content.targets ?? ["claude"];
  const markerPrefix = lockfile.content.marker_prefix;
  const source = lockfile.source;

  const checkOptions: CheckManagedFilesOptions = markerPrefix
    ? { markerPrefix, metadataPrefix: markerPrefix }
    : {};

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

  const filesToPropose = allFiles.filter((f) => {
    if (!f.hasChanges) return false;
    if (f.type === "skill" && f.contentChanged === false) return false;
    return matchesFilter(f.path);
  });

  const changes: ProposedChange[] = [];
  for (const file of filesToPropose) {
    const change = await buildProposedChange(targetDir, file, markerPrefix);
    if (change) {
      changes.push(change);
    }
  }

  // Non-SKILL.md files inside managed skill dirs: diff against canonical.
  // Only clone if there is at least one managed skill to inspect.
  const managedSkillNames = allFiles
    .filter((f) => f.type === "skill" && f.isManaged && f.skillName)
    .map((f) => f.skillName as string);

  let canonicalCloneDir: string | undefined;
  if (managedSkillNames.length > 0) {
    canonicalCloneDir = await cloneCanonicalForDetect(source);
    for (const skillName of managedSkillNames) {
      const assetChanges = await detectSkillAssetChanges(
        targetDir,
        targets,
        skillName,
        canonicalCloneDir,
      );
      for (const change of assetChanges) {
        if (matchesFilter(change.downstreamPath)) {
          changes.push(change);
        }
      }
    }
  }

  // Gather downstream context
  const downstream = await getDownstreamContext(targetDir);

  return {
    changes,
    source,
    markerPrefix,
    downstream,
    canonicalCloneDir,
  };
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
): Promise<ProposedChange[]> {
  const canonicalSkillDir = path.join(canonicalCloneDir, "skills", skillName);

  for (const target of targets) {
    const downstreamSkillDir = path.join(targetDir, `.${target}`, "skills", skillName);
    try {
      await fs.access(downstreamSkillDir);
    } catch {
      continue; // Skill not synced to this target
    }

    return diffSkillDir(targetDir, target, skillName, downstreamSkillDir, canonicalSkillDir);
  }
  return [];
}

async function diffSkillDir(
  _targetDir: string,
  target: string,
  skillName: string,
  downstreamSkillDir: string,
  canonicalSkillDir: string,
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
    const downstreamPath = path.join(`.${target}`, "skills", skillName, relPath);
    const canonicalPath = `skills/${skillName}/${relPath.split(path.sep).join("/")}`;

    changes.push({
      downstreamPath,
      canonicalPath,
      content: downstreamBytes,
      type: "skill-asset",
    });
  }

  return changes;
}

/**
 * Clone canonical to a temp dir for detection. The same clone is reused by
 * `applyProposedChanges` (it's threaded through `ProposeResult`) so we never
 * clone twice in a single propose flow.
 */
async function cloneCanonicalForDetect(source: Source): Promise<string> {
  // mkdtemp atomically creates a uniquely-named dir, so concurrent propose
  // flows never collide on the same clone path.
  const tmpBase = await fs.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "agconf-propose-"));
  const cloneDir = path.join(tmpBase, "canonical");
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
  markerPrefix?: string,
): Promise<ProposedChange | null> {
  const fullPath = path.join(targetDir, file.path);
  const metadataOptions = markerPrefix ? { metadataPrefix: markerPrefix } : {};

  switch (file.type) {
    case "skill": {
      const content = await fs.readFile(fullPath, "utf-8");
      const stripped = stripManagedMetadata(content, metadataOptions);
      // .claude/skills/<name>/SKILL.md → skills/<name>/SKILL.md
      const canonicalPath = file.path.replace(/^\.[^/]+\/skills\//, "skills/");
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
      // .claude/rules/<path> → rules/<path>
      const canonicalPath = file.path.replace(/^\.[^/]+\/rules\//, "rules/");
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
      // .claude/agents/<name>.md → agents/<name>.md
      const canonicalPath = file.path.replace(/^\.[^/]+\/agents\//, "agents/");
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
        canonicalPath: "instructions/AGENTS.md",
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
  /** Working directory (default: process.cwd()) */
  cwd?: string | undefined;
  /** Restrict discovery to this path (relative to cwd or absolute) within a managed dir */
  path?: string | undefined;
}

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
  const targetDir = options.cwd ?? process.cwd();

  const lockfileResult = await readLockfile(targetDir);
  if (!lockfileResult) {
    throw new Error("No lockfile found. Run 'agconf init' first.");
  }

  const { lockfile } = lockfileResult;
  const targets = lockfile.content.targets ?? ["claude"];
  const markerPrefix = lockfile.content.marker_prefix;
  const source = lockfile.source;
  const metaOpts: MetaOpts = markerPrefix ? { metadataPrefix: markerPrefix } : {};

  const downstream = await getDownstreamContext(targetDir);

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
  const canonConfig = await loadCanonicalRepoConfig(canonicalCloneDir);
  const skillsDir = canonConfig?.content.skills_dir ?? "skills";
  const rulesDir = canonConfig?.content.rules_dir ?? "rules";
  const agentsDir = canonConfig?.content.agents_dir ?? "agents";

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
    const skillDir = path.join(targetDir, `.${raw.target}`, "skills", raw.name);
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
    const skillsDir = path.join(targetDir, `.${target}`, "skills");
    for (const sf of await globFiles(skillsDir, "*/SKILL.md")) {
      const name = path.dirname(sf);
      const key = `skill:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const content = await fs.readFile(path.join(skillsDir, sf), "utf-8");
      if (isManaged(content, metaOpts)) continue;
      raws.push({ type: "skill", name, downstreamPath: `.${target}/skills/${name}`, target });
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
    const downstreamPath = `.${target}/skills/${skillName}/${posix}`;
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
  /** Path to the temporary canonical clone */
  cloneDir: string;
  /** Branch name created */
  branch: string;
  /** Whether push succeeded */
  pushed: boolean;
  /** PR URL if created */
  prUrl?: string | undefined;
  /** Manual commands to run if push or PR creation failed */
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
    // Create a persistent temp directory (not auto-cleaned, so user can retry
    // on failure). mkdtemp gives a unique name so concurrent applies don't collide.
    const tmpBase = await fs.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "agconf-propose-"));
    cloneDir = path.join(tmpBase, "canonical");
    await cloneCanonical(source, cloneDir);
  }

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
    const prCmd = buildGhPrCommand(source, branch, result.changes, result.downstream, options);
    manualCommands = [`cd ${cloneDir}`, pushCmd, "", "Then create a PR:", prCmd].join("\n");
    return { cloneDir, branch, pushed, manualCommands };
  }

  // Try to open PR (only for GitHub sources)
  if (source.type === "github") {
    try {
      const prCmd = buildGhPrCommand(source, branch, result.changes, result.downstream, options);
      const { stdout } = await execAsync(prCmd, { cwd: cloneDir });
      prUrl = stdout.trim();
    } catch {
      const prCmd = buildGhPrCommand(source, branch, result.changes, result.downstream, options);
      manualCommands = ["Branch was pushed successfully. To create a PR:", prCmd].join("\n");
    }
  }

  return { cloneDir, branch, pushed, prUrl, manualCommands };
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
  await git.clone(repoUrl, targetDir, ["--branch", ref]);
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
 * Gather context about the downstream repository.
 */
async function getDownstreamContext(targetDir: string): Promise<DownstreamContext> {
  const ctx: DownstreamContext = {};
  try {
    const git: SimpleGit = simpleGit(targetDir);
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
function buildPrBody(
  changes: ProposedChange[],
  downstream: DownstreamContext,
  options: ApplyOptions,
): string {
  const lines: string[] = [];

  if (options.message) {
    lines.push(options.message, "", "---", "");
  }

  lines.push("## Changed files", "");
  for (const c of changes) {
    lines.push(`- ${c.canonicalPath} (${c.type})`);
  }

  lines.push("", "## Origin", "");
  if (downstream.repoName) {
    lines.push(`- **Repository:** ${downstream.repoName}`);
  }
  if (downstream.commitSha) {
    lines.push(`- **Commit:** ${downstream.commitSha.slice(0, 12)}`);
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
function buildGhPrCommand(
  source: Source,
  branch: string,
  changes: ProposedChange[],
  downstream: DownstreamContext,
  options: ApplyOptions,
): string {
  const body = buildPrBody(changes, downstream, options);

  const repo = source.type === "github" ? ` --repo ${source.repository}` : "";
  // Use single quotes to avoid shell interpreting backticks or special chars
  const escapedTitle = options.title.replace(/'/g, "'\\''");
  const escapedBody = body.replace(/'/g, "'\\''");
  return `gh pr create${repo} --head ${branch} --title '${escapedTitle}' --body '${escapedBody}'`;
}
