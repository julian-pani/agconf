import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import fg from "fast-glob";
import type { Lockfile } from "../schemas/lockfile.js";
import { toMetadataPrefix } from "../utils/prefix.js";
import {
  type Agent,
  type AgentValidationError,
  addAgentMetadata,
  discoverAgents,
  validateAgentFrontmatter,
} from "./agents.js";
import { readLockfile, writeLockfile } from "./lockfile.js";
import {
  addManagedMetadata,
  computeAssetsHash,
  fileMatchesCanonical,
  hasManualChanges,
  hasModifiedAssets,
  isManaged,
  type SkillValidationError,
  skillMatchesCanonical,
  validateSkillFrontmatter,
} from "./managed-content.js";
import { consolidateClaudeMd, mergeAgentsMd, writeAgentsMd } from "./merge.js";
import {
  addRuleMetadata,
  generateRulesSection,
  parseRule,
  type Rule,
  updateAgentsMdWithRules,
} from "./rules.js";
import type { ResolvedSource } from "./source.js";
import { getSkillsDir, getTargetConfig, type Target, type TargetConfig } from "./targets.js";

export interface SyncOptions {
  override: boolean;
  targets: Target[];
  /** Pinned version to record in lockfile */
  pinnedVersion?: string;
}

// =============================================================================
// Rules Sync
// =============================================================================

export interface RulesSyncOptions {
  sourceRulesPath: string;
  targetDir: string;
  targets: Target[];
  markerPrefix: string;
  metadataPrefix: string;
  agentsMdContent: string;
}

export interface RulesSyncResult {
  rules: Rule[];
  updatedAgentsMd: string | null;
  claudeFiles: string[];
  modifiedRules: string[];
  contentHash: string;
}

// =============================================================================
// Agents Sync
// =============================================================================

export interface AgentsSyncOptions {
  sourceAgentsPath: string;
  targetDir: string;
  metadataPrefix: string;
}

export interface AgentsSyncResult {
  agents: Agent[];
  syncedFiles: string[];
  modifiedFiles: string[];
  contentHash: string;
  validationErrors: AgentValidationError[];
}

/**
 * Discover all markdown rule files in a directory recursively.
 */
async function discoverRules(rulesDir: string): Promise<Rule[]> {
  try {
    await fs.access(rulesDir);
  } catch {
    // Directory doesn't exist - return empty array
    return [];
  }

  const ruleFiles = await fg("**/*.md", {
    cwd: rulesDir,
    absolute: false,
  });

  const rules: Rule[] = [];
  for (const relativePath of ruleFiles) {
    const fullPath = path.join(rulesDir, relativePath);
    const content = await fs.readFile(fullPath, "utf-8");
    rules.push(parseRule(content, relativePath));
  }

  // Sort by path for deterministic order in lockfile and outputs
  rules.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  return rules;
}

/**
 * Compute aggregate hash for a list of rules.
 * Rules are sorted by path for determinism.
 */
function computeRulesHash(rules: Rule[]): string {
  if (rules.length === 0) return "";

  const sorted = [...rules].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const combined = sorted.map((r) => `${r.relativePath}:${r.body}`).join("\n---\n");
  const hash = createHash("sha256").update(combined).digest("hex");
  return `sha256:${hash.slice(0, 12)}`;
}

/**
 * Sync rules from a canonical source to target directory.
 *
 * For Claude target: Copy rules to .claude/rules/ with metadata added
 * For Codex target: Generate rules section and return updated AGENTS.md
 */
export async function syncRules(options: RulesSyncOptions): Promise<RulesSyncResult> {
  const { sourceRulesPath, targetDir, targets, markerPrefix, metadataPrefix, agentsMdContent } =
    options;

  // Discover all rules
  const rules = await discoverRules(sourceRulesPath);

  const result: RulesSyncResult = {
    rules,
    updatedAgentsMd: null,
    claudeFiles: [],
    modifiedRules: [],
    contentHash: "",
  };

  // No rules - return early
  if (rules.length === 0) {
    return result;
  }

  // Compute content hash for lockfile
  result.contentHash = computeRulesHash(rules);

  // Sync to Claude target
  if (targets.includes("claude")) {
    const claudeRulesDir = path.join(targetDir, ".claude", "rules");

    for (const rule of rules) {
      const targetPath = path.join(claudeRulesDir, rule.relativePath);

      // Ensure parent directory exists
      await fs.mkdir(path.dirname(targetPath), { recursive: true });

      // Add metadata and write file
      const contentWithMetadata = addRuleMetadata(rule, metadataPrefix);

      // Check if file exists and has same content
      let existingContent: string | null = null;
      try {
        existingContent = await fs.readFile(targetPath, "utf-8");
      } catch {
        // File doesn't exist
      }

      if (existingContent !== contentWithMetadata) {
        await fs.writeFile(targetPath, contentWithMetadata, "utf-8");
        result.modifiedRules.push(rule.relativePath);
      }

      result.claudeFiles.push(rule.relativePath);
    }
  }

  // Sync to Codex target
  if (targets.includes("codex")) {
    const rulesSection = generateRulesSection(rules, markerPrefix);
    result.updatedAgentsMd = updateAgentsMdWithRules(agentsMdContent, rulesSection, markerPrefix);
  }

  return result;
}

