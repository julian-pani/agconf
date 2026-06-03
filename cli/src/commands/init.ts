import * as prompts from "@clack/prompts";
import pc from "picocolors";
import { getSyncStatus } from "../core/sync.js";
import { createLogger } from "../utils/logger.js";
import { promptCompletionInstall } from "./completion.js";
import {
  checkModifiedFilesBeforeSync,
  parseAndValidateTargets,
  performSync,
  promptMergeOrOverride,
  resolveSource,
  resolveTargetDirectory,
  resolveVersion,
  type SharedSyncOptions,
} from "./shared.js";

export interface InitOptions extends SharedSyncOptions {}

export async function initCommand(options: InitOptions): Promise<void> {
  const logger = createLogger();

  console.log();
  prompts.intro(pc.bold("agconf init"));

  // Resolve target directory to git root
  const targetDir = await resolveTargetDirectory(options.cwd);

  // Parse targets
  const targets = await parseAndValidateTargets(options.target);

  // Check current status
  const status = await getSyncStatus(targetDir);

  // Check schema compatibility
  if (status.schemaError) {
    logger.error(status.schemaError);
    process.exit(1);
  }
  if (status.schemaWarning) {
    logger.warn(status.schemaWarning);
  }

  // Prompt if already synced (init-specific behavior)
  if (status.hasSynced && !options.yes) {
    const shouldContinue = await prompts.confirm({
      message: "This repository has already been synced. Do you want to sync again?",
    });

    if (prompts.isCancel(shouldContinue) || !shouldContinue) {
      prompts.cancel("Operation cancelled");
      process.exit(0);
    }
  }

  // Resolve version (fetches latest release if no --ref specified)
  // For GitHub sources, pass the repo to fetch releases from
  const resolvedVersion = await resolveVersion(options, status, "init", options.source);

  // Resolve source using the determined version
  const { resolvedSource, tempDir, repository } = await resolveSource(options, resolvedVersion);

  // Determine merge behavior
  const shouldOverride = await promptMergeOrOverride(status, options, tempDir);

  // Check for modified skill files and warn
  await checkModifiedFilesBeforeSync(targetDir, targets, options, tempDir);

  // Perform sync (includes workflow files for release versions)
  await performSync({
    targetDir,
    resolvedSource,
    resolvedVersion,
    shouldOverride,
    targets,
    context: {
      commandName: "init",
      status,
    },
    tempDir,
    yes: options.yes,
    sourceRepo: repository,
  });

  // Prompt to install shell completions (only if not in non-interactive mode)
  if (!options.yes) {
    await promptCompletionInstall();
  }
}
