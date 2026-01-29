import type { TargetAgent, TargetCapabilities, TargetConfig } from "./types.js";

/**
 * Claude Code target configuration.
 *
 * Claude Code uses a .claude/ directory with:
 * - CLAUDE.md instructions file that references @../AGENTS.md
 * - skills/ subdirectory for skill files
 */
const CLAUDE_CONFIG: TargetConfig = {
  dir: ".claude",
  instructionsFile: "CLAUDE.md",
  instructionsContent: "@../AGENTS.md",
};

/**
 * Claude Code capabilities.
 * Claude supports all features.
 */
const CLAUDE_CAPABILITIES: TargetCapabilities = {
  skills: true,
  subAgents: true,
  hooks: true,
  fileReferences: true, // Claude supports @file syntax
  instructionsFile: true,
};

/**
 * Claude Code target agent.
 */
export const claudeTarget: TargetAgent = {
  name: "claude",
  config: CLAUDE_CONFIG,
  capabilities: CLAUDE_CAPABILITIES,
};

/**
 * Create a Claude target instance.
 */
export function createClaudeTarget(): TargetAgent {
  return claudeTarget;
}