/**
 * Compute aggregate hash for a list of agents.
 * Agents are sorted by path for determinism.
 */
function computeAgentsHash(agents: Agent[]): string {
  if (agents.length === 0) return "";

  const sorted = [...agents].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const combined = sorted.map((a) => `${a.relativePath}:${a.body}`).join("\n---\n");
  const hash = createHash("sha256").update(combined).digest("hex");
  return `sha256:${hash.slice(0, 12)}`;
}

/**
 * Sync agents from a canonical source to target directory.
 * Only Claude target supports agents (Codex does not have sub-agents).
 */
export async function syncAgents(options: AgentsSyncOptions): Promise<AgentsSyncResult> {
  const { sourceAgentsPath, targetDir, metadataPrefix } = options;

  // Discover all agents
  const agents = await discoverAgents(sourceAgentsPath);

  const result: AgentsSyncResult = {
    agents,
    syncedFiles: [],
    modifiedFiles: [],
    contentHash: "",
    validationErrors: [],
  };

  // No agents - return early
  if (agents.length === 0) {
    return result;
  }

  // Validate all agents have required frontmatter
  for (const agent of agents) {
    const error = validateAgentFrontmatter(agent.rawContent, agent.relativePath);
    if (error) {
      result.validationErrors.push(error);
    }
  }

  // Compute content hash for lockfile
  result.contentHash = computeAgentsHash(agents);

  // Sync to Claude target (agents directory is .claude/agents/)
  const claudeAgentsDir = path.join(targetDir, ".claude", "agents");

  for (const agent of agents) {
    const targetPath = path.join(claudeAgentsDir, agent.relativePath);

    // Ensure directory exists
    await fs.mkdir(path.dirname(targetPath), { recursive: true });

    // Add metadata and write file
    const contentWithMetadata = addAgentMetadata(agent, metadataPrefix);

    // Check if file exists and has same content
    let existingContent: string | null = null;
    try {
      existingContent = await fs.readFile(targetPath, "utf-8");
    } catch {
      // File doesn't exist
    }

    if (existingContent !== contentWithMetadata) {
      await fs.writeFile(targetPath, contentWithMetadata, "utf-8");
      result.modifiedFiles.push(agent.relativePath);
    }

    result.syncedFiles.push(agent.relativePath);
  }

  return result;
}

/**
 * Find agents that were previously synced but are no longer in the current sync.
 */
export function findOrphanedAgents(previousAgents: string[], currentAgents: string[]): string[] {
  return previousAgents.filter((agent) => !currentAgents.includes(agent));
}

/**
 * Delete orphaned agent files from the Claude agents directory.
 * Only deletes agents that are managed (have managed metadata).
 */
export async function deleteOrphanedAgents(
  targetDir: string,
  orphanedAgents: string[],
  previouslyTrackedAgents: string[],
  options: { metadataPrefix?: string } = {},
): Promise<{ deleted: string[]; skipped: string[] }> {
  const deleted: string[] = [];
  const skipped: string[] = [];
  const metadataOptions = options.metadataPrefix
    ? { metadataPrefix: options.metadataPrefix }
    : undefined;

  const agentsDir = path.join(targetDir, ".claude", "agents");

  for (const agentPath of orphanedAgents) {
    const fullPath = path.join(agentsDir, agentPath);

    // Check if file exists
    try {
      await fs.access(fullPath);
    } catch {
      // File doesn't exist
      continue;
    }

    // Check if the agent is managed before deleting
    try {
      const content = await fs.readFile(fullPath, "utf-8");

      if (!isManaged(content, metadataOptions)) {
        // Not managed, skip deletion
        skipped.push(agentPath);
        continue;
      }

      // Additional safety check: only delete if either:
      // 1. The agent was in the previous lockfile (confirming it was synced), OR
      // 2. The content hash matches (agent hasn't been modified)
      const wasInPreviousLockfile = previouslyTrackedAgents.includes(agentPath);
      const isUnmodified = !hasManualChanges(content, metadataOptions);

      if (!wasInPreviousLockfile && !isUnmodified) {
        // Agent is managed but wasn't in lockfile and has been modified
        skipped.push(agentPath);
        continue;
      }
    } catch {
      // Can't read file, skip deletion to be safe
      skipped.push(agentPath);
      continue;
    }

    // Delete the agent file
    await fs.unlink(fullPath);
    deleted.push(agentPath);
  }

  return { deleted, skipped };
}

export interface TargetResult {
  target: Target;
  skills: {
    copied: number;
  };
}

