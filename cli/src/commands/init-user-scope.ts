import * as os from "node:os";
import * as path from "node:path";
import * as prompts from "@clack/prompts";
import pc from "picocolors";
import { isAutosyncInstalled, loadUserScopeConfig, setAutosyncEnabled } from "../config/loader.js";
import type { CodexFeaturesRunner } from "../core/session-check.js";
import { getSyncStatusSafe } from "../core/sync.js";
import { isValidTarget, SUPPORTED_TARGETS, TARGET_CONFIGS } from "../core/targets.js";
import { StoreBusyError, type UserSyncResult } from "../core/user-scope.js";
import { createLogger } from "../utils/logger.js";
import { isValidRepositorySlug } from "../utils/repository.js";
import { enableAutosync } from "./autosync.js";
import { promptCompletionInstall } from "./completion.js";
import { installStoreHooks, printHookLines } from "./hook-install.js";
import {
  NoUserScopeSourceError,
  printUserSyncResult,
  resolveRecordedSource,
  runUserScopeSync,
  type UserScopeSyncOptions,
} from "./user-scope.js";

export interface InitUserScopeOptions extends UserScopeSyncOptions {
  /**
   * Turn on background auto-sync as the final step. Defaults to on for a fresh
   * setup — `init` is an explicit, interactive act, so the opt-in that guards
   * `autosync` against silently activating on upgrade is already satisfied. On a
   * machine where auto-sync was deliberately disabled, that preference wins over
   * the default instead.
   *
   * Commander sets this to `false` for `--no-autosync` and leaves it `true`
   * otherwise, so `false` is the only value that carries intent — hence the
   * `!== false` tests rather than `=== undefined`.
   */
  autosync?: boolean | undefined;
  /** Test seam: inject the `codex features list` runner for the disabled-hooks warning. */
  codexFeaturesRun?: CodexFeaturesRunner | undefined;
}

/**
 * `agconf init --scope user`: the guided front door to user-scope setup. Asks
 * for the canonical source, the harnesses to project into, and whether to keep
 * the store fresh automatically — then does the whole setup in one go (sync,
 * SessionStart hook, auto-sync).
 *
 * A thin orchestrator by design: every step delegates to the same functions the
 * individual commands use (`runUserScopeSync`, `enableAutosync`,
 * `installSessionStartHooks`), so there is exactly one implementation of each.
 * `sync --scope user` remains the scriptable path; this is the discoverable one.
 */
