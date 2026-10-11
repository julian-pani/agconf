import * as prompts from "@clack/prompts";
import pc from "picocolors";
import { loadDownstreamConfig, setWorkflowCommitStrategy } from "../config/loader.js";
import { getSyncStatus } from "../core/sync.js";
import { createLogger } from "../utils/logger.js";
import { promptCompletionInstall } from "./completion.js";
import { type InitUserScopeOptions, initUserScopeCommand } from "./init-user-scope.js";
import {
  checkModifiedFilesBeforeSync,
  parseAndValidateTargets,
  performSync,
  promptMergeOrOverride,
  resolveSource,
  resolveTargetDirectory,
  resolveVersion,
  type SharedSyncOptions,
  validateScope,
} from "./shared.js";

// `home` already comes from SharedSyncOptions; `codexFeaturesRun` is picked up so
// the user-scope branch stays injectable through `initCommand` in tests.
export interface InitOptions
  extends SharedSyncOptions,
    Pick<InitUserScopeOptions, "autosync" | "codexFeaturesRun"> {}

export async function initCommand(options: InitOptions): Promise<void> {
  const logger = createLogger();

  // Reject an unknown --scope rather than silently initializing the repo — a
  // typo like `--scope usr` must not commit canonical content into the repo.
  validateScope(options.scope);

  // User scope: guided setup of the ~/.agconf store, the per-user projection,
  // the SessionStart hook and auto-sync — no repo is involved.
  if (options.scope === "user") {
    await initUserScopeCommand(options);
    return;
  }

  // Accepting a flag and doing nothing with it reads as "auto-sync is off here",
  // when auto-sync is a user-scope concept that repo init never touches.
  if (options.autosync === false) {
    logger.warn("--no-autosync only applies to --scope user; ignoring it.");
  }

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

  // Asked last, so an abort or failure above leaves no config behind. Only GitHub
  // sources get a sync workflow, so only they have a strategy to choose.
  if (resolvedVersion.ref !== "local" && repository) {
    await promptCommitStrategy(targetDir, options);
  }

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

const COMMIT_STRATEGY_DOCS_URL =
  "https://github.com/julian-pani/agconf/blob/master/cli/docs/DOWNSTREAM_REPOSITORY_CONFIGURATION.md#commit-strategies";

/**
 * Ask how the generated sync workflow should apply changes and record the answer
 * in `.agconf/config.yaml`. Skipped in non-interactive mode and when the repo
 * already chose a strategy; the sync that follows reads the file back.
 */
export async function promptCommitStrategy(targetDir: string, options: InitOptions): Promise<void> {
  if (options.yes) return;
  const existing = await loadDownstreamConfig(targetDir);
  if (existing?.workflow) return;

  prompts.note(`Details: ${COMMIT_STRATEGY_DOCS_URL}`, "Commit strategy");
  const choice = await prompts.select({
    message: "How should the sync workflow apply updates?",
    options: [
      {
        value: "pr",
        label: "Pull request (recommended)",
        hint: "opens a PR for review before anything changes",
      },
      {
        value: "direct",
        label: "Direct commit",
        hint: "commits straight to the branch, no review step",
      },
    ],
    initialValue: "pr",
  });
  if (prompts.isCancel(choice)) {
    prompts.cancel("Operation cancelled");
    process.exit(0);
  }
  await setWorkflowCommitStrategy(targetDir, choice as "pr" | "direct");
  prompts.log.info("Saved commit strategy to .agconf/config.yaml (commit this file).");
}
