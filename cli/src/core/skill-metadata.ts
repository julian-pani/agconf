import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import fg from "fast-glob";
import { getMetadataKeys } from "../config/schema.js";
import { parseFrontmatter as parseFrontmatterShared, serializeFrontmatter } from "./frontmatter.js";
import {
  hasGlobalBlockChanges,
  hasRulesSectionChanges,
  isAgentsMdManaged,
  type MarkerOptions,
  parseAgentsMd,
  parseGlobalBlockMetadata,
  parseRulesSection,
} from "./markers.js";

// Default metadata prefix
const DEFAULT_METADATA_PREFIX = "agconf";

/**
 * Options for metadata operations.
 */
export interface MetadataOptions extends MarkerOptions {
  /** Prefix for metadata keys (default: "agconf") */
  metadataPrefix?: string;
}

/**
 * Get metadata key names for a given prefix.
 */
export function getMetadataKeyNames(prefix: string = DEFAULT_METADATA_PREFIX) {
  return getMetadataKeys(prefix);
}

/**
 * Metadata fields added to synced skill files.
 * These are stored under the `metadata` key in YAML frontmatter.
 *
 * Note: Source and sync timestamp are tracked in lockfile
 * to avoid unnecessary file changes on every sync.
 */
export interface ManagedMetadata {
  managed: string; // "true"
  content_hash: string; // e.g., "sha256:abc123..."
}

/**
 * Parse YAML frontmatter from markdown content.
 * Returns the frontmatter object and the body content.
 *
 * Note: This wrapper ensures backward compatibility by returning
 * an empty object instead of null when no frontmatter exists.
 */
export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
  raw: string;
} {
  const result = parseFrontmatterShared(content);
  return {
    frontmatter: result.frontmatter ?? {},
    body: result.body,
    raw: result.raw,
  };
}

/**
 * Validation error for skill frontmatter.
 */
export interface SkillValidationError {
  skillName: string;
  path: string;
  errors: string[];
}

/**
 * Validate that a skill file has required frontmatter fields.
 * Returns validation errors if any required fields are missing.
 */
export function validateSkillFrontmatter(
  content: string,
  skillName: string,
  filePath: string,
): SkillValidationError | null {
  const { frontmatter } = parseFrontmatter(content);
  const errors: string[] = [];

  // Check for frontmatter existence
  if (Object.keys(frontmatter).length === 0) {
    errors.push("Missing frontmatter (must have --- delimiters)");
  } else {
    // Check for required fields
    if (!frontmatter.name) {
      errors.push("Missing required field: name");
    }
    if (!frontmatter.description) {
      errors.push("Missing required field: description");
    }
  }

  if (errors.length > 0) {
    return { skillName, path: filePath, errors };
  }
  return null;
}

/**
 * Compute content hash excluding managed metadata.
 * This allows detecting manual changes to synced files.
 */
export function computeContentHash(content: string, options: MetadataOptions = {}): string {
  const stripped = stripManagedMetadata(content, options);
  const hash = createHash("sha256").update(stripped).digest("hex");
  return `sha256:${hash.slice(0, 12)}`;
}

/**
 * Strip managed metadata from content for hashing purposes.
 * Removes metadata fields with the configured prefix.
 */
export function stripManagedMetadata(content: string, options: MetadataOptions = {}): string {
  const { metadataPrefix = DEFAULT_METADATA_PREFIX } = options;
  const { frontmatter, body } = parseFrontmatter(content);

  if (Object.keys(frontmatter).length === 0) {
    return content;
  }

  // Get the key prefix (convert dashes to underscores for key names)
  const keyPrefix = `${metadataPrefix.replace(/-/g, "_")}_`;

  // Remove managed fields from metadata
  if (frontmatter.metadata && typeof frontmatter.metadata === "object") {
    const metadata = frontmatter.metadata as Record<string, string>;
    const cleanedMetadata: Record<string, string> = {};

    for (const [key, value] of Object.entries(metadata)) {
      // Skip keys with configured prefix
      if (!key.startsWith(keyPrefix)) {
        cleanedMetadata[key] = value;
      }
    }

    if (Object.keys(cleanedMetadata).length > 0) {
      frontmatter.metadata = cleanedMetadata;
    } else {
      delete frontmatter.metadata;
    }
  }

  // If frontmatter is now empty after stripping, return just the body
  // This ensures content that originally had no frontmatter hashes the same
  // after having managed metadata added and then stripped
  if (Object.keys(frontmatter).length === 0) {
    return body;
  }

  // Rebuild content with remaining frontmatter
  const yamlContent = serializeFrontmatter(frontmatter);
  return `---\n${yamlContent}\n---\n${body}`;
}

