import * as prompts from "@clack/prompts";
import pc from "picocolors";
import { getCliVersion } from "../core/lockfile.js";
import { resolveGithubSource } from "../core/source.js";
import { getSyncStatus, type SyncStatus } from "../core/sync.js";
import { compareVersions, getLatestRelease, type ReleaseInfo } from "../core/version.js";
import { createTempDir, removeTempDir } from "../utils/fs.js";
import { getGitRoot } from "../utils/git.js";
import { createLogger } from "../utils/logger.js";
import {
  checkModifiedFilesBeforeSync,
  parseAndValidateTargets,
  performSync,
  promptMergeOrOverride,
  type ResolvedVersion,
} from "./shared.js";

export interface UpdateOptions {
  yes?: boolean;
  target?: string[];
}

/**
 * Gets the repository from the lockfile's source.
 * Returns undefined for local sources or if no lockfile exists.
 */
function getRepositoryFromLockfile(status: SyncStatus): string | undefined {
  if (!status.lockfile?.source) {
    return undefined;
  }
  if (status.lockfile.source.type === "github") {
    return status.lockfile.source.repository;
  }
  return undefined;
}

export async function updateCommand(options: UpdateOptions): Promise<void> {
  const logger = createLogger();
  const currentCliVersion = getCliVersion();

  console.log();
  prompts.intro(pc.bold("agent-conf update"));

  // Check if we're in a git repo
  const cwd = process.cwd();
  const gitRoot = await getGitRoot(cwd);

  if (!gitRoot) {
    logger.error("Not inside a git repository. Run this command from within a git repository.");
    process.exit(1);
  }

  const status = await getSyncStatus(gitRoot);
  const sourceRepository = getRepositoryFromLockfile(status);

  // For update command, we need a repository to check releases
  if (!sourceRepository) {
    logger.error(
      "No GitHub source found in lockfile. Cannot check for updates.\n" +
        "Run 'agent-conf init --source <owner/repo>' to sync from a canonical repository first.",
    );
    process.exit(1);
  }

  // Fetch latest release from the canonical repo
  const spinner = logger.spinner("Checking for updates...");
  spinner.start();

  let latestRelease: ReleaseInfo;
  try {
    latestRelease = await getLatestRelease(sourceRepository);
    spinner.stop();
  } catch (error) {
    spinner.fail("Failed to check for updates");
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Display version info
  console.log();
  console.log(`CLI version: ${pc.cyan(currentCliVersion)}`);
  console.log(`Canonical source: ${pc.cyan(sourceRepository)}`);
  console.log(`Latest release: ${pc.cyan(latestRelease.tag)}`);

  // Check if repository needs update
  const currentRepoVersion = status.lockfile?.pinned_version;
  const repoNeedsUpdate = currentRepoVersion
    ? compareVersions(currentRepoVersion, latestRelease.version) < 0
    : false;

  if (currentRepoVersion) {
    console.log(`Pinned version: ${pc.cyan(currentRepoVersion)}`);
    if (repoNeedsUpdate) {
      console.log(`  ${pc.yellow("→")} Update available: ${latestRelease.version}`);
    } else {
      console.log(`  ${pc.green("✓")} Up to date`);
    }
  }

  // Nothing to update
  if (!repoNeedsUpdate) {
    console.log();
    prompts.outro(pc.green("Everything is up to date!"));
    return;
  }

  console.log();

  // Show what will be updated
  console.log(pc.bold("Updates available:"));
  console.log(`  ${pc.yellow("→")} Canonical: ${currentRepoVersion} → ${latestRelease.version}`);
  console.log();

  // Confirm update
  if (!options.yes) {
    const shouldUpdate = await prompts.confirm({
      message: "Proceed with update?",
      initialValue: true,
    });

    if (prompts.isCancel(shouldUpdate) || !shouldUpdate) {
      prompts.cancel("Update cancelled");
      process.exit(0);
    }
  }

  // Update canonical content
  console.log();
  console.log(pc.bold("Updating canonical content..."));

  const targets = await parseAndValidateTargets(options.target);
  const currentStatus = await getSyncStatus(gitRoot);

    // Create resolved version for the latest release
    const resolvedVersion: ResolvedVersion = {
      ref: latestRelease.tag,
      version: latestRelease.version,
      isRelease: true,
      releaseInfo: latestRelease,
    };

    // Clone the source from the same repository in the lockfile
    let tempDir: string | null = null;
    try {
      tempDir = await createTempDir();
      const resolvedSource = await resolveGithubSource(
        { repository: sourceRepository, ref: latestRelease.tag },
        tempDir,
      );

      // Check for modified files
      await checkModifiedFilesBeforeSync(gitRoot, targets, options, tempDir);

      // Determine merge behavior (always merge for updates)
      const shouldOverride = await promptMergeOrOverride(
        currentStatus,
        { ...options, override: false },
        tempDir,
      );

      // Perform sync
      await performSync({
        targetDir: gitRoot,
        resolvedSource,
        resolvedVersion,
        shouldOverride,
        targets,
        context: {
          commandName: "sync",
          status: currentStatus,
        },
        tempDir,
        yes: options.yes,
        sourceRepo: sourceRepository,
      });
  } catch (error) {
    if (tempDir) await removeTempDir(tempDir);
    throw error;
  }

  prompts.outro(pc.green("Update complete!"));
}
