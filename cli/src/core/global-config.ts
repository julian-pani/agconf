/**
 * Global user configuration for agent-conf CLI.
 *
 * Stored at ~/.agent-conf/config.json
 * This is separate from per-repository lockfiles.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const CONFIG_DIR = path.join(os.homedir(), ".agent-conf");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export interface GlobalConfig {
  /** Repository where the CLI is hosted (e.g., "your-org/agent-conf") */
  cliRepository?: string;
}

/**
 * Reads the global config file.
 * Returns empty object if file doesn't exist.
 */
export async function readGlobalConfig(): Promise<GlobalConfig> {
  try {
    const content = await fs.readFile(CONFIG_FILE, "utf-8");
    return JSON.parse(content) as GlobalConfig;
  } catch {
    return {};
  }
}

/**
 * Writes the global config file.
 * Creates the config directory if it doesn't exist.
 */
export async function writeGlobalConfig(config: GlobalConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Updates specific fields in the global config.
 * Preserves existing fields not being updated.
 */
export async function updateGlobalConfig(updates: Partial<GlobalConfig>): Promise<GlobalConfig> {
  const existing = await readGlobalConfig();
  const updated = { ...existing, ...updates };
  await writeGlobalConfig(updated);
  return updated;
}

/**
 * Gets the CLI repository from config.
 */
export async function getCliRepository(): Promise<string | undefined> {
  const config = await readGlobalConfig();
  return config.cliRepository;
}

/**
 * Sets the CLI repository in config.
 */
export async function setCliRepository(repo: string): Promise<void> {
  await updateGlobalConfig({ cliRepository: repo });
}
