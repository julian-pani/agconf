import * as prompts from "@clack/prompts";
import pc from "picocolors";
import {
  type ApplyOptions,
  type ApplyResult,
  applyProposedChanges,
  type DetectNewContentResult,
  DivergentCopiesError,
  DivergentInstructionsError,
  detectNewContent,
  detectProposedChanges,
  discardCanonicalClone,
  type NewContentCandidate,
  type ProposeResult,
  type ProposeScope,
} from "../core/propose.js";
import { StaleBaseError } from "../core/propose-merge.js";
import { formatSourceString } from "../core/source.js";
import { validateScope } from "./shared.js";

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
  /** Distribution scope of the local copy: "repo" (default) or "user". */
  scope?: string | undefined;
  /** Home directory override for `--scope user` (defaults to os.homedir()). For testing. */
  home?: string | undefined;
}

type Spinner = ReturnType<typeof prompts.spinner>;

/** Scope-specific options threaded into both detectors. */
interface ScopeOptions {
  scope: ProposeScope;
  cwd?: string | undefined;
  home?: string | undefined;
}

export async function proposeCommand(options: ProposeCommandOptions = {}): Promise<void> {
  // Reject an unknown --scope rather than silently proposing from the repo.
  validateScope(options.scope);

  const scope: ProposeScope = options.scope === "user" ? "user" : "repo";
  const scopeOptions: ScopeOptions = {
    scope,
    ...(scope === "repo" ? { cwd: options.cwd ?? process.cwd() } : {}),
    ...(options.home !== undefined ? { home: options.home } : {}),
  };
  const isNew = options.new !== undefined && options.new !== false;

  console.log();
  prompts.intro(pc.bold(scope === "user" ? "agconf propose --scope user" : "agconf propose"));

  const spinner = prompts.spinner();

  const result = isNew
    ? await buildNewProposeResult(scopeOptions, options, spinner)
    : await buildManagedProposeResult(scopeOptions, options, spinner);

  if (!result) return; // messaging + outro already handled (clone discarded there)

  // Detection left a canonical clone in TMPDIR. It is only worth keeping when
  // the run ends by handing the user a path into it to finish by hand; every
  // other ending (dry run, cancelled prompt, PR opened) discards it.
  let retainClone = false;
  try {
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
      // Nothing was applied, so there is nothing to retry — the clone is garbage.
      prompts.outro("Dry run complete — no changes were made");
      return;
    }

    retainClone = await runApply(result, options, spinner);
  } finally {
    if (!retainClone) await discardCanonicalClone(result.canonicalCloneDir);
  }
}

/**
 * Detect modified managed files. Returns null (after emitting the appropriate
 * outro) when detection fails or there is nothing to propose.
 */
