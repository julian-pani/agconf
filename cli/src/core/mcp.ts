/**
 * MCP (Model Context Protocol) server content type.
 *
 * MCP servers are authored in the canonical repository as one JSON file per
 * server under the configured `mcp_servers_dir` (e.g. `mcps/figma.json`). Each
 * file holds a single server config — either a stdio server (`command`/`args`/
 * `env`/`cwd`) or an HTTP server (`url`/`bearer_token_env_var`/...). The server
 * name defaults to the filename stem but may be overridden with a top-level
 * `name` field (which is stripped from the emitted config).
 *
 * Unlike skills/rules/agents, MCP servers are NOT synced to downstream repos by
 * `sync`; they exist to be compiled into plugin manifests (see `plugins.ts`),
 * where they are aggregated into a target-appropriate `.mcp.json`.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import fg from "fast-glob";

/**
 * Parsed representation of a single MCP server definition.
 */
export interface McpServer {
  /** Server name: explicit `name` field if present, else the filename stem. */
  name: string;
  /** Path relative to the mcps directory (e.g. "figma.json"). */
  relativePath: string;
  /** The server config object (the file's JSON minus any `name` field). */
  config: Record<string, unknown>;
}

/**
 * Validation error for an MCP server file.
 */
export interface McpServerValidationError {
  mcpPath: string;
  errors: string[];
}

/**
 * Derive the server name from a relative path (filename without `.json`).
 */
function nameFromPath(relativePath: string): string {
  return path.basename(relativePath).replace(/\.json$/i, "");
}

/**
 * Parse an MCP server JSON file into an {@link McpServer}.
 *
 * Malformed JSON or a non-object payload yields an empty config; callers that
 * care about validity should run {@link validateMcpServer} first.
 */
export function parseMcpServer(content: string, relativePath: string): McpServer {
  const stem = nameFromPath(relativePath);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { name: stem, relativePath, config: {} };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { name: stem, relativePath, config: {} };
  }

  const obj = parsed as Record<string, unknown>;
  const name = typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : stem;

  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === "name") continue;
    config[key] = value;
  }

  return { name, relativePath, config };
}

/**
 * Validate an MCP server file: must be a JSON object that defines either a
 * `command` (stdio server) or a `url` (HTTP server). Returns null when valid.
 */
export function validateMcpServer(
  content: string,
  relativePath: string,
): McpServerValidationError | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { mcpPath: relativePath, errors: ["Invalid JSON"] };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { mcpPath: relativePath, errors: ["MCP server config must be a JSON object"] };
  }

  const obj = parsed as Record<string, unknown>;
  const hasCommand = typeof obj.command === "string" && obj.command.length > 0;
  const hasUrl = typeof obj.url === "string" && obj.url.length > 0;

  if (!hasCommand && !hasUrl) {
    return {
      mcpPath: relativePath,
      errors: ['MCP server must define either "command" (stdio) or "url" (http)'],
    };
  }

  return null;
}

/**
 * Discover all MCP server files (flat, `*.json`) under a directory.
 * Returns an empty array if the directory does not exist. Results are sorted by
 * path for deterministic compile output.
 */
export async function discoverMcpServers(mcpsDir: string): Promise<McpServer[]> {
  try {
    await fs.access(mcpsDir);
  } catch {
    return [];
  }

  const files = await fg("*.json", { cwd: mcpsDir, absolute: false });

  const servers: McpServer[] = [];
  for (const relativePath of files) {
    const content = await fs.readFile(path.join(mcpsDir, relativePath), "utf-8");
    servers.push(parseMcpServer(content, relativePath));
  }

  servers.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return servers;
}
