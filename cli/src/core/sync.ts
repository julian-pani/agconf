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
  parseAgent,
  validateAgentFrontmatter,
} from "./agents.js";
import { readLockfile, writeLockfile } from "./lockfile.js";
import {
  addManagedMetadata,
  hasManualChanges,
  isManaged,
  type SkillValidationError,
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
import { getTargetConfig, type Target, type TargetConfig } from "./targets.js";

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
 * Discover all markdown agent files in a directory (flat, not recursive).
 */
async function discoverAgents(agentsDir: string): Promise<Agent[]> {
  try {
    await fs.access(agentsDir);
  } catch {
    // Directory doesn't exist - return empty array
    return [];
  }

  // Agents are flat files (no nested directories)
  const agentFiles = await fg("*.md", {
    cwd: agentsDir,
    absolute: false,
  });

  const agents: Agent[] = [];
  for (const relativePath of agentFiles) {
    const fullPath = path.join(agentsDir, relativePath);
    const content = await fs.readFile(fullPath, "utf-8");
    agents.push(parseAgent(content, relativePath));
  }

  // Sort by path for deterministic order in lockfile and outputs
  agents.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  return agents;
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
}

export async function sync(
  targetDir: string,
  resolvedSource: ResolvedSource,
  options: SyncOptions = { override: false, targets: ["claude"] },
): Promise<SyncResult> {
  // Get marker prefix from resolved source
  const markerPrefix = resolvedSource.markerPrefix;

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

  // Find all skill directories once
  const skillDirs = await fg("*/", {
    cwd: resolvedSource.skillsPath,
    onlyDirectories: true,
    deep: 1,
  });
  const skillNames = skillDirs.map((d) => d.replace(/\/$/, ""));

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
  const targetSkillsPath = path.join(targetDir, config.dir, "skills");
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
 * Copy a skill directory, adding managed metadata to SKILL.md files.
 * Returns whether any files were actually modified (content changed).
 */
async function copySkillDirectory(
  sourceDir: string,
  targetDir: string,
  metadataPrefix: string,
): Promise<CopyResult> {
  await fs.mkdir(targetDir, { recursive: true });

  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  let copied = 0;
  let modified = false;

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      const subResult = await copySkillDirectory(sourcePath, targetPath, metadataPrefix);
      copied += subResult.copied;
      if (subResult.modified) modified = true;
    } else if (entry.name === "SKILL.md") {
      // Add managed metadata to SKILL.md files
      const content = await fs.readFile(sourcePath, "utf-8");
      const contentWithMetadata = addManagedMetadata(content, { metadataPrefix });

      // Check if file exists and has same content
      let existingContent: string | null = null;
      try {
        existingContent = await fs.readFile(targetPath, "utf-8");
      } catch {
        // File doesn't exist
      }

      if (existingContent !== contentWithMetadata) {
        await fs.writeFile(targetPath, contentWithMetadata, "utf-8");
        modified = true;
      }
      copied++;
    } else {
      // Check if file exists and has same content
      let needsCopy = true;
      try {
        const [sourceContent, targetContent] = await Promise.all([
          fs.readFile(sourcePath),
          fs.readFile(targetPath),
        ]);
        needsCopy = !sourceContent.equals(targetContent);
      } catch {
        // Target doesn't exist
      }

      if (needsCopy) {
        await fs.copyFile(sourcePath, targetPath);
        modified = true;
      }
      copied++;
    }
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
  const skillsPath = path.join(targetDir, ".claude", "skills");

  const [agentsMdExists, skillsExist] = await Promise.all([
    fs
      .access(agentsMdPath)
      .then(() => true)
      .catch(() => false),
    fs
      .access(skillsPath)
      .then(() => true)
      .catch(() => false),
  ]);

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
      const skillDir = path.join(targetDir, `.${target}`, "skills", skillName);

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
