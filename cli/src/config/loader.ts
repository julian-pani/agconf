import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  CanonicalRepoConfigSchema,
  DEFAULT_CONFIG,
  DownstreamConfigSchema,
  type CanonicalRepoConfig,
  type DownstreamConfig,
  type ResolvedConfig,
} from "./schema.js";

// Config file names
const CANONICAL_REPO_CONFIG = "agent-conf.yaml";
const DOWNSTREAM_CONFIG = ".agent-conf.yaml";

// Legacy config file names (for migration)
const LEGACY_LOCKFILE_DIR = ".agent-conf";
const LEGACY_LOCKFILE_NAME = "agent-conf.lock";

export interface LoadConfigOptions {
  /** Path to the canonical source repository */
  sourcePath?: string;
  /** Path to the downstream repository (where content is synced to) */
  targetPath?: string;
  /** Override config values (for CLI flags) */
  overrides?: Partial<ResolvedConfig>;
}

export interface LoadedConfig {
  /** Resolved configuration with all defaults applied */
  config: ResolvedConfig;
  /** Canonical repo config if found */
  canonicalRepoConfig: CanonicalRepoConfig | undefined;
  /** Downstream config if found */
  downstreamConfig: DownstreamConfig | undefined;
  /** Whether a legacy agent-conf setup was detected */
  hasLegacySetup: boolean;
}

/**
 * Load configuration from source and target repositories.
 * Resolves configuration in order of precedence:
 * 1. CLI overrides (highest)
 * 2. Downstream repo config (.agent-conf.yaml)
 * 3. Canonical repo config (agent-conf.yaml)
 * 4. Defaults (lowest)
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadedConfig> {
  const { sourcePath, targetPath, overrides = {} } = options;

  let canonicalRepoConfig: CanonicalRepoConfig | undefined;
  let downstreamConfig: DownstreamConfig | undefined;
  let hasLegacySetup = false;

  // Load canonical repo config if source path provided
  if (sourcePath) {
    canonicalRepoConfig = await loadCanonicalRepoConfig(sourcePath);
  }

  // Load downstream config if target path provided
  if (targetPath) {
    downstreamConfig = await loadDownstreamConfig(targetPath);
    hasLegacySetup = await detectLegacySetup(targetPath);
  }

  // Resolve final configuration
  const config = resolveConfig(canonicalRepoConfig, downstreamConfig, overrides);

  return {
    config,
    canonicalRepoConfig,
    downstreamConfig,
    hasLegacySetup,
  };
}

/**
 * Load canonical repository config (agent-conf.yaml).
 * Returns undefined if file doesn't exist.
 */
export async function loadCanonicalRepoConfig(
  basePath: string,
): Promise<CanonicalRepoConfig | undefined> {
  const configPath = path.join(basePath, CANONICAL_REPO_CONFIG);

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const parsed = parseYaml(content);
    return CanonicalRepoConfigSchema.parse(parsed);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw new Error(`Failed to load ${CANONICAL_REPO_CONFIG}: ${error}`);
  }
}

/**
 * Load downstream repository config (.agent-conf.yaml).
 * Returns undefined if file doesn't exist.
 */
export async function loadDownstreamConfig(
  basePath: string,
): Promise<DownstreamConfig | undefined> {
  const configPath = path.join(basePath, DOWNSTREAM_CONFIG);

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const parsed = parseYaml(content);
    return DownstreamConfigSchema.parse(parsed);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw new Error(`Failed to load ${DOWNSTREAM_CONFIG}: ${error}`);
  }
}

/**
 * Detect if the target repository has a legacy agent-conf setup.
 */
export async function detectLegacySetup(targetPath: string): Promise<boolean> {
  const legacyLockfilePath = path.join(targetPath, LEGACY_LOCKFILE_DIR, LEGACY_LOCKFILE_NAME);

  try {
    await fs.access(legacyLockfilePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve final configuration by merging sources in order of precedence.
 */
export function resolveConfig(
  canonicalRepoConfig?: CanonicalRepoConfig,
  downstreamConfig?: DownstreamConfig,
  overrides: Partial<ResolvedConfig> = {},
): ResolvedConfig {
  // Start with defaults
  const config: ResolvedConfig = { ...DEFAULT_CONFIG };

  // Apply canonical repo config
  if (canonicalRepoConfig) {
    config.name = canonicalRepoConfig.meta.name;
    config.organization = canonicalRepoConfig.meta.organization;
    config.instructionsPath = canonicalRepoConfig.content.instructions;
    config.skillsDir = canonicalRepoConfig.content.skills_dir;
    config.markerPrefix = canonicalRepoConfig.markers.prefix;
    config.targets = canonicalRepoConfig.targets;
    config.preserveRepoContent = canonicalRepoConfig.merge.preserve_repo_content;
  }

  // Apply downstream config overrides
  if (downstreamConfig) {
    if (downstreamConfig.targets) {
      config.targets = downstreamConfig.targets;
    }
  }

  // Apply CLI overrides
  Object.assign(config, overrides);

  return config;
}

/**
 * Get the lockfile path for a target repository.
 */
export function getLockfilePath(targetPath: string, config: ResolvedConfig): string {
  return path.join(targetPath, config.configDir, config.lockfileName);
}

/**
 * Get the config directory path for a target repository.
 */
export function getConfigDirPath(targetPath: string, config: ResolvedConfig): string {
  return path.join(targetPath, config.configDir);
}

/**
 * Ensure the config directory exists.
 */
export async function ensureConfigDir(targetPath: string, config: ResolvedConfig): Promise<void> {
  const configDir = getConfigDirPath(targetPath, config);
  await fs.mkdir(configDir, { recursive: true });
}

// Type guard for Node.js errors with code property
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
