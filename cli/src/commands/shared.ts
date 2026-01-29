import * as path from "node:path";
import * as prompts from "@clack/prompts";
import pc from "picocolors";
import { installPreCommitHook } from "../core/hooks.js";
import { readLockfile } from "../core/lockfile.js";
import { getModifiedManagedFiles } from "../core/skill-metadata.js";
import type { ResolvedSource } from "../core/source.js";
import { formatSourceString, resolveGithubSource, resolveLocalSource } from "../core/source.js";
import { deleteOrphanedSkills, findOrphanedSkills, type SyncStatus, sync } from "../core/sync.js";
import { getTargetConfig, parseTargets, SUPPORTED_TARGETS, type Target } from "../core/targets.js";
import {
  formatTag,
  getLatestRelease,
  isVersionRef,
  parseVersion,
  type ReleaseInfo,
} from "../core/version.js";
import { syncWorkflows, type WorkflowSyncResult } from "../core/workflows.js";
import { createTempDir, removeTempDir, resolvePath } from "../utils/fs.js";
import { getGitRoot } from "../utils/git.js";
import { createLogger, formatPath } from "../utils/logger.js";

export interface SharedSyncOptions {
  source?: string;
  local?: string | boolean;
  yes?: boolean;
  override?: boolean;
  ref?: string;
  target?: string[];
}

export interface CommandContext {
  commandName: "init" | "sync";
  status: SyncStatus;
}

export interface ResolvedVersion {
  ref: string; // The ref used for cloning (e.g., "v1.2.0" or "master")
  version: string | undefined; // The semantic version if ref is a release tag (e.g., "1.2.0")
  isRelease: boolean; // Whether this is a release version
  releaseInfo: ReleaseInfo | null; // Full release info if fetched
}

export async function parseAndValidateTargets(
  targetOptions: string[] | undefined,
): Promise<Target[]> {
  const logger = createLogger();
  try {
    return parseTargets(targetOptions ?? ["claude"]);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    logger.info(`Supported targets: ${SUPPORTED_TARGETS.join(", ")}`);
    process.exit(1);
  }
}

export async function resolveTargetDirectory(): Promise<string> {
  const logger = createLogger();
  const cwd = process.cwd();

  const gitRoot = await getGitRoot(cwd);
  if (!gitRoot) {
    logger.error(
      "Not inside a git repository. Please run this command from within a git repository.",
    );
    process.exit(1);
  }

  // If we're in a subdirectory, inform the user
  if (gitRoot !== cwd) {
    logger.info(`Syncing to repository root: ${formatPath(gitRoot)}`);
  }

  return gitRoot;
}

/**
 * Resolves the version to use for syncing.
 * - For init: fetches latest release if no ref specified
 * - For sync: uses lockfile version if no ref specified
 * - For explicit --ref: uses that ref
 *
 * @param repo - The repository to fetch releases from (only used for non-local sources)
 */
export async function resolveVersion(
  options: SharedSyncOptions,
  status: SyncStatus,
  commandName: "init" | "sync",
  repo?: string,
): Promise<ResolvedVersion> {
  const logger = createLogger();

  // If --local is used, no version management
  if (options.local !== undefined) {
    return {
      ref: "local",
      version: undefined,
      isRelease: false,
      releaseInfo: null,
    };
  }

  // If explicit --ref is provided, use it
  if (options.ref) {
    if (isVersionRef(options.ref)) {
      return {
        ref: formatTag(options.ref),
        version: parseVersion(options.ref),
        isRelease: true,
        releaseInfo: null,
      };
    }
    // Branch ref
    return {
      ref: options.ref,
      version: undefined,
      isRelease: false,
      releaseInfo: null,
    };
  }

  // For sync without --ref: use lockfile version if available
  if (commandName === "sync" && status.lockfile?.pinned_version) {
    const version = status.lockfile.pinned_version;
    return {
      ref: formatTag(version),
      version,
      isRelease: true,
      releaseInfo: null,
    };
  }

  // For init or sync without lockfile version: fetch latest release
  // This requires a repo to be specified
  if (!repo) {
    // No repo means we can't fetch releases - use master as fallback
    logger.warn("No source repository specified. Using master branch.");
    return {
      ref: "master",
      version: undefined,
      isRelease: false,
      releaseInfo: null,
    };
  }

  const spinner = logger.spinner("Fetching latest release...");
  spinner.start();

  try {
    const release = await getLatestRelease(repo);
    spinner.succeed(`Latest release: ${release.tag}`);
    return {
      ref: release.tag,
      version: release.version,
      isRelease: true,
      releaseInfo: release,
    };
  } catch {
    spinner.fail("Failed to fetch latest release, falling back to master");
    logger.warn("Could not fetch latest release. Using master branch instead.");
    return {
      ref: "master",
      version: undefined,
      isRelease: false,
      releaseInfo: null,
    };
  }
}

