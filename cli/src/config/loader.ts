import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseDocument, parse as parseYaml } from "yaml";
import {
  type CanonicalRepoConfig,
  CanonicalRepoConfigSchema,
  type DownstreamConfig,
  DownstreamConfigSchema,
  type UserScopeConfig,
  UserScopeConfigSchema,
} from "./schema.js";

// Config file names
const CANONICAL_REPO_CONFIG = "agconf.yaml";
const DOWNSTREAM_CONFIG = "config.yaml";

/**
 * Load canonical repository config (agconf.yaml).
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
 * Load downstream repository config (.agconf/config.yaml).
 * Returns undefined if file doesn't exist.
 * This config contains user preferences for how sync operates (workflow settings, etc.)
 */
export async function loadDownstreamConfig(
  basePath: string,
): Promise<DownstreamConfig | undefined> {
  const configPath = path.join(basePath, ".agconf", DOWNSTREAM_CONFIG);

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const parsed = parseYaml(content);
    return DownstreamConfigSchema.parse(parsed);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw new Error(`Failed to load .agconf/${DOWNSTREAM_CONFIG}: ${error}`);
  }
}

/** Absolute path of the user-scope config (`~/.agconf/config.yaml`). */
export function getUserScopeConfigPath(homeDir: string): string {
  return path.join(homeDir, ".agconf", DOWNSTREAM_CONFIG);
}

/**
 * Load user-scope config (~/.agconf/config.yaml). Returns defaults (autosync
 * enabled, 10-minute interval) when the file is absent — the config is optional
 * INTENT, so no file means "use defaults". Malformed YAML still throws.
 */
export async function loadUserScopeConfig(homeDir: string): Promise<UserScopeConfig> {
  const configPath = getUserScopeConfigPath(homeDir);

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const parsed = parseYaml(content);
    return UserScopeConfigSchema.parse(parsed ?? {});
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return UserScopeConfigSchema.parse({});
    }
    throw new Error(`Failed to load ~/.agconf/${DOWNSTREAM_CONFIG}: ${error}`);
  }
}

/**
 * Whether background auto-sync has been explicitly installed — i.e. the user
 * ran `agconf autosync --install`/`--enable`, which writes the config file. The
 * file's PRESENCE is the opt-in marker (independent of the `enabled` value), so
 * upgrading a user who only has the session-check hook does not silently start
 * auto-sync.
 */
export async function isAutosyncInstalled(homeDir: string): Promise<boolean> {
  try {
    await fs.access(getUserScopeConfigPath(homeDir));
    return true;
  } catch {
    return false;
  }
}

/**
 * Set `autosync.enabled` in the user-scope config, PRESERVING the rest of the
 * file — comments and any other keys — by patching the YAML document in place
 * rather than round-tripping through the (unknown-key-stripping) Zod schema.
 * Creating the file is what marks auto-sync as installed.
 */
export async function setAutosyncEnabled(homeDir: string, enabled: boolean): Promise<void> {
  const configPath = getUserScopeConfigPath(homeDir);
  let raw = "";
  try {
    raw = await fs.readFile(configPath, "utf-8");
  } catch (error) {
    if (!(isNodeError(error) && error.code === "ENOENT")) throw error;
  }
  const doc = parseDocument(raw); // empty string → empty document
  doc.setIn(["autosync", "enabled"], enabled);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, doc.toString(), "utf-8");
}

// Type guard for Node.js errors with code property
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
