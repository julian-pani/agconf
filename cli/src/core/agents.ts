import * as fs from "node:fs/promises";
import * as path from "node:path";
import fg from "fast-glob";
import { toMarkerPrefix } from "../utils/prefix.js";
import { parseFrontmatter as parseFrontmatterShared, serializeFrontmatter } from "./frontmatter.js";
import { computeContentHash, getMetadataKeys } from "./managed-content.js";

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
// Frontmatter parsing (wrapper for type safety)
// =============================================================================

/**
 * Parse YAML frontmatter from markdown content.
 * Returns null frontmatter if parsing fails or no frontmatter exists.
 */
function parseFrontmatter(content: string): {
  frontmatter: AgentFrontmatter | null;
  body: string;
} {
  const result = parseFrontmatterShared(content);
  return {
    frontmatter: result.frontmatter as AgentFrontmatter | null,
    body: result.body,
  };
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
/**
 * Discover all agent markdown files (flat `*.md`) in a directory.
 * Returns an empty array if the directory does not exist. Results are sorted by
 * path for deterministic lockfile/compile ordering. Shared by sync and plugin
 * compilation so discovery semantics stay in one place.
 */
export async function discoverAgents(agentsDir: string): Promise<Agent[]> {
  try {
    await fs.access(agentsDir);
  } catch {
    // Directory doesn't exist - return empty array
    return [];
  }

  const agentFiles = await fg("*.md", { cwd: agentsDir, absolute: false });

  const agents: Agent[] = [];
  for (const relativePath of agentFiles) {
    const content = await fs.readFile(path.join(agentsDir, relativePath), "utf-8");
    agents.push(parseAgent(content, relativePath));
  }

  agents.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return agents;
}

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
  // Convert underscore prefix to dash prefix for managed-content compatibility
  const hashMetadataPrefix = toMarkerPrefix(metadataPrefix);
  const contentHash = computeContentHash(agent.rawContent, {
    metadataPrefix: hashMetadataPrefix,
  });

  // Build new frontmatter
  const existingFrontmatter = agent.frontmatter || ({} as AgentFrontmatter);
  const existingMetadata = existingFrontmatter.metadata ?? {};

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

// =============================================================================
// Codex agent (TOML) emitter
// =============================================================================

/** Map a canonical agent identity (`code-reviewer.md`) to its Codex TOML file name. */
export function codexAgentFileName(relativePath: string): string {
  return relativePath.replace(/\.md$/, ".toml");
}

/**
 * Escape the control characters that TOML basic strings forbid as literals
 * (`U+0000`–`U+0008`, `U+000B`, `U+000C`, `U+000E`–`U+001F`, `U+007F`) as
 * `\uXXXX`. `\t`/`\n`/`\r` are intentionally excluded — they are handled
 * explicitly (single-line) or allowed literally (multi-line). Run LAST, after
 * backslashes have been doubled, so the `\u` escapes it introduces survive.
 */
function escapeTomlControlChars(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    const isControl =
      code <= 0x08 ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      code === 0x7f;
    out += isControl ? `\\u${code.toString(16).padStart(4, "0")}` : ch;
  }
  return out;
}

/**
 * Serialize a string as a TOML single-line basic string (quoted + escaped).
 * Used for scalar agent fields like `name` and `description`.
 */
function tomlBasicString(value: string): string {
  const escaped = escapeTomlControlChars(
    value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t"),
  );
  return `"${escaped}"`;
}

/**
 * Serialize a (possibly multi-line) string as a TOML multi-line basic string.
 * A leading newline is emitted after the opening delimiter (the TOML spec trims
 * it) purely for readability; the newline before the closing delimiter is part
 * of the value, so every emitted value ends with a trailing `\n`. Backslashes
 * are escaped, any literal `"""` is broken up so the body can neither terminate
 * the string early nor introduce a line-continuation escape, and control chars
 * are escaped so the output is always valid TOML.
 */
function tomlMultilineString(value: string): string {
  const escaped = escapeTomlControlChars(value.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"'));
  return `"""\n${escaped}\n"""`;
}

/**
 * Project a canonical agent into a Codex subagent TOML body.
 *
 * Codex subagents live at `.codex/agents/<name>.toml` and are defined by
 * `name`, `description`, and `developer_instructions`. We map the canonical
 * frontmatter `name`/`description` and use the markdown body as the developer
 * instructions. We deliberately do NOT carry over `model`/`tools`: Claude model
 * identifiers and tool names do not match Codex's, so passing them through
 * would produce invalid Codex config. Optional Codex fields (`model`,
 * `sandbox_mode`, `mcp_servers`, …) are left for the user to add.
 */
export function emitCodexAgentToml(agent: Agent): string {
  const fm = agent.frontmatter ?? ({} as AgentFrontmatter);
  const name = typeof fm.name === "string" ? fm.name : "";
  const description = typeof fm.description === "string" ? fm.description : "";
  const instructions = agent.body.trim();

  return (
    `name = ${tomlBasicString(name)}\n` +
    `description = ${tomlBasicString(description)}\n` +
    `developer_instructions = ${tomlMultilineString(instructions)}\n`
  );
}

/**
 * Build the full `.codex/agents/<name>.toml` file content for an agent,
 * including agconf managed metadata as leading TOML comments. Comments are
 * ignored by TOML parsers, so Codex still reads a valid agent definition, while
 * `check` can verify integrity: the stored `content_hash` is computed (via the
 * shared {@link computeContentHash}) over the metadata-free body, and
 * {@link stripCodexAgentMetadata} recovers exactly that body downstream.
 */
export function buildCodexAgentToml(agent: Agent, metadataPrefix: string): string {
  const body = emitCodexAgentToml(agent);
  const contentHash = computeContentHash(body);
  const keys = getMetadataKeys(metadataPrefix);
  return `# ${keys.managed}: true\n# ${keys.contentHash}: ${contentHash}\n${body}`;
}
