import * as prompts from "@clack/prompts";
import pc from "picocolors";
import { getSyncStatus } from "../core/sync.js";
import { compareVersions } from "../core/version.js";
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

  // Validate mutually exclusive flags
  if (options.pinned && options.ref) {
    logger.error("Cannot use --pinned with --ref. Choose one.");
    process.exit(1);
  }
  if (options.pinned && options.local !== undefined) {
    logger.error("Cannot use --pinned with --local.");
    process.exit(1);
  }

  // Resolve target directory to git root
  const targetDir = await resolveTargetDirectory();

  // Check current status (informational only, no confirmation prompt)
  const status = await getSyncStatus(targetDir);

  // Parse targets: use lockfile targets if --target not explicitly specified
  const targetsFromLockfile = status.lockfile?.content.targets;
  const effectiveTargetOption =
    options.target ?? (targetsFromLockfile?.length ? targetsFromLockfile : undefined);
  const targets = await parseAndValidateTargets(effectiveTargetOption);

  // Check schema compatibility
  if (status.schemaError) {
    logger.error(status.schemaError);
    process.exit(1);
  }
  if (status.schemaWarning) {
    logger.warn(status.schemaWarning);
  }

  if (!status.hasSynced) {
    logger.warn(
      "This repository has not been synced yet. Consider running 'agent-conf init' first.",
    );
  }

  // For sync command, try to get source from:
  // 1. --source flag (highest priority)
  // 2. Lockfile's recorded source
  let sourceRepo = options.source;
  if (!sourceRepo && status.lockfile?.source.type === "github") {
    sourceRepo = status.lockfile.source.repository;
  }

  // Resolve version (fetches latest by default, unless --pinned or --ref)
  const resolvedVersion = await resolveVersion(options, status, "sync", sourceRepo);

  // Check if already up to date (when fetching latest, not --pinned or --ref)
  if (!options.pinned && !options.ref && !options.local && status.lockfile?.pinned_version) {
    const currentVersion = status.lockfile.pinned_version;

    if (resolvedVersion.version) {
      const comparison = compareVersions(currentVersion, resolvedVersion.version);

      // Display version info
      console.log();
      console.log(`Canonical source: ${pc.cyan(sourceRepo)}`);
      console.log(`Latest release: ${pc.cyan(resolvedVersion.version)}`);
      console.log(`Pinned version: ${pc.cyan(currentVersion)}`);

      if (comparison >= 0) {
        // Current version is equal or newer
        console.log(`  ${pc.green("✓")} Up to date`);
        console.log();
        prompts.outro(pc.green("Already up to date!"));
        return;
      }

      // Update available
      console.log(
        `  ${pc.yellow("→")} Update available: ${currentVersion} → ${resolvedVersion.version}`,
      );
      console.log();

      // Confirm update
      if (!options.yes) {
        const shouldUpdate = await prompts.confirm({
          message: "Proceed with update?",
          initialValue: true,
        });

        if (prompts.isCancel(shouldUpdate) || !shouldUpdate) {
          prompts.cancel("Sync cancelled");
          process.exit(0);
        }
      }
    }
  }

  // If --ref was specified, inform user about version change
  if (options.ref && status.lockfile?.pinned_version) {
    const currentVersion = status.lockfile.pinned_version;
    if (resolvedVersion.version && currentVersion !== resolvedVersion.version) {
      logger.info(`Updating version: ${currentVersion} → ${resolvedVersion.version}`);
    }
  }

  // Pass the resolved source to options for resolveSource
  const optionsWithSource: SyncOptions = sourceRepo ? { ...options, source: sourceRepo } : options;

  // Resolve source using the determined version
  const { resolvedSource, tempDir, repository } = await resolveSource(
    optionsWithSource,
    resolvedVersion,
  );

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
    summaryFile: options.summaryFile,
    expandChanges: options.expandChanges,
  });
}
