import { createHash } from "node:crypto";
import { getMarkers as getMarkersFromConfig } from "../config/schema.js";

// Default marker prefix
const DEFAULT_MARKER_PREFIX = "agent-conf";

/**
 * Marker strings for managed content blocks.
 */
export interface Markers {
  globalStart: string;
  globalEnd: string;
  repoStart: string;
  repoEnd: string;
}

/**
 * Get markers for a given prefix.
 * Uses the config schema helper for consistency.
 */
export function getMarkers(prefix: string = DEFAULT_MARKER_PREFIX): Markers {
  return getMarkersFromConfig(prefix);
}

export interface ParsedAgentsMd {
  globalBlock: string | null;
  repoBlock: string | null;
  hasMarkers: boolean;
}

export interface GlobalBlockMetadata {
  contentHash?: string;
}

export interface ParsedGlobalBlockMetadata {
  source?: string;
  syncedAt?: string;
  contentHash?: string;
}

/**
 * Options for marker-based operations.
 */
export interface MarkerOptions {
  /** Marker prefix to use (default: "agent-conf") */
  prefix?: string;
  /** CLI name for comments (default: "agent-conf") */
  cliName?: string;
}

/**
 * Parse AGENTS.md content to extract global and repo blocks.
 */
export function parseAgentsMd(content: string, options: MarkerOptions = {}): ParsedAgentsMd {
  const { prefix = DEFAULT_MARKER_PREFIX } = options;
  const markers = getMarkers(prefix);
  return parseWithMarkers(content, markers);
}

function parseWithMarkers(content: string, markers: Markers): ParsedAgentsMd {
  const globalStartIdx = content.indexOf(markers.globalStart);
  const globalEndIdx = content.indexOf(markers.globalEnd);
  const repoStartIdx = content.indexOf(markers.repoStart);
  const repoEndIdx = content.indexOf(markers.repoEnd);

  const hasMarkers = globalStartIdx !== -1 || repoStartIdx !== -1;

  let globalBlock: string | null = null;
  let repoBlock: string | null = null;

  if (globalStartIdx !== -1 && globalEndIdx !== -1 && globalEndIdx > globalStartIdx) {
    const startContent = globalStartIdx + markers.globalStart.length;
    globalBlock = content.slice(startContent, globalEndIdx).trim();
  }

  if (repoStartIdx !== -1 && repoEndIdx !== -1 && repoEndIdx > repoStartIdx) {
    const startContent = repoStartIdx + markers.repoStart.length;
    repoBlock = content.slice(startContent, repoEndIdx).trim();
  }

  return { globalBlock, repoBlock, hasMarkers };
}

/**
 * Compute content hash for AGENTS.md global block.
 */
export function computeGlobalBlockHash(content: string): string {
  const hash = createHash("sha256").update(content.trim()).digest("hex");
  return `sha256:${hash.slice(0, 12)}`;
}

/**
 * Build the global block section of AGENTS.md.
 */
export function buildGlobalBlock(
  content: string,
  metadata: GlobalBlockMetadata,
  options: MarkerOptions = {},
): string {
  const { prefix = DEFAULT_MARKER_PREFIX, cliName = "agent-conf" } = options;
  const markers = getMarkers(prefix);

  // Compute hash if not provided
  const contentHash = metadata.contentHash ?? computeGlobalBlockHash(content);

  const lines = [
    markers.globalStart,
    `<!-- DO NOT EDIT THIS SECTION - Managed by ${cliName} CLI -->`,
    `<!-- Content hash: ${contentHash} -->`,
    "",
    content.trim(),
    "",
    markers.globalEnd,
  ];
  return lines.join("\n");
}

/**
 * Build the repo-specific block section of AGENTS.md.
 */
export function buildRepoBlock(content: string | null, options: MarkerOptions = {}): string {
  const { prefix = DEFAULT_MARKER_PREFIX } = options;
  const markers = getMarkers(prefix);

  const lines = [
    markers.repoStart,
    "<!-- Repository-specific instructions below -->",
    "",
    content?.trim() ?? "",
    "",
    markers.repoEnd,
  ];
  return lines.join("\n");
}

/**
 * Build a complete AGENTS.md file with global and repo blocks.
 */
export function buildAgentsMd(
  globalContent: string,
  repoContent: string | null,
  metadata: GlobalBlockMetadata,
  options: MarkerOptions = {},
): string {
  const globalBlock = buildGlobalBlock(globalContent, metadata, options);
  const repoBlock = buildRepoBlock(repoContent, options);
  return `${globalBlock}\n\n${repoBlock}\n`;
}

/**
 * Extract the content from a repo block, stripping metadata comments.
 */
export function extractRepoBlockContent(parsed: ParsedAgentsMd): string | null {
  if (!parsed.repoBlock) return null;

  // Strip the "Repository-specific instructions below" comment since buildRepoBlock adds it fresh
  const lines = parsed.repoBlock.split("\n");
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    return trimmed !== "<!-- Repository-specific instructions below -->";
  });

  const result = filtered.join("\n").trim();
  return result || null;
}

/**
 * Strip metadata comments from a global block.
 */
export function stripMetadataComments(globalBlock: string): string {
  const lines = globalBlock.split("\n");
  const filteredLines = lines.filter((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("<!-- DO NOT EDIT")) return false;
    if (trimmed.startsWith("<!-- Source:")) return false;
    if (trimmed.startsWith("<!-- Last synced:")) return false;
    if (trimmed.startsWith("<!-- Content hash:")) return false;
    return true;
  });
  return filteredLines.join("\n").trim();
}

