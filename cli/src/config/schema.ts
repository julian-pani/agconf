import { z } from "zod";

// =============================================================================
// Canonical Repository Configuration Schema (agconf.yaml)
// =============================================================================
// This is the config file that lives in the canonical repository (the source of
// skills and standards). It defines metadata about the canonical content, marker prefix,
// and which targets are supported.

/**
 * Current canonical config schema version.
 * Follows semver: MAJOR.MINOR.PATCH
 *
 * Version bump guidelines:
 * - PATCH: Bug fixes in validation
 * - MINOR: Add optional fields (backwards compatible)
 * - MAJOR: Required field changes, field type changes, field removal
 */
export const CURRENT_CONFIG_VERSION = "1.0.0";

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
  /** Path to the rules directory (e.g., "rules") - optional for backward compat */
  rules_dir: z.string().optional(),
  /** Path to the agents directory (e.g., "agents") - optional */
  agents_dir: z.string().optional(),
  /** Path to the MCP servers directory (e.g., "mcps") - optional. Used by plugin compilation. */
  mcp_servers_dir: z.string().optional(),
});

export const MarkersConfigSchema = z.object({
  /**
   * Prefix for marker comments in managed files.
   * Generates markers like: <!-- {prefix}:global:start -->
   * Default: "agconf"
   */
  prefix: z.string().default("agconf"),
});

export const MergeConfigSchema = z.object({
  /** Whether to preserve repository-specific content blocks during sync */
  preserve_repo_content: z.boolean().default(true),
});

// =============================================================================
// Plugin Compilation Schema (agconf.yaml -> plugins)
// =============================================================================
// Optional `plugins` block in the canonical config. When present, `agconf
// compile` builds installable Claude Code / Codex plugins and a marketplace
// index FROM the canonical skills/agents/mcps, committed into the canonical repo
// so they can be installed directly (without `sync`). See core/plugins.ts.

/** Author / owner metadata reused for plugin and marketplace manifests. */
export const PluginAuthorSchema = z.object({
  name: z.string().min(1),
  email: z.string().optional(),
  url: z.string().optional(),
});

/** Marketplace-level metadata (the index that lists the compiled plugins). */
export const PluginMarketplaceSchema = z.object({
  /** Marketplace identifier (kebab-case). Users install as `plugin@marketplace`. */
  name: z.string().min(1),
  /** Owner block for the Claude marketplace (`owner`). Optional. */
  owner: PluginAuthorSchema.optional(),
  /** Display name for the Codex marketplace (`interface.displayName`). Optional. */
  display_name: z.string().optional(),
  /** Marketplace description. */
  description: z.string().optional(),
});

/**
 * A single plugin definition: a curated bundle of canonical content.
 *
 * Selector semantics for `skills`/`agents`/`mcps`:
 * - omitted  -> include ALL discovered content of that type
 * - provided -> include only items whose name matches a selector (exact or `*` glob)
 * - []       -> include none of that type
 */
export const PluginDefinitionSchema = z.object({
  /** Plugin identifier (kebab-case). Users install as `name@marketplace`. */
  name: z.string().min(1),
  /** Human-readable description for the plugin manifest. */
  description: z.string().optional(),
  /** Plugin version (semver). Falls back to `plugins.version` when omitted. */
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, "Version must be in semver format (e.g., 1.0.0)")
    .optional(),
  /** Skill name selectors (exact names or `*` globs). Omit for all skills. */
  skills: z.array(z.string()).optional(),
  /** Agent name selectors (exact names or `*` globs). Omit for all agents. */
  agents: z.array(z.string()).optional(),
  /** MCP server name selectors (exact names or `*` globs). Omit for all servers. */
  mcps: z.array(z.string()).optional(),
  /** Optional marketplace category. */
  category: z.string().optional(),
  /** Optional discovery keywords. */
  keywords: z.array(z.string()).optional(),
});

/**
 * `plugins` block in the canonical config. When present, enables `agconf
 * compile`.
 */
