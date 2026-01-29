import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type SimpleGit, simpleGit } from "simple-git";

/**
 * Check if a directory exists.
 */
async function directoryExistsForGit(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

export interface GitInfo {
  isGitRepo: boolean;
  branch?: string;
  commitSha?: string;
  isDirty?: boolean;
}

export async function getGitInfo(dir: string): Promise<GitInfo> {
  const git: SimpleGit = simpleGit(dir);

  try {
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return { isGitRepo: false };
    }

    const [branch, log, status] = await Promise.all([
      git
        .branch()
        .then((b) => b.current)
        .catch(() => undefined),
      git
        .log({ maxCount: 1 })
        .then((l) => l.latest?.hash)
        .catch(() => undefined),
      git
        .status()
        .then((s) => !s.isClean())
        .catch(() => undefined),
    ]);

    const result: GitInfo = { isGitRepo: true };
    if (branch !== undefined) result.branch = branch;
    if (log !== undefined) result.commitSha = log;
    if (status !== undefined) result.isDirty = status;
    return result;
  } catch {
    return { isGitRepo: false };
  }
}

export async function isGitRepo(dir: string): Promise<boolean> {
  const git: SimpleGit = simpleGit(dir);
  try {
    return await git.checkIsRepo();
  } catch {
    return false;
  }
}

export async function getGitRoot(dir: string): Promise<string | null> {
  if (!(await directoryExistsForGit(dir))) {
    return null;
  }
  try {
    const git: SimpleGit = simpleGit(dir);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return null;
    }
    // Get the root directory of the git repository
    const root = await git.revparse(["--show-toplevel"]);
    return root.trim();
  } catch {
    return null;
  }
}

/**
 * Get the git project name (basename of the git root directory).
 * Returns null if not in a git repository or directory doesn't exist.
 */
export async function getGitProjectName(dir: string): Promise<string | null> {
  const gitRoot = await getGitRoot(dir);
  if (!gitRoot) {
    return null;
  }
  return path.basename(gitRoot);
}

/**
 * Check if the given directory is the root of a git repository.
 * Returns false if directory doesn't exist.
 */
export async function isGitRoot(dir: string): Promise<boolean> {
  if (!(await directoryExistsForGit(dir))) {
    return false;
  }
  const gitRoot = await getGitRoot(dir);
  if (!gitRoot) {
    return false;
  }
  // Resolve real paths to handle symlinks (e.g., macOS /var -> /private/var)
  try {
    const realDir = await fs.realpath(dir);
    const realGitRoot = await fs.realpath(gitRoot);
    return realDir === realGitRoot;
  } catch {
    // Fallback to simple comparison if realpath fails
    return path.resolve(dir) === path.resolve(gitRoot);
  }
}

/**
 * Get git config value.
 * Returns undefined if directory doesn't exist, not in a git repo, or config not set.
 */
export async function getGitConfig(dir: string, key: string): Promise<string | undefined> {
  if (!(await directoryExistsForGit(dir))) {
    return undefined;
  }
  try {
    const git: SimpleGit = simpleGit(dir);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return undefined;
    }
    const value = await git.getConfig(key);
    return value.value ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Get organization name from git config or remote URL.
 * Returns undefined if directory doesn't exist or not in a git repo.
 * Tries to extract org from remote origin URL first, then falls back to user.name.
 */
export async function getGitOrganization(dir: string): Promise<string | undefined> {
  if (!(await directoryExistsForGit(dir))) {
    return undefined;
  }
  try {
    const git: SimpleGit = simpleGit(dir);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return undefined;
    }

    // Try to extract organization from remote origin URL
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === "origin");
    if (origin?.refs.fetch) {
      const url = origin.refs.fetch;
      // Match patterns like:
      // https://github.com/org/repo.git
      // git@github.com:org/repo.git
      const httpsMatch = url.match(/github\.com\/([^/]+)\//);
      const sshMatch = url.match(/github\.com:([^/]+)\//);
      const org = httpsMatch?.[1] ?? sshMatch?.[1];
      if (org) {
        return org;
      }
    }

    // Fallback to user.name from git config
    const userName = await git.getConfig("user.name");
    return userName.value ?? undefined;
  } catch {
    return undefined;
  }
}