/**
 * Parse metadata comments from a global block.
 */
export function parseGlobalBlockMetadata(globalBlock: string): ParsedGlobalBlockMetadata {
  const result: ParsedGlobalBlockMetadata = {};

  const sourceMatch = globalBlock.match(/<!--\s*Source:\s*(.+?)\s*-->/);
  if (sourceMatch?.[1]) {
    result.source = sourceMatch[1];
  }

  const syncedMatch = globalBlock.match(/<!--\s*Last synced:\s*(.+?)\s*-->/);
  if (syncedMatch?.[1]) {
    result.syncedAt = syncedMatch[1];
  }

  const hashMatch = globalBlock.match(/<!--\s*Content hash:\s*(.+?)\s*-->/);
  if (hashMatch?.[1]) {
    result.contentHash = hashMatch[1];
  }

  return result;
}

/**
 * Check if the global block of AGENTS.md has been manually modified.
 * Returns true if the content hash doesn't match.
 */
export function hasGlobalBlockChanges(
  agentsMdContent: string,
  options: MarkerOptions = {},
): boolean {
  const parsed = parseAgentsMd(agentsMdContent, options);

  if (!parsed.globalBlock) {
    return false; // No global block
  }

  const metadata = parseGlobalBlockMetadata(parsed.globalBlock);

  if (!metadata.contentHash) {
    return false; // No hash stored (old format)
  }

  // Get content without metadata comments
  const content = stripMetadataComments(parsed.globalBlock);
  const currentHash = computeGlobalBlockHash(content);

  return metadata.contentHash !== currentHash;
}

/**
 * Check if AGENTS.md is managed by agent-conf.
 */
export function isAgentsMdManaged(agentsMdContent: string, options: MarkerOptions = {}): boolean {
  const parsed = parseAgentsMd(agentsMdContent, options);
  return parsed.hasMarkers && parsed.globalBlock !== null;
}

// =============================================================================
// Rules section parsing (for Codex target)
// =============================================================================

export interface ParsedRulesSection {
  /** The content between rules markers, or null if not found */
  content: string | null;
  /** Whether rules markers exist */
  hasMarkers: boolean;
}

export interface RulesSectionMetadata {
  /** Content hash stored in the rules section */
  contentHash?: string;
  /** Number of rules stored in the section */
  ruleCount?: number;
}

/**
 * Parse the rules section from AGENTS.md content.
 * The rules section is between <!-- prefix:rules:start --> and <!-- prefix:rules:end --> markers.
 */
export function parseRulesSection(
  agentsMdContent: string,
  options: MarkerOptions = {},
): ParsedRulesSection {
  const { prefix = DEFAULT_MARKER_PREFIX } = options;
  const rulesStartMarker = `<!-- ${prefix}:rules:start -->`;
  const rulesEndMarker = `<!-- ${prefix}:rules:end -->`;

  const startIdx = agentsMdContent.indexOf(rulesStartMarker);
  const endIdx = agentsMdContent.indexOf(rulesEndMarker);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return { content: null, hasMarkers: false };
  }

  const content = agentsMdContent.slice(startIdx + rulesStartMarker.length, endIdx).trim();

  return { content, hasMarkers: true };
}

/**
 * Parse metadata from the rules section.
 */
export function parseRulesSectionMetadata(rulesSection: string): RulesSectionMetadata {
  const result: RulesSectionMetadata = {};

  const hashMatch = rulesSection.match(/<!--\s*Content hash:\s*(.+?)\s*-->/);
  if (hashMatch?.[1]) {
    result.contentHash = hashMatch[1];
  }

  const countMatch = rulesSection.match(/<!--\s*Rule count:\s*(\d+)\s*-->/);
  if (countMatch?.[1]) {
    result.ruleCount = Number.parseInt(countMatch[1], 10);
  }

  return result;
}

/**
 * Strip metadata comments from a rules section, keeping only the actual content.
 */
export function stripRulesSectionMetadata(rulesSection: string): string {
  const lines = rulesSection.split("\n");
  const filteredLines = lines.filter((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("<!-- DO NOT EDIT")) return false;
    if (trimmed.startsWith("<!-- Content hash:")) return false;
    if (trimmed.startsWith("<!-- Rule count:")) return false;
    return true;
  });
  return filteredLines.join("\n").trim();
}

/**
 * Compute content hash for the rules section.
 */
export function computeRulesSectionHash(content: string): string {
  const hash = createHash("sha256").update(content.trim()).digest("hex");
  return `sha256:${hash.slice(0, 12)}`;
}

/**
 * Check if the rules section of AGENTS.md has been manually modified.
 * Returns true if the content hash doesn't match.
 */
export function hasRulesSectionChanges(
  agentsMdContent: string,
  options: MarkerOptions = {},
): boolean {
  const parsed = parseRulesSection(agentsMdContent, options);

  if (!parsed.content) {
    return false; // No rules section
  }

  const metadata = parseRulesSectionMetadata(parsed.content);

  if (!metadata.contentHash) {
    return false; // No hash stored
  }

  // Get content without metadata comments
  const content = stripRulesSectionMetadata(parsed.content);
  const currentHash = computeRulesSectionHash(content);

  return metadata.contentHash !== currentHash;
}
