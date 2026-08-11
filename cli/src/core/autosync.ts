/**
 * Auto-sync plumbing for the user store (F5b): throttle state, a debug log, and
 * cron installation. The runner itself lives in `commands/autosync.ts`; this
 * module holds the testable pieces.
 *
 * Split of concerns (see the config-vs-state principle in DISTRIBUTION_SCOPES.md):
 * - INTENT lives in `~/.agconf/config.yaml` (`autosync.enabled` / `interval_minutes`).
 * - STATE lives in `~/.agconf/autosync-state.json` (last attempt / result) — used
 *   to throttle session-start runs so opening many sessions doesn't hammer sync.
 * - The lockfile stays the record of what was synced.
 *
 * All paths derive from an injectable `homeDir` for testability.
 */

import { execFile, spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { loadUserScopeConfig } from "../config/loader.js";
import { getUserPaths } from "./user-scope.js";

const execFileAsync = promisify(execFile);

/** Marker comment that makes the crontab entry idempotent + removable. */
export const CRON_MARKER = "# agconf-autosync";

/** Cap the debug log; one rollover to `.1` keeps it bounded. */
const LOG_MAX_BYTES = 256 * 1024;

export interface AutosyncPaths {
  statePath: string;
  logPath: string;
}

export function getAutosyncPaths(homeDir: string): AutosyncPaths {
  const { storeDir } = getUserPaths(homeDir);
  return {
    statePath: path.join(storeDir, "autosync-state.json"),
    logPath: path.join(storeDir, "logs", "autosync.log"),
  };
}

export type AutosyncResult = "synced" | "up-to-date" | "throttled" | "disabled" | "error";

export interface AutosyncState {
  version: number;
  /** ISO timestamp of the last run attempt (throttle key). */
  last_attempt?: string;
  last_result?: AutosyncResult;
  last_error?: string;
}

export async function readAutosyncState(homeDir: string): Promise<AutosyncState | null> {
  try {
    const raw = await fs.readFile(getAutosyncPaths(homeDir).statePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AutosyncState>;
    if (!parsed || typeof parsed !== "object") return null;
    return { version: parsed.version ?? 1, ...parsed };
  } catch {
    return null;
  }
}

export async function writeAutosyncState(homeDir: string, state: AutosyncState): Promise<void> {
  const { statePath } = getAutosyncPaths(homeDir);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

/**
 * Whether a run should be skipped because a recent attempt is within the
 * throttle window. Pure — `now` is injectable. A missing/blank last-attempt
 * never throttles.
 */
export function isThrottled(
  state: AutosyncState | null,
  intervalMinutes: number,
  now: Date,
): boolean {
  const last = state?.last_attempt;
  if (!last) return false;
  const lastMs = Date.parse(last);
  if (Number.isNaN(lastMs)) return false;
  return now.getTime() - lastMs < intervalMinutes * 60_000;
}

/** Append one line to the debug log, rotating once when it grows too large. */
export async function appendAutosyncLog(homeDir: string, line: string): Promise<void> {
  const { logPath } = getAutosyncPaths(homeDir);
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  try {
    const stat = await fs.stat(logPath);
    if (stat.size > LOG_MAX_BYTES) {
      await fs.rename(logPath, `${logPath}.1`).catch(() => {});
    }
  } catch {
    // No log yet — nothing to rotate.
  }
  await fs.appendFile(logPath, `${line}\n`, "utf-8");
}

/** Format a single log line for a run. */
export function formatLogLine(
  now: string,
  trigger: string,
  result: AutosyncResult,
  detail?: string,
): string {
  const base = `[${now}] trigger=${trigger} result=${result}`;
  return detail ? `${base} ${detail}` : base;
}

/** Cron schedule expression for an interval in minutes. */
export function cronScheduleFor(intervalMinutes: number): string {
  if (intervalMinutes >= 1 && intervalMinutes <= 59) return `*/${intervalMinutes} * * * *`;
  return "0 * * * *"; // hourly fallback for out-of-range intervals
}

/**
 * Produce a crontab body with exactly one agconf-autosync line, preserving all
 * other entries. Idempotent (keyed by {@link CRON_MARKER}). Pure — testable.
 */
export function buildCrontab(
  existing: string,
  cronLine: string,
): { content: string; changed: boolean } {
  const kept = existing
    .split("\n")
    .filter((l) => !l.includes(CRON_MARKER))
    .join("\n")
    .replace(/\n+$/, "");
  const body = kept ? `${kept}\n${cronLine}\n` : `${cronLine}\n`;
  return {
    content: body,
    changed: body !== (existing.endsWith("\n") ? existing : `${existing}\n`),
  };
}

/** Remove the agconf-autosync line from a crontab body. Pure. */
export function stripCrontab(existing: string): { content: string; changed: boolean } {
  const lines = existing.split("\n");
  const kept = lines.filter((l) => !l.includes(CRON_MARKER));
  const changed = kept.length !== lines.length;
  const body = kept.join("\n").replace(/\n+$/, "");
  return { content: body ? `${body}\n` : "", changed };
}

/** Injectable read/write of the user crontab (so tests never touch the real one). */
export interface CrontabIO {
  read: () => Promise<string>;
  write: (content: string) => Promise<void>;
}

const defaultCrontabIO: CrontabIO = {
  async read() {
    try {
      const { stdout } = await execFileAsync("crontab", ["-l"]);
      return stdout;
    } catch {
      // No crontab yet (crontab -l exits non-zero) or crontab missing.
      return "";
    }
  },
  write(content: string) {
    // `crontab -` reads the new table from stdin.
    return new Promise<void>((resolve, reject) => {
      const child = execFile("crontab", ["-"], (err) => (err ? reject(err) : resolve()));
      child.stdin?.end(content);
    });
  },
};

/**
 * Install (or refresh) the agconf-autosync crontab entry. Best-effort and
 * mac/Linux only (uses the `crontab` binary). Returns whether it changed.
 */
export async function installCron(options: {
  invocation: string;
  intervalMinutes: number;
  io?: CrontabIO;
}): Promise<{ changed: boolean; line: string }> {
  const io = options.io ?? defaultCrontabIO;
  const line = `${cronScheduleFor(options.intervalMinutes)} ${options.invocation} >/dev/null 2>&1 ${CRON_MARKER}`;
  const existing = await io.read();
  const { content, changed } = buildCrontab(existing, line);
  if (changed) await io.write(content);
  return { changed, line };
}

export async function uninstallCron(
  io: CrontabIO = defaultCrontabIO,
): Promise<{ changed: boolean }> {
  const existing = await io.read();
  const { content, changed } = stripCrontab(existing);
  if (changed) await io.write(content);
  return { changed };
}

/** Fire-and-forget spawn used to launch the background auto-sync. Injectable for tests. */
export type SpawnFn = (command: string, args: string[]) => void;

const defaultSpawn: SpawnFn = (command, args) => {
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
};

/**
 * Launch `agconf autosync --trigger startup` in a detached background process
 * when auto-sync is enabled, so a SessionStart hook returns instantly instead of
 * waiting on a sync. Returns whether a process was started. Never throws.
 */
export async function maybeStartBackgroundAutosync(
  homeDir: string,
  opts: { spawn?: SpawnFn } = {},
): Promise<boolean> {
  try {
    const config = await loadUserScopeConfig(homeDir);
    if (!config.autosync.enabled) return false;
    const spawnFn = opts.spawn ?? defaultSpawn;
    const entry = process.argv[1];
    if (entry) {
      spawnFn(process.execPath, [entry, "autosync", "--trigger", "startup"]);
    } else {
      spawnFn("agconf", ["autosync", "--trigger", "startup"]);
    }
    return true;
  } catch {
    return false;
  }
}