/**
 * Add managed metadata to a skill file content.
 * Only adds managed flag and content hash - source/timestamp are in lockfile.
 */
export function addManagedMetadata(content: string, options: MetadataOptions = {}): string {
  const { metadataPrefix = DEFAULT_METADATA_PREFIX } = options;
  const { frontmatter, body } = parseFrontmatter(content);

  // Compute hash of original content (without any existing managed metadata)
  const contentHash = computeContentHash(content, options);

  // Ensure metadata object exists
  if (!frontmatter.metadata || typeof frontmatter.metadata !== "object") {
    frontmatter.metadata = {};
  }

  const metadata = frontmatter.metadata as Record<string, string>;
  const keys = getMetadataKeyNames(metadataPrefix);

  // Add managed fields (only managed flag and hash - source/timestamp in lockfile)
  metadata[keys.managed] = "true";
  metadata[keys.contentHash] = contentHash;

  // Rebuild content
  const yamlContent = serializeFrontmatter(frontmatter);
  return `---\n${yamlContent}\n---\n${body}`;
}

/**
 * Check if a file has been manually modified since last sync.
 * Returns true if the content hash doesn't match.
 */
export function hasManualChanges(content: string, options: MetadataOptions = {}): boolean {
  const { metadataPrefix = DEFAULT_METADATA_PREFIX } = options;
  const { frontmatter } = parseFrontmatter(content);

  if (!frontmatter.metadata || typeof frontmatter.metadata !== "object") {
    return false; // No metadata means not managed
  }

  const metadata = frontmatter.metadata as Record<string, string>;
  const keys = getMetadataKeyNames(metadataPrefix);
  const storedHash = metadata[keys.contentHash];

  if (!storedHash) {
    return false; // No hash stored
  }

  const currentHash = computeContentHash(content, options);
  return storedHash !== currentHash;
}

/**
 * Check if a file is managed by agconf.
 */
export function isManaged(content: string, options: MetadataOptions = {}): boolean {
  const { metadataPrefix = DEFAULT_METADATA_PREFIX } = options;
  const { frontmatter } = parseFrontmatter(content);

  if (!frontmatter.metadata || typeof frontmatter.metadata !== "object") {
    return false;
  }

  const metadata = frontmatter.metadata as Record<string, string>;
  const keys = getMetadataKeyNames(metadataPrefix);
  return metadata[keys.managed] === "true";
}

/**
 * Result of checking a skill file for modifications.
 */
export interface SkillFileCheckResult {
  /** Relative path to the skill file */
  path: string;
  /** Skill name (directory name) */
  skillName: string;
  /** Whether the file is managed by agconf */
  isManaged: boolean;
  /** Whether the file has been manually modified */
  hasChanges: boolean;
}

/**
 * Check all synced skill files in a target directory for manual modifications.
 * Returns information about each managed SKILL.md file found.
 */
export async function checkSkillFiles(
  targetDir: string,
  targets: string[] = ["claude"],
  options: MetadataOptions = {},
): Promise<SkillFileCheckResult[]> {
  const results: SkillFileCheckResult[] = [];

  for (const target of targets) {
    const skillsDir = path.join(targetDir, `.${target}`, "skills");

    // Check if skills directory exists
    try {
      await fs.access(skillsDir);
    } catch {
      // Expected: skills directory may not exist for this target
      continue;
    }

    // Find all SKILL.md files
    const skillFiles = await fg("*/SKILL.md", {
      cwd: skillsDir,
      absolute: false,
    });

    for (const skillFile of skillFiles) {
      const fullPath = path.join(skillsDir, skillFile);
      const skillName = path.dirname(skillFile);
      const relativePath = path.join(`.${target}`, "skills", skillFile);

      try {
        const content = await fs.readFile(fullPath, "utf-8");
        const fileIsManaged = isManaged(content, options);
        const hasChanges = fileIsManaged && hasManualChanges(content, options);

        results.push({
          path: relativePath,
          skillName,
          isManaged: fileIsManaged,
          hasChanges,
        });
      } catch (_error) {
        // Expected: file read may fail, skip this skill file
      }
    }
  }

  return results;
}

/**
 * Check all synced rule files in a target directory for manual modifications.
 * Returns information about each managed rule file found.
 */
