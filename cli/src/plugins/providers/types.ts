import type { ResolvedConfig } from "../../config/schema.js";

/**
 * Information about a resolved canonical source.
 * This is returned after resolving a source (cloning, locating, etc.)
 */
export interface ResolvedSource {
  /** The source metadata for lockfile storage */
  source: SourceMetadata;
  /** Local path to the source content (after clone or resolution) */
  basePath: string;
  /** Path to the global instructions file (e.g., instructions/AGENTS.md) */
  agentsMdPath: string;
  /** Path to the skills directory (e.g., skills/) */
  skillsPath: string;
}

/**
 * Source metadata stored in the lockfile.
 * Uses a discriminated union to support different source types.
 */
export type SourceMetadata = GitHubSourceMetadata | LocalSourceMetadata;

export interface GitHubSourceMetadata {
  type: "github";
  /** Repository in owner/repo format */
  repository: string;
  /** Git commit SHA */
  commit_sha: string;
  /** Git ref used (branch, tag, or commit) */
  ref: string;
}

export interface LocalSourceMetadata {
  type: "local";
  /** Absolute path to the local source */
  path: string;
  /** Git commit SHA if available */
  commit_sha?: string;
}

/**
 * Options for resolving a source.
 */
export interface SourceResolveOptions {
  /** Resolved configuration for the project */
  config: ResolvedConfig;
  /** Temporary directory for cloning (for remote sources) */
  tempDir?: string;
}

/**
 * Interface for source providers.
 * Providers handle resolving canonical content from different source types (GitHub, GitLab, local, etc.)
 */
export interface SourceProvider {
  /** Unique name of the provider (e.g., "github", "local") */
  readonly name: string;

  /**
   * Check if this provider can handle the given source specification.
   * @param source - Source specification (URL, path, or repository identifier)
   * @returns true if this provider can handle the source
   */
  canHandle(source: string): boolean;

  /**
   * Resolve the source to a local path with content.
   * For remote sources, this typically involves cloning.
   * For local sources, this validates and returns the path.
   *
   * @param source - Source specification (URL, path, or repository identifier)
   * @param options - Resolution options including config and temp directory
   * @returns Resolved source with local paths
   */
  resolve(source: string, options: SourceResolveOptions): Promise<ResolvedSource>;
}

/**
 * Registry for source providers.
 * Allows registering custom providers and finding the right provider for a source.
 */
export interface SourceProviderRegistry {
  /**
   * Register a provider.
   * @param provider - The provider to register
   */
  register(provider: SourceProvider): void;

  /**
   * Get a provider that can handle the given source.
   * @param source - Source specification
   * @returns The first provider that can handle the source, or undefined
   */
  getProvider(source: string): SourceProvider | undefined;

  /**
   * Get all registered providers.
   */
  getProviders(): SourceProvider[];
}

/**
 * Format a source metadata object to a human-readable string.
 */
export function formatSourceString(source: SourceMetadata): string {
  if (source.type === "github") {
    const sha = source.commit_sha.slice(0, 7);
    return `github:${source.repository}@${sha}`;
  }
  if (source.commit_sha) {
    return `local:${source.path}@${source.commit_sha.slice(0, 7)}`;
  }
  return `local:${source.path}`;
}
