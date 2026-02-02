import { createHash } from "node:crypto";
import { computeContentHash as computeSkillContentHash } from "./skill-metadata.js";

// =============================================================================
// Interfaces
// =============================================================================

/**
 * Frontmatter fields that can be present in a rule file.
 */
export interface RuleFrontmatter {
  /**
   * Glob patterns for conditional rule loading (Claude-specific feature).
   * Example: ["src/api/all.ts", "lib/api/all.ts"]
   */
  paths?: string[];

  /**
   * Metadata added by agent-conf during sync or by the rule author.
   */
  metadata?: Record<string, string>;

  /**
   * Any other frontmatter fields from the original rule.
   */
  [key: string]: unknown;
}

/**
 * Parsed representation of a rule file.
 */
export interface Rule {
  /**
   * Relative path from rules directory root.
   * Example: "security/api-auth.md"
   */
  relativePath: string;

  /**
   * Full file content including frontmatter.
   */
  rawContent: string;

  /**
   * Parsed frontmatter (null if no frontmatter or parse error).
   */
  frontmatter: RuleFrontmatter | null;

  /**
   * Content without frontmatter (body only).
   */
  body: string;
}

// =============================================================================
// Frontmatter parsing
// =============================================================================

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Parse YAML frontmatter from markdown content.
 * Returns null frontmatter if parsing fails or no frontmatter exists.
 */
function parseFrontmatter(content: string): {
  frontmatter: RuleFrontmatter | null;
  body: string;
} {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match || !match[1]) {
    return { frontmatter: null, body: content };
  }

  const rawYaml = match[1];
  const body = content.slice(match[0].length);

  try {
    const frontmatter = parseSimpleYaml(rawYaml);
    return { frontmatter: frontmatter as RuleFrontmatter, body };
  } catch {
    // Parse error - treat as no frontmatter
    return { frontmatter: null, body: content };
  }
}

/**
 * Simple YAML parser for frontmatter.
 * Handles basic key-value pairs, nested metadata objects, and arrays.
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  let currentKey: string | null = null;
  let currentValue: unknown = null;
  let isArray = false;

  for (const line of lines) {
    // Skip empty lines
    if (line.trim() === "") continue;

    // Check for array item (starts with spaces and dash)
    if (line.match(/^\s+-\s+/)) {
      if (currentKey && isArray) {
        const value = line
          .replace(/^\s+-\s+/, "")
          .replace(/^["']|["']$/g, "")
          .trim();
        (currentValue as string[]).push(value);
      }
      continue;
    }

    // Check for nested content (indented key: value)
    if (line.startsWith("  ") && currentKey && typeof currentValue === "object" && !isArray) {
      const nestedMatch = line.match(/^\s+(\w+):\s*["']?(.*)["']?$/);
      if (nestedMatch?.[1] && nestedMatch[2] !== undefined) {
        const key = nestedMatch[1];
        const value = nestedMatch[2].replace(/^["']|["']$/g, "");
        (currentValue as Record<string, string>)[key] = value;
      }
      continue;
    }

    // Save previous value if we're moving to a new key
    if (currentKey && currentValue !== null) {
      result[currentKey] = currentValue;
      currentValue = null;
      isArray = false;
    }

    // Parse top-level key-value
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match?.[1] && match[2] !== undefined) {
      const key = match[1];
      const value = match[2].trim();
      currentKey = key;

      if (value === "") {
        // Could be nested object or array - we'll determine based on next line
        // For now, assume object (metadata) or check for array indicator
        currentValue = {};
        isArray = false;
      } else if (value.startsWith("[") && value.endsWith("]")) {
        // Inline array: key: [item1, item2]
        try {
          currentValue = JSON.parse(value);
          result[key] = currentValue;
          currentKey = null;
          currentValue = null;
        } catch {
          result[key] = value.replace(/^["']|["']$/g, "");
          currentKey = null;
          currentValue = null;
        }
      } else {
        // Simple value - remove quotes if present
        result[key] = value.replace(/^["']|["']$/g, "");
        currentKey = null;
        currentValue = null;
      }
    }
  }

  // Don't forget the last value
  if (currentKey && currentValue !== null) {
    result[currentKey] = currentValue;
  }

  // Post-process: Check if any "object" values should actually be arrays
  // by checking if the first line after the key starts with a dash
  return result;
}

/**
 * Serialize frontmatter object back to YAML string.
 */
