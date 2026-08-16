import * as prompts from "@clack/prompts";
import pc from "picocolors";
import {
  type ApplyOptions,
  type ApplyResult,
  applyProposedChanges,
  type DetectNewContentResult,
  detectNewContent,
  detectProposedChanges,
  type NewContentCandidate,
  type ProposeResult,
} from "../core/propose.js";
import { StaleBaseError } from "../core/propose-merge.js";
import { formatSourceString } from "../core/source.js";

export interface ProposeCommandOptions {
  dryRun?: boolean | undefined;
  title?: string | undefined;
  message?: string | undefined;
  files?: string[] | undefined;
  yes?: boolean | undefined;
  /**
   * Propose new (unmanaged) content instead of changes to managed content.
   * `true` discovers everything; a string restricts discovery to that path.
   */
  new?: string | boolean | undefined;
  /** Resolve conflicts with canonical by taking the local copy instead of aborting. */
  override?: boolean | undefined;
  cwd?: string | undefined;
}

type Spinner = ReturnType<typeof prompts.spinner>;

export async function proposeCommand(options: ProposeCommandOptions = {}): Promise<void> {
  const targetDir = options.cwd ?? process.cwd();
  const isNew = options.new !== undefined && options.new !== false;

  console.log();
  prompts.intro(pc.bold("agconf propose"));

  const spinner = prompts.spinner();

  const result = isNew
    ? await buildNewProposeResult(targetDir, options, spinner)
    : await buildManagedProposeResult(targetDir, options, spinner);

  if (!result) return; // messaging + outro already handled

  // Show what will be proposed.
  prompts.log.info(isNew ? "New files to propose:" : "Modified files:");
  for (const change of result.changes) {
    // A merged file ships reconciled content, not what's on disk downstream.
    const merged = change.rebased ? pc.yellow(" (merged onto canonical HEAD)") : "";
    console.log(`  ${change.downstreamPath} ${pc.dim(`→ ${change.canonicalPath}`)}${merged}`);
  }

  console.log();
  prompts.log.info(`Canonical source: ${pc.cyan(formatSourceString(result.source))}`);

  if (options.dryRun) {
    prompts.outro("Dry run complete — no changes were made");
    return;
  }

  await runApply(result, options, spinner);
}

/**
 * Detect modified managed files. Returns null (after emitting the appropriate
 * outro) when detection fails or there is nothing to propose.
 */
async function buildManagedProposeResult(
  targetDir: string,
  options: ProposeCommandOptions,
  spinner: Spinner,
): Promise<ProposeResult | null> {
  spinner.start("Detecting changes to managed content...");

  let result: ProposeResult;
  try {
    result = await detectProposedChanges({
      cwd: targetDir,
      files: options.files,
      override: options.override,
    });
  } catch (error) {
    if (error instanceof StaleBaseError) {
      spinner.stop("Canonical has moved on");
      reportStaleBase(error);
      prompts.outro("Propose cancelled");
      process.exit(1);
    }
    spinner.stop("Failed to detect changes");
    prompts.log.error(String(error));
    prompts.outro("Propose cancelled");
    process.exit(1);
  }

  if (result.changes.length === 0) {
    spinner.stop("No changes detected");
    reportDropped(result);
    prompts.log.info("No modified managed files found. Nothing to propose.");
    prompts.outro("Done");
    return null;
  }

  reportDropped(result);

  spinner.stop(`Found ${result.changes.length} modified file(s)`);
  return result;
}

/**
 * Note files that were reconciled away. Without this, a local copy that only
 * looked modified because canonical moved would vanish from the proposal with
 * no explanation.
 */
function reportDropped(result: ProposeResult): void {
  const dropped = result.dropped ?? [];
  if (dropped.length === 0) return;

  prompts.log.info(`${dropped.length} file(s) already up to date with canonical — not proposed:`);
  for (const filePath of dropped) {
    console.log(`  ${pc.dim(filePath)}`);
  }
}

