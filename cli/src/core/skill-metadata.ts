import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import fg from "fast-glob";
import { getMetadataKeys } from "../config/schema.js";
import {
  hasGlobalBlockChanges,
  isAgentsMdManaged,
  parseAgentsMd,
  parseGlobalBlockMetadata,
  type MarkerOptions,
} from "./markers.js";

// Default metadata prefix
const DEFAULT_METADATA_PREFIX = "agent-conf";

/**
 * Options for metadata operations.
 */
export interface MetadataOptions extends MarkerOptions {
  /** Prefix for metadata keys (default: "agent-conf") */
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

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Parse YAML frontmatter from markdown content.
 * Returns the frontmatter object and the body content.
 */
export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
  raw: string;
} {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match || !match[1]) {
    return { frontmatter: {}, body: content, raw: "" };
  }

  const rawYaml = match[1];
  const body = content.slice(match[0].length);
  const frontmatter = parseSimpleYaml(rawYaml);

  return { frontmatter, body, raw: rawYaml };
}

/**
 * Simple YAML parser for frontmatter.
 * Handles basic key-value pairs and nested metadata objects.
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  let currentKey: string | null = null;
  let nestedObject: Record<string, string> | null = null;

  for (const line of lines) {
    // Skip empty lines
    if (line.trim() === "") continue;

    // Check for nested content (indented lines)
    if (line.startsWith("  ") && currentKey && nestedObject !== null) {
      const nestedMatch = line.match(/^\s+(\w+):\s*["']?(.*)["']?$/);
      if (nestedMatch?.[1] && nestedMatch[2] !== undefined) {
        const key = nestedMatch[1];
        const value = nestedMatch[2];
        nestedObject[key] = value.replace(/^["']|["']$/g, "");
      }
      continue;
    }

    // Save previous nested object if we're moving to a new key
    if (currentKey && nestedObject !== null) {
      result[currentKey] = nestedObject;
      nestedObject = null;
    }

    // Parse top-level key-value
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match?.[1] && match[2] !== undefined) {
      const key = match[1];
      const value = match[2];
      currentKey = key;

      if (value.trim() === "") {
        // This is a nested object (like metadata:)
        nestedObject = {};
      } else {
        // Simple value - remove quotes if present
        result[key] = value.replace(/^["']|["']$/g, "");
      }
    }
  }

  // Don't forget the last nested object
  if (currentKey && nestedObject !== null) {
    result[currentKey] = nestedObject;
  }

  return result;
}

/**
 * Serialize frontmatter object back to YAML string.
 */
function serializeFrontmatter(frontmatter: Record<string, unknown>): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (typeof value === "object" && value !== null) {
      lines.push(`${key}:`);
      for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, string>)) {
        // Quote values that might need it
        const quotedValue = needsQuoting(String(nestedValue))
          ? `"${String(nestedValue)}"`
          : String(nestedValue);
        lines.push(`  ${nestedKey}: ${quotedValue}`);
      }
    } else {
      // Handle multiline descriptions
      const strValue = String(value);
      if (strValue.length > 80 || strValue.includes("\n")) {
        lines.push(`${key}: ${strValue}`);
      } else {
        lines.push(`${key}: ${strValue}`);
      }
    }
  }

  return lines.join("\n");
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
 * Check if a YAML value needs quoting.
 */
function needsQuoting(value: string): boolean {
  // Quote if contains special characters or looks like a boolean/number
  return (
    value.includes(":") ||
    value.includes("#") ||
    value.includes("@") ||
    value === "true" ||
    value === "false" ||
    /^\d+$/.test(value)
  );
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
  const keyPrefix = metadataPrefix.replace(/-/g, "_") + "_";

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

  // Rebuild content
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
 * Check if a file is managed by agent-conf.
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
  /** Whether the file is managed by agent-conf */
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
): Promise<SkillFileCheckResult[]> {
  const results: SkillFileCheckResult[] = [];

  for (const target of targets) {
    const skillsDir = path.join(targetDir, `.${target}`, "skills");

    // Check if skills directory exists
    try {
      await fs.access(skillsDir);
    } catch {
      continue; // Skills directory doesn't exist for this target
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
        const fileIsManaged = isManaged(content);
        const hasChanges = fileIsManaged && hasManualChanges(content);

        results.push({
          path: relativePath,
          skillName,
          isManaged: fileIsManaged,
          hasChanges,
        });
      } catch (_error) {}
    }
  }

  return results;
}

/**
 * Get only the modified skill files.
 */
export async function getModifiedSkillFiles(
  targetDir: string,
  targets: string[] = ["claude"],
): Promise<SkillFileCheckResult[]> {
  const allFiles = await checkSkillFiles(targetDir, targets);
  return allFiles.filter((f) => f.hasChanges);
}

/**
 * Result of checking a managed file for modifications.
 * Used for both skill files and AGENTS.md.
 */
export interface ManagedFileCheckResult {
  /** Relative path to the file */
  path: string;
  /** Type of file */
  type: "skill" | "agents";
  /** Skill name if type is skill */
  skillName?: string;
  /** Whether the file is managed by agent-conf */
  isManaged: boolean;
  /** Whether the file has been manually modified */
  hasChanges: boolean;
  /** Source info from the file's metadata */
  source?: string;
  /** When the file was synced */
  syncedAt?: string;
}

/**
 * Check AGENTS.md for manual modifications.
 */
export async function checkAgentsMd(targetDir: string): Promise<ManagedFileCheckResult | null> {
  const agentsMdPath = path.join(targetDir, "AGENTS.md");

  try {
    const content = await fs.readFile(agentsMdPath, "utf-8");
    const isManaged = isAgentsMdManaged(content);

    if (!isManaged) {
      return null;
    }

    const hasChanges = hasGlobalBlockChanges(content);

    // Extract metadata
    const parsed = parseAgentsMd(content);
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
      isManaged,
      hasChanges,
    };
    if (source !== undefined) result.source = source;
    if (syncedAt !== undefined) result.syncedAt = syncedAt;
    return result;
  } catch {
    return null; // File doesn't exist or can't be read
  }
}

/**
 * Check all managed files (skills and AGENTS.md) for modifications.
 */
export async function checkAllManagedFiles(
  targetDir: string,
  targets: string[] = ["claude"],
): Promise<ManagedFileCheckResult[]> {
  const results: ManagedFileCheckResult[] = [];

  // Check AGENTS.md
  const agentsMdResult = await checkAgentsMd(targetDir);
  if (agentsMdResult) {
    results.push(agentsMdResult);
  }

  // Check skill files
  const skillFiles = await checkSkillFiles(targetDir, targets);
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

  return results;
}

/**
 * Get all modified managed files (skills and AGENTS.md).
 */
export async function getModifiedManagedFiles(
  targetDir: string,
  targets: string[] = ["claude"],
): Promise<ManagedFileCheckResult[]> {
  const allFiles = await checkAllManagedFiles(targetDir, targets);
  return allFiles.filter((f) => f.hasChanges);
}