function serializeFrontmatter(frontmatter: RuleFrontmatter): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      // Array value
      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - "${item}"`);
      }
    } else if (typeof value === "object") {
      // Nested object (like metadata)
      lines.push(`${key}:`);
      for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, string>)) {
        const quotedValue = needsQuoting(String(nestedValue))
          ? `"${String(nestedValue)}"`
          : String(nestedValue);
        lines.push(`  ${nestedKey}: ${quotedValue}`);
      }
    } else {
      // Simple value
      const strValue = String(value);
      const quotedValue = needsQuoting(strValue) ? `"${strValue}"` : strValue;
      lines.push(`${key}: ${quotedValue}`);
    }
  }

  return lines.join("\n");
}

/**
 * Check if a YAML value needs quoting.
 */
function needsQuoting(value: string): boolean {
  return (
    value.includes(":") ||
    value.includes("#") ||
    value.includes("@") ||
    value === "true" ||
    value === "false" ||
    /^\d+$/.test(value)
  );
}

// =============================================================================
// Heading level adjustment
// =============================================================================

/**
 * Adjusts markdown heading levels by a given increment.
 *
 * @param content - Markdown content to adjust
 * @param increment - Number of levels to add (positive = deeper)
 * @returns Adjusted markdown content
 *
 * Rules:
 * - Only ATX headings are adjusted (# style, not underline style)
 * - Headings in code blocks are NOT adjusted
 * - Maximum heading level is 6 (h7+ stay as h6)
 * - Minimum heading level is 1 (can't go below h1)
 */
export function adjustHeadingLevels(content: string, increment: number): string {
  if (!content) return "";

  // Track if we're inside a code block
  let inCodeBlock = false;

  return content
    .split("\n")
    .map((line) => {
      // Check for code block boundaries (``` style)
      if (line.trim().startsWith("```")) {
        inCodeBlock = !inCodeBlock;
        return line;
      }

      // Skip lines in code blocks
      if (inCodeBlock) {
        return line;
      }

      // Match ATX headings: ^(#{1,6})(\s+.*)$
      const headingMatch = line.match(/^(#{1,6})(\s+.*)$/);
      if (!headingMatch || !headingMatch[1]) {
        return line;
      }

      const hashes = headingMatch[1];
      const rest = headingMatch[2] || "";
      const currentLevel = hashes.length;
      const newLevel = Math.min(6, Math.max(1, currentLevel + increment));

      return "#".repeat(newLevel) + rest;
    })
    .join("\n");
}

// =============================================================================
// Rule parsing
// =============================================================================

/**
 * Parse markdown file content into a Rule object.
 *
 * @param content - Raw markdown file content
 * @param relativePath - Relative path from rules directory (e.g., "security/api-auth.md")
 * @returns Parsed Rule object
 */
