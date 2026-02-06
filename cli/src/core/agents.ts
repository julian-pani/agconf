import { computeContentHash as computeSkillContentHash } from "./skill-metadata.js";

// =============================================================================
// Interfaces
// =============================================================================

/**
 * Frontmatter fields that can be present in an agent file.
 * Required: name, description
 * Optional: tools, model, etc.
 */
export interface AgentFrontmatter {
  /** Display name for the agent (required) */
  name: string;

  /** Description of what the agent does (required) */
  description: string;

  /** Tools available to the agent */
  tools?: string[];

  /** Model to use for the agent */
  model?: string;

  /**
   * Metadata added by agconf during sync.
   */
  metadata?: Record<string, string>;

  /**
   * Any other frontmatter fields from the original agent.
   */
  [key: string]: unknown;
}

/**
 * Parsed representation of an agent file.
 */
export interface Agent {
  /**
   * Relative path from agents directory root.
   * Example: "code-reviewer.md"
   */
  relativePath: string;

  /**
   * Full file content including frontmatter.
   */
  rawContent: string;

  /**
   * Parsed frontmatter (null if no frontmatter or parse error).
   */
  frontmatter: AgentFrontmatter | null;

  /**
   * Content without frontmatter (body only).
   */
  body: string;
}

/**
 * Validation error for agent frontmatter.
 */
export interface AgentValidationError {
  agentPath: string;
  errors: string[];
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
  frontmatter: AgentFrontmatter | null;
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
    return { frontmatter: frontmatter as AgentFrontmatter, body };
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
        // Check next lines to see if it's an array
        const nextLineIndex = lines.indexOf(line) + 1;
        if (nextLineIndex < lines.length && lines[nextLineIndex]?.match(/^\s+-\s+/)) {
          currentValue = [];
          isArray = true;
        } else {
          currentValue = {};
          isArray = false;
        }
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

  return result;
}

/**
 * Serialize frontmatter object back to YAML string.
 */
function serializeFrontmatter(frontmatter: AgentFrontmatter): string {
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
// Agent parsing
// =============================================================================

/**
 * Parse markdown file content into an Agent object.
 *
 * @param content - Raw markdown file content
 * @param relativePath - Relative path from agents directory (e.g., "code-reviewer.md")
 * @returns Parsed Agent object
 */
export function parseAgent(content: string, relativePath: string): Agent {
  const { frontmatter, body } = parseFrontmatter(content);

  // Handle array-style tools in frontmatter
  if (frontmatter) {
    const toolsMatch = content.match(/^---\r?\n[\s\S]*?tools:\s*\n((?:\s+-\s+.+\n?)+)/m);
    if (toolsMatch?.[1]) {
      const toolsContent = toolsMatch[1];
      const tools = toolsContent
        .split("\n")
        .filter((line) => line.trim().startsWith("-"))
        .map((line) =>
          line
            .replace(/^\s+-\s+/, "")
            .replace(/^["']|["']$/g, "")
            .trim(),
        )
        .filter((t) => t.length > 0);
      if (tools.length > 0) {
        frontmatter.tools = tools;
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
// Validation
// =============================================================================

/**
 * Validate that an agent file has required frontmatter fields.
 * Returns validation errors if any required fields are missing.
 *
 * @param content - Agent file content
 * @param agentPath - Path to the agent file (for error messages)
 * @returns Validation error or null if valid
 */
export function validateAgentFrontmatter(
  content: string,
  agentPath: string,
): AgentValidationError | null {
  const { frontmatter } = parseFrontmatter(content);
  const errors: string[] = [];

  // Check for frontmatter existence
  if (!frontmatter || Object.keys(frontmatter).length === 0) {
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
    return { agentPath, errors };
  }
  return null;
}

// =============================================================================
// Agent metadata
// =============================================================================

/**
 * Add managed metadata to an agent file for Claude target.
 * This marks the file as managed by agconf and stores a content hash
 * for change detection.
 *
 * Note: Unlike rules, agents use flat files so we don't need source_path.
 *
 * @param agent - The agent to add metadata to
 * @param metadataPrefix - Prefix for metadata keys (e.g., "agconf")
 * @returns Agent content with metadata frontmatter added
 */
export function addAgentMetadata(agent: Agent, metadataPrefix: string): string {
  const managedKey = `${metadataPrefix}_managed`;
  const hashKey = `${metadataPrefix}_content_hash`;

  // Compute hash using the same function that check will use
  // This ensures hash consistency between sync and check operations
  // Convert underscore prefix to dash prefix for skill-metadata compatibility
  const hashMetadataPrefix = metadataPrefix.replace(/_/g, "-");
  const contentHash = computeSkillContentHash(agent.rawContent, {
    metadataPrefix: hashMetadataPrefix,
  });

  // Build new frontmatter
  const existingFrontmatter = agent.frontmatter || ({} as AgentFrontmatter);
  const existingMetadata = (existingFrontmatter.metadata as Record<string, string>) || {};

  const newMetadata: Record<string, string> = {
    ...existingMetadata,
    [managedKey]: "true",
    [hashKey]: contentHash,
  };

  // Build complete frontmatter, preserving other fields
  const newFrontmatter: AgentFrontmatter = {
    name: existingFrontmatter.name || "",
    description: existingFrontmatter.description || "",
  };

  // Copy non-metadata fields first (like tools, model, etc.)
  for (const [key, value] of Object.entries(existingFrontmatter)) {
    if (key !== "metadata") {
      newFrontmatter[key] = value;
    }
  }

  // Add metadata section
  newFrontmatter.metadata = newMetadata;

  // Serialize
  const yamlContent = serializeFrontmatter(newFrontmatter);
  return `---\n${yamlContent}\n---\n${agent.body}`;
}