/**
 * Explain a stale-base abort: which files couldn't be rebased onto canonical
 * HEAD, why, and the two ways forward.
 */
function reportStaleBase(error: StaleBaseError): void {
  prompts.log.error(
    "Canonical has changed since your last sync, and these files could not be merged cleanly:",
  );
  console.log();
  for (const conflict of error.conflicts) {
    console.log(`  ${conflict.downstreamPath}`);
    console.log(`    ${pc.dim(conflict.reason)}`);
  }
  console.log();
  prompts.log.info(
    "To resolve: commit or stash these files, run `agconf sync` to take canonical's version, then re-apply your edits and propose again.",
  );
  // sync's overwrite guard exempts managed files — canonical owns them — so it
  // replaces the local copy outright. Saying "just sync" without this would
  // send the user to lose the very edits they are trying to propose.
  prompts.log.warn(
    "`agconf sync` overwrites your local copy of managed files, so save your work first.",
  );
  prompts.log.warn(
    "Or pass --override to take your local copy for these files — this discards the canonical changes listed above. Files that merge cleanly are still merged.",
  );
}

/**
 * Discover new (unmanaged) content, let the user choose which items to propose,
 * and assemble a ProposeResult. Returns null (after emitting the appropriate
 * outro) when nothing is found or the user cancels.
 */
async function buildNewProposeResult(
  targetDir: string,
  options: ProposeCommandOptions,
  spinner: Spinner,
): Promise<ProposeResult | null> {
  if (options.override) {
    // New content has no canonical counterpart, so there is nothing to override.
    prompts.log.warn(
      "--override has no effect with --new; new content never overwrites canonical.",
    );
  }

  spinner.start("Discovering new content...");

  let detect: DetectNewContentResult;
  try {
    detect = await detectNewContent({
      cwd: targetDir,
      path: typeof options.new === "string" ? options.new : undefined,
    });
  } catch (error) {
    spinner.stop("Failed to discover new content");
    prompts.log.error(String(error));
    prompts.outro("Propose cancelled");
    process.exit(1);
  }

  spinner.stop(
    detect.candidates.length > 0
      ? `Found ${detect.candidates.length} new item(s)`
      : "No new content found",
  );

  for (const warning of detect.warnings) {
    prompts.log.warn(warning);
  }

  // Round-trip items: already upstream and identical to the local copy. Not
  // proposable — `sync` adopts them. Surfaced so a repo that proposed content
  // earlier isn't left wondering why it no longer appears as "new".
  if (detect.adoptable.length > 0) {
    prompts.log.info(
      `${detect.adoptable.length} item(s) already exist in canonical and match your local copy:`,
    );
    for (const item of detect.adoptable) {
      console.log(`  ${item.downstreamPath} ${pc.dim(`(${item.type})`)}`);
    }
    console.log();
    prompts.log.info(
      "Run `agconf sync` to adopt them as managed (replaces the untracked local copy with the tracked version).",
    );
  }

  if (detect.candidates.length === 0) {
    prompts.log.info("No new skills, rules, or agents to propose.");
    prompts.outro("Done");
    return null;
  }

  const selected = await selectNewCandidates(detect, options);
  if (!selected) {
    prompts.outro("Propose cancelled");
    return null;
  }

  return {
    changes: selected.flatMap((c) => c.changes),
    source: detect.source,
    markerPrefix: detect.markerPrefix,
    downstream: detect.downstream,
    canonicalCloneDir: detect.canonicalCloneDir,
  };
}

/**
 * Resolve which discovered candidates to propose. Auto-selects when a path
 * filter pinned down a single item; selects all in `--yes` mode; otherwise
 * prompts with a multiselect. Returns null if the user cancels.
 */
