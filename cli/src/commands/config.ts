import * as prompts from "@clack/prompts";
import pc from "picocolors";
import { createLogger } from "../utils/logger.js";

export async function configShowCommand(): Promise<void> {
  console.log();
  prompts.intro(pc.bold("agconf config"));

  console.log();
  console.log(pc.bold("Global Configuration:"));
  console.log();
  console.log(pc.dim("  No configuration options available."));
  console.log();
  console.log(pc.dim("Config location: ~/.agconf/config.json"));

  prompts.outro("");
}

export async function configGetCommand(key: string): Promise<void> {
  const logger = createLogger();
  logger.error(`Unknown config key: ${key}`);
  logger.info("No configuration options available.");
  process.exit(1);
}

export async function configSetCommand(key: string, _value: string): Promise<void> {
  const logger = createLogger();
  logger.error(`Unknown config key: ${key}`);
  logger.info("No configuration options available.");
  process.exit(1);
}
