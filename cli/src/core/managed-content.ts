import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import fg from "fast-glob";
import { toMetadataPrefix } from "../utils/prefix.js";
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

/**
 * Hash a buffer using the standard agconf format (sha256:<12-hex>).
 * Mirrors the format used by the sync path for non-SKILL.md skill files.
 */
function hashBuffer(content: Buffer): string {
  const hash = createHash("sha256").update(content).digest("hex");
  return `sha256:${hash.slice(0, 12)}`;
}

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
 * Generate metadata key names based on the configured prefix.
 * Used in skill frontmatter to track managed content.
 */
export function getMetadataKeys(prefix: string = DEFAULT_METADATA_PREFIX) {
  const keyPrefix = toMetadataPrefix(prefix);
  return {
    managed: `${keyPrefix}_managed`,
    contentHash: `${keyPrefix}_content_hash`,
  };
}

/**
 * Metadata fields added to synced skill files.
 * These are stored under the `metadata` key in YAML frontmatter.
 *
 * Note: Source and sync timestamp are tracked in lockfile
 * to avoid unnecessary file changes on every sync.
 */
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
  const keyPrefix = `${toMetadataPrefix(metadataPrefix)}_`;

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
  const keys = getMetadataKeys(metadataPrefix);

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
  const keys = getMetadataKeys(metadataPrefix);
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
  const keys = getMetadataKeys(metadataPrefix);
  return metadata[keys.managed] === "true";
}

/**
 * Result of checking a skill file for modifications.
 */
interface SkillFileCheckResult {
  /** Relative path to the skill file */
  path: string;
  /** Skill name (directory name) */
  skillName: string;
  /** Path relative to the skill directory (e.g. "SKILL.md", "references/foo.py") */
  skillFilePath: string;
  /** Whether the file is managed by agconf */
  isManaged: boolean;
  /** Whether the file has been manually modified */
  hasChanges: boolean;
  /** Expected hash for non-SKILL.md files (from lockfile), if any */
  expectedHash?: string;
  /** Current hash for non-SKILL.md files, if any */
  currentHash?: string;
}

/**
 * Check all synced skill files in a target directory for manual modifications.
 * Reports SKILL.md (via frontmatter hash) and all non-SKILL.md files
 * (e.g. references/, scripts/) inside managed skill directories. Non-SKILL.md
 * files are detected as modified when their content hash differs from the
 * hash recorded in the lockfile at sync time.
 *
 * @param skillFileHashes Optional per-skill map of recorded hashes for
 *   non-SKILL.md files (skillName → relativePath → hash). When absent, only
 *   SKILL.md modifications are reported (legacy behavior).
 */
export async function checkSkillFiles(
  targetDir: string,
  targets: string[] = ["claude"],
  options: MetadataOptions = {},
  skillFileHashes: Record<string, Record<string, string>> = {},
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

    // Find all SKILL.md files (each one anchors a managed skill directory)
    const skillMdFiles = await fg("*/SKILL.md", {
      cwd: skillsDir,
      absolute: false,
    });

    for (const skillMdFile of skillMdFiles) {
      const skillName = path.dirname(skillMdFile);
      const skillDir = path.join(skillsDir, skillName);
      const skillMdFullPath = path.join(skillsDir, skillMdFile);
      const skillMdRelativePath = path.join(`.${target}`, "skills", skillMdFile);

      let skillIsManaged = false;
      try {
        const content = await fs.readFile(skillMdFullPath, "utf-8");
        skillIsManaged = isManaged(content, options);
        const hasChanges = skillIsManaged && hasManualChanges(content, options);

        results.push({
          path: skillMdRelativePath,
          skillName,
          skillFilePath: "SKILL.md",
          isManaged: skillIsManaged,
          hasChanges,
        });
      } catch (_error) {
        // Expected: file read may fail, skip this skill file
      }

      if (!skillIsManaged) {
        continue;
      }

      // Walk the rest of the skill directory: references/, scripts/, etc.
      // These have no frontmatter, so we compare their content hash against
      // the hash recorded in the lockfile when the skill was last synced.
      const recordedHashes = skillFileHashes[skillName] ?? {};
      const subFiles = await fg("**/*", {
        cwd: skillDir,
        onlyFiles: true,
        dot: true,
      });

      for (const subFile of subFiles) {
        if (subFile === "SKILL.md") continue;

        const subFullPath = path.join(skillDir, subFile);
        const subRelativePath = path.join(`.${target}`, "skills", skillName, subFile);
        const expectedHash = recordedHashes[subFile];

        let currentHash: string;
        try {
          const bytes = await fs.readFile(subFullPath);
          currentHash = hashBuffer(bytes);
        } catch (_error) {
          // Expected: file may have vanished between glob and read
          continue;
        }

        // Treat the file as managed-by-association with its skill.
        // hasChanges fires when:
        //   - we have a recorded hash and it differs (modified), OR
        //   - there is no recorded hash for this file (added downstream)
        const hasRecordedHash = expectedHash !== undefined;
        const hasChanges = hasRecordedHash ? expectedHash !== currentHash : true;

        const result: SkillFileCheckResult = {
          path: subRelativePath,
          skillName,
          skillFilePath: subFile,
          isManaged: true,
          hasChanges,
          currentHash,
        };
        if (expectedHash !== undefined) {
          result.expectedHash = expectedHash;
        }
        results.push(result);
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
        const keyPrefix = toMetadataPrefix(options.metadataPrefix || "agconf");
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
  type: "skill" | "skill-asset" | "agents" | "rule" | "rules-section" | "agent";
  /** Skill name if type is skill or skill-asset */
  skillName?: string;
  /** Path relative to the skill dir, if type is skill-asset (e.g. "references/foo.py") */
  skillFilePath?: string;
  /** Hash recorded in the lockfile for skill-asset files, if any */
  expectedHash?: string;
  /** Current hash on disk for skill-asset files */
  currentHash?: string;
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
interface RuleFileCheckResult {
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
interface AgentFileCheckResult {
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
  /**
   * Per-skill content hashes for non-SKILL.md files, as recorded in the lockfile.
   * Used to detect manual modifications to references/, scripts/, etc.
   */
  skillFileHashes?: Record<string, Record<string, string>>;
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

  // Check skill files (SKILL.md + non-SKILL.md assets like references/, scripts/)
  const skillFiles = await checkSkillFiles(
    targetDir,
    targets,
    metadataOptions,
    options.skillFileHashes ?? {},
  );
  for (const skill of skillFiles) {
    if (!skill.isManaged) continue;
    if (skill.skillFilePath === "SKILL.md") {
      results.push({
        path: skill.path,
        type: "skill",
        skillName: skill.skillName,
        skillFilePath: skill.skillFilePath,
        isManaged: skill.isManaged,
        hasChanges: skill.hasChanges,
      });
    } else {
      const entry: ManagedFileCheckResult = {
        path: skill.path,
        type: "skill-asset",
        skillName: skill.skillName,
        skillFilePath: skill.skillFilePath,
        isManaged: skill.isManaged,
        hasChanges: skill.hasChanges,
      };
      if (skill.currentHash !== undefined) entry.currentHash = skill.currentHash;
      if (skill.expectedHash !== undefined) entry.expectedHash = skill.expectedHash;
      results.push(entry);
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