async function selectNewCandidates(
  detect: DetectNewContentResult,
  options: ProposeCommandOptions,
): Promise<NewContentCandidate[] | null> {
  if (detect.autoSelect && detect.candidates.length === 1) {
    const only = detect.candidates[0];
    if (only) prompts.log.info(`Selected ${candidateLabel(only)}`);
    return detect.candidates;
  }

  if (options.yes) {
    return detect.candidates;
  }

  const choice = await prompts.multiselect({
    message: "Select new content to propose:",
    options: detect.candidates.map((c, i) => ({
      value: i,
      label: candidateLabel(c),
      hint: c.canonicalPath,
    })),
    required: true,
  });

  if (prompts.isCancel(choice)) {
    return null;
  }

  return (choice as number[])
    .map((i) => detect.candidates[i])
    .filter((c): c is NewContentCandidate => c !== undefined);
}

function candidateLabel(candidate: NewContentCandidate): string {
  return `${candidate.type}: ${candidate.name}`;
}

/**
 * Prompt for title/message as needed, apply the proposal to canonical, and
 * report the outcome. Shared by the managed and new-content flows.
 */
async function runApply(
  result: ProposeResult,
  options: ProposeCommandOptions,
  spinner: Spinner,
): Promise<void> {
  // Prompt for proposal title if not provided
  let title = options.title;
  if (!title && !options.yes) {
    const titleInput = await prompts.text({
      message: "Proposal title:",
      placeholder: "e.g. Update code review skill with new guidelines",
      validate: (value) => {
        if (!value.trim()) return "Title is required";
        return undefined;
      },
    });
    if (prompts.isCancel(titleInput)) {
      prompts.outro("Propose cancelled");
      return;
    }
    title = titleInput;
  }
  if (!title) {
    prompts.log.error("Title is required. Use --title or run interactively.");
    prompts.outro("Propose cancelled");
    process.exit(1);
  }

  // Prompt for message if not provided
  let message = options.message;
  if (!message && !options.yes) {
    const messageInput = await prompts.text({
      message: "Description (optional):",
      placeholder: "What changed and why?",
    });
    if (prompts.isCancel(messageInput)) {
      prompts.outro("Propose cancelled");
      return;
    }
    message = messageInput || undefined;
  }

  const applyOptions: ApplyOptions = { title, message };

  spinner.start("Applying changes to canonical repository...");

  let applyResult: ApplyResult;
  try {
    applyResult = await applyProposedChanges(result, applyOptions);
  } catch (error) {
    spinner.stop("Failed");
    prompts.log.error(`Failed to apply changes: ${error}`);
    prompts.outro("Propose failed");
    process.exit(1);
  }

  if (!applyResult.pushed) {
    spinner.stop("Branch created locally");
    prompts.log.warn("Failed to push branch to remote.");
    console.log();
    console.log(pc.yellow("Run these commands manually to complete:"));
    console.log();
    console.log(pc.dim(applyResult.manualCommands));
    console.log();
    prompts.outro(`Branch: ${pc.cyan(applyResult.branch)}`);
    return;
  }

  if (applyResult.prUrl) {
    spinner.stop("PR created");
    prompts.log.success(`Branch: ${pc.cyan(applyResult.branch)}`);
    prompts.log.success(`PR: ${pc.cyan(applyResult.prUrl)}`);
    prompts.outro("Done!");
  } else if (applyResult.manualCommands) {
    spinner.stop("Branch pushed");
    prompts.log.success(`Branch: ${pc.cyan(applyResult.branch)}`);
    prompts.log.warn("Could not create PR automatically.");
    console.log();
    console.log(pc.yellow("Run this command to create the PR:"));
    console.log();
    console.log(pc.dim(applyResult.manualCommands));
    console.log();
    prompts.outro("Branch pushed successfully");
  } else {
    // Local source — no PR
    spinner.stop("Branch created");
    prompts.log.success(`Branch: ${pc.cyan(applyResult.branch)}`);
    prompts.log.info(`Clone directory: ${pc.dim(applyResult.cloneDir)}`);
    prompts.outro("Changes applied to canonical clone");
  }
}
