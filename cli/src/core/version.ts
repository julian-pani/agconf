/**
 * Version resolution and management for agent-conf releases.
 *
 * Handles fetching release information from GitHub, parsing version strings,
 * and determining the appropriate version to use.
 */

import { execSync } from "node:child_process";

const GITHUB_API_BASE = "https://api.github.com";

/**
 * Gets a GitHub token for API authentication.
 * Tries in order:
 * 1. GITHUB_TOKEN environment variable
 * 2. gh auth token (if gh CLI is installed)
 * Throws an error if no token is available.
 */
function getGitHubToken(): string {
  // First try environment variable
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }

  // Try gh CLI
  try {
    const token = execSync("gh auth token", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    if (token) {
      return token;
    }
  } catch {
    // gh CLI not available or not authenticated
  }

  throw new Error(
    `GitHub authentication required to access agent-conf releases.

To fix this, do one of the following:

1. Install and authenticate GitHub CLI (recommended):
   brew install gh
   gh auth login

2. Set GITHUB_TOKEN environment variable:
   export GITHUB_TOKEN=<your-personal-access-token>

   Create a token at https://github.com/settings/tokens
   with 'repo' scope for private repository access.`,
  );
}

/**
 * Builds headers for GitHub API requests.
 * Includes Authorization header with required token.
 */
function getGitHubHeaders(): Record<string, string> {
  const token = getGitHubToken();
  return {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "agent-conf-cli",
    Authorization: `token ${token}`,
  };
}

export interface ReleaseInfo {
  tag: string; // e.g., "v1.2.0"
  version: string; // e.g., "1.2.0" (without 'v' prefix)
  commitSha: string;
  publishedAt: string;
  tarballUrl: string;
}

/**
 * Fetches the latest release from a GitHub repository.
 */
export async function getLatestRelease(repo: string): Promise<ReleaseInfo> {
  const url = `${GITHUB_API_BASE}/repos/${repo}/releases/latest`;

  const response = await fetch(url, {
    headers: getGitHubHeaders(),
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("No releases found for agent-conf repository");
    }
    throw new Error(`Failed to fetch latest release: ${response.statusText}`);
  }

  const data: unknown = await response.json();
  return parseReleaseResponse(data as Record<string, unknown>);
}

/**
 * Fetches a specific release by tag from a GitHub repository.
 */
export async function getReleaseByTag(repo: string, tag: string): Promise<ReleaseInfo> {
  // Ensure tag has 'v' prefix
  const normalizedTag = tag.startsWith("v") ? tag : `v${tag}`;
  const url = `${GITHUB_API_BASE}/repos/${repo}/releases/tags/${normalizedTag}`;

  const response = await fetch(url, {
    headers: getGitHubHeaders(),
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Release ${normalizedTag} not found`);
    }
    throw new Error(`Failed to fetch release ${normalizedTag}: ${response.statusText}`);
  }

  const data: unknown = await response.json();
  return parseReleaseResponse(data as Record<string, unknown>);
}

/**
 * Lists all releases from a GitHub repository.
 */
export async function listReleases(repo: string, limit = 10): Promise<ReleaseInfo[]> {
  const url = `${GITHUB_API_BASE}/repos/${repo}/releases?per_page=${limit}`;

  const response = await fetch(url, {
    headers: getGitHubHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch releases: ${response.statusText}`);
  }

  const data: unknown = await response.json();
  return (data as Record<string, unknown>[]).map(parseReleaseResponse);
}

/**
 * Parses a GitHub release API response into ReleaseInfo.
 */
function parseReleaseResponse(data: Record<string, unknown>): ReleaseInfo {
  const tag = data.tag_name as string;
  return {
    tag,
    version: parseVersion(tag),
    commitSha: (data.target_commitish as string) || "",
    publishedAt: data.published_at as string,
    tarballUrl: data.tarball_url as string,
  };
}

/**
 * Parses a version tag into a clean version string.
 * "v1.2.0" -> "1.2.0"
 * "1.2.0" -> "1.2.0"
 */
export function parseVersion(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

/**
 * Formats a version string as a tag.
 * "1.2.0" -> "v1.2.0"
 * "v1.2.0" -> "v1.2.0"
 */
export function formatTag(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

/**
 * Checks if a ref is a version tag (e.g., "v1.2.0" or "1.2.0").
 */
export function isVersionRef(ref: string): boolean {
  const normalized = ref.startsWith("v") ? ref.slice(1) : ref;
  return /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(normalized);
}

/**
 * Checks if a ref is a branch name (e.g., "master", "main", "develop").
 */
export function isBranchRef(ref: string): boolean {
  return !isVersionRef(ref);
}

/**
 * Resolves a ref to release info.
 * - "latest" -> fetches latest release
 * - "v1.2.0" or "1.2.0" -> fetches specific release
 * - "master" or other branch -> returns null (not a release)
 */
export async function resolveRef(repo: string, ref: string): Promise<ReleaseInfo | null> {
  if (ref === "latest") {
    return getLatestRelease(repo);
  }

  if (isVersionRef(ref)) {
    return getReleaseByTag(repo, ref);
  }

  // Branch ref - not a release
  return null;
}

/**
 * Compares two semantic versions.
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
export function compareVersions(a: string, b: string): number {
  const parseVer = (v: string) => {
    const clean = v.startsWith("v") ? v.slice(1) : v;
    const [main, prerelease] = clean.split("-");
    const parts = (main ?? "").split(".").map(Number);
    return { parts, prerelease };
  };

  const verA = parseVer(a);
  const verB = parseVer(b);

  // Compare major.minor.patch
  for (let i = 0; i < 3; i++) {
    const partA = verA.parts[i] || 0;
    const partB = verB.parts[i] || 0;
    if (partA < partB) return -1;
    if (partA > partB) return 1;
  }

  // Handle prerelease (1.0.0-alpha < 1.0.0)
  if (verA.prerelease && !verB.prerelease) return -1;
  if (!verA.prerelease && verB.prerelease) return 1;
  if (verA.prerelease && verB.prerelease) {
    return verA.prerelease.localeCompare(verB.prerelease);
  }

  return 0;
}

/**
 * Gets the download URL for a CLI tarball from a release.
 */
export function getCliTarballUrl(repo: string, version: string): string {
  const tag = formatTag(version);
  return `https://github.com/${repo}/releases/download/${tag}/agent-conf-cli-${tag}.tar.gz`;
}

/**
 * Gets the download URL for the latest CLI tarball.
 */
export function getLatestCliTarballUrl(repo: string): string {
  return `https://github.com/${repo}/releases/latest/download/agent-conf-cli.tar.gz`;
}
