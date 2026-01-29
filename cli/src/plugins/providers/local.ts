import * as fs from "node:fs/promises";
import * as path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import type { ResolvedConfig } from "../../config/schema.js";
import type { ResolvedSource, SourceProvider, SourceResolveOptions } from "./types.js";

// Pattern for detecting local paths
const LOCAL_PATH_PATTERN = /^[./~]/;

export interface LocalResolveOptions extends SourceResolveOptions {
  /**
   * If true and no explicit path is given, search for the canonical repo
   * starting from the current directory.
   */
  autoDiscover?: boolean;
}

/**
 * Local filesystem source provider.
 * Handles resolving content from local directories.
 */
export class LocalProvider implements SourceProvider {
  readonly name = "local";

  canHandle(source: string): boolean {
    // Handle explicit local paths or when source is undefined/empty (for auto-discovery)
    return !source || LOCAL_PATH_PATTERN.test(source);
  }

  async resolve(source: string, options: LocalResolveOptions): Promise<ResolvedSource> {
    const { config, autoDiscover = true } = options;

    let basePath: string;

    if (source) {
      // Explicit path provided
      basePath = path.resolve(source);
    } else if (autoDiscover) {
      // Auto-discover canonical repository
      basePath = await this.findCanonicalRepo(process.cwd(), config);
    } else {
      throw new Error("No source path provided and auto-discovery disabled");
    }

    // Validate the canonical repository structure
    await this.validateCanonicalRepo(basePath, config);

    // Get git commit SHA if available
    const commitSha = await this.getCommitSha(basePath);

    // Build source metadata, only including commit_sha if defined
    const sourceMetadata: ResolvedSource["source"] = {
      type: "local",
      path: basePath,
    };
    if (commitSha) {
      sourceMetadata.commit_sha = commitSha;
    }

    return {
      source: sourceMetadata,
      basePath,
      agentsMdPath: path.join(basePath, config.instructionsPath),
      skillsPath: path.join(basePath, config.skillsDir),
    };
  }

  /**
   * Find a canonical repository by searching up from the start directory.
   * Also checks sibling directories.
   */
  private async findCanonicalRepo(startDir: string, config: ResolvedConfig): Promise<string> {
    let currentDir = path.resolve(startDir);
    const root = path.parse(currentDir).root;

    // First, check if we're already inside a canonical repo
    let checkDir = currentDir;
    while (checkDir !== root) {
      if (await this.isCanonicalRepo(checkDir, config)) {
        return checkDir;
      }
      checkDir = path.dirname(checkDir);
    }

    // Otherwise, look for sibling directories that match the canonical repo name
    currentDir = path.resolve(startDir);
    while (currentDir !== root) {
      const parentDir = path.dirname(currentDir);

      // Try sibling with the config name
      const siblingByName = path.join(parentDir, config.name);
      if (await this.isCanonicalRepo(siblingByName, config)) {
        return siblingByName;
      }

      // Also try common suffixes
      for (const suffix of ["-agent-conf", "-agent-standards", "-agents"]) {
        const siblingWithSuffix = path.join(parentDir, `${config.name}${suffix}`);
        if (await this.isCanonicalRepo(siblingWithSuffix, config)) {
          return siblingWithSuffix;
        }
      }

      currentDir = parentDir;
    }

    throw new Error(
      `Could not find canonical repository. Please specify --local <path> or run from within the canonical repo.`,
    );
  }

  /**
   * Check if a directory is a valid canonical repository.
   */
  private async isCanonicalRepo(dir: string, config: ResolvedConfig): Promise<boolean> {
    try {
      // Check directory exists
      const stat = await fs.stat(dir).catch(() => null);
      if (!stat?.isDirectory()) {
        return false;
      }

      // Check for canonical repo structure
      const instructionsPath = path.join(dir, config.instructionsPath);
      const skillsPath = path.join(dir, config.skillsDir);

      const [instructionsExists, skillsExists] = await Promise.all([
        fs
          .access(instructionsPath)
          .then(() => true)
          .catch(() => false),
        fs
          .access(skillsPath)
          .then(() => true)
          .catch(() => false),
      ]);

      if (!instructionsExists || !skillsExists) {
        return false;
      }

      // Optionally verify git remote contains the config name
      try {
        const git: SimpleGit = simpleGit(dir);
        const remotes = await git.getRemotes(true);
        const hasMatchingRemote = remotes.some(
          (r) =>
            r.refs.fetch?.includes(config.name) ||
            r.refs.push?.includes(config.name) ||
            // Also check for "agent-conf" as a fallback
            r.refs.fetch?.includes("agent-conf") ||
            r.refs.push?.includes("agent-conf"),
        );
        if (hasMatchingRemote) {
          return true;
        }
      } catch {
        // Git check failed, fall back to structure check only
      }

      // Structure matches, accept it even without git verification
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate that a directory has the required canonical repo structure.
   */
  private async validateCanonicalRepo(basePath: string, config: ResolvedConfig): Promise<void> {
    const instructionsPath = path.join(basePath, config.instructionsPath);
    const skillsPath = path.join(basePath, config.skillsDir);

    const [instructionsExists, skillsExists] = await Promise.all([
      fs
        .access(instructionsPath)
        .then(() => true)
        .catch(() => false),
      fs
        .access(skillsPath)
        .then(() => true)
        .catch(() => false),
    ]);

    if (!instructionsExists) {
      throw new Error(
        `Invalid canonical repository: missing ${config.instructionsPath} at ${basePath}`,
      );
    }

    if (!skillsExists) {
      throw new Error(`Invalid canonical repository: missing ${config.skillsDir}/ directory at ${basePath}`);
    }
  }

  /**
   * Get the current git commit SHA, if available.
   */
  private async getCommitSha(basePath: string): Promise<string | undefined> {
    try {
      const git: SimpleGit = simpleGit(basePath);
      const log = await git.log({ maxCount: 1 });
      return log.latest?.hash;
    } catch {
      // Not a git repo or git not available
      return undefined;
    }
  }
}

/**
 * Resolve a local source with explicit options.
 * This is a convenience function for direct use without the registry.
 */
export async function resolveLocalSource(
  localPath: string | undefined,
  config: ResolvedConfig,
): Promise<ResolvedSource> {
  const provider = new LocalProvider();
  return provider.resolve(localPath ?? "", { config, autoDiscover: !localPath });
}

/**
 * Create a local provider instance.
 */
export function createLocalProvider(): SourceProvider {
  return new LocalProvider();
}
