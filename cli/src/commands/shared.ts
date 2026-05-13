import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as prompts from "@clack/prompts";
import pc from "picocolors";
import { loadDownstreamConfig } from "../config/loader.js";
import { installPreCommitHook } from "../core/hooks.js";
import { readLockfile } from "../core/lockfile.js";
import { getModifiedManagedFiles } from "../core/managed-content.js";
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
import { syncWorkflows, toWorkflowSettings, type WorkflowSyncResult } from "../core/workflows.js";
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
  pinned?: boolean;
  summaryFile?: string;
  expandChanges?: boolean;
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
      workflowResult = await syncWorkflows(targetDir, workflowRef, options.sourceRepo, {
        resolvedConfig: { markerPrefix: resolvedSource.markerPrefix },
        workflowSettings,
      });
      workflowSpinner.stop();
    }

    // Install git hooks
    const hookResult = await installPreCommitHook(targetDir);

    // Build summary lines for both console and markdown file
    const summaryLines: string[] = [];

    // Summary header
    console.log();
    console.log(pc.bold("Sync complete:"));
    console.log();

    // AGENTS.md status
    const agentsMdPath = formatPath(path.join(targetDir, "AGENTS.md"));
    if (!result.agentsMd.merged) {
      console.log(`  ${pc.green("+")} ${agentsMdPath} ${pc.dim("(created)")}`);
      summaryLines.push("- `AGENTS.md` (created)");
    } else if (result.agentsMd.changed) {
      const label = context.commandName === "sync" ? "(updated)" : "(merged)";
      console.log(`  ${pc.green("+")} ${agentsMdPath} ${pc.dim(label)}`);
      summaryLines.push(`- \`AGENTS.md\` ${label}`);
    } else {
      console.log(`  ${pc.dim("-")} ${agentsMdPath} ${pc.dim("(unchanged)")}`);
      summaryLines.push("- `AGENTS.md` (unchanged)");
    }

    // CLAUDE.md status (consolidation result, shown once regardless of targets)
    {
      const claudeMdPath = formatPath(path.join(targetDir, "CLAUDE.md"));
      const claudeMdRelPath = "CLAUDE.md";

      if (result.claudeMd.created) {
        console.log(`  ${pc.green("+")} ${claudeMdPath} ${pc.dim("(created)")}`);
        summaryLines.push(`- \`${claudeMdRelPath}\` (created)`);
      } else if (result.claudeMd.updated) {
        const hint = result.claudeMd.deletedDotClaudeClaudeMd
          ? "(content merged into AGENTS.md, reference added)"
          : "(reference added)";
        console.log(`  ${pc.yellow("~")} ${claudeMdPath} ${pc.dim(hint)}`);
        summaryLines.push(`- \`${claudeMdRelPath}\` ${hint}`);
      } else {
        console.log(`  ${pc.dim("-")} ${claudeMdPath} ${pc.dim("(unchanged)")}`);
        summaryLines.push(`- \`${claudeMdRelPath}\` (unchanged)`);
      }

      // Show deleted .claude/CLAUDE.md
      if (result.claudeMd.deletedDotClaudeClaudeMd) {
        const dotClaudeMdPath = formatPath(path.join(targetDir, ".claude", "CLAUDE.md"));
        console.log(
          `  ${pc.red("-")} ${dotClaudeMdPath} ${pc.dim("(deleted, content merged into AGENTS.md)")}`,
        );
        summaryLines.push("- `.claude/CLAUDE.md` (deleted, content merged into AGENTS.md)");
      }
    }

    // Per-target results
    for (const targetResult of result.targets) {
      const config = getTargetConfig(targetResult.target);

      // Skills status for this target
      const skillsPath = formatPath(path.join(targetDir, config.dir, "skills"));
      const skillsRelPath = `${config.dir}/skills/`;

      // Compute new vs actually modified skills
      const newSkills = result.skills.synced.filter((s) => !previousSkills.includes(s)).sort();
      // Only show as "updated" if content actually changed (not just re-synced)
      const updatedSkills = result.skills.modified.filter((s) => previousSkills.includes(s)).sort();
      const removedSkills = orphanResult.deleted.sort();

      // Determine if skills had any changes
      const skillsHadChanges =
        newSkills.length > 0 || updatedSkills.length > 0 || removedSkills.length > 0;
      const skillsStatusIcon = skillsHadChanges ? pc.green("+") : pc.dim("-");
      const skillsStatusLabel = skillsHadChanges ? "(updated)" : "(unchanged)";

      // Summary line for skills directory
      console.log(
        `  ${skillsStatusIcon} ${skillsPath}/ ${pc.dim(`(total: ${result.skills.synced.length} skills, ${targetResult.skills.copied} files) ${skillsStatusLabel}`)}`,
      );
      summaryLines.push(
        `- \`${skillsRelPath}\` (total: ${result.skills.synced.length} skills, ${targetResult.skills.copied} files) ${skillsStatusLabel}`,
      );

      // Helper to display change lists with truncation
      const MAX_ITEMS_DEFAULT = 5;
      const shouldExpand = options.expandChanges === true;

      const formatChangeList = (
        items: string[],
        icon: string,
        colorFn: (s: string) => string,
        label: string,
        mdLabel: string,
        formatItem: (item: string) => { display: string; summary: string },
      ) => {
        if (items.length === 0) return;

        const maxDisplay = shouldExpand ? items.length : MAX_ITEMS_DEFAULT;
        const displayItems = items.slice(0, maxDisplay);
        const hiddenCount = items.length - displayItems.length;

        for (const item of displayItems) {
          const { display, summary } = formatItem(item);
          console.log(`    ${colorFn(icon)} ${display} ${pc.dim(`(${label})`)}`);
          summaryLines.push(`  - ${summary} (${mdLabel})`);
        }

        if (hiddenCount > 0) {
          console.log(`    ${pc.dim(`  ... ${hiddenCount} more ${label}`)}`);
          summaryLines.push(`  - ... ${hiddenCount} more ${mdLabel}`);
        }
      };

      const formatSkillItem = (skill: string) => ({
        display: `${formatPath(path.join(targetDir, config.dir, "skills", skill))}/`,
        summary: `\`${config.dir}/skills/${skill}/\``,
      });

      // Show new skills
      formatChangeList(newSkills, "+", pc.green, "new", "new", formatSkillItem);

      // Show updated skills
      formatChangeList(updatedSkills, "~", pc.yellow, "updated", "updated", formatSkillItem);

      // Show removed skills
      for (const skill of removedSkills) {
        const orphanPath = formatPath(path.join(targetDir, config.dir, "skills", skill));
        const orphanRelPath = `${config.dir}/skills/${skill}/`;
        console.log(`    ${pc.red("-")} ${orphanPath}/ ${pc.dim("(removed)")}`);
        summaryLines.push(`  - \`${orphanRelPath}\` (removed)`);
      }

      // Show skipped orphans
      if (orphanResult.skipped.length > 0) {
        for (const skill of orphanResult.skipped) {
          const orphanPath = formatPath(path.join(targetDir, config.dir, "skills", skill));
          const orphanRelPath = `${config.dir}/skills/${skill}/`;
          console.log(`    ${pc.yellow("!")} ${orphanPath}/ ${pc.dim("(orphaned but skipped)")}`);
          summaryLines.push(`  - \`${orphanRelPath}\` (orphaned but skipped)`);
        }
      }

      // Rules status for Claude target
      if (result.rules && result.rules.claudeFiles.length > 0 && targetResult.target === "claude") {
        const rulesPath = formatPath(path.join(targetDir, config.dir, "rules"));
        const rulesRelPath = `${config.dir}/rules/`;
        const rulesCount = result.rules.claudeFiles.length;

        // Compute new vs actually modified rules
        const newRules = result.rules.synced.filter((r) => !previousRules.includes(r)).sort();
        // Only show as "updated" if content actually changed (not just re-synced)
        const updatedRules = result.rules.modified.filter((r) => previousRules.includes(r)).sort();

        // Determine if rules had any changes
        const rulesHadChanges = newRules.length > 0 || updatedRules.length > 0;
        const rulesStatusIcon = rulesHadChanges ? pc.green("+") : pc.dim("-");
        const rulesStatusLabel = rulesHadChanges ? "(updated)" : "(unchanged)";

        console.log(
          `  ${rulesStatusIcon} ${rulesPath}/ ${pc.dim(`(total: ${rulesCount} rules) ${rulesStatusLabel}`)}`,
        );
        summaryLines.push(`- \`${rulesRelPath}\` (total: ${rulesCount} rules) ${rulesStatusLabel}`);

        const formatRuleItem = (rule: string) => ({
          display: formatPath(path.join(targetDir, config.dir, "rules", rule)),
          summary: `\`${config.dir}/rules/${rule}\``,
        });

        // Show new rules
        formatChangeList(newRules, "+", pc.green, "new", "new", formatRuleItem);

        // Show updated rules
        formatChangeList(updatedRules, "~", pc.yellow, "updated", "updated", formatRuleItem);
      }

      // Rules status for Codex target (concatenated into AGENTS.md)
      if (result.rules?.codexUpdated && targetResult.target === "codex") {
        const rulesCount = result.rules.synced.length;
        console.log(
          `  ${pc.green("+")} ${pc.dim("AGENTS.md rules section")} ${pc.dim(`(total: ${rulesCount} rules concatenated) (updated)`)}`,
        );
        summaryLines.push(
          `- AGENTS.md rules section (total: ${rulesCount} rules concatenated) (updated)`,
        );

        // Compute new vs actually modified rules for Codex
        const newRules = result.rules.synced.filter((r) => !previousRules.includes(r)).sort();
        // Only show as "updated" if content actually changed (not just re-synced)
        const updatedRules = result.rules.modified.filter((r) => previousRules.includes(r)).sort();

        const formatCodexRuleItem = (rule: string) => ({
          display: rule,
          summary: `\`${rule}\``,
        });

        // Show new rules
        formatChangeList(newRules, "+", pc.green, "new", "new", formatCodexRuleItem);

        // Show updated rules
        formatChangeList(updatedRules, "~", pc.yellow, "updated", "updated", formatCodexRuleItem);
      }

      // Agents status for Claude target (agents are only synced to Claude)
      if (result.agents && result.agents.synced.length > 0 && targetResult.target === "claude") {
        const agentsPath = formatPath(path.join(targetDir, config.dir, "agents"));
        const agentsRelPath = `${config.dir}/agents/`;
        const agentsCount = result.agents.synced.length;

        // Compute new vs actually modified agents
        const newAgents = result.agents.synced.filter((a) => !previousAgents.includes(a)).sort();
        const updatedAgents = result.agents.modified
          .filter((a) => previousAgents.includes(a))
          .sort();

        // Determine if agents had any changes
        const agentsHadChanges = newAgents.length > 0 || updatedAgents.length > 0;
        const agentsStatusIcon = agentsHadChanges ? pc.green("+") : pc.dim("-");
        const agentsStatusLabel = agentsHadChanges ? "(updated)" : "(unchanged)";

        console.log(
          `  ${agentsStatusIcon} ${agentsPath}/ ${pc.dim(`(total: ${agentsCount} agents) ${agentsStatusLabel}`)}`,
        );
        summaryLines.push(
          `- \`${agentsRelPath}\` (total: ${agentsCount} agents) ${agentsStatusLabel}`,
        );

        const formatAgentItem = (agent: string) => ({
          display: formatPath(path.join(targetDir, config.dir, "agents", agent)),
          summary: `\`${config.dir}/agents/${agent}\``,
        });

        // Show new agents
        formatChangeList(newAgents, "+", pc.green, "new", "new", formatAgentItem);

        // Show updated agents
        formatChangeList(updatedAgents, "~", pc.yellow, "updated", "updated", formatAgentItem);
      }

      // Warning when agents were skipped due to Codex-only target
      if (result.agents?.skipped && targetResult.target === "codex") {
        console.log(
          `  ${pc.yellow("!")} ${pc.dim("Agents skipped")} ${pc.yellow("(Codex does not support sub-agents)")}`,
        );
        summaryLines.push("- Agents skipped (Codex does not support sub-agents)");
      }
    }

    // Workflow files status
    if (workflowResult) {
      for (const filename of workflowResult.created) {
        const workflowPath = formatPath(path.join(targetDir, ".github/workflows", filename));
        console.log(`  ${pc.green("+")} ${workflowPath} ${pc.dim("(created)")}`);
        summaryLines.push(`- \`.github/workflows/${filename}\` (created)`);
      }
      for (const filename of workflowResult.updated) {
        const workflowPath = formatPath(path.join(targetDir, ".github/workflows", filename));
        console.log(`  ${pc.yellow("~")} ${workflowPath} ${pc.dim("(updated)")}`);
        summaryLines.push(`- \`.github/workflows/${filename}\` (updated)`);
      }
      for (const filename of workflowResult.unchanged) {
        const workflowPath = formatPath(path.join(targetDir, ".github/workflows", filename));
        console.log(`  ${pc.dim("-")} ${workflowPath} ${pc.dim("(unchanged)")}`);
        summaryLines.push(`- \`.github/workflows/${filename}\` (unchanged)`);
      }
    }

    // Lockfile status
    const lockfilePath = formatPath(path.join(targetDir, ".agconf", "agconf.lock"));
    console.log(`  ${pc.green("+")} ${lockfilePath}`);
    summaryLines.push("- `.agconf/lockfile.json` (updated)");

    // Git hook status
    const hookPath = formatPath(path.join(targetDir, ".git/hooks/pre-commit"));
    if (hookResult.installed) {
      if (hookResult.wasAppended && hookResult.wasUpdated) {
        console.log(`  ${pc.yellow("~")} ${hookPath} ${pc.dim("(updated in existing hook)")}`);
        summaryLines.push("- `.git/hooks/pre-commit` (updated in existing hook)");
      } else if (hookResult.wasAppended && hookResult.alreadyExisted && !hookResult.wasUpdated) {
        console.log(`  ${pc.dim("-")} ${hookPath} ${pc.dim("(unchanged)")}`);
        summaryLines.push("- `.git/hooks/pre-commit` (unchanged)");
      } else if (hookResult.wasAppended && !hookResult.wasUpdated) {
        console.log(`  ${pc.green("+")} ${hookPath} ${pc.dim("(appended to existing hook)")}`);
        summaryLines.push("- `.git/hooks/pre-commit` (appended to existing hook)");
      } else if (hookResult.alreadyExisted && !hookResult.wasUpdated) {
        console.log(`  ${pc.dim("-")} ${hookPath} ${pc.dim("(unchanged)")}`);
        summaryLines.push("- `.git/hooks/pre-commit` (unchanged)");
      } else if (hookResult.wasUpdated) {
        console.log(`  ${pc.yellow("~")} ${hookPath} ${pc.dim("(updated)")}`);
        summaryLines.push("- `.git/hooks/pre-commit` (updated)");
      } else {
        console.log(`  ${pc.green("+")} ${hookPath} ${pc.dim("(installed)")}`);
        summaryLines.push("- `.git/hooks/pre-commit` (installed)");
      }
    } else if (hookResult.alreadyExisted) {
      console.log(`  ${pc.yellow("!")} ${hookPath} ${pc.dim("(skipped - custom hook exists)")}`);
      summaryLines.push("- `.git/hooks/pre-commit` (skipped - custom hook exists)");
    }

    console.log();
    console.log(pc.dim(`Source: ${formatSourceString(resolvedSource.source)}`));
    if (resolvedVersion.version) {
      console.log(pc.dim(`Version: ${resolvedVersion.version}`));
    }
    if (targets.length > 1) {
      console.log(pc.dim(`Targets: ${targets.join(", ")}`));
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

    prompts.outro(pc.green("Done!"));
  } catch (error) {
    syncSpinner.fail("Sync failed");
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    if (tempDir) await removeTempDir(tempDir);
  }
}