export async function resolveSource(
  options: SharedSyncOptions,
  resolvedVersion: ResolvedVersion,
): Promise<{ resolvedSource: ResolvedSource; tempDir: string | null; repository: string }> {
  const logger = createLogger();
  let resolvedSource: ResolvedSource;
  let tempDir: string | null = null;

  const spinner = logger.spinner("Resolving source...");

  try {
    if (options.local !== undefined) {
      spinner.start();
      const localSourceOptions =
        typeof options.local === "string" ? { path: resolvePath(options.local) } : {};
      resolvedSource = await resolveLocalSource(localSourceOptions);
      spinner.succeed(`Using local source: ${formatPath(resolvedSource.basePath)}`);
      // For local sources, repository is empty string (no GitHub repo)
      return { resolvedSource, tempDir, repository: "" };
    }

    // For GitHub sources, repository must be provided
    const repository = options.source;
    if (!repository) {
      spinner.fail("No canonical source specified");
      logger.error(`No canonical source specified.

Specify a source using one of these methods:
  1. CLI flag: agent-conf init --source acme/engineering-standards
  2. Config file: Add 'source.repository' to .agent-conf.yaml

Example .agent-conf.yaml:
  source:
    type: github
    repository: acme/engineering-standards`);
      process.exit(1);
    }

    spinner.start();
    tempDir = await createTempDir();
    const ref = resolvedVersion.ref;
    spinner.text = `Cloning ${repository}@${ref}...`;
    resolvedSource = await resolveGithubSource({ repository, ref }, tempDir);
    spinner.succeed(`Cloned from GitHub: ${formatSourceString(resolvedSource.source)}`);
    return { resolvedSource, tempDir, repository };
  } catch (error) {
    spinner.fail("Failed to resolve source");
    logger.error(error instanceof Error ? error.message : String(error));
    if (tempDir) await removeTempDir(tempDir);
    process.exit(1);
  }
}

export async function promptMergeOrOverride(
  status: SyncStatus,
  options: SharedSyncOptions,
  tempDir: string | null,
): Promise<boolean> {
  let shouldOverride = options.override ?? false;

  // If the repo has already been synced, the AGENTS.md was created by agent-conf,
  // so we don't need to ask - just merge by default (unless --override is specified)
  if (status.hasSynced) {
    return shouldOverride;
  }

  if (status.agentsMdExists && !options.yes && !options.override) {
    const action = await prompts.select({
      message: "An AGENTS.md file already exists. How would you like to proceed?",
      options: [
        {
          value: "merge",
          label: "Merge (recommended)",
          hint: "Preserves your existing content in a repository-specific block",
        },
        {
          value: "override",
          label: "Override",
          hint: "Replaces everything with fresh global standards",
        },
      ],
    });

    if (prompts.isCancel(action)) {
      prompts.cancel("Operation cancelled");
      if (tempDir) await removeTempDir(tempDir);
      process.exit(0);
    }

    shouldOverride = action === "override";
  }

  return shouldOverride;
}

/**
 * Check for manually modified managed files and warn/prompt the user.
 * Returns true if sync should proceed, false if cancelled.
 */
export async function checkModifiedFilesBeforeSync(
  targetDir: string,
  targets: Target[],
  options: SharedSyncOptions,
  tempDir: string | null,
): Promise<boolean> {
  const modifiedFiles = await getModifiedManagedFiles(targetDir, targets);

  if (modifiedFiles.length === 0) {
    return true; // No modified files, proceed
  }

  const logger = createLogger();

  // Show warning about modified files
  console.log();
  console.log(pc.yellow(`⚠ ${modifiedFiles.length} managed file(s) have been manually modified:`));
  for (const file of modifiedFiles) {
    const label = file.type === "agents" ? "(global block)" : "";
    console.log(`  ${pc.yellow("~")} ${file.path} ${pc.dim(label)}`);
  }
  console.log();

  // In non-interactive mode, just warn and proceed
  if (options.yes) {
    logger.warn("Proceeding with sync (--yes flag). Modified files will be overwritten.");
    return true;
  }

  // Ask for confirmation
  const proceed = await prompts.confirm({
    message: "These files will be overwritten. Continue with sync?",
    initialValue: false,
  });

  if (prompts.isCancel(proceed) || !proceed) {
    prompts.cancel("Sync cancelled. Your modified files were preserved.");
    if (tempDir) await removeTempDir(tempDir);
    process.exit(0);
  }

  return true;
}

