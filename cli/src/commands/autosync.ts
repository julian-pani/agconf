import * as os from "node:os";
import pc from "picocolors";
import { loadUserScopeConfig } from "../config/loader.js";
import {
  type AutosyncResult,
  appendAutosyncLog,
  type CrontabIO,
  formatLogLine,
  installCron,
  isThrottled,
  readAutosyncState,
  uninstallCron,
  writeAutosyncState,
} from "../core/autosync.js";
import { installSessionStartHook } from "../core/session-check.js";
import { NoUserScopeSourceError, runUserScopeSync } from "./user-scope.js";

export interface AutosyncCommandOptions {
  home?: string | undefined;
  /** Bypass the throttle window (used by the cron entry). */
  force?: boolean | undefined;
  /** Label for the log line: "startup" | "cron" | "manual". Default "manual". */
  trigger?: string | undefined;
  /** Install the SessionStart hook + cron entry, then exit. */
  install?: boolean | undefined;
  /** Remove the cron entry, then exit. */
  uninstall?: boolean | undefined;
  quiet?: boolean | undefined;
  /** Test seam: cron invocation string (defaults to this binary). */
  invocation?: string | undefined;
  /** Test seam: inject crontab IO so tests never touch the real crontab. */
  crontabIo?: CrontabIO | undefined;
}

/** Single-quote a path for the /bin/sh cron command line (handles spaces). */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Cron invocation string. Passes `--force` so scheduled runs bypass the
 * session-start throttle (cron IS the schedule; without it a run landing on the
 * interval boundary would be throttled by the previous run and no-op). Paths are
 * shell-quoted so a node/entry path containing spaces still runs under cron.
 */
function defaultInvocation(): string {
  const node = process.execPath;
  const entry = process.argv[1];
  return entry
    ? `${shQuote(node)} ${shQuote(entry)} autosync --trigger cron --force`
    : "agconf autosync --trigger cron --force";
}

/**
 * `agconf autosync`: the auto-sync runner for the user store. Refreshes the
 * per-user projection when it's behind canonical. Triggered from the SessionStart
 * hook (`--trigger startup`, throttled) and cron (`--trigger cron --force`), or
 * run manually. Always best-effort and exit 0 — it must never disrupt a session
 * or spam cron mail.
 */
export async function autosyncCommand(options: AutosyncCommandOptions = {}): Promise<void> {
  const homeDir = options.home ?? os.homedir();

  if (options.install) return installAutosync(homeDir, options);
  if (options.uninstall) return uninstallAutosync(options);

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
      return;
    }

    // Record the attempt up front so concurrent/rapid triggers throttle each other.
    await writeAutosyncState(homeDir, { version: stateVersion, last_attempt: nowIso });

    const run = await runUserScopeSync({ home: homeDir, skipIfUpToDate: true });
    const result: AutosyncResult = run.upToDate ? "up-to-date" : "synced";
    const detail = run.upToDate
      ? `version=${run.pinnedVersion ?? "?"}`
      : `changed=${run.result?.files.filter((f) => f.changed).length ?? 0} committed=${run.result?.committed ?? false}`;

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

async function installAutosync(homeDir: string, options: AutosyncCommandOptions): Promise<void> {
  const config = await loadUserScopeConfig(homeDir);

  // The SessionStart hook is the primary trigger; a failure here (e.g. a
  // malformed settings.json we refuse to clobber) is fatal for --install.
  let hook: Awaited<ReturnType<typeof installSessionStartHook>>;
  try {
    hook = await installSessionStartHook(homeDir);
  } catch (err) {
    console.error(pc.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
    return;
  }

  // Cron is a best-effort bonus on top of session-start autosync; if the crontab
  // is unavailable (e.g. no `crontab` binary, or an unexpected read error we
  // won't clobber), report it but don't fail the install.
  let cronChanged = false;
  let cronError: string | null = null;
  try {
    const cron = await installCron({
      invocation: options.invocation ?? defaultInvocation(),
      intervalMinutes: config.autosync.interval_minutes,
      ...(options.crontabIo ? { io: options.crontabIo } : {}),
    });
    cronChanged = cron.changed;
  } catch (err) {
    cronError = err instanceof Error ? err.message : String(err);
  }

  if (options.quiet) return;
  console.log();
  console.log(pc.bold("agconf autosync --install"));
  console.log(
    hook.alreadyPresent
      ? pc.dim("  SessionStart hook already present")
      : `  ${pc.green("✓")} SessionStart hook installed (${hook.settingsPath})`,
  );
  if (cronError) {
    console.log(
      pc.yellow(`  cron not installed: ${cronError} (session-start autosync still active)`),
    );
  } else {
    console.log(
      cronChanged
        ? `  ${pc.green("✓")} cron installed (every ${config.autosync.interval_minutes} min)`
        : pc.dim("  cron already up to date"),
    );
  }
  if (!config.autosync.enabled) {
    console.log(
      pc.yellow("  note: autosync.enabled is false — nothing will run until you enable it."),
    );
  }
  console.log();
  console.log(
    pc.dim("  Disable anytime: set `autosync: { enabled: false }` in ~/.agconf/config.yaml"),
  );
  console.log(pc.dim("  Debug log: ~/.agconf/logs/autosync.log"));
  console.log();
}

async function uninstallAutosync(options: AutosyncCommandOptions): Promise<void> {
  let cronChanged = false;
  let cronError: string | null = null;
  try {
    const cron = await uninstallCron(options.crontabIo);
    cronChanged = cron.changed;
  } catch (err) {
    cronError = err instanceof Error ? err.message : String(err);
  }

  if (options.quiet) return;
  if (cronError) {
    console.log(pc.yellow(`Could not read the crontab: ${cronError}`));
  } else {
    console.log(
      cronChanged
        ? `${pc.green("✓")} Removed the agconf-autosync cron entry`
        : pc.dim("No agconf-autosync cron entry found"),
    );
  }
  // The SessionStart hook is shared with the cross-scope duplication check, so it
  // is intentionally left in place. The real off-switch for autosync is the
  // config flag, which stops both the cron and the session-start trigger.
  console.log(
    pc.dim("To stop all autosync, set `autosync: { enabled: false }` in ~/.agconf/config.yaml."),
  );
}