export function parseRule(content: string, relativePath: string): Rule {
  const { frontmatter, body } = parseFrontmatter(content);

  // Handle array-style paths in frontmatter
  // The simple parser may have issues with arrays, so let's re-parse specifically for paths
  if (frontmatter) {
    const pathsMatch = content.match(/^---\r?\n[\s\S]*?paths:\s*\n((?:\s+-\s+.+\n?)+)/m);
    if (pathsMatch?.[1]) {
      const pathsContent = pathsMatch[1];
      const paths = pathsContent
        .split("\n")
        .filter((line) => line.trim().startsWith("-"))
        .map((line) =>
          line
            .replace(/^\s+-\s+/, "")
            .replace(/^["']|["']$/g, "")
            .trim(),
        )
        .filter((p) => p.length > 0);
      if (paths.length > 0) {
        frontmatter.paths = paths;
      }
    }
  }

  return {
    relativePath,
    rawContent: content,
    frontmatter,
    body,
  };
}

// =============================================================================
// Path comment generation
// =============================================================================

/**
 * Generates a comment describing the paths a rule applies to.
 * Only included if the rule has a `paths` frontmatter field.
 *
 * @param paths - Array of glob patterns
 * @returns HTML comment string or empty string if no paths
 */
export function generatePathsComment(paths: string[] | undefined): string {
  if (!paths || paths.length === 0) return "";

  // Single path
  if (paths.length === 1) {
    return `<!-- Applies to: ${paths[0]} -->`;
  }

  // Multiple paths
  return `<!-- Applies to:\n${paths.map((p) => `     - ${p}`).join("\n")}\n-->`;
}

// =============================================================================
// Rules section generation (for Codex target)
// =============================================================================

/**
 * Generate the rules section for insertion into AGENTS.md.
 * This is used for Codex target which concatenates all rules into one section.
 *
 * @param rules - Array of Rule objects to include
 * @param markerPrefix - Prefix for marker comments (e.g., "agent-conf")
 * @returns Complete rules section with markers
 */
export function generateRulesSection(rules: Rule[], markerPrefix: string): string {
  // Sort rules alphabetically by path for deterministic output
  const sortedRules = [...rules].sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  // First, generate the content that will be hashed (excludes metadata comments)
  const contentParts: string[] = [];
  contentParts.push("# Project Rules");
  contentParts.push("");

  for (const rule of sortedRules) {
    contentParts.push(`<!-- Rule: ${rule.relativePath} -->`);

    if (rule.frontmatter?.paths && rule.frontmatter.paths.length > 0) {
      contentParts.push(generatePathsComment(rule.frontmatter.paths));
    }

    const adjustedBody = adjustHeadingLevels(rule.body.trim(), 1);
    contentParts.push(adjustedBody);
    contentParts.push("");
  }

  // Compute hash of the content (same content that check will hash after stripping metadata)
  const contentForHash = contentParts.join("\n").trim();
  const hash = createHash("sha256").update(contentForHash).digest("hex");
  const contentHash = `sha256:${hash.slice(0, 12)}`;

  // Now build the full section with markers and metadata
  const parts: string[] = [];
  parts.push(`<!-- ${markerPrefix}:rules:start -->`);
  parts.push(`<!-- DO NOT EDIT THIS SECTION - Managed by agent-conf -->`);
  parts.push(`<!-- Content hash: ${contentHash} -->`);
  parts.push(`<!-- Rule count: ${rules.length} -->`);
  parts.push("");
  parts.push(contentForHash);
  parts.push("");
  parts.push(`<!-- ${markerPrefix}:rules:end -->`);

  return parts.join("\n");
}

// =============================================================================
// AGENTS.md update
// =============================================================================

/**
 * Insert or replace the rules section in AGENTS.md content.
 *
 * Placement strategy:
 * 1. If rules markers exist: replace content between them
 * 2. If no rules markers but global:end exists: insert after global:end
 * 3. If no global:end but repo:start exists: insert before repo:start
 * 4. Otherwise: append at end
 *
 * @param agentsMdContent - Current AGENTS.md content
 * @param rulesSection - New rules section to insert
 * @param markerPrefix - Prefix for marker comments
 * @returns Updated AGENTS.md content
 */
export function updateAgentsMdWithRules(
  agentsMdContent: string,
  rulesSection: string,
  markerPrefix: string,
): string {
  const rulesStartMarker = `<!-- ${markerPrefix}:rules:start -->`;
  const rulesEndMarker = `<!-- ${markerPrefix}:rules:end -->`;

  // Check if rules markers already exist
  const startIdx = agentsMdContent.indexOf(rulesStartMarker);
  const endIdx = agentsMdContent.indexOf(rulesEndMarker);

  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing rules section
    const before = agentsMdContent.slice(0, startIdx);
    const after = agentsMdContent.slice(endIdx + rulesEndMarker.length);
    return before + rulesSection + after;
  }

  // No existing rules section - find insertion point
  const globalEndMarker = `<!-- ${markerPrefix}:global:end -->`;
  const repoStartMarker = `<!-- ${markerPrefix}:repo:start -->`;

  // Try to insert between global end and repo start
  const globalEndIdx = agentsMdContent.indexOf(globalEndMarker);
  if (globalEndIdx !== -1) {
    const insertPoint = globalEndIdx + globalEndMarker.length;
    const before = agentsMdContent.slice(0, insertPoint);
    const after = agentsMdContent.slice(insertPoint);
    return `${before}\n\n${rulesSection}${after}`;
  }

  // No global section, try to insert before repo section
  const repoStartIdx = agentsMdContent.indexOf(repoStartMarker);
  if (repoStartIdx !== -1) {
    const before = agentsMdContent.slice(0, repoStartIdx);
    const after = agentsMdContent.slice(repoStartIdx);
    return `${before}${rulesSection}\n\n${after}`;
  }

  // No markers at all - append at end
  return `${agentsMdContent.trimEnd()}\n\n${rulesSection}\n`;
}

// =============================================================================
// Rule metadata (for Claude target)
// =============================================================================

/**
 * Add managed metadata to a rule file for Claude target.
 * This marks the file as managed by agent-conf and stores a content hash
 * for change detection.
 *
 * @param rule - The rule to add metadata to
 * @param metadataPrefix - Prefix for metadata keys (e.g., "agent_conf")
 * @returns Rule content with metadata frontmatter added
 */
export function addRuleMetadata(rule: Rule, metadataPrefix: string): string {
  const managedKey = `${metadataPrefix}_managed`;
  const hashKey = `${metadataPrefix}_content_hash`;
  const sourceKey = `${metadataPrefix}_source_path`;

  // Compute hash using the same function that check will use
  // This ensures hash consistency between sync and check operations
  // Convert underscore prefix to dash prefix for skill-metadata compatibility
  const hashMetadataPrefix = metadataPrefix.replace(/_/g, "-");
  const contentHash = computeSkillContentHash(rule.rawContent, {
    metadataPrefix: hashMetadataPrefix,
  });

  // Build new frontmatter
  const existingFrontmatter = rule.frontmatter || {};
  const existingMetadata = (existingFrontmatter.metadata as Record<string, string>) || {};

  const newMetadata: Record<string, string> = {
    ...existingMetadata,
    [managedKey]: "true",
    [hashKey]: contentHash,
    [sourceKey]: rule.relativePath,
  };

  // Build complete frontmatter, preserving other fields
  const newFrontmatter: RuleFrontmatter = {};

  // Copy non-metadata fields first (like paths)
  for (const [key, value] of Object.entries(existingFrontmatter)) {
    if (key !== "metadata") {
      newFrontmatter[key] = value;
    }
  }

  // Add metadata section
  newFrontmatter.metadata = newMetadata;

  // Serialize
  const yamlContent = serializeFrontmatter(newFrontmatter);
  return `---\n${yamlContent}\n---\n${rule.body}`;
}
