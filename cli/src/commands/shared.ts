import * as fs from "node:fs/promises";
import * as prompts from "@clack/prompts";
import pc from "picocolors";
import { loadDownstreamConfig } from "../config/loader.js";
import { type HookInstallResult, installPreCommitHook } from "../core/hooks.js";
import { readLockfile } from "../core/lockfile.js";
import { getModifiedManagedFiles } from "../core/managed-content.js";
import type { ResolvedSource } from "../core/source.js";
import { formatSourceString, resolveGithubSource, resolveLocalSource } from "../core/source.js";
import {
  deleteOrphanedAgents,
  deleteOrphanedRules,
  deleteOrphanedSkills,
  findOrphanedAgents,
  findOrphanedRules,
  findOrphanedSkills,
  type SyncStatus,
  sync,
  UnmanagedOverwriteError,
} from "../core/sync.js";
import { parseTargets, SUPPORTED_TARGETS, type Target } from "../core/targets.js";
import {
  formatTag,
  getLatestRelease,
  isVersionRef,
  parseVersion,
  type ReleaseInfo,
} from "../core/version.js";
import { syncWorkflows, toWorkflowSettings, type WorkflowSyncResult } from "../core/workflows.js";
import { createTempDir, removeTempDir, resolvePath } from "../utils/fs.js";
import { getGitRoot } from "../utils/git.js";
import { createLogger, formatPath } from "../utils/logger.js";
import { renderSyncSummary } from "./sync-output.js";