export interface SyncResult {
  lockfile: Lockfile;
  agentsMd: {
    merged: boolean;
    changed: boolean;
    preservedRepoContent: boolean;
  };
  claudeMd: {
    created: boolean;
    updated: boolean;
    deletedDotClaudeClaudeMd: boolean;
  };
  targets: TargetResult[];
  skills: {
    synced: string[];
    modified: string[];
    totalCopied: number;
    validationErrors: SkillValidationError[];
  };
  rules?: {
    synced: string[];
    modified: string[];
    contentHash: string;
    claudeFiles: string[];
    codexUpdated: boolean;
  };
  agents?: {
    synced: string[];
    modified: string[];
    contentHash: string;
    validationErrors: AgentValidationError[];
    /** True if agents were skipped due to Codex-only target */
    skipped?: boolean;
  };
  /**
   * Downstream paths of previously-unmanaged files that matched canonical and
   * were adopted as managed by this sync (the round-trip closing). Empty in the
   * common case.
   */
  adopted: string[];
  /**
   * Legacy Codex skill directories relocated from `.codex/skills/` to
   * `.agents/skills/` during this sync (skill names). See
   * {@link migrateLegacyCodexSkills}. Empty in the common case.
   */
  migratedCodexSkills: {
    /** Skill names removed from the legacy `.codex/skills/` location. */
    moved: string[];
    /** Legacy skills left in place (unmanaged or locally modified). */
    skipped: string[];
  };
}

/** A local file that `sync` would overwrite but that differs from canonical and is not agconf-managed. */
export interface SyncConflict {
  type: "skill" | "rule" | "agent";
  /** Downstream path relative to the target dir (e.g. ".claude/skills/foo") */
  path: string;
}

/**
 * Thrown by `sync()` when it would overwrite local content that differs from
 * canonical and is not managed by agconf (e.g. uncommitted local work). The
 * caller decides how to surface it; pass `override: true` to overwrite anyway.
 */
export class UnmanagedOverwriteError extends Error {
  constructor(public readonly conflicts: SyncConflict[]) {
    super(
      `Refusing to overwrite ${conflicts.length} local file(s) that differ from canonical and are not managed by agconf`,
    );
    this.name = "UnmanagedOverwriteError";
  }
}

interface UnmanagedCollisions {
  /** Divergent unmanaged files — block the sync unless overridden */
  conflicts: SyncConflict[];
  /** Identical unmanaged files — safe to overwrite (adopt as managed) */
  adopted: string[];
}

/**
 * Read-only pre-flight: for every file `sync` is about to write, classify any
 * EXISTING UNMANAGED downstream file as either `adopted` (byte-identical to
 * canonical modulo metadata — safe to overwrite/adopt) or a `conflict`
 * (differs — would lose local content). Managed files are left to the normal
 * write path (canonical is their source of truth; `check` reports drift).
 */
async function detectUnmanagedCollisions(
  targetDir: string,
  resolvedSource: ResolvedSource,
  targets: Target[],
  skillNames: string[],
  metadataPrefix: string,
): Promise<UnmanagedCollisions> {
  const conflicts: SyncConflict[] = [];
  const adopted: string[] = [];
  const metaOpts = { metadataPrefix };

  const exists = async (p: string): Promise<boolean> => {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  };

  // Skills — one managed dir per target (.claude/skills, .agents/skills for Codex).
  for (const target of targets) {
    const skillsDirName = getSkillsDir(target);
    for (const skillName of skillNames) {
      const localSkillDir = path.join(targetDir, skillsDirName, skillName);
      const localSkillMd = path.join(localSkillDir, "SKILL.md");
      const canonicalSkillDir = path.join(resolvedSource.skillsPath, skillName);
      const downstreamPath = `${skillsDirName}/${skillName}`;

      if (!(await exists(localSkillMd))) {
        // Abnormal: a skill dir without SKILL.md. We can't read its managed
        // state, so if it holds files that sync would overwrite and they differ
        // from canonical, be conservative and flag a conflict rather than risk a
        // silent clobber. Empty/identical dirs (and absent dirs) pass through.
        const localFiles = await fg("**/*", {
          cwd: localSkillDir,
          onlyFiles: true,
          dot: true,
        }).catch(() => []);
        if (
          localFiles.length > 0 &&
          !(await skillMatchesCanonical(localSkillDir, canonicalSkillDir, metaOpts))
        ) {
          conflicts.push({ type: "skill", path: downstreamPath });
        }
        continue;
      }

      const content = await fs.readFile(localSkillMd, "utf-8");
      if (isManaged(content, metaOpts)) continue; // managed: canonical owns it
      if (await skillMatchesCanonical(localSkillDir, canonicalSkillDir, metaOpts)) {
        adopted.push(downstreamPath);
      } else {
        conflicts.push({ type: "skill", path: downstreamPath });
      }
    }
  }

  // Rules — Claude target only (Codex rules live in AGENTS.md markers, not files).
  if (resolvedSource.rulesPath && targets.includes("claude")) {
    const rules = await discoverRules(resolvedSource.rulesPath);
    for (const rule of rules) {
      const localPath = path.join(targetDir, ".claude", "rules", rule.relativePath);
      if (!(await exists(localPath))) continue;
      const content = await fs.readFile(localPath, "utf-8");
      if (isManaged(content, metaOpts)) continue;
      const canonicalPath = path.join(resolvedSource.rulesPath, rule.relativePath);
      const downstreamPath = `.claude/rules/${rule.relativePath}`;
      if (await fileMatchesCanonical(localPath, canonicalPath, metaOpts)) {
        adopted.push(downstreamPath);
      } else {
        conflicts.push({ type: "rule", path: downstreamPath });
      }
    }
  }

  // Agents — Claude target only.
  if (resolvedSource.agentsPath && targets.includes("claude")) {
    const agents = await discoverAgents(resolvedSource.agentsPath);
    for (const agent of agents) {
      const localPath = path.join(targetDir, ".claude", "agents", agent.relativePath);
      if (!(await exists(localPath))) continue;
      const content = await fs.readFile(localPath, "utf-8");
      if (isManaged(content, metaOpts)) continue;
      const canonicalPath = path.join(resolvedSource.agentsPath, agent.relativePath);
      const downstreamPath = `.claude/agents/${agent.relativePath}`;
      if (await fileMatchesCanonical(localPath, canonicalPath, metaOpts)) {
        adopted.push(downstreamPath);
      } else {
        conflicts.push({ type: "agent", path: downstreamPath });
      }
    }
  }

  return { conflicts, adopted };
}

