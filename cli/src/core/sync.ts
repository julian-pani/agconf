import * as fs from "node:fs/promises";
import * as path from "node:path";
import fg from "fast-glob";
import type { Lockfile } from "../schemas/lockfile.js";
import { readLockfile, writeLockfile } from "./lockfile.js";
import { ensureClaudeMd, mergeAgentsMd, writeAgentsMd } from "./merge.js";
import {
  addManagedMetadata,
  type SkillValidationError,
  validateSkillFrontmatter,
} from "./skill-metadata.js";
import type { ResolvedSource } from "./source.js";
import { getTargetConfig, type Target, type TargetConfig } from "./targets.js";

export interface SyncOptions {
  override: boolean;
  targets: Target[];
  /** Pinned version to record in lockfile */
  pinnedVersion?: string;
}

export interface TargetResult {
  target: Target;
  instructionsMd: {
    created: boolean;
    updated: boolean;
    location: "root" | "dotdir" | null;
    contentMerged: boolean;
  };
  skills: {
    copied: number;
  };
}

export interface SyncResult {
  lockfile: Lockfile;
  agentsMd: {
    merged: boolean;
    preservedRepoContent: boolean;
  };
  targets: TargetResult[];
  skills: {
    synced: string[];
    totalCopied: number;
    validationErrors: SkillValidationError[];
  };
}

export async function sync(
  targetDir: string,
  resolvedSource: ResolvedSource,
  options: SyncOptions = { override: false, targets: ["claude"] },
): Promise<SyncResult> {
  // Read global AGENTS.md content
  const globalContent = await fs.readFile(resolvedSource.agentsMdPath, "utf-8");

  // Merge/write AGENTS.md (also gathers existing CLAUDE.md content)
  const mergeResult = await mergeAgentsMd(targetDir, globalContent, resolvedSource.source, {
    override: options.override,
  });
  await writeAgentsMd(targetDir, mergeResult.content);

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
      // Skip if SKILL.md doesn't exist (will be handled elsewhere)
    }
  }

  // Process each target
  const targetResults: TargetResult[] = [];
  let totalCopied = 0;

  for (const target of options.targets) {
    const config = getTargetConfig(target);

    // Sync skills to this target
    const skillsCopied = await syncSkillsToTarget(
      targetDir,
      resolvedSource.skillsPath,
      skillNames,
      config,
    );
    totalCopied += skillsCopied;

    // Only Claude needs an instructions file with @AGENTS.md reference
    // Other targets (codex, etc.) read AGENTS.md directly
    let instructionsResult: TargetResult["instructionsMd"];
    if (config.instructionsFile) {
      instructionsResult = await ensureInstructionsMd(
        targetDir,
        config,
        target === "claude" ? mergeResult.claudeMdLocation : null,
      );
    } else {
      instructionsResult = {
        created: false,
        updated: false,
        location: null,
        contentMerged: false,
      };
    }

    targetResults.push({
      target,
      instructionsMd: instructionsResult,
      skills: { copied: skillsCopied },
    });
  }

  // Write lockfile
  const lockfileOptions: Parameters<typeof writeLockfile>[1] = {
    source: resolvedSource.source,
    globalBlockContent: globalContent,
    skills: skillNames,
    targets: options.targets,
  };
  if (options.pinnedVersion) {
    lockfileOptions.pinnedVersion = options.pinnedVersion;
  }
  const lockfile = await writeLockfile(targetDir, lockfileOptions);

  return {
    lockfile,
    agentsMd: {
      merged: mergeResult.merged,
      preservedRepoContent: mergeResult.preservedRepoContent,
    },
    targets: targetResults,
    skills: {
      synced: skillNames,
      totalCopied,
      validationErrors,
    },
  };
}

async function syncSkillsToTarget(
  targetDir: string,
  sourceSkillsPath: string,
  skillNames: string[],
  config: TargetConfig,
): Promise<number> {
  const targetSkillsPath = path.join(targetDir, config.dir, "skills");
  let copied = 0;

  for (const skillName of skillNames) {
    const sourceDir = path.join(sourceSkillsPath, skillName);
    const targetSkillDir = path.join(targetSkillsPath, skillName);

    const filesCopied = await copySkillDirectory(sourceDir, targetSkillDir);
    copied += filesCopied;
  }

  return copied;
}

/**
 * Copy a skill directory, adding managed metadata to SKILL.md files.
 */
async function copySkillDirectory(sourceDir: string, targetDir: string): Promise<number> {
  await fs.mkdir(targetDir, { recursive: true });

  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  let copied = 0;

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copied += await copySkillDirectory(sourcePath, targetPath);
    } else if (entry.name === "SKILL.md") {
      // Add managed metadata to SKILL.md files
      const content = await fs.readFile(sourcePath, "utf-8");
      const contentWithMetadata = addManagedMetadata(content);
      await fs.writeFile(targetPath, contentWithMetadata, "utf-8");
      copied++;
    } else {
      // Copy other files as-is
      await fs.copyFile(sourcePath, targetPath);
      copied++;
    }
  }

  return copied;
}

async function ensureInstructionsMd(
  targetDir: string,
  config: TargetConfig,
  existingLocation: "root" | "dotclaude" | null,
): Promise<{
  created: boolean;
  updated: boolean;
  location: "root" | "dotdir" | null;
  contentMerged: boolean;
}> {
  // Only Claude needs an instructions file
  if (!config.instructionsFile) {
    return { created: false, updated: false, location: null, contentMerged: false };
  }

  // Use the existing ensureClaudeMd logic for Claude
  const result = await ensureClaudeMd(targetDir, existingLocation);
  return {
    created: result.created,
    updated: result.updated,
    location: result.location === "dotclaude" ? "dotdir" : result.location,
    contentMerged: result.contentMerged,
  };
}

export interface SyncStatus {
  hasSynced: boolean;
  lockfile: Lockfile | null;
  agentsMdExists: boolean;
  skillsExist: boolean;
}

export async function getSyncStatus(targetDir: string): Promise<SyncStatus> {
  const lockfile = await readLockfile(targetDir);
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
    hasSynced: lockfile !== null,
    lockfile,
    agentsMdExists,
    skillsExist,
  };
}

/**
 * Find skills that were previously synced but are no longer in the current sync.
 */
export function findOrphanedSkills(previousSkills: string[], currentSkills: string[]): string[] {
  return previousSkills.filter((skill) => !currentSkills.includes(skill));
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
): Promise<{ deleted: string[]; skipped: string[] }> {
  const deleted: string[] = [];
  const skipped: string[] = [];

  for (const skillName of orphanedSkills) {
    let wasDeleted = false;

    for (const target of targets) {
      const skillDir = path.join(targetDir, `.${target}`, "skills", skillName);

      // Check if skill directory exists
      try {
        await fs.access(skillDir);
      } catch {
        continue; // Directory doesn't exist for this target
      }

      // Check if the skill is managed before deleting
      const skillMdPath = path.join(skillDir, "SKILL.md");
      try {
        const content = await fs.readFile(skillMdPath, "utf-8");
        const { isManaged, hasManualChanges } = await import("./skill-metadata.js");

        if (!isManaged(content)) {
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
        const isUnmodified = !hasManualChanges(content);

        if (!wasInPreviousLockfile && !isUnmodified) {
          // Skill is managed but wasn't in lockfile and has been modified
          // This could be a manually copied skill - skip to be safe
          if (!skipped.includes(skillName)) {
            skipped.push(skillName);
          }
          continue;
        }
      } catch {
        // SKILL.md doesn't exist, skip deletion to be safe
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
