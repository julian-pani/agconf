/**
 * Shared frontmatter parsing and serialization utilities.
 *
 * This module provides a unified implementation for parsing and serializing
 * YAML frontmatter in markdown files. Used by skills, rules, and agents.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Result of parsing frontmatter from markdown content.
 */
export interface ParsedFrontmatter {
  /**
   * Parsed frontmatter object, or null if no frontmatter exists.
   */
  frontmatter: Record<string, unknown> | null;

  /**
   * Content without frontmatter (body only).
   */
  body: string;

  /**
   * Raw YAML string (between --- delimiters), or empty string if no frontmatter.
   */
  raw: string;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Regex to match YAML frontmatter at the start of a file.
 * Matches content between --- delimiters.
 */
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

// =============================================================================
// Parsing
// =============================================================================

/**
 * Parse YAML frontmatter from markdown content.
 *
 * @param content - Raw markdown file content
 * @returns Parsed frontmatter, body, and raw YAML string
 *
 * @example
 * ```ts
 * const { frontmatter, body, raw } = parseFrontmatter(content);
 * if (frontmatter) {
 *   console.log(frontmatter.name);
 * }
 * ```
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match || !match[1]) {
    return { frontmatter: null, body: content, raw: "" };
  }

  const rawYaml = match[1];
  const body = content.slice(match[0].length);

  try {
    const frontmatter = parseSimpleYaml(rawYaml);
    return { frontmatter, body, raw: rawYaml };
  } catch {
    // Parse error - treat as no frontmatter
    return { frontmatter: null, body: content, raw: "" };
  }
}

/**
 * Simple YAML parser for frontmatter.
 * Handles basic key-value pairs, nested metadata objects, and arrays.
 *
 * Supported formats:
 * - Simple values: `key: value`
 * - Quoted values: `key: "value with: special chars"`
 * - Nested objects: `metadata:\n  key: value`
 * - Block arrays: `items:\n  - item1\n  - item2`
 * - Inline arrays: `items: [a, b, c]`
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  let currentKey: string | null = null;
  let currentValue: unknown = null;
  let isArray = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;

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
        // Could be nested object or array - determine based on next line
        const nextLineIndex = i + 1;
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

// =============================================================================
// Serialization
// =============================================================================

/**
 * Serialize frontmatter object back to YAML string.
 *
 * @param frontmatter - Object to serialize
 * @returns YAML string (without --- delimiters)
 *
 * @example
 * ```ts
 * const yaml = serializeFrontmatter({ name: "test", tools: ["Read", "Write"] });
 * // Returns:
 * // name: test
 * // tools:
 * //   - "Read"
 * //   - "Write"
 * ```
 */
export function serializeFrontmatter(frontmatter: Record<string, unknown>): string {
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
 * Values need quoting if they contain special YAML characters
 * or could be interpreted as booleans/numbers.
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