export async function checkRuleFiles(
  targetDir: string,
  targets: string[] = ["claude"],
  options: MetadataOptions = {},
): Promise<RuleFileCheckResult[]> {
  const results: RuleFileCheckResult[] = [];

  for (const target of targets) {
    const rulesDir = path.join(targetDir, `.${target}`, "rules");

    // Check if rules directory exists
    try {
      await fs.access(rulesDir);
    } catch {
      // Expected: rules directory may not exist for this target
      continue;
    }

    // Find all .md files recursively
    const ruleFiles = await fg("**/*.md", {
      cwd: rulesDir,
      absolute: false,
    });

    for (const ruleFile of ruleFiles) {
      const fullPath = path.join(rulesDir, ruleFile);
      const relativePath = path.join(`.${target}`, "rules", ruleFile);

      try {
        const content = await fs.readFile(fullPath, "utf-8");
        const fileIsManaged = isManaged(content, options);
        const hasChanges = fileIsManaged && hasManualChanges(content, options);

        // Extract rulePath from metadata if available
        const { frontmatter } = parseFrontmatter(content);
        const metadata = frontmatter.metadata as Record<string, string> | undefined;
        const keyPrefix = (options.metadataPrefix || "agconf").replace(/-/g, "_");
        const rulePath = metadata?.[`${keyPrefix}_source_path`] || ruleFile;

        results.push({
          path: relativePath,
          rulePath,
          isManaged: fileIsManaged,
          hasChanges,
        });
      } catch (_error) {
        // Expected: file read may fail, skip this rule file
      }
    }
  }

  return results;
}

/**
 * Result of checking a managed file for modifications.
 * Used for skill files, rule files, agent files, and AGENTS.md.
 */
export interface ManagedFileCheckResult {
  /** Relative path to the file */
  path: string;
  /** Type of file */
  type: "skill" | "agents" | "rule" | "rules-section" | "agent";
  /** Skill name if type is skill */
  skillName?: string;
  /** Rule source path if type is rule (e.g., "security/auth.md") */
  rulePath?: string;
  /** Agent path if type is agent (e.g., "code-reviewer.md") */
  agentPath?: string;
  /** Whether the file is managed by agconf */
  isManaged: boolean;
  /** Whether the file has been manually modified */
  hasChanges: boolean;
  /** Source info from the file's metadata */
  source?: string;
  /** When the file was synced */
  syncedAt?: string;
}

/**
 * Result of checking a rule file for modifications.
 */
export interface RuleFileCheckResult {
  /** Relative path to the rule file (from target dir) */
  path: string;
  /** Original rule path (e.g., "security/auth.md") */
  rulePath: string;
  /** Whether the file is managed by agconf */
  isManaged: boolean;
  /** Whether the file has been manually modified */
  hasChanges: boolean;
}

/**
 * Result of checking an agent file for modifications.
 */
export interface AgentFileCheckResult {
  /** Relative path to the agent file (from target dir) */
  path: string;
  /** Agent file name (e.g., "code-reviewer.md") */
  agentPath: string;
  /** Whether the file is managed by agconf */
  isManaged: boolean;
  /** Whether the file has been manually modified */
  hasChanges: boolean;
}

/**
 * Check all synced agent files in a target directory for manual modifications.
 * Returns information about each managed agent file found.
 */
export async function checkAgentFiles(
  targetDir: string,
  options: MetadataOptions = {},
): Promise<AgentFileCheckResult[]> {
  const results: AgentFileCheckResult[] = [];

  // Agents are only synced to Claude target
  const agentsDir = path.join(targetDir, ".claude", "agents");

  // Check if agents directory exists
  try {
    await fs.access(agentsDir);
  } catch {
    // Expected: agents directory may not exist
    return results;
  }

  // Find all .md files (agents are flat, not nested)
  const agentFiles = await fg("*.md", {
    cwd: agentsDir,
    absolute: false,
  });

  for (const agentFile of agentFiles) {
    const fullPath = path.join(agentsDir, agentFile);
    const relativePath = path.join(".claude", "agents", agentFile);

    try {
      const content = await fs.readFile(fullPath, "utf-8");
      const fileIsManaged = isManaged(content, options);
      const hasChanges = fileIsManaged && hasManualChanges(content, options);

      results.push({
        path: relativePath,
        agentPath: agentFile,
        isManaged: fileIsManaged,
        hasChanges,
      });
    } catch (_error) {
      // Expected: file read may fail, skip this agent file
    }
  }

  return results;
}

/**
 * Get only the modified agent files.
 */
export async function getModifiedAgentFiles(
  targetDir: string,
  options: MetadataOptions = {},
): Promise<AgentFileCheckResult[]> {
  const allFiles = await checkAgentFiles(targetDir, options);
  return allFiles.filter((f) => f.hasChanges);
}

/**
 * Check AGENTS.md for manual modifications.
 */
