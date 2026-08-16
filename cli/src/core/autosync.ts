/**
 * Auto-sync plumbing for the user store (F5b): throttle state, a debug log, and
 * the detached background launcher. The runner itself lives in
 * `commands/autosync.ts`; this module holds the testable pieces.
 *
 * Freshness is driven entirely by the SessionStart hook (the ecosystem norm —
 * Claude Code, Codex, gh, rustup all check on invocation, not via an installed
 * OS scheduler). No cron/launchd/systemd entry is installed.
 *
 * Split of concerns (see the config-vs-state principle in DISTRIBUTION_SCOPES.md):
 * - INTENT lives in `~/.agconf/config.yaml` (`autosync.enabled`); its PRESENCE is
 *   the install marker (background sync only runs once explicitly installed).
 * - STATE lives in `~/.agconf/autosync-state.json` (last attempt / result) — used
 *   to throttle session-start runs so opening many sessions doesn't hammer sync.
 * - The lockfile stays the record of what was synced.
 *
 * All paths derive from an injectable `homeDir` for testability.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isAutosyncInstalled, loadUserScopeConfig } from "../config/loader.js";
import { getUserPaths } from "./user-scope.js";

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

export type AutosyncResult =
  | "synced"
  | "up-to-date"
  | "throttled"
  | "locked"
  | "disabled"
  | "error";

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

/** Fire-and-forget spawn used to launch the background auto-sync. Injectable for tests. */
export type SpawnFn = (command: string, args: string[]) => void;

const defaultSpawn: SpawnFn = (command, args) => {
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    // An ENOENT (or other) spawn failure surfaces as an async 'error' event; with
    // no listener Node rethrows it as an uncaught exception that would crash the
    // hosting process. Swallow it — the background launch is strictly best-effort.
    child.on("error", () => {});
    child.unref();
  } catch {
    // spawn threw synchronously (bad args, etc.) — ignore, best-effort.
  }
};

/**
 * Launch `agconf autosync --trigger startup` in a detached background process,
 * so the SessionStart hook returns instantly instead of waiting on a sync.
 * Returns whether a process was started. Never throws.
 *
 * Gated on an EXPLICIT opt-in — background sync runs only when auto-sync was
 * installed (`~/.agconf/config.yaml` present, via `autosync --install`/`--enable`)
 * AND `autosync.enabled` is not false. So upgrading a user who only had the F5
 * duplication hook never silently starts background syncs or git commits.
 */
export async function maybeStartBackgroundAutosync(
  homeDir: string,
  opts: { spawn?: SpawnFn } = {},
): Promise<boolean> {
  try {
    if (!(await isAutosyncInstalled(homeDir))) return false;
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
