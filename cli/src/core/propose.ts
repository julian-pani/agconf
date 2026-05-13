import { exec } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import fg from "fast-glob";
import { type SimpleGit, simpleGit } from "simple-git";
import type { Source } from "../schemas/lockfile.js";
import { readLockfile } from "./lockfile.js";
import {
  type CheckManagedFilesOptions,
  checkAllManagedFiles,
  type ManagedFileCheckResult,
  stripManagedMetadata,
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

  // SKILL.md / rules / agents / AGENTS.md: existing self-hashing detection
  const modifiedFiles = allFiles.filter((f) => f.hasChanges);
  const filterRegexes = (options.files ?? []).map((pattern) => new RegExp(pattern));
  const matchesFilter = (relPath: string): boolean =>
    filterRegexes.length === 0 || filterRegexes.some((re) => re.test(relPath));

  const filesToPropose = modifiedFiles.filter((f) => matchesFilter(f.path));

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
  const tmpBase = path.join(process.env.TMPDIR || "/tmp", `agconf-propose-${Date.now()}`);
  await fs.mkdir(tmpBase, { recursive: true });
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
    // Create a persistent temp directory (not auto-cleaned, so user can retry on failure)
    const tmpBase = path.join(process.env.TMPDIR || "/tmp", `agconf-propose-${Date.now()}`);
    await fs.mkdir(tmpBase, { recursive: true });
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