export async function checkAgentsMd(
  targetDir: string,
  options: MarkerOptions = {},
): Promise<ManagedFileCheckResult | null> {
  const agentsMdPath = path.join(targetDir, "AGENTS.md");

  try {
    const content = await fs.readFile(agentsMdPath, "utf-8");
    const managed = isAgentsMdManaged(content, options);

    if (!managed) {
      return null;
    }

    const hasChanges = hasGlobalBlockChanges(content, options);

    // Extract metadata
    const parsed = parseAgentsMd(content, options);
    let source: string | undefined;
    let syncedAt: string | undefined;

    if (parsed.globalBlock) {
      const metadata = parseGlobalBlockMetadata(parsed.globalBlock);
      source = metadata.source;
      syncedAt = metadata.syncedAt;
    }

    const result: ManagedFileCheckResult = {
      path: "AGENTS.md",
      type: "agents",
      isManaged: managed,
      hasChanges,
    };
    if (source !== undefined) result.source = source;
    if (syncedAt !== undefined) result.syncedAt = syncedAt;
    return result;
  } catch {
    // Expected: AGENTS.md may not exist or can't be read
    return null;
  }
}

/** Options for checking managed files */
export interface CheckManagedFilesOptions {
  /** Marker prefix for AGENTS.md (default: "agconf") */
  markerPrefix?: string;
  /** Metadata prefix for skill files (default: "agconf") */
  metadataPrefix?: string;
}

/**
 * Check all managed files (skills, rules, and AGENTS.md) for modifications.
 */
export async function checkAllManagedFiles(
  targetDir: string,
  targets: string[] = ["claude"],
  options: CheckManagedFilesOptions = {},
): Promise<ManagedFileCheckResult[]> {
  const results: ManagedFileCheckResult[] = [];
  const markerOptions = options.markerPrefix ? { prefix: options.markerPrefix } : {};
  const metadataOptions = options.metadataPrefix ? { metadataPrefix: options.metadataPrefix } : {};

  // Check AGENTS.md global block
  const agentsMdResult = await checkAgentsMd(targetDir, markerOptions);
  if (agentsMdResult) {
    results.push(agentsMdResult);
  }

  // Check AGENTS.md rules section (for Codex target where rules are concatenated)
  const rulesSectionResult = await checkAgentsMdRulesSection(targetDir, markerOptions);
  if (rulesSectionResult) {
    results.push(rulesSectionResult);
  }

  // Check skill files
  const skillFiles = await checkSkillFiles(targetDir, targets, metadataOptions);
  for (const skill of skillFiles) {
    if (skill.isManaged) {
      results.push({
        path: skill.path,
        type: "skill",
        skillName: skill.skillName,
        isManaged: skill.isManaged,
        hasChanges: skill.hasChanges,
      });
    }
  }

  // Check rule files (for Claude target where rules are separate files)
  const ruleFiles = await checkRuleFiles(targetDir, targets, metadataOptions);
  for (const rule of ruleFiles) {
    if (rule.isManaged) {
      results.push({
        path: rule.path,
        type: "rule",
        rulePath: rule.rulePath,
        isManaged: rule.isManaged,
        hasChanges: rule.hasChanges,
      });
    }
  }

  // Check agent files (for Claude target only)
  if (targets.includes("claude")) {
    const agentFiles = await checkAgentFiles(targetDir, metadataOptions);
    for (const agent of agentFiles) {
      if (agent.isManaged) {
        results.push({
          path: agent.path,
          type: "agent",
          agentPath: agent.agentPath,
          isManaged: agent.isManaged,
          hasChanges: agent.hasChanges,
        });
      }
    }
  }

  return results;
}

/**
 * Check AGENTS.md rules section for manual modifications.
 * This is used for Codex target where rules are concatenated into AGENTS.md.
 */
export async function checkAgentsMdRulesSection(
  targetDir: string,
  options: MarkerOptions = {},
): Promise<ManagedFileCheckResult | null> {
  const agentsMdPath = path.join(targetDir, "AGENTS.md");

  try {
    const content = await fs.readFile(agentsMdPath, "utf-8");
    const parsed = parseRulesSection(content, options);

    if (!parsed.hasMarkers || !parsed.content) {
      return null; // No rules section
    }

    const hasChanges = hasRulesSectionChanges(content, options);

    return {
      path: "AGENTS.md",
      type: "rules-section",
      isManaged: true,
      hasChanges,
    };
  } catch {
    // Expected: AGENTS.md may not exist or can't be read
    return null;
  }
}

/**
 * Get all modified managed files (skills and AGENTS.md).
 */
export async function getModifiedManagedFiles(
  targetDir: string,
  targets: string[] = ["claude"],
  options: CheckManagedFilesOptions = {},
): Promise<ManagedFileCheckResult[]> {
  const allFiles = await checkAllManagedFiles(targetDir, targets, options);
  return allFiles.filter((f) => f.hasChanges);
}
