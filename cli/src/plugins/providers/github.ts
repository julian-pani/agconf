import * as path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import type { ResolvedConfig } from "../../config/schema.js";
import type { ResolvedSource, SourceProvider, SourceResolveOptions } from "./types.js";

// Patterns for detecting GitHub sources
const GITHUB_URL_PATTERN = /^https?:\/\/github\.com\/([^/]+\/[^/]+)/;
const GITHUB_REPO_PATTERN = /^([^/]+\/[^/]+)$/;

export interface GitHubResolveOptions extends SourceResolveOptions {
  /** Git ref to checkout (branch, tag, or commit) */
  ref?: string;
}

/**
 * GitHub source provider.
 * Handles cloning content from GitHub repositories.
 */
export class GitHubProvider implements SourceProvider {
  readonly name = "github";

  canHandle(source: string): boolean {
    return GITHUB_URL_PATTERN.test(source) || GITHUB_REPO_PATTERN.test(source);
  }

  async resolve(source: string, options: GitHubResolveOptions): Promise<ResolvedSource> {
    const { config, tempDir, ref = "master" } = options;

    if (!tempDir) {
      throw new Error("GitHub provider requires a tempDir for cloning");
    }

    // Extract repository from URL or use directly
    const repository = this.extractRepository(source);
    const repoUrl = `https://github.com/${repository}.git`;

    // Clone the repository
    const git: SimpleGit = simpleGit();
    await git.clone(repoUrl, tempDir, ["--depth", "1", "--branch", ref]);

    // Get the commit SHA
    const clonedGit: SimpleGit = simpleGit(tempDir);
    const log = await clonedGit.log({ maxCount: 1 });
    const commitSha = log.latest?.hash ?? "";

    return {
      source: {
        type: "github",
        repository,
        commit_sha: commitSha,
        ref,
      },
      basePath: tempDir,
      agentsMdPath: path.join(tempDir, config.instructionsPath),
      skillsPath: path.join(tempDir, config.skillsDir),
    };
  }

  private extractRepository(source: string): string {
    // Try URL pattern first
    const urlMatch = source.match(GITHUB_URL_PATTERN);
    if (urlMatch?.[1]) {
      // Remove .git suffix if present
      return urlMatch[1].replace(/\.git$/, "");
    }

    // Assume it's a repository identifier (owner/repo)
    const repoMatch = source.match(GITHUB_REPO_PATTERN);
    if (repoMatch?.[1]) {
      return repoMatch[1];
    }

    throw new Error(`Cannot extract repository from source: ${source}`);
  }
}

/**
 * Resolve a GitHub source with explicit options.
 * This is a convenience function for direct use without the registry.
 */
export async function resolveGitHubSource(
  repository: string,
  ref: string,
  tempDir: string,
  config: ResolvedConfig,
): Promise<ResolvedSource> {
  const provider = new GitHubProvider();
  return provider.resolve(repository, { config, tempDir, ref });
}

/**
 * Create a GitHub provider instance.
 */
export function createGitHubProvider(): SourceProvider {
  return new GitHubProvider();
}