async function buildManagedProposeResult(
  scopeOptions: ScopeOptions,
  options: ProposeCommandOptions,
  spinner: Spinner,
): Promise<ProposeResult | null> {
  spinner.start("Detecting changes to managed content...");

  let result: ProposeResult;
  try {
    result = await detectProposedChanges({
      ...scopeOptions,
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
    if (error instanceof DivergentInstructionsError) {
      spinner.stop("Instruction files disagree");
      reportDivergentInstructions(error);
      prompts.outro("Propose cancelled");
      process.exit(1);
    }
    if (error instanceof DivergentCopiesError) {
      spinner.stop("Target copies disagree");
      reportDivergentCopies(error);
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
    // Detection may still have cloned (managed skills exist, none of them
    // modified). Nothing will be applied, so drop it.
    await discardCanonicalClone(result.canonicalCloneDir);
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
 * Explain a divergent-instructions abort (user scope): the same company block
 * was edited differently in two harness files, so there is no single edit to
 * propose.
 */
function reportDivergentInstructions(error: DivergentInstructionsError): void {
  prompts.log.error(
    "Your instructions block was edited differently in more than one file, so there is no single change to propose:",
  );
  console.log();
  for (const filePath of error.paths) {
    console.log(`  ${filePath}`);
  }
  console.log();
  prompts.log.info(
    "To resolve: make the copies match, or select one with --files (e.g. --files '\\.claude/CLAUDE\\.md').",
  );
}

/**
 * Explain a divergent-copies abort: one canonical file has several downstream
 * copies (a skill synced to claude + codex) and they were edited differently, so
 * there is no single edit to propose.
 */
function reportDivergentCopies(error: DivergentCopiesError): void {
  prompts.log.error(
    "These files have more than one downstream copy, and the copies were edited differently:",
  );
  console.log();
  for (const item of error.divergent) {
    console.log(`  ${pc.dim(`→ ${item.canonicalPath}`)}`);
    for (const downstreamPath of item.downstreamPaths) {
      console.log(`    ${downstreamPath}`);
    }
  }
  console.log();
  prompts.log.info(
    "To resolve: make the copies match, or select one with --files (e.g. --files '^\\.claude/').",
  );
  // --override takes the local copy over canonical's. Here every candidate is
  // local, so there is nothing for it to choose between — say so rather than
  // letting the user retry with a flag that cannot help.
  prompts.log.warn(
    "--override does not apply: both copies are yours, so it has no winner to pick.",
  );
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
  scopeOptions: ScopeOptions,
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
      ...scopeOptions,
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
    await discardCanonicalClone(detect.canonicalCloneDir);
    prompts.outro("Done");
    return null;
  }

  const selected = await selectNewCandidates(detect, options);
  if (!selected) {
    // User cancelled the selection prompt — nothing to apply, nothing to retry.
    await discardCanonicalClone(detect.canonicalCloneDir);
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
 *
 * Returns whether the canonical clone must be kept — true only when the outcome
 * we just printed hands the user a path into it (manual push / PR commands, or
 * the local-source outro that reports the clone as the result of the run).
 * Everything else is cleaned up: by the caller's `finally` for the clone
 * detection made, and here for one `applyProposedChanges` created itself.
 */
async function runApply(
  result: ProposeResult,
  options: ProposeCommandOptions,
  spinner: Spinner,
): Promise<boolean> {
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
      return false;
    }
    title = titleInput;
  }
  if (!title) {
    prompts.log.error("Title is required. Use --title or run interactively.");
    // process.exit skips the caller's finally, so discard here instead.
    await discardCanonicalClone(result.canonicalCloneDir);
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
      return false;
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

  // True when the message we print sends the user back into the clone, so it
  // has to survive this process.
  let retainClone: boolean;

  if (!applyResult.pushed) {
    spinner.stop("Branch created locally");
    prompts.log.warn("Failed to push branch to remote.");
    console.log();
    console.log(pc.yellow("Run these commands manually to complete:"));
    console.log();
    console.log(pc.dim(applyResult.manualCommands));
    console.log();
    prompts.outro(`Branch: ${pc.cyan(applyResult.branch)}`);
    // The commit exists only in the clone and the commands start with `cd` into it.
    retainClone = true;
  } else if (applyResult.prUrl) {
    spinner.stop("PR created");
    prompts.log.success(`Branch: ${pc.cyan(applyResult.branch)}`);
    prompts.log.success(`PR: ${pc.cyan(applyResult.prUrl)}`);
    prompts.outro("Done!");
    // Pushed and the PR is open — the work is safely upstream, nothing to retry.
    retainClone = false;
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
    // `gh pr create` has to run inside the clone.
    retainClone = true;
  } else {
    // Local source — no PR
    spinner.stop("Branch created");
    prompts.log.success(`Branch: ${pc.cyan(applyResult.branch)}`);
    prompts.log.info(`Clone directory: ${pc.dim(applyResult.cloneDir)}`);
    prompts.outro("Changes applied to canonical clone");
    // We just printed the path as the outcome of the run; deleting it would
    // point the user at a directory that no longer exists.
    retainClone = true;
  }

  // Covers the clone applyProposedChanges made for itself when detection had
  // none to hand over. A no-op when it reused detection's — the caller's
  // `finally` removes that same path, and removal is idempotent.
  if (!retainClone) await discardCanonicalClone(applyResult.cloneDir);

  return retainClone;
}
