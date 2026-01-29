import type { TargetAgent, TargetCapabilities, TargetConfig } from "./types.js";

/**
 * OpenAI Codex target configuration.
 *
 * Codex uses a .codex/ directory with:
 * - No instructions file (reads AGENTS.md directly)
 * - skills/ subdirectory for skill files
 */
const CODEX_CONFIG: TargetConfig = {
  dir: ".codex",
  instructionsFile: null, // Codex reads AGENTS.md directly
  instructionsContent: null,
};

/**
 * OpenAI Codex capabilities.
 * Codex supports skills but doesn't need a separate instructions file.
 */
const CODEX_CAPABILITIES: TargetCapabilities = {
  skills: true,
  subAgents: false, // Codex doesn't have sub-agent concept (yet)
  hooks: true,
  fileReferences: false, // Codex doesn't support @file syntax
  instructionsFile: false,
};

/**
 * OpenAI Codex target agent.
 */
export const codexTarget: TargetAgent = {
  name: "codex",
  config: CODEX_CONFIG,
  capabilities: CODEX_CAPABILITIES,
};

/**
 * Create a Codex target instance.
 */
export function createCodexTarget(): TargetAgent {
  return codexTarget;
}
