import * as os from "node:os";
import pc from "picocolors";
import { loadUserScopeConfig, setAutosyncEnabled } from "../config/loader.js";
import {
  type AutosyncResult,
  appendAutosyncLog,
  formatLogLine,
  isThrottled,
  readAutosyncState,
  writeAutosyncState,
} from "../core/autosync.js";
import { installSessionStartHook } from "../core/session-check.js";
import { StoreBusyError } from "../core/user-scope.js";
import { NoUserScopeSourceError, runUserScopeSync } from "./user-scope.js";

export interface AutosyncCommandOptions {
  home?: string | undefined;
  /** Bypass the throttle window (manual `--force`). */
  force?: boolean | undefined;
  /** Label for the log line: "startup" | "manual". Default "manual". */
  trigger?: string | undefined;
  /** Install the SessionStart hook + enable auto-sync, then exit. */
  install?: boolean | undefined;
  /** Disable auto-sync (leaving the shared hook in place), then exit. */
  uninstall?: boolean | undefined;
  /** Enable auto-sync (ensures the hook is installed), then exit. */
  enable?: boolean | undefined;
  /** Disable auto-sync, then exit. */
  disable?: boolean | undefined;
  quiet?: boolean | undefined;
}

/**
 * `agconf autosync`: the auto-sync runner for the user store. Refreshes the
 * per-user projection when it's behind canonical. Triggered from the SessionStart
 * hook (`--trigger startup`, throttled), or run manually. Always best-effort and
 * exit 0 — it must never disrupt a session.
 *
 * There is no OS scheduler (cron/launchd): freshness is driven by the
 * SessionStart hook, matching the norm for developer CLIs. `--install`/`--enable`
 * turn it on; `--uninstall`/`--disable` turn it off.
 */
export async function autosyncCommand(options: AutosyncCommandOptions = {}): Promise<void> {
  const homeDir = options.home ?? os.homedir();

  if (options.install || options.enable) return enableAutosync(homeDir, options.quiet);
  if (options.uninstall || options.disable) return disableAutosync(homeDir, options.quiet);

  const trigger = options.trigger ?? "manual";
  const now = new Date();
  const nowIso = now.toISOString();
  // Preserved across the try/catch so the error path keeps the existing state
  // version rather than resetting it.
  let stateVersion = 1;

  try {
    const config = await loadUserScopeConfig(homeDir);
    if (!config.autosync.enabled) {
      await appendAutosyncLog(homeDir, formatLogLine(nowIso, trigger, "disabled"));
      if (!options.quiet && trigger === "manual") {
        console.log(
          pc.dim("Auto-sync is disabled (autosync.enabled: false in ~/.agconf/config.yaml)."),
        );
      }
      return;
    }

    const state = await readAutosyncState(homeDir);
    stateVersion = state?.version ?? 1;
    if (!options.force && isThrottled(state, config.autosync.interval_minutes, now)) {
      await appendAutosyncLog(homeDir, formatLogLine(nowIso, trigger, "throttled"));
      if (!options.quiet && trigger === "manual") {
        console.log(pc.dim("Skipped — synced recently. Use --force to sync now."));
      }
      return;
    }

    // Record the attempt up front so concurrent/rapid triggers throttle each other.
    await writeAutosyncState(homeDir, { version: stateVersion, last_attempt: nowIso });

    // throwOnResolveError so an offline/private-repo clone failure is CAUGHT here
    // (recorded to state + log) instead of process.exit escaping best-effort.
    const run = await runUserScopeSync({
      home: homeDir,
      skipIfUpToDate: true,
      throwOnResolveError: true,
    });
    const result: AutosyncResult = run.upToDate ? "up-to-date" : "synced";
    const detail = run.upToDate
      ? `version=${run.pinnedVersion ?? "?"}`
      : `changed=${run.result?.files.filter((f) => f.changed).length ?? 0} committed=${run.result?.committed ?? false} backed_up=${run.result?.contentBackups.length ?? 0}`;

    await writeAutosyncState(homeDir, {
      version: stateVersion,
      last_attempt: nowIso,
      last_result: result,
    });
    await appendAutosyncLog(homeDir, formatLogLine(nowIso, trigger, result, detail));

    if (!options.quiet && trigger === "manual") {
      console.log(run.upToDate ? pc.dim("Already up to date.") : pc.green("✓ Synced user scope."));
    }
  } catch (error) {
    // Another sync holds the store lock — benign, not an error. Log and move on.
    if (error instanceof StoreBusyError) {
      await appendAutosyncLog(homeDir, formatLogLine(nowIso, trigger, "locked")).catch(() => {});
      return;
    }
    const msg =
      error instanceof NoUserScopeSourceError
        ? "no source (run `agconf sync --scope user --source …` once)"
        : error instanceof Error
          ? error.message
          : String(error);
    await writeAutosyncState(homeDir, {
      version: stateVersion,
      last_attempt: nowIso,
      last_result: "error",
      last_error: msg,
    }).catch(() => {});
    await appendAutosyncLog(
      homeDir,
      formatLogLine(nowIso, trigger, "error", `error=${JSON.stringify(msg)}`),
    ).catch(() => {});
    // Best-effort: never throw, never non-zero exit.
    if (!options.quiet && trigger === "manual") {
      console.log(pc.yellow(`Auto-sync failed: ${msg}`));
    }
  }
}

/**
 * Enable auto-sync: ensure the SessionStart hook is installed and write the
 * config (whose presence is the opt-in marker) with `enabled: true`. A malformed
 * settings.json we refuse to clobber is fatal here (explicit admin action).
 */
async function enableAutosync(homeDir: string, quiet?: boolean): Promise<void> {
  let hook: Awaited<ReturnType<typeof installSessionStartHook>>;
  try {
    hook = await installSessionStartHook(homeDir);
  } catch (err) {
    console.error(pc.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
    return;
  }
  await setAutosyncEnabled(homeDir, true);

  if (quiet) return;
  console.log();
  console.log(`${pc.green("✓")} Auto-sync enabled — refreshes the user store at session start.`);
  console.log(
    hook.alreadyPresent
      ? pc.dim(`  SessionStart hook already present (${hook.settingsPath})`)
      : pc.dim(`  Installed SessionStart hook (${hook.settingsPath})`),
  );
  console.log(
    pc.dim("  Turn off with `agconf autosync --disable`. Debug log: ~/.agconf/logs/autosync.log"),
  );
  console.log();
}

/** Disable auto-sync (set `enabled: false`). The shared hook is left in place. */
async function disableAutosync(homeDir: string, quiet?: boolean): Promise<void> {
  await setAutosyncEnabled(homeDir, false);
  if (quiet) return;
  console.log();
  console.log(`${pc.green("✓")} Auto-sync disabled — no background sync will run.`);
  console.log(
    pc.dim(
      "  The SessionStart hook remains (it also powers the cross-scope duplication check). Re-enable with `agconf autosync --enable`.",
    ),
  );
  console.log();
}