export async function sync(
  targetDir: string,
  resolvedSource: ResolvedSource,
  options: SyncOptions = { override: false, targets: ["claude"] },
): Promise<SyncResult> {
  // Get marker prefix from resolved source
  const markerPrefix = resolvedSource.markerPrefix;
  const metadataPrefix = toMetadataPrefix(markerPrefix);

  // Find all skill directories once (used by the overwrite guard and sync loop).
  const skillDirs = await fg("*/", {
    cwd: resolvedSource.skillsPath,
    onlyDirectories: true,
    deep: 1,
  });
  const skillNames = skillDirs.map((d) => d.replace(/\/$/, ""));

  // Pre-flight: never silently overwrite local content that differs from canonical
  // and isn't managed by agconf. Identical unmanaged files are adopted (reported in
  // result.adopted); divergent ones abort the whole sync unless --override. Runs
  // before any write, so a conflict leaves the working tree untouched.
  const collisions = await detectUnmanagedCollisions(
    targetDir,
    resolvedSource,
    options.targets,
    skillNames,
    metadataPrefix,
  );
  if (collisions.conflicts.length > 0 && !options.override) {
    throw new UnmanagedOverwriteError(collisions.conflicts);
  }

  // Read global AGENTS.md content
  const globalContent = await fs.readFile(resolvedSource.agentsMdPath, "utf-8");

  // Merge/write AGENTS.md (also gathers existing CLAUDE.md content)
  const mergeResult = await mergeAgentsMd(targetDir, globalContent, resolvedSource.source, {
    override: options.override,
    markerPrefix,
  });
  await writeAgentsMd(targetDir, mergeResult.content);

  // Consolidate CLAUDE.md files (regardless of target)
  // This merges content into AGENTS.md and creates root CLAUDE.md reference
  const consolidateResult = await consolidateClaudeMd(targetDir, mergeResult.hadDotClaudeClaudeMd);

  // Validate all skills have required frontmatter
  const validationErrors: SkillValidationError[] = [];
  for (const skillName of skillNames) {
    const skillMdPath = path.join(resolvedSource.skillsPath, skillName, "SKILL.md");
    try {
      const content = await fs.readFile(skillMdPath, "utf-8");
      const error = validateSkillFrontmatter(content, skillName, skillMdPath);
      if (error) {
        validationErrors.push(error);
      }
    } catch {
      // Expected: SKILL.md may not exist, will be handled during sync
    }
  }

  // Process each target
  const targetResults: TargetResult[] = [];
  let totalCopied = 0;
  const allModifiedSkills = new Set<string>();

  for (const target of options.targets) {
    const config = getTargetConfig(target);

    // Sync skills to this target
    const skillsResult = await syncSkillsToTarget(
      targetDir,
      resolvedSource.skillsPath,
      skillNames,
      config,
      markerPrefix,
    );
    totalCopied += skillsResult.copied;
    for (const skill of skillsResult.modifiedSkills) {
      allModifiedSkills.add(skill);
    }

    targetResults.push({
      target,
      skills: { copied: skillsResult.copied },
    });
  }

  // Migrate any skills left in the legacy `.codex/skills/` location to the new
  // `.agents/skills/` path. Only runs when Codex is a target and is a no-op once
  // the legacy directory is gone.
  let migratedCodexSkills: { moved: string[]; skipped: string[] } = { moved: [], skipped: [] };
  if (options.targets.includes("codex")) {
    migratedCodexSkills = await migrateLegacyCodexSkills(targetDir, { metadataPrefix });
  }

  // Sync rules if canonical has rules configured
  let rulesResult: RulesSyncResult | null = null;
  if (resolvedSource.rulesPath) {
    // Read current AGENTS.md content for potential Codex rules insertion
    const currentAgentsMd = await fs.readFile(path.join(targetDir, "AGENTS.md"), "utf-8");

    rulesResult = await syncRules({
      sourceRulesPath: resolvedSource.rulesPath,
      targetDir,
      targets: options.targets,
      markerPrefix,
      metadataPrefix: toMetadataPrefix(markerPrefix),
      agentsMdContent: currentAgentsMd,
    });

    // If Codex target and rules were found, update AGENTS.md with rules section
    if (rulesResult.updatedAgentsMd && options.targets.includes("codex")) {
      await writeAgentsMd(targetDir, rulesResult.updatedAgentsMd);
    }
  }

  // Sync agents if canonical has agents configured
  // Only Claude target supports agents (Codex does not have sub-agents)
  let agentsResult: AgentsSyncResult | null = null;
  let agentsSkipped = false;

  if (resolvedSource.agentsPath) {
    // Check if Claude target is included
    const hasClaudeTarget = options.targets.includes("claude");

    if (hasClaudeTarget) {
      agentsResult = await syncAgents({
        sourceAgentsPath: resolvedSource.agentsPath,
        targetDir,
        metadataPrefix: toMetadataPrefix(markerPrefix),
      });
    } else {
      // Agents exist but only Codex target - skip with warning
      // Note: In interactive mode, the caller should prompt the user
      // For now, we just skip and set the flag
      agentsSkipped = true;
    }
  }

  // Write lockfile
  const lockfileOptions: Parameters<typeof writeLockfile>[1] = {
    source: resolvedSource.source,
    globalBlockContent: globalContent,
    skills: skillNames,
    targets: options.targets,
    markerPrefix,
  };
  if (options.pinnedVersion) {
    lockfileOptions.pinnedVersion = options.pinnedVersion;
  }
  if (rulesResult && rulesResult.rules.length > 0) {
    lockfileOptions.rules = {
      files: rulesResult.rules.map((r) => r.relativePath),
      content_hash: rulesResult.contentHash,
    };
  }
  if (agentsResult && agentsResult.agents.length > 0) {
    lockfileOptions.agents = {
      files: agentsResult.agents.map((a) => a.relativePath),
      content_hash: agentsResult.contentHash,
    };
  }
  const lockfile = await writeLockfile(targetDir, lockfileOptions);

  const result: SyncResult = {
    lockfile,
    agentsMd: {
      merged: mergeResult.merged,
      changed: mergeResult.changed,
      preservedRepoContent: mergeResult.preservedRepoContent,
    },
    claudeMd: {
      created: consolidateResult.created,
      updated: consolidateResult.updated,
      deletedDotClaudeClaudeMd: consolidateResult.deletedDotClaudeClaudeMd,
    },
    targets: targetResults,
    skills: {
      synced: skillNames,
      modified: [...allModifiedSkills],
      totalCopied,
      validationErrors,
    },
    adopted: collisions.adopted,
    migratedCodexSkills,
  };

  if (rulesResult && rulesResult.rules.length > 0) {
    result.rules = {
      synced: rulesResult.rules.map((r) => r.relativePath),
      modified: rulesResult.modifiedRules,
      contentHash: rulesResult.contentHash,
      claudeFiles: rulesResult.claudeFiles,
      codexUpdated: rulesResult.updatedAgentsMd !== null,
    };
  }

  if (agentsResult && agentsResult.agents.length > 0) {
    result.agents = {
      synced: agentsResult.syncedFiles,
      modified: agentsResult.modifiedFiles,
      contentHash: agentsResult.contentHash,
      validationErrors: agentsResult.validationErrors,
    };
  } else if (agentsSkipped) {
    result.agents = {
      synced: [],
      modified: [],
      contentHash: "",
      validationErrors: [],
      skipped: true,
    };
  }

  return result;
}

