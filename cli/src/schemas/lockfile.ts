import { z } from "zod";

/**
 * Current lockfile schema version.
 * Follows semver: MAJOR.MINOR.PATCH
 *
 * Version bump guidelines:
 * - PATCH: Bug fixes in validation
 * - MINOR: Add optional fields (backwards compatible)
 * - MAJOR: Required field changes, field type changes, field removal
 */
export const CURRENT_LOCKFILE_VERSION = "1.0.0";

export const RulesContentSchema = z.object({
  /** List of rule file paths synced (relative to rules dir) */
  files: z.array(z.string()),
  /** Hash of all rules content */
  content_hash: z.string(),
});

export const AgentsContentSchema = z.object({
  /** List of agent file paths synced (relative to agents dir) */
  files: z.array(z.string()),
  /** Hash of all agents content */
  content_hash: z.string(),
});

export const SourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("github"),
    repository: z.string(),
    commit_sha: z.string(),
    ref: z.string(),
  }),
  z.object({
    type: z.literal("local"),
    path: z.string(),
    commit_sha: z.string().optional(),
  }),
]);

export const ContentSchema = z.object({
  agents_md: z.object({
    global_block_hash: z.string(),
    merged: z.boolean(),
  }),
  skills: z.array(z.string()),
  targets: z.array(z.string()).optional(),
  /** Marker prefix used for managed content (default: "agconf") */
  marker_prefix: z.string().optional(),
  /** Rules content tracking - optional for backward compat */
  rules: RulesContentSchema.optional(),
  /** Agents content tracking - optional */
  agents: AgentsContentSchema.optional(),
});

export const LockfileSchema = z.object({
  /** Schema version in semver format (e.g., "1.0.0") */
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "Version must be in semver format (e.g., 1.0.0)"),
  /** Pinned release version of the canonical source (e.g., "1.2.0") */
  pinned_version: z.string().optional(),
  synced_at: z.string().datetime(),
  source: SourceSchema,
  content: ContentSchema,
  /** CLI version used for sync (optional, for diagnostics only) */
  cli_version: z.string().optional(),
});

export type Source = z.infer<typeof SourceSchema>;
export type Lockfile = z.infer<typeof LockfileSchema>;
