import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type SimpleGit, simpleGit } from "simple-git";
import type { Source } from "../schemas/lockfile.js";

export interface ResolvedSource {
  source: Source;
  basePath: string;
  agentsMdPath: string;
  skillsPath: string;
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
    // Not a git repo or git not available
  }

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
  };
}

export async function resolveGithubSource(
  options: GithubSourceOptions,
  tempDir: string,
): Promise<ResolvedSource> {
  const { repository, ref = DEFAULT_REF } = options;
  const repoUrl = `https://github.com/${repository}.git`;

  const git: SimpleGit = simpleGit();
  await git.clone(repoUrl, tempDir, ["--depth", "1", "--branch", ref]);

  const clonedGit: SimpleGit = simpleGit(tempDir);
  const log = await clonedGit.log({ maxCount: 1 });
  const commitSha = log.latest?.hash ?? "";

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
  };
}

async function findCanonicalRepo(startDir: string): Promise<string> {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  // First, check if we're already inside the agent-conf repo
  let checkDir = currentDir;
  while (checkDir !== root) {
    if (await isCanonicalRepo(checkDir)) {
      return checkDir;
    }
    checkDir = path.dirname(checkDir);
  }

  // Otherwise, look for a sibling "agent-conf" directory
  currentDir = path.resolve(startDir);
  while (currentDir !== root) {
    const parentDir = path.dirname(currentDir);
    const siblingCanonicalRepo = path.join(parentDir, "agent-conf");

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

    // Check for agent-conf structure
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

    // Optionally verify git remote contains "agent-conf"
    try {
      const git: SimpleGit = simpleGit(dir);
      const remotes = await git.getRemotes(true);
      const hasMatchingRemote = remotes.some(
        (r) => r.refs.fetch?.includes("agent-conf") || r.refs.push?.includes("agent-conf"),
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