interface SkillSyncResult {
  copied: number;
  modifiedSkills: string[];
}

async function syncSkillsToTarget(
  targetDir: string,
  sourceSkillsPath: string,
  skillNames: string[],
  config: TargetConfig,
  metadataPrefix: string,
): Promise<SkillSyncResult> {
  const targetSkillsPath = path.join(targetDir, config.skillsDir);
  let copied = 0;
  const modifiedSkills: string[] = [];

  for (const skillName of skillNames) {
    const sourceDir = path.join(sourceSkillsPath, skillName);
    const targetSkillDir = path.join(targetSkillsPath, skillName);

    const result = await copySkillDirectory(sourceDir, targetSkillDir, metadataPrefix);
    copied += result.copied;
    if (result.modified) {
      modifiedSkills.push(skillName);
    }
  }

  return { copied, modifiedSkills };
}

interface CopyResult {
  copied: number;
  modified: boolean;
}

/**
 * Recursively copy a directory tree from `srcDir` to `dstDir`.
 * Skips writes when the destination file's bytes already match.
 * Used for the inside of a skill dir (after we've handled SKILL.md separately).
 */
async function copyTree(srcDir: string, dstDir: string): Promise<CopyResult> {
  await fs.mkdir(dstDir, { recursive: true });
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  let copied = 0;
  let modified = false;

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);

    if (entry.isDirectory()) {
      const r = await copyTree(srcPath, dstPath);
      copied += r.copied;
      if (r.modified) modified = true;
    } else {
      let needsCopy = true;
      try {
        const [s, t] = await Promise.all([fs.readFile(srcPath), fs.readFile(dstPath)]);
        needsCopy = !s.equals(t);
      } catch {
        // Destination missing — needsCopy stays true
      }
      if (needsCopy) {
        await fs.copyFile(srcPath, dstPath);
        modified = true;
      }
      copied++;
    }
  }
  return { copied, modified };
}