export async function initUserScopeCommand(options: InitUserScopeOptions): Promise<void> {
  const logger = createLogger();
  const homeDir = options.home ?? os.homedir();

  console.log();
  prompts.intro(pc.bold("agconf init --scope user"));

  const status = await getSyncStatusSafe(homeDir);

  if (status.hasSynced && !options.yes) {
    const again = await prompts.confirm({
      message: "User scope is already set up. Run setup again (re-sync and re-check hooks)?",
    });
    if (prompts.isCancel(again) || !again) {
      prompts.cancel("Operation cancelled");
      return;
    }
  }

  // Source: flags first, then the store lockfile (so re-running is an update
  // flow), then ask. Only a first run with neither flag nor store reaches the
  // prompt — and under --yes that is a hard error rather than a hang.
  const recorded = resolveRecordedSource(options, status.lockfile);
  let source = recorded.source;
  const local = recorded.local;
  if (!source && local === undefined) {
    if (options.yes) {
      logger.error(new NoUserScopeSourceError().message);
      process.exit(1);
    }
    const answer = await prompts.text({
      message: "Canonical repository holding your company standards",
      placeholder: "acme/standards",
      validate: (value) =>
        isValidRepositorySlug((value ?? "").trim())
          ? undefined
          : "Enter a GitHub repository as owner/repo (or re-run with --local <path>).",
    });
    if (prompts.isCancel(answer)) {
      prompts.cancel("Operation cancelled");
      return;
    }
    source = answer.trim();
  }

  // Targets: the setting developers most often get wrong, so ask rather than
  // silently defaulting to Claude alone.
  let target = options.target;
  if (!target && !options.yes) {
    const previous = status.lockfile?.content.targets;
    const picked = await prompts.multiselect({
      message: "Which agent harnesses should receive company standards?",
      options: SUPPORTED_TARGETS.map((t) => ({
        value: t as string,
        label: t,
        hint: path.dirname(TARGET_CONFIGS[t].userInstructionsFile),
      })),
      initialValues: previous?.length ? previous.filter(isValidTarget) : ["claude"],
      required: true,
    });
    if (prompts.isCancel(picked)) {
      prompts.cancel("Operation cancelled");
      return;
    }
    target = picked as string[];
  }

  // Dropping a target does NOT clean up what was already projected into it: the
  // sync's orphan detection diffs canonical CONTENT, not the target list, so the
  // de-selected harness keeps a frozen copy of the company instructions AND its
  // lockfile entry disappears, hiding it from `check --scope user` too. Cheap to
  // do by accident now that the previous targets are pre-selected, so say so.
  // isValidTarget guard: `content.targets` is a plain string array in the schema,
  // so a hand-edited store — or one written by a newer agconf that knows a target
  // this build doesn't — must not crash the TARGET_CONFIGS lookup below.
  const dropped = (status.lockfile?.content.targets ?? [])
    .filter(isValidTarget)
    .filter((t) => target && !target.includes(t));
  if (dropped.length > 0) {
    logger.warn(
      `Dropping target(s) ${dropped.join(", ")}: already-projected content stays on disk (${dropped
        .map((t) => path.dirname(TARGET_CONFIGS[t].userInstructionsFile))
        .join(", ")}) and stops being checked. Remove it manually if you want it gone.`,
    );
  }

  // Auto-sync defaults ON, but never overrides a deliberate `autosync --disable`:
  // a re-run must not silently restart background syncs the developer turned off.
  const previouslyInstalled = await isAutosyncInstalled(homeDir);
  const previouslyEnabled =
    previouslyInstalled && (await loadUserScopeConfig(homeDir)).autosync.enabled;
  const suggested = previouslyInstalled ? previouslyEnabled : true;

  let autosync = options.autosync !== false && suggested;
  if (options.autosync !== false && !options.yes) {
    const answer = await prompts.confirm({
      message: "Keep company standards fresh automatically (background refresh at session start)?",
      initialValue: suggested,
    });
    if (prompts.isCancel(answer)) {
      prompts.cancel("Operation cancelled");
      return;
    }
    autosync = answer;
  }

  let result: UserSyncResult | null;
  try {
    result = (
      await runUserScopeSync({
        ...options,
        home: homeDir,
        ...(source ? { source } : {}),
        ...(local !== undefined ? { local } : {}),
        ...(target ? { target } : {}),
      })
    ).result;
  } catch (error) {
    if (error instanceof NoUserScopeSourceError) {
      logger.error(error.message);
      process.exit(1);
    }
    if (error instanceof StoreBusyError) {
      logger.error(`${error.message} — try again in a moment.`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  // Only reachable via the skipIfUpToDate fast path, which init never requests.
  if (!result) return;

  // Not the command name again — the clack intro already printed that.
  printUserSyncResult(result, homeDir, "Company standards projected", { autosyncTip: false });

  // Hooks are installed AFTER the sync: `installStoreHooks` resolves its targets
  // from the store lockfile the sync just wrote, so installing first would
  // register a Claude-only hook and immediately trip the findMissingHookTargets
  // nudge on the next session. (It also means a failed sync installs nothing.)
  const ok = autosync
    ? await enableAutosync(homeDir, false, options.codexFeaturesRun)
    : await disableAutosyncAndInstallHooks(homeDir, previouslyEnabled, options.codexFeaturesRun);

  // The step above already printed the reason and set a non-zero exit code.
  // Don't follow it with a completion offer and a "Done." — the standards are
  // projected, but nothing is wired to keep them fresh or checked.
  if (!ok) {
    prompts.outro(
      pc.yellow("Standards projected, but session setup failed — see the error above."),
    );
    return;
  }

  if (!options.yes) {
    await promptCompletionInstall();
  }

  prompts.outro(
    pc.dim(
      autosync
        ? "Done. Restart your agent session to load the company standards."
        : "Done. Restart your agent session, and re-run `agconf sync --scope user` to pick up updates.",
    ),
  );
}

/**
 * The declined-auto-sync path. The SessionStart hook is still worth installing —
 * it also powers the cross-scope duplication and user-scope integrity checks.
 *
 * Declining auto-sync is persisted as `enabled: false` in the store config —
 * leaving `enabled: true` (or leaving no config at all) would mean the CLI
 * reports auto-sync as off while background syncs keep running, or start again
 * on the next run.
 */
async function disableAutosyncAndInstallHooks(
  homeDir: string,
  previouslyEnabled: boolean,
  codexFeaturesRun?: CodexFeaturesRunner,
): Promise<boolean> {
  // Record the decline FIRST, and unconditionally. Before the hook install,
  // because turning auto-sync off must not depend on the hook install
  // succeeding — a pre-existing hook would otherwise keep spawning the syncs the
  // developer just declined. Unconditionally, because a decline that writes
  // nothing is not remembered: a later `--yes` run would read "never configured"
  // and helpfully switch background sync back on.
  await setAutosyncEnabled(homeDir, false);

  const hooks = await installStoreHooks(homeDir);
  if (!hooks) return false;

  console.log();
  console.log(
    `${pc.green("✓")} Session checks installed (${
      previouslyEnabled ? "auto-sync turned off" : "auto-sync left off"
    }).`,
  );
  await printHookLines(hooks, codexFeaturesRun);
  console.log(pc.dim("  Turn auto-sync on later with `agconf autosync --enable`."));
  console.log();
  return true;
}
