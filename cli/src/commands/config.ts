import * as prompts from "@clack/prompts";
import pc from "picocolors";
import {
  getCliRepository,
  readGlobalConfig,
  setCliRepository,
} from "../core/global-config.js";
import { createLogger } from "../utils/logger.js";

export type ConfigOptions = {}

export type ConfigSetKey = "cli-repo";

export async function configShowCommand(): Promise<void> {
  console.log();
  prompts.intro(pc.bold("agent-conf config"));

  const config = await readGlobalConfig();

  console.log();
  console.log(pc.bold("Global Configuration:"));
  console.log();

  if (config.cliRepository) {
    console.log(`  cli-repo: ${pc.cyan(config.cliRepository)}`);
  } else {
    console.log(`  cli-repo: ${pc.dim("(not set)")}`);
  }

  console.log();
  console.log(pc.dim("Config location: ~/.agent-conf/config.json"));

  prompts.outro("");
}

export async function configGetCommand(key: string): Promise<void> {
  const logger = createLogger();

  switch (key) {
    case "cli-repo": {
      const value = await getCliRepository();
      if (value) {
        console.log(value);
      } else {
        logger.warn("cli-repo is not set");
        process.exit(1);
      }
      break;
    }
    default:
      logger.error(`Unknown config key: ${key}`);
      logger.info("Available keys: cli-repo");
      process.exit(1);
  }
}

export async function configSetCommand(key: string, value: string): Promise<void> {
  const logger = createLogger();

  switch (key) {
    case "cli-repo":
      await setCliRepository(value);
      logger.info(`Set cli-repo to: ${value}`);
      break;
    default:
      logger.error(`Unknown config key: ${key}`);
      logger.info("Available keys: cli-repo");
      process.exit(1);
  }
}