/**
 * Copy a skill directory in three passes:
 *   1. Copy every file except SKILL.md (recursively).
 *   2. Compute `assets_hash` over what was written (everything except SKILL.md).
 *   3. Copy SKILL.md last, baking both `content_hash` and `assets_hash` into
 *      its frontmatter so `check` can later detect tampering of either the
 *      SKILL.md body or any sibling asset file without consulting canonical.
 * Returns whether any files were actually modified (content changed).
 */
async function copySkillDirectory(
  sourceDir: string,
  targetDir: string,
  metadataPrefix: string,
): Promise<CopyResult> {
  await fs.mkdir(targetDir, { recursive: true });

  let copied = 0;
  let modified = false;

  // Pass 1: copy every non-SKILL.md entry at the skill root.
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "SKILL.md" && !entry.isDirectory()) continue;
    const srcPath = path.join(sourceDir, entry.name);
    const dstPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      const r = await copyTree(srcPath, dstPath);
      copied += r.copied;
      if (r.modified) modified = true;
    } else {
      let needsCopy = true;
      try {
        const [s, t] = await Promise.all([fs.readFile(srcPath), fs.readFile(dstPath)]);
        needsCopy = !s.equals(t);
      } catch {
        // Destination missing — needsCopy stays true
      }
      if (needsCopy) {
        await fs.copyFile(srcPath, dstPath);
        modified = true;
      }
      copied++;
    }
  }

  // Pass 2: compute the aggregate hash of the asset files we just wrote.
  const assetsHash = await computeAssetsHash(targetDir, ["SKILL.md"]);

  // Pass 3: write SKILL.md with both hashes embedded.
  const skillMdSrc = path.join(sourceDir, "SKILL.md");
  const skillMdDst = path.join(targetDir, "SKILL.md");
  try {
    const skillContent = await fs.readFile(skillMdSrc, "utf-8");
    const withMetadata = addManagedMetadata(skillContent, { metadataPrefix, assetsHash });
    let existing: string | null = null;
    try {
      existing = await fs.readFile(skillMdDst, "utf-8");
    } catch {
      // Destination missing
    }
    if (existing !== withMetadata) {
      await fs.writeFile(skillMdDst, withMetadata, "utf-8");
      modified = true;
    }
    copied++;
  } catch {
    // SKILL.md may not exist in source — validateSkillFrontmatter surfaces this.
  }

  return { copied, modified };
}

export interface SyncStatus {
  hasSynced: boolean;
  lockfile: Lockfile | null;
  agentsMdExists: boolean;
  skillsExist: boolean;
  /** Schema compatibility warning (null if no warning) */
  schemaWarning: string | null;
  /** Schema compatibility error (null if no error) */
  schemaError: string | null;
}

export async function getSyncStatus(targetDir: string): Promise<SyncStatus> {
  const result = await readLockfile(targetDir);
  const agentsMdPath = path.join(targetDir, "AGENTS.md");
  // Skills can live under either target's location (.claude/skills for Claude,
  // .agents/skills for Codex), so treat the repo as "has skills" if either exists.
  const skillsPaths = [
    path.join(targetDir, ".claude", "skills"),
    path.join(targetDir, ".agents", "skills"),
  ];

  const [agentsMdExists, ...skillsExistFlags] = await Promise.all([
    fs
      .access(agentsMdPath)
      .then(() => true)
      .catch(() => false),
    ...skillsPaths.map((p) =>
      fs
        .access(p)
        .then(() => true)
        .catch(() => false),
    ),
  ]);
  const skillsExist = skillsExistFlags.some(Boolean);

  return {
    hasSynced: result !== null,
    lockfile: result?.lockfile ?? null,
    agentsMdExists,
    skillsExist,
    schemaWarning: result?.schemaCompatibility.warning ?? null,
    schemaError: result?.schemaCompatibility.error ?? null,
  };
}

