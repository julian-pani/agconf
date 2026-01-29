import * as prompts from "@clack/prompts";
import pc from "picocolors";
import { getSyncStatus } from "../core/sync.js";
import { createLogger } from "../utils/logger.js";
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

export interface SyncOptions extends SharedSyncOptions {}

export async function syncCommand(options: SyncOptions): Promise<void> {
  const logger = createLogger();

  console.log();
  prompts.intro(pc.bold("agent-conf sync"));

  // Resolve target directory to git root
  const targetDir = await resolveTargetDirectory();

  // Parse targets
  const targets = await parseAndValidateTargets(options.target);

  // Check current status (informational only, no confirmation prompt)
  const status = await getSyncStatus(targetDir);

  if (!status.hasSynced) {
    logger.warn("This repository has not been synced yet. Consider running 'agent-conf init' first.");
  }

  // For sync command, try to get source from:
  // 1. --source flag (highest priority)
  // 2. Lockfile's recorded source
  let sourceRepo = options.source;
  if (!sourceRepo && status.lockfile?.source.type === "github") {
    sourceRepo = status.lockfile.source.repository;
  }

  // Resolve version (uses lockfile version if no --ref specified)
  const resolvedVersion = await resolveVersion(options, status, "sync", sourceRepo);

  // If --ref was specified, inform user about version change
  if (options.ref && status.lockfile?.pinned_version) {
    const currentVersion = status.lockfile.pinned_version;
    if (resolvedVersion.version && currentVersion !== resolvedVersion.version) {
      logger.info(`Updating version: ${currentVersion} → ${resolvedVersion.version}`);
    }
  }

  // Pass the resolved source to options for resolveSource
  const optionsWithSource: SyncOptions = sourceRepo
    ? { ...options, source: sourceRepo }
    : options;

  // Resolve source using the determined version
  const { resolvedSource, tempDir, repository } = await resolveSource(optionsWithSource, resolvedVersion);

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
      commandName: "sync",
      status,
    },
    tempDir,
    yes: options.yes,
    sourceRepo: repository,
  });
}