export interface PerformSyncOptions {
  targetDir: string;
  resolvedSource: ResolvedSource;
  resolvedVersion: ResolvedVersion;
  shouldOverride: boolean;
  targets: Target[];
  context: CommandContext;
  tempDir: string | null;
  yes?: boolean | undefined;
  /** Source repository in owner/repo format (for GitHub sources) */
  sourceRepo?: string;
}

export async function performSync(options: PerformSyncOptions): Promise<void> {
  const { targetDir, resolvedSource, resolvedVersion, shouldOverride, targets, context, tempDir } =
    options;

  const logger = createLogger();

  // Read previous lockfile to detect orphaned skills later
  const previousLockfile = await readLockfile(targetDir);
  const previousSkills = previousLockfile?.content.skills ?? [];
  const previousTargets = previousLockfile?.content.targets ?? ["claude"];

  const syncSpinner = logger.spinner("Syncing...");
  syncSpinner.start();

  try {
    const syncOptions: Parameters<typeof sync>[2] = {
      override: shouldOverride,
      targets,
    };
    if (resolvedVersion.version) {
      syncOptions.pinnedVersion = resolvedVersion.version;
    }
    const result = await sync(targetDir, resolvedSource, syncOptions);
    syncSpinner.stop();

    // Detect and handle orphaned skills
    const orphanedSkills = findOrphanedSkills(previousSkills, result.skills.synced);
    let orphanResult: { deleted: string[]; skipped: string[] } = { deleted: [], skipped: [] };

    if (orphanedSkills.length > 0) {
      // Determine which targets to check (union of previous and current)
      const allTargets = [...new Set([...previousTargets, ...targets])];

      if (options.yes) {
        // Non-interactive mode: delete by default
        orphanResult = await deleteOrphanedSkills(
          targetDir,
          orphanedSkills,
          allTargets,
          previousSkills,
        );
      } else {
        // Interactive mode: prompt user
        console.log();
        console.log(
          pc.yellow(
            `⚠ ${orphanedSkills.length} skill(s) were previously synced but are no longer in the source:`,
          ),
        );
        for (const skill of orphanedSkills) {
          console.log(`  ${pc.yellow("·")} ${skill}`);
        }
        console.log();

        const deleteOrphans = await prompts.confirm({
          message: "Delete these orphaned skills?",
          initialValue: true,
        });

        if (prompts.isCancel(deleteOrphans)) {
          // User cancelled, skip deletion but continue with sync summary
          logger.info("Skipping orphan deletion.");
        } else if (deleteOrphans) {
          orphanResult = await deleteOrphanedSkills(
            targetDir,
            orphanedSkills,
            allTargets,
            previousSkills,
          );
        }
      }
    }

    // Show validation errors if any
    if (result.skills.validationErrors.length > 0) {
      console.log();
      console.log(
        pc.yellow(`⚠ ${result.skills.validationErrors.length} skill(s) have invalid frontmatter:`),
      );
      for (const error of result.skills.validationErrors) {
        console.log(`  ${pc.yellow("!")} ${error.skillName}/SKILL.md`);
        for (const msg of error.errors) {
          console.log(`      ${pc.dim("-")} ${msg}`);
        }
      }
      console.log();
      console.log(pc.dim("Skills must have frontmatter with 'name' and 'description' fields."));
    }

    // Sync workflow files for GitHub sources only (not local)
    // Workflows reference the same ref that was used for syncing
    let workflowResult: WorkflowSyncResult | null = null;
    if (resolvedVersion.ref !== "local" && options.sourceRepo) {
      const workflowSpinner = logger.spinner("Syncing workflow files...");
      workflowSpinner.start();
      // Use the version tag if it's a release, otherwise use the ref directly
      const workflowRef =
        resolvedVersion.isRelease && resolvedVersion.version
          ? formatTag(resolvedVersion.version)
          : resolvedVersion.ref;
      workflowResult = await syncWorkflows(targetDir, workflowRef, options.sourceRepo);
      workflowSpinner.stop();
    }

    // Install git hooks
    const hookResult = await installPreCommitHook(targetDir);

    // Summary
    console.log();
    console.log(pc.bold("Sync complete:"));
    console.log();

    // AGENTS.md status
    const agentsMdPath = formatPath(path.join(targetDir, "AGENTS.md"));
    if (result.agentsMd.merged) {
      const label = context.commandName === "sync" ? "(updated)" : "(merged)";
      console.log(`  ${pc.green("+")} ${agentsMdPath} ${pc.dim(label)}`);
    } else {
      console.log(`  ${pc.green("+")} ${agentsMdPath} ${pc.dim("(created)")}`);
    }

    // Per-target results
    for (const targetResult of result.targets) {
      const config = getTargetConfig(targetResult.target);

      // Instructions file status (only for targets that use one, like Claude)
      if (config.instructionsFile) {
        const instructionsPath =
          targetResult.instructionsMd.location === "root"
            ? formatPath(path.join(targetDir, config.instructionsFile))
            : formatPath(path.join(targetDir, config.dir, config.instructionsFile));

        if (targetResult.instructionsMd.created) {
          console.log(`  ${pc.green("+")} ${instructionsPath} ${pc.dim("(created)")}`);
        } else if (targetResult.instructionsMd.updated) {
          const hint = targetResult.instructionsMd.contentMerged
            ? "(content merged into AGENTS.md, reference added)"
            : "(reference added)";
          console.log(`  ${pc.yellow("~")} ${instructionsPath} ${pc.dim(hint)}`);
        } else {
          console.log(`  ${pc.dim("-")} ${instructionsPath} ${pc.dim("(unchanged)")}`);
        }
      }

      // Skills status for this target
      const skillsPath = formatPath(path.join(targetDir, config.dir, "skills"));
      console.log(
        `  ${pc.green("+")} ${skillsPath}/ ${pc.dim(`(${result.skills.synced.length} skills, ${targetResult.skills.copied} files)`)}`,
      );

      // Orphan deletion status for this target
      if (orphanResult.deleted.length > 0) {
        for (const skill of orphanResult.deleted) {
          const orphanPath = formatPath(path.join(targetDir, config.dir, "skills", skill));
          console.log(
            `  ${pc.red("-")} ${orphanPath}/ ${pc.dim("(removed - no longer in source)")}`,
          );
        }
      }
      if (orphanResult.skipped.length > 0) {
        for (const skill of orphanResult.skipped) {
          const orphanPath = formatPath(path.join(targetDir, config.dir, "skills", skill));
          console.log(`  ${pc.yellow("!")} ${orphanPath}/ ${pc.dim("(orphaned but skipped)")}`);
        }
      }
    }

    // Workflow files status
    if (workflowResult) {
      for (const filename of workflowResult.created) {
        const workflowPath = formatPath(path.join(targetDir, ".github/workflows", filename));
        console.log(`  ${pc.green("+")} ${workflowPath} ${pc.dim("(created)")}`);
      }
      for (const filename of workflowResult.updated) {
        const workflowPath = formatPath(path.join(targetDir, ".github/workflows", filename));
        console.log(`  ${pc.yellow("~")} ${workflowPath} ${pc.dim("(updated)")}`);
      }
      for (const filename of workflowResult.unchanged) {
        const workflowPath = formatPath(path.join(targetDir, ".github/workflows", filename));
        console.log(`  ${pc.dim("-")} ${workflowPath} ${pc.dim("(unchanged)")}`);
      }
    }

    // Lockfile status
    const lockfilePath = formatPath(path.join(targetDir, ".agent-conf", "agent-conf.lock"));
    console.log(`  ${pc.green("+")} ${lockfilePath}`);

    // Git hook status
    const hookPath = formatPath(path.join(targetDir, ".git/hooks/pre-commit"));
    if (hookResult.installed) {
      if (hookResult.alreadyExisted && !hookResult.wasUpdated) {
        console.log(`  ${pc.dim("-")} ${hookPath} ${pc.dim("(unchanged)")}`);
      } else if (hookResult.wasUpdated) {
        console.log(`  ${pc.yellow("~")} ${hookPath} ${pc.dim("(updated)")}`);
      } else {
        console.log(`  ${pc.green("+")} ${hookPath} ${pc.dim("(installed)")}`);
      }
    } else if (hookResult.alreadyExisted) {
      console.log(`  ${pc.yellow("!")} ${hookPath} ${pc.dim("(skipped - custom hook exists)")}`);
    }

    console.log();
    console.log(pc.dim(`Source: ${formatSourceString(resolvedSource.source)}`));
    if (resolvedVersion.version) {
      console.log(pc.dim(`Version: ${resolvedVersion.version}`));
    }
    if (targets.length > 1) {
      console.log(pc.dim(`Targets: ${targets.join(", ")}`));
    }

    prompts.outro(pc.green("Done!"));
  } catch (error) {
    syncSpinner.fail("Sync failed");
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    if (tempDir) await removeTempDir(tempDir);
  }
}