/**
 * Find skills that were previously synced but are no longer in the current sync.
 */
export function findOrphanedSkills(previousSkills: string[], currentSkills: string[]): string[] {
  return previousSkills.filter((skill) => !currentSkills.includes(skill));
}

/** Options for deleting orphaned skills */
export interface DeleteOrphanedSkillsOptions {
  /** Metadata prefix to use for checking managed status (default: "agconf") */
  metadataPrefix?: string;
}

/**
 * Delete orphaned skill directories from all targets.
 * Only deletes skills that:
 * 1. Are managed (have managed metadata in SKILL.md)
 * 2. AND either:
 *    - Content hash matches (skill hasn't been modified), OR
 *    - Skill was in the previous lockfile (confirming it was synced)
 *
 * This prevents accidentally deleting skills that were manually copied.
 */
export async function deleteOrphanedSkills(
  targetDir: string,
  orphanedSkills: string[],
  targets: string[],
  previouslyTrackedSkills: string[],
  options: DeleteOrphanedSkillsOptions = {},
): Promise<{ deleted: string[]; skipped: string[] }> {
  const deleted: string[] = [];
  const skipped: string[] = [];
  const metadataOptions = options.metadataPrefix
    ? { metadataPrefix: options.metadataPrefix }
    : undefined;

  for (const skillName of orphanedSkills) {
    let wasDeleted = false;

    for (const target of targets) {
      const skillDir = path.join(targetDir, getSkillsDir(target), skillName);

      // Check if skill directory exists
      try {
        await fs.access(skillDir);
      } catch {
        // Expected: skill directory may not exist for this target
        continue;
      }

      // Check if the skill is managed before deleting
      const skillMdPath = path.join(skillDir, "SKILL.md");
      try {
        const content = await fs.readFile(skillMdPath, "utf-8");

        if (!isManaged(content, metadataOptions)) {
          // Not managed, skip deletion
          if (!skipped.includes(skillName)) {
            skipped.push(skillName);
          }
          continue;
        }

        // Additional safety check: only delete if either:
        // 1. The skill was in the previous lockfile (confirming it was synced), OR
        // 2. The content hash matches (skill hasn't been modified)
        const wasInPreviousLockfile = previouslyTrackedSkills.includes(skillName);
        const isUnmodified = !hasManualChanges(content, metadataOptions);

        if (!wasInPreviousLockfile && !isUnmodified) {
          // Skill is managed but wasn't in lockfile and has been modified
          // This could be a manually copied skill - skip to be safe
          if (!skipped.includes(skillName)) {
            skipped.push(skillName);
          }
          continue;
        }
      } catch {
        // Expected: SKILL.md may not exist, skip deletion to be safe
        if (!skipped.includes(skillName)) {
          skipped.push(skillName);
        }
        continue;
      }

      // Delete the skill directory
      await fs.rm(skillDir, { recursive: true, force: true });
      wasDeleted = true;
    }

    if (wasDeleted && !deleted.includes(skillName)) {
      deleted.push(skillName);
    }
  }

  return { deleted, skipped };
}

/**
 * One-time migration: Codex skills used to be written to `.codex/skills/`, but
 * current Codex only discovers project skills under `.agents/skills/` (see
 * `TARGET_CONFIGS.codex.skillsDir`). After skills are synced to the new
 * location, relocate any leftover managed skill dirs from the legacy
 * `.codex/skills/` path so they are not silently stranded (Codex would never
 * load them there).
 *
 * Mirrors {@link deleteOrphanedSkills} safety: only removes a legacy skill dir
 * that is agconf-managed AND unmodified (neither the SKILL.md body nor its
 * sibling assets changed). Unmanaged or locally-edited dirs are left in place
 * and reported as skipped. The `.codex/skills` directory itself is pruned when
 * it becomes empty; `.codex/` is never touched (Codex still uses it for agents).
 */