export interface SharedSyncOptions {
  source?: string;
  local?: string | boolean;
  yes?: boolean;
  override?: boolean;
  ref?: string;
  target?: string[];
  pinned?: boolean;
  summaryFile?: string;
  expandChanges?: boolean;
  /** Working directory to resolve the target git root from (defaults to process.cwd()). For testing. */
  cwd?: string;
  /** Distribution scope: "repo" (default) writes into the repo; "user" projects into ~/.claude, ~/.codex via the ~/.agconf store. */
  scope?: string;
  /** Home directory override for `--scope user` (defaults to os.homedir()). For testing. */
  home?: string;
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

/**
 * Reject an unknown `--scope` (exit 1) so a typo like `--scope usr` never falls
 * through to a repo sync/check. Shared by `sync` and `check`.
 */
export function validateScope(scope: string | undefined): void {
  if (scope !== undefined && scope !== "repo" && scope !== "user") {
    createLogger().error(`Invalid --scope "${scope}". Use "repo" (default) or "user".`);
    process.exit(1);
  }
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

export async function resolveTargetDirectory(cwd: string = process.cwd()): Promise<string> {
  const logger = createLogger();

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
  _commandName: "init" | "sync",
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

  // If --pinned is specified, use lockfile version without fetching
  if (options.pinned) {
    if (!status.lockfile?.pinned_version) {
      logger.error("Cannot use --pinned: no version pinned in lockfile.");
      process.exit(1);
    }
    const version = status.lockfile.pinned_version;
    return {
      ref: formatTag(version),
      version,
      isRelease: true,
      releaseInfo: null,
    };
  }

  // Default for both init and sync: fetch latest release
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
    spinner.info("No releases found, using master branch");
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
  /**
   * When true, a resolution failure THROWS instead of calling `process.exit(1)`.
   * The unattended auto-sync path sets this so its best-effort/exit-0 catch can
   * record the error to state + log rather than the process dying uncatchably.
   */
  throwOnError = false,
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
  1. CLI flag: agconf init --source acme/engineering-standards
  2. Config file: Add 'source.repository' to .agconf.yaml

Example .agconf.yaml:
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
    if (tempDir) await removeTempDir(tempDir);
    if (throwOnError) throw error instanceof Error ? error : new Error(String(error));
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export async function promptMergeOrOverride(
  status: SyncStatus,
  options: SharedSyncOptions,
  tempDir: string | null,
): Promise<boolean> {
  let shouldOverride = options.override ?? false;

  // If the repo has already been synced, the AGENTS.md was created by agconf,
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

/**
 * Resolve orphaned managed objects (skills, rules, or agents) that were
 * previously synced but are no longer present in canonical. In non-interactive
 * mode they are deleted by default; otherwise the user is prompted. The actual
 * deletion (with its managed/unmodified safety checks) is performed by
 * `doDelete`. Shared by all content types so behavior stays identical.
 */
async function resolveOrphans(
  orphaned: string[],
  label: string,
  yes: boolean,
  logger: { info: (message: string) => void },
  doDelete: () => Promise<{ deleted: string[]; skipped: string[] }>,
): Promise<{ deleted: string[]; skipped: string[] }> {
  if (orphaned.length === 0) {
    return { deleted: [], skipped: [] };
  }

  if (yes) {
    // Non-interactive mode: delete by default
    return doDelete();
  }

  // Interactive mode: prompt user
  console.log();
  console.log(
    pc.yellow(
      `⚠ ${orphaned.length} ${label}(s) were previously synced but are no longer in the source:`,
    ),
  );
  for (const item of orphaned) {
    console.log(`  ${pc.yellow("·")} ${item}`);
  }
  console.log();

  const confirmDelete = await prompts.confirm({
    message: `Delete these orphaned ${label}s?`,
    initialValue: true,
  });

  if (prompts.isCancel(confirmDelete)) {
    logger.info("Skipping orphan deletion.");
    return { deleted: [], skipped: [] };
  }
  if (confirmDelete) {
    return doDelete();
  }
  return { deleted: [], skipped: [] };
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
  /** Write markdown summary to this file (for CI PR descriptions) */
  summaryFile?: string | undefined;
  /** Show all items instead of truncating (skills, rules, hooks, etc.) */
  expandChanges?: boolean | undefined;
}

export async function performSync(options: PerformSyncOptions): Promise<void> {
  const { targetDir, resolvedSource, resolvedVersion, shouldOverride, targets, context, tempDir } =
    options;

  const logger = createLogger();

  // Load downstream config for workflow settings (optional - file may not exist)
  const downstreamConfig = await loadDownstreamConfig(targetDir);
  const workflowSettings = toWorkflowSettings(downstreamConfig?.workflow);

  // Read previous lockfile to detect orphaned skills/rules/agents later
  const previousLockfileResult = await readLockfile(targetDir);
  const previousSkills = previousLockfileResult?.lockfile.content.skills ?? [];
  const previousRules = previousLockfileResult?.lockfile.content.rules?.files ?? [];
  const previousAgents = previousLockfileResult?.lockfile.content.agents?.files ?? [];
  const previousTargets = previousLockfileResult?.lockfile.content.targets ?? ["claude"];
  // Marker prefix the orphaned downstream files were written with. Prefer the
  // previous lockfile's value (matches the files on disk); fall back to the
  // source's prefix. Used so orphan cleanup recognizes managed files written
  // with a custom prefix instead of silently skipping them.
  const orphanMetadataPrefix =
    previousLockfileResult?.lockfile.content.marker_prefix ?? resolvedSource.markerPrefix;
  const orphanPrefixOption = orphanMetadataPrefix
    ? { metadataPrefix: orphanMetadataPrefix }
    : undefined;

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
    // Per-type delivery map (skills/agents/mcps): types not set to "sync" are
    // skipped and orphan-cleaned so they can be delivered via a plugin instead.
    if (downstreamConfig?.delivery) {
      syncOptions.delivery = downstreamConfig.delivery;
    }
    const result = await sync(targetDir, resolvedSource, syncOptions);
    syncSpinner.stop();

    // Detect and handle orphaned skills, rules, and agents. All three behave
    // identically: deleted from canonical means deleted downstream (with
    // managed/unmodified safety checks). Targets to check are the union of the
    // previous and current sync targets.
    const allTargets = [...new Set([...previousTargets, ...targets])];
    const yes = options.yes === true;

    const orphanedSkills = findOrphanedSkills(previousSkills, result.skills.synced);
    const orphanResult = await resolveOrphans(orphanedSkills, "skill", yes, logger, () =>
      deleteOrphanedSkills(
        targetDir,
        orphanedSkills,
        allTargets,
        previousSkills,
        orphanPrefixOption,
      ),
    );

    const orphanedRules = findOrphanedRules(previousRules, result.rules?.synced ?? []);
    const ruleOrphanResult = await resolveOrphans(orphanedRules, "rule", yes, logger, () =>
      deleteOrphanedRules(targetDir, orphanedRules, allTargets, previousRules, orphanPrefixOption),
    );

    const orphanedAgents = findOrphanedAgents(previousAgents, result.agents?.synced ?? []);
    const agentOrphanResult = await resolveOrphans(orphanedAgents, "agent", yes, logger, () =>
      deleteOrphanedAgents(
        targetDir,
        orphanedAgents,
        allTargets,
        previousAgents,
        orphanPrefixOption,
      ),
    );

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
      workflowResult = await syncWorkflows(targetDir, workflowRef, options.sourceRepo, {
        resolvedConfig: { markerPrefix: resolvedSource.markerPrefix },
        workflowSettings,
      });
      workflowSpinner.stop();
    }

    // Install git hooks. This is a best-effort convenience step — a failure
    // here must not fail the whole sync (the content sync above already
    // succeeded), so swallow the error and report it as a warning below.
    let hookResult: HookInstallResult | null = null;
    try {
      hookResult = await installPreCommitHook(targetDir);
    } catch (error) {
      logger.warn(
        `Skipped git hook installation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const { consoleLines, summaryLines } = renderSyncSummary({
      result,
      targetDir,
      targets,
      previousSkills,
      previousRules,
      previousAgents,
      orphanResult,
      ruleOrphanResult,
      agentOrphanResult,
      workflowResult,
      hookResult,
      resolvedSource,
      resolvedVersion,
      commandName: context.commandName,
      expandChanges: options.expandChanges === true,
    });
    for (const line of consoleLines) {
      console.log(line);
    }

    // Write summary file if requested (for CI PR descriptions)
    if (options.summaryFile) {
      const sourceStr = formatSourceString(resolvedSource.source);
      const versionStr = resolvedVersion.version
        ? `v${resolvedVersion.version}`
        : resolvedVersion.ref;
      const summary = `## Changes

${summaryLines.join("\n")}

---
**Source:** ${sourceStr}
**Version:** ${versionStr}
`;
      await fs.writeFile(options.summaryFile, summary, "utf-8");
    }

    // Round-trip adoption: previously-unmanaged local files that matched canonical
    // and are now tracked. Surfaces that re-running `propose --new` is unnecessary.
    if (result.adopted.length > 0) {
      console.log();
      console.log(
        pc.green(`Adopted ${result.adopted.length} previously-untracked file(s) as managed:`),
      );
      for (const adoptedPath of result.adopted) {
        console.log(`  ${pc.green("+")} ${adoptedPath}`);
      }
    }

    prompts.outro(pc.green("Done!"));
  } catch (error) {
    if (error instanceof UnmanagedOverwriteError) {
      syncSpinner.fail("Sync stopped");
      console.log();
      console.log(
        pc.yellow("These local files differ from canonical and are not managed by agconf:"),
      );
      for (const conflict of error.conflicts) {
        console.log(`  ${pc.yellow("!")} ${conflict.path} ${pc.dim(`(${conflict.type})`)}`);
      }
      console.log();
      console.log(pc.dim("Overwriting would discard your local changes. Either:"));
      // `propose` only makes sense once a canonical relationship exists (sync),
      // not on a first-time `init`.
      if (context.commandName === "sync") {
        console.log(pc.dim("  • send them upstream:     agconf propose"));
      } else {
        console.log(pc.dim("  • rename the local file(s) to keep them, then re-run"));
      }
      console.log(pc.dim(`  • overwrite with canonical: agconf ${context.commandName} --override`));
      process.exit(1);
    }
    syncSpinner.fail("Sync failed");
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    if (tempDir) await removeTempDir(tempDir);
  }
}
