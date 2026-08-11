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

function defaultInvocation(): string {
  const node = process.execPath;
  const entry = process.argv[1];
  return entry ? `${node} ${entry} autosync --trigger cron` : "agconf autosync --trigger cron";
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
    if (!options.force && isThrottled(state, config.autosync.interval_minutes, now)) {
      await appendAutosyncLog(homeDir, formatLogLine(nowIso, trigger, "throttled"));
      return;
    }

    // Record the attempt up front so concurrent/rapid triggers throttle each other.
    await writeAutosyncState(homeDir, { version: state?.version ?? 1, last_attempt: nowIso });

    const run = await runUserScopeSync({ home: homeDir, skipIfUpToDate: true });
    const result: AutosyncResult = run.upToDate ? "up-to-date" : "synced";
    const detail = run.upToDate
      ? `version=${run.pinnedVersion ?? "?"}`
      : `changed=${run.result?.files.filter((f) => f.changed).length ?? 0} committed=${run.result?.committed ?? false}`;

    await writeAutosyncState(homeDir, {
      version: state?.version ?? 1,
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
      version: 1,
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
  const hook = await installSessionStartHook(homeDir);
  const cron = await installCron({
    invocation: options.invocation ?? defaultInvocation(),
    intervalMinutes: config.autosync.interval_minutes,
    ...(options.crontabIo ? { io: options.crontabIo } : {}),
  });

  if (options.quiet) return;
  console.log();
  console.log(pc.bold("agconf autosync --install"));
  console.log(
    hook.alreadyPresent
      ? pc.dim("  SessionStart hook already present")
      : `  ${pc.green("✓")} SessionStart hook installed (${hook.settingsPath})`,
  );
  console.log(
    cron.changed
      ? `  ${pc.green("✓")} cron installed (every ${config.autosync.interval_minutes} min)`
      : pc.dim("  cron already up to date"),
  );
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
  const cron = await uninstallCron(options.crontabIo);
  if (options.quiet) return;
  console.log(
    cron.changed
      ? `${pc.green("✓")} Removed the agconf-autosync cron entry`
      : pc.dim("No agconf-autosync cron entry found"),
  );
  console.log(
    pc.dim(
      "The SessionStart hook is left in place; remove it from ~/.claude/settings.json if desired.",
    ),
  );
}