export async function migrateLegacyCodexSkills(
  targetDir: string,
  options: { metadataPrefix?: string } = {},
): Promise<{ moved: string[]; skipped: string[] }> {
  const moved: string[] = [];
  const skipped: string[] = [];
  const metadataOptions = options.metadataPrefix
    ? { metadataPrefix: options.metadataPrefix }
    : undefined;

  const legacyDir = path.join(targetDir, ".codex", "skills");
  let entries: string[];
  try {
    await fs.access(legacyDir);
    entries = await fg("*/", { cwd: legacyDir, onlyDirectories: true, deep: 1 });
  } catch {
    // No legacy directory — nothing to migrate.
    return { moved, skipped };
  }

  for (const entry of entries) {
    const skillName = entry.replace(/\/$/, "");
    const skillDir = path.join(legacyDir, skillName);
    const skillMdPath = path.join(skillDir, "SKILL.md");

    let content: string;
    try {
      content = await fs.readFile(skillMdPath, "utf-8");
    } catch {
      // No SKILL.md — not a managed skill dir we own; leave it untouched.
      skipped.push(skillName);
      continue;
    }

    if (!isManaged(content, metadataOptions)) {
      skipped.push(skillName);
      continue;
    }

    const bodyModified = hasManualChanges(content, metadataOptions);
    const assetsModified = await hasModifiedAssets(
      content,
      skillDir,
      ["SKILL.md"],
      metadataOptions,
    );
    if (bodyModified || assetsModified) {
      // Locally edited — don't delete; the user should reconcile it.
      skipped.push(skillName);
      continue;
    }

    await fs.rm(skillDir, { recursive: true, force: true });
    moved.push(skillName);
  }

  // Prune the now-empty legacy skills dir, but never `.codex` itself.
  try {
    const remaining = await fs.readdir(legacyDir);
    if (remaining.length === 0) {
      await fs.rmdir(legacyDir);
    }
  } catch {
    // Directory already gone or not empty — nothing to prune.
  }

  return { moved, skipped };
}

/**
 * Find rules that were previously synced but are no longer in the current sync.
 */
export function findOrphanedRules(previousRules: string[], currentRules: string[]): string[] {
  return previousRules.filter((rule) => !currentRules.includes(rule));
}

/**
 * Remove now-empty parent directories up to (but not including) `stopDir`.
 * Used after deleting a nested rule file so the rules tree does not accumulate
 * empty directories.
 */
async function removeEmptyDirsUp(startDir: string, stopDir: string): Promise<void> {
  let current = startDir;
  const stop = path.resolve(stopDir);
  while (path.resolve(current) !== stop && path.resolve(current).startsWith(stop)) {
    try {
      const entries = await fs.readdir(current);
      if (entries.length > 0) break;
      await fs.rmdir(current);
    } catch {
      // Directory missing or not empty - stop walking up.
      break;
    }
    current = path.dirname(current);
  }
}

/**
 * Delete orphaned rule files from file-based targets (Claude). Rules are only
 * stored as individual files for the Claude target; for Codex they are
 * concatenated into AGENTS.md and the rules section is regenerated on sync, so
 * removed rules drop out automatically there.
 *
 * Mirrors {@link deleteOrphanedSkills}: only deletes a rule that is managed AND
 * either was in the previous lockfile or is unmodified, so manually-authored or
 * locally-edited rule files are preserved.
 */
export async function deleteOrphanedRules(
  targetDir: string,
  orphanedRules: string[],
  targets: string[],
  previouslyTrackedRules: string[],
  options: { metadataPrefix?: string } = {},
): Promise<{ deleted: string[]; skipped: string[] }> {
  const deleted: string[] = [];
  const skipped: string[] = [];
  const metadataOptions = options.metadataPrefix
    ? { metadataPrefix: options.metadataPrefix }
    : undefined;

  for (const rulePath of orphanedRules) {
    let wasDeleted = false;

    for (const target of targets) {
      const rulesDir = path.join(targetDir, `.${target}`, "rules");
      const fullPath = path.join(rulesDir, rulePath);

      // Check if rule file exists for this target
      try {
        await fs.access(fullPath);
      } catch {
        // Expected: rule file may not exist for this target (e.g. Codex)
        continue;
      }

      try {
        const content = await fs.readFile(fullPath, "utf-8");

        if (!isManaged(content, metadataOptions)) {
          if (!skipped.includes(rulePath)) {
            skipped.push(rulePath);
          }
          continue;
        }

        // Additional safety check: only delete if either:
        // 1. The rule was in the previous lockfile (confirming it was synced), OR
        // 2. The content hash matches (rule hasn't been modified)
        const wasInPreviousLockfile = previouslyTrackedRules.includes(rulePath);
        const isUnmodified = !hasManualChanges(content, metadataOptions);

        if (!wasInPreviousLockfile && !isUnmodified) {
          if (!skipped.includes(rulePath)) {
            skipped.push(rulePath);
          }
          continue;
        }
      } catch {
        // Can't read file, skip deletion to be safe
        if (!skipped.includes(rulePath)) {
          skipped.push(rulePath);
        }
        continue;
      }

      // Delete the rule file and prune any directories it leaves empty.
      await fs.unlink(fullPath);
      await removeEmptyDirsUp(path.dirname(fullPath), rulesDir);
      wasDeleted = true;
    }

    if (wasDeleted && !deleted.includes(rulePath)) {
      deleted.push(rulePath);
    }
  }

  return { deleted, skipped };
}