export const PluginsConfigSchema = z.object({
  /**
   * Single source of truth for the stamped plugin/marketplace version (semver).
   * Bumped at release time; reproduced verbatim by compile so the freshness
   * check stays deterministic between releases.
   */
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/, "Version must be in semver format (e.g., 1.0.0)")
    .optional(),
  marketplace: PluginMarketplaceSchema,
  /** Output directory for compiled plugins (relative to the canonical repo root). */
  output_dir: z.string().default("plugins"),
  /**
   * Override which targets to compile plugins for (e.g. ["claude", "codex"]).
   * Defaults to the canonical config's top-level `targets`.
   */
  targets: z.array(z.string()).optional(),
  /**
   * Explicit plugin definitions. Omit entirely to synthesize a single plugin
   * (named after the marketplace) containing all canonical content.
   */
  definitions: z.array(PluginDefinitionSchema).optional(),
});

/**
 * Configuration schema for canonical repositories (agconf.yaml).
 * This file lives in the canonical source repo (e.g., acme-agent-standards).
 */
export const CanonicalRepoConfigSchema = z.object({
  /** Schema version in semver format (e.g., "1.0.0") */
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "Version must be in semver format (e.g., 1.0.0)"),
  meta: CanonicalMetaSchema,
  content: CanonicalPathsSchema.default({}),
  /** List of supported target agents (e.g., ["claude", "codex"]) */
  targets: z.array(z.string()).default(["claude"]),
  markers: MarkersConfigSchema.default({}),
  merge: MergeConfigSchema.default({}),
  /** Optional plugin compilation config. Enables `agconf compile` when present. */
  plugins: PluginsConfigSchema.optional(),
});

export type PluginAuthor = z.infer<typeof PluginAuthorSchema>;
export type PluginMarketplaceConfig = z.infer<typeof PluginMarketplaceSchema>;
export type PluginDefinition = z.infer<typeof PluginDefinitionSchema>;
export type PluginsConfig = z.infer<typeof PluginsConfigSchema>;

export type CanonicalRepoConfig = z.infer<typeof CanonicalRepoConfigSchema>;

// =============================================================================
// Downstream Repository Configuration Schema (.agconf.yaml)
// =============================================================================
// This is the config file that lives in downstream repositories (the consumers
// of skills and standards). It defines which sources to sync from.

const SourceConfigSchema = z.object({
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
 * Workflow configuration for downstream repositories.
 * Controls how the sync workflow behaves (PR vs direct commit, etc.)
 */
export const WorkflowConfigSchema = z.object({
  /** Commit strategy: "pr" creates a pull request, "direct" commits directly to branch */
  commit_strategy: z.enum(["pr", "direct"]).default("pr"),
  /** Branch prefix for PR branches (only used with commit_strategy: "pr") */
  pr_branch_prefix: z.string().optional(),
  /** Custom PR title (only used with commit_strategy: "pr") */
  pr_title: z.string().optional(),
  /** Custom commit message */
  commit_message: z.string().optional(),
  /** Comma-separated list of GitHub usernames for PR reviewers */
  reviewers: z.string().optional(),
});

/**
 * Configuration schema for downstream repositories (.agconf/config.yaml).
 * This file lives in repos that consume content from canonical repos.
 * Unlike the canonical config (agconf.yaml), this contains user preferences
 * for how sync operates, not content definitions.
 */
export const DownstreamConfigSchema = z.object({
  /**
   * List of canonical sources to sync from.
   * For MVP, only single source is supported; multi-source is future work.
   */
  sources: z.array(SourceConfigSchema).min(1).optional(),
  /** Override which targets to sync to (defaults to source repo's targets) */
  targets: z.array(z.string()).optional(),
  /** Workflow configuration (commit strategy, PR settings, etc.) */
  workflow: WorkflowConfigSchema.optional(),
});

export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;
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
  /** Path to rules directory within source - optional for backward compat */
  rulesDir: z.string().optional(),
  /** Path to agents directory within source - optional */
  agentsDir: z.string().optional(),
  /** Path to MCP servers directory within source - optional */
  mcpsDir: z.string().optional(),
  /** Marker prefix for managed content */
  markerPrefix: z.string(),
  /** Target agents to sync to */
  targets: z.array(z.string()),
  /** Whether to preserve repo-specific content during merge */
  preserveRepoContent: z.boolean(),
  /** CLI name for hooks and workflows */
  cliName: z.string().default("agconf"),
  /** Directory name for lockfile and config (e.g., ".agconf") */
  configDir: z.string().default(".agconf"),
  /** Lockfile name */
  lockfileName: z.string().default("lockfile.json"),
});

export type ResolvedConfig = z.infer<typeof ResolvedConfigSchema>;

// =============================================================================
// Default Configuration
// =============================================================================
