import { z } from "zod";

// =============================================================================
// Canonical Repository Configuration Schema (agent-conf.yaml)
// =============================================================================
// This is the config file that lives in the canonical repository (the source of
// skills and standards). It defines metadata about the canonical content, marker prefix,
// and which targets are supported.

export const CanonicalMetaSchema = z.object({
  /** Unique identifier for this canonical source (e.g., "acme-standards") */
  name: z.string().min(1),
  /** Organization name for display purposes */
  organization: z.string().optional(),
  /** Description of what this canonical repository provides */
  description: z.string().optional(),
});

export const CanonicalPathsSchema = z.object({
  /** Path to the global instructions file (e.g., "instructions/AGENTS.md") */
  instructions: z.string().default("instructions/AGENTS.md"),
  /** Path to the skills directory (e.g., "skills") */
  skills_dir: z.string().default("skills"),
});

export const MarkersConfigSchema = z.object({
  /**
   * Prefix for marker comments in managed files.
   * Generates markers like: <!-- {prefix}:global:start -->
   * Default: "agent-conf"
   */
  prefix: z.string().default("agent-conf"),
});

export const MergeConfigSchema = z.object({
  /** Whether to preserve repository-specific content blocks during sync */
  preserve_repo_content: z.boolean().default(true),
});

/**
 * Configuration schema for canonical repositories (agent-conf.yaml).
 * This file lives in the canonical source repo (e.g., acme-agent-standards).
 */
export const CanonicalRepoConfigSchema = z.object({
  version: z.literal("1"),
  meta: CanonicalMetaSchema,
  content: CanonicalPathsSchema.default({}),
  /** List of supported target agents (e.g., ["claude", "codex"]) */
  targets: z.array(z.string()).default(["claude"]),
  markers: MarkersConfigSchema.default({}),
  merge: MergeConfigSchema.default({}),
});

export type CanonicalMeta = z.infer<typeof CanonicalMetaSchema>;
export type CanonicalPaths = z.infer<typeof CanonicalPathsSchema>;
export type MarkersConfig = z.infer<typeof MarkersConfigSchema>;
export type MergeConfig = z.infer<typeof MergeConfigSchema>;
export type CanonicalRepoConfig = z.infer<typeof CanonicalRepoConfigSchema>;

// =============================================================================
// Downstream Repository Configuration Schema (.agent-conf.yaml)
// =============================================================================
// This is the config file that lives in downstream repositories (the consumers
// of skills and standards). It defines which sources to sync from.

export const SourceConfigSchema = z.object({
  /** URL of the canonical repository (e.g., "https://github.com/acme/agent-standards") */
  url: z.string().url().optional(),
  /** GitHub repository in owner/repo format (alternative to url) */
  repository: z.string().optional(),
  /** Git ref to sync from (branch, tag, or commit) */
  ref: z.string().optional(),
  /** Priority for conflict resolution (higher wins). Default: 0 */
  priority: z.number().default(0),
});

/**
 * Configuration schema for downstream repositories (.agent-conf.yaml).
 * This file lives in repos that consume content from canonical repos.
 */
export const DownstreamConfigSchema = z.object({
  /**
   * List of canonical sources to sync from.
   * For MVP, only single source is supported; multi-source is future work.
   */
  sources: z.array(SourceConfigSchema).min(1).optional(),
  /** Override which targets to sync to (defaults to source repo's targets) */
  targets: z.array(z.string()).optional(),
});

export type SourceConfig = z.infer<typeof SourceConfigSchema>;
export type DownstreamConfig = z.infer<typeof DownstreamConfigSchema>;

// =============================================================================
// Resolved Configuration (Runtime)
// =============================================================================
// After loading and merging configs, we work with a resolved configuration
// that has all values filled in with defaults.

export const ResolvedConfigSchema = z.object({
  /** Name of the canonical source */
  name: z.string(),
  /** Organization name */
  organization: z.string().optional(),
  /** Path to instructions file within source */
  instructionsPath: z.string(),
  /** Path to skills directory within source */
  skillsDir: z.string(),
  /** Marker prefix for managed content */
  markerPrefix: z.string(),
  /** Target agents to sync to */
  targets: z.array(z.string()),
  /** Whether to preserve repo-specific content during merge */
  preserveRepoContent: z.boolean(),
  /** CLI name for hooks and workflows */
  cliName: z.string().default("agent-conf"),
  /** Directory name for lockfile and config (e.g., ".agent-conf") */
  configDir: z.string().default(".agent-conf"),
  /** Lockfile name */
  lockfileName: z.string().default("lockfile.json"),
});

export type ResolvedConfig = z.infer<typeof ResolvedConfigSchema>;

// =============================================================================
// Default Configuration
// =============================================================================

export const DEFAULT_CONFIG: ResolvedConfig = {
  name: "agent-conf",
  instructionsPath: "instructions/AGENTS.md",
  skillsDir: "skills",
  markerPrefix: "agent-conf",
  targets: ["claude"],
  preserveRepoContent: true,
  cliName: "agent-conf",
  configDir: ".agent-conf",
  lockfileName: "lockfile.json",
};

// =============================================================================
// Marker Generation Helpers
// =============================================================================

/**
 * Generate marker strings based on the configured prefix.
 */
export function getMarkers(prefix: string) {
  return {
    globalStart: `<!-- ${prefix}:global:start -->`,
    globalEnd: `<!-- ${prefix}:global:end -->`,
    repoStart: `<!-- ${prefix}:repo:start -->`,
    repoEnd: `<!-- ${prefix}:repo:end -->`,
  };
}

/**
 * Generate metadata key names based on the configured prefix.
 * Used in skill frontmatter to track managed content.
 */
export function getMetadataKeys(prefix: string) {
  // Normalize prefix for use as key (replace dashes with underscores)
  const keyPrefix = prefix.replace(/-/g, "_");
  return {
    managed: `${keyPrefix}_managed`,
    contentHash: `${keyPrefix}_content_hash`,
  };
}
