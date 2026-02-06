import { exec } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { type SimpleGit, simpleGit } from "simple-git";
import { loadCanonicalRepoConfig } from "../config/loader.js";
import type { Source } from "../schemas/lockfile.js";

const execAsync = promisify(exec);

export interface ResolvedSource {
  source: Source;
  basePath: string;
  agentsMdPath: string;
  skillsPath: string;
  /** Path to rules directory (null if no rules_dir configured) */
  rulesPath: string | null;
  /** Path to agents directory (null if no agents_dir configured) */
  agentsPath: string | null;
  /** Marker prefix from canonical config (default: "agconf") */
  markerPrefix: string;
}

export interface LocalSourceOptions {
  path?: string;
}

export interface GithubSourceOptions {
  repository: string;
  ref: string;
}

const DEFAULT_REF = "master";

export async function resolveLocalSource(
  options: LocalSourceOptions = {},
): Promise<ResolvedSource> {
  let basePath: string;

  if (options.path) {
    basePath = path.resolve(options.path);
  } else {
    basePath = await findCanonicalRepo(process.cwd());
  }

  await validateCanonicalRepo(basePath);

  const git: SimpleGit = simpleGit(basePath);
  let commitSha: string | undefined;

  try {
    const log = await git.log({ maxCount: 1 });
    commitSha = log.latest?.hash;
  } catch {
    // Expected: not a git repo or git not available, commit SHA is optional
  }

  // Load canonical config to get marker prefix, rules_dir, and agents_dir
  const canonicalConfig = await loadCanonicalRepoConfig(basePath);
  const markerPrefix = canonicalConfig?.markers.prefix ?? "agconf";
  const rulesDir = canonicalConfig?.content.rules_dir;
  const agentsDir = canonicalConfig?.content.agents_dir;

  const source: Source = {
    type: "local",
    path: basePath,
    commit_sha: commitSha,
  };

  return {
    source,
    basePath,
    agentsMdPath: path.join(basePath, "instructions", "AGENTS.md"),
    skillsPath: path.join(basePath, "skills"),
    rulesPath: rulesDir ? path.join(basePath, rulesDir) : null,
    agentsPath: agentsDir ? path.join(basePath, agentsDir) : null,
    markerPrefix,
  };
}

export async function resolveGithubSource(
  options: GithubSourceOptions,
  tempDir: string,
): Promise<ResolvedSource> {
  const { repository, ref = DEFAULT_REF } = options;

  await cloneRepository(repository, ref, tempDir);

  const clonedGit: SimpleGit = simpleGit(tempDir);
  const log = await clonedGit.log({ maxCount: 1 });
  const commitSha = log.latest?.hash ?? "";

  // Load canonical config to get marker prefix, rules_dir, and agents_dir
  const canonicalConfig = await loadCanonicalRepoConfig(tempDir);
  const markerPrefix = canonicalConfig?.markers.prefix ?? "agconf";
  const rulesDir = canonicalConfig?.content.rules_dir;
  const agentsDir = canonicalConfig?.content.agents_dir;

  const source: Source = {
    type: "github",
    repository,
    commit_sha: commitSha,
    ref,
  };

  return {
    source,
    basePath: tempDir,
    agentsMdPath: path.join(tempDir, "instructions", "AGENTS.md"),
    skillsPath: path.join(tempDir, "skills"),
    rulesPath: rulesDir ? path.join(tempDir, rulesDir) : null,
    agentsPath: agentsDir ? path.join(tempDir, agentsDir) : null,
    markerPrefix,
  };
}

/**
 * Clone a repository using the best available method.
 * Tries in order: gh CLI, HTTPS with token, plain HTTPS.
 */
async function cloneRepository(repository: string, ref: string, tempDir: string): Promise<void> {
  // Try gh CLI first (handles auth automatically in CI)
  if (await isGhAvailable()) {
    try {
      await execAsync(`gh repo clone ${repository} ${tempDir} -- --depth 1 --branch ${ref}`);
      return;
    } catch {
      // Expected: gh clone may fail, fall back to git with token auth
    }
  }

  // Fall back to git with GITHUB_TOKEN authentication
  const token = process.env.GITHUB_TOKEN;
  const repoUrl = token
    ? `https://x-access-token:${token}@github.com/${repository}.git`
    : `https://github.com/${repository}.git`;

  const git: SimpleGit = simpleGit();
  await git.clone(repoUrl, tempDir, ["--depth", "1", "--branch", ref]);
}

/**
 * Check if gh CLI is available.
 */
async function isGhAvailable(): Promise<boolean> {
  try {
    await execAsync("gh --version");
    return true;
  } catch {
    // Expected: gh CLI not installed
    return false;
  }
}

async function findCanonicalRepo(startDir: string): Promise<string> {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  // First, check if we're already inside the agconf repo
  let checkDir = currentDir;
  while (checkDir !== root) {
    if (await isCanonicalRepo(checkDir)) {
      return checkDir;
    }
    checkDir = path.dirname(checkDir);
  }

  // Otherwise, look for a sibling "agconf" directory
  currentDir = path.resolve(startDir);
  while (currentDir !== root) {
    const parentDir = path.dirname(currentDir);
    const siblingCanonicalRepo = path.join(parentDir, "agconf");

    if (await isCanonicalRepo(siblingCanonicalRepo)) {
      return siblingCanonicalRepo;
    }

    currentDir = parentDir;
  }

  throw new Error(
    "Could not find canonical repository. Please specify --local <path> or run from within the canonical repo.",
  );
}

async function isCanonicalRepo(dir: string): Promise<boolean> {
  try {
    // Check directory exists
    const stat = await fs.stat(dir).catch(() => null);
    if (!stat?.isDirectory()) {
      return false;
    }

    // Check for agconf structure
    const instructionsPath = path.join(dir, "instructions", "AGENTS.md");
    const skillsPath = path.join(dir, "skills");

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

    // Optionally verify git remote contains "agconf"
    try {
      const git: SimpleGit = simpleGit(dir);
      const remotes = await git.getRemotes(true);
      const hasMatchingRemote = remotes.some(
        (r) => r.refs.fetch?.includes("agconf") || r.refs.push?.includes("agconf"),
      );
      if (hasMatchingRemote) {
        return true;
      }
    } catch {
      // Expected: git check may fail, fall back to structure check only
    }

    // Structure matches, accept it even without git verification
    return true;
  } catch {
    // Expected: directory access or structure check failed
    return false;
  }
}

async function validateCanonicalRepo(basePath: string): Promise<void> {
  const agentsMdPath = path.join(basePath, "instructions", "AGENTS.md");
  const skillsPath = path.join(basePath, "skills");

  const [agentsMdExists, skillsExists] = await Promise.all([
    fs
      .access(agentsMdPath)
      .then(() => true)
      .catch(() => false),
    fs
      .access(skillsPath)
      .then(() => true)
      .catch(() => false),
  ]);

  if (!agentsMdExists) {
    throw new Error(`Invalid canonical repository: missing instructions/AGENTS.md at ${basePath}`);
  }

  if (!skillsExists) {
    throw new Error(`Invalid canonical repository: missing skills/ directory at ${basePath}`);
  }
}

export function formatSourceString(source: Source): string {
  if (source.type === "github") {
    const sha = source.commit_sha.slice(0, 7);
    return `github:${source.repository}@${sha}`;
  }
  if (source.commit_sha) {
    return `local:${source.path}@${source.commit_sha.slice(0, 7)}`;
  }
  return `local:${source.path}`;
}

export function getDefaultRef(): string {
  return DEFAULT_REF;
}
