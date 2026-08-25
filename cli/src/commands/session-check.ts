import * as os from "node:os";
import pc from "picocolors";
import { loadUserScopeConfig } from "../config/loader.js";
import {
  isThrottled,
  maybeStartBackgroundAutosync,
  readAutosyncState,
  type SpawnFn,
} from "../core/autosync.js";
import {
  type CodexFeaturesRunner,
  codexHooksDisabledWarning,
  type DuplicationFinding,
  detectCrossScopeDuplication,
  findMissingHookTargets,
  HOOK_COMMAND_FULL,
} from "../core/session-check.js";
import { checkUserScope } from "../core/user-scope.js";
import { stripAnsi } from "../utils/ansi.js";
import { getGitRoot } from "../utils/git.js";
import { hookStatus, installStoreHooks, staleHookWarning } from "./hook-install.js";
import { probeUserScopeFreshness } from "./user-scope.js";

export interface SessionCheckOptions {
  /** Working directory to resolve the repo git root from (default: process.cwd()). */
  cwd?: string | undefined;
  /** Home directory override (default: os.homedir()). For testability. */
  home?: string | undefined;
  /**
   * Minimal output: suppresses the advisory notes entirely (a developer who has
   * seen them can silence the hook without uninstalling it) and, under
   * `--install-hook`, the install report.
   */
  quiet?: boolean | undefined;
  /**
   * Install the SessionStart hook for the user store's targets (Claude →
   * ~/.claude/settings.json, Codex → ~/.codex/hooks.json) instead of checking.
   */
  installHook?: boolean | undefined;
  /** Test seam: inject the spawn used to launch the background auto-sync. */
  autosyncSpawn?: SpawnFn | undefined;
  /** Test seam: resolve canonical's latest version for the freshness probe. */
  probeLatest?: ((repo: string, timeoutMs: number) => Promise<string | null>) | undefined;
  /** Test seam: inject the `codex features list` runner for the disabled-hooks warning. */
  codexFeaturesRun?: CodexFeaturesRunner | undefined;
  /**
   * Running as a SessionStart hook: emit the wire envelope
   * (`hookSpecificOutput.additionalContext`) instead of human-readable text.
   */
  hook?: boolean | undefined;
}

function describeFinding(f: DuplicationFinding): string {
  const scopes = f.scopes.join(" + ");
  if (f.type === "instructions") {
    const note = f.divergent
      ? pc.red("divergent — conflicting guidance")
      : pc.dim("identical — duplicated context");
    return `  instructions: ${scopes} scope (${note})`;
  }
  // Name the specific overlapping objects so the finding is concrete/actionable.
  const which = f.objects?.length ? ` (${f.objects.join(", ")})` : "";
  return `  ${f.type}${which}: ${scopes} scope`;
}

const HUMAN_HEADER = "[agconf session-check] Heads-up:";

const RELAY_HEADER =
  "[agconf session-check] INSTRUCTION FOR THE CODING AGENT: relay the following to the user (the human developer) at the start of your next reply, before answering their request. Summarize it in your own words, keeping the specifics (names, versions, commands). This is a heads-up for the human to act on — do NOT try to fix it yourself, do NOT run any agconf command unless the user asks, and do NOT skip mentioning it.";

/**
 * Print the collected notes.
 *
 * Three audiences, three shapes:
 *   - `asHook` — the SessionStart wire envelope. Codex validates a hook's stdout
 *     against `session-start.command.output` and fails the hook (discarding the
 *     text) unless it gets that JSON; Claude Code accepts the same envelope. The
 *     envelope is emitted even with nothing to say, so a clean session can't be
 *     read as invalid output.
 *   - a terminal (stdout is a TTY) — a human is reading, so no agent header.
 *   - anything else (a pre-`--hook` hook still piping plain text) — keeps the
 *     relay header so those installs go on working until they're upgraded.
 *
 * The relay header exists because the agent is the developer's ONLY channel to
 * this output: notes framed as background context get read and silently dropped,
 * and the developer never learns their config is duplicated. Hence the imperative
 * plus the explicit "don't act on it yourself" guard.
 *
 * Everything interpolated into a note must be agconf-authored or validated — the
 * envelope is an instruction in the agent's context, so `sanitizeForNote` guards
 * the one value that comes off the network (a release tag).
 */
function printNotes(notes: string[], asHook: boolean): void {
  if (asHook) {
    // Colors are a terminal affordance; in the envelope they would just be noise
    // in the agent's context (picocolors usually no-ops here, but a pty-backed
    // hook runner would keep them).
    const additionalContext =
      notes.length === 0 ? "" : stripAnsi(`${RELAY_HEADER}\n\n${formatNotes(notes)}`);
    console.log(
      JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }),
    );
    return;
  }
  if (notes.length === 0) return;
  console.log(process.stdout.isTTY ? HUMAN_HEADER : RELAY_HEADER);
  console.log(`\n${formatNotes(notes)}`);
}

function formatNotes(notes: string[]): string {
  return notes.map((note) => `- ${note}`).join("\n\n");
}

/**
 * Strip anything that could restructure the agent's context (control characters,
 * line breaks) and cap the length. Applied to values agconf does not author —
 * currently a version tag read from the releases API.
 */
function sanitizeForNote(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the point
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, 64);
}

/**
 * Gather every note this session should surface, in report order (stale
 * standards → cross-scope duplication → user-scope drift → missing hook).
 * Returns `[]` when there is nothing to say — including on failure: this feeds a
 * SessionStart hook, which must never break a session, so everything is swallowed.
 */
async function collectNotes(options: SessionCheckOptions, homeDir: string): Promise<string[]> {
  try {
    const repoDir = await getGitRoot(options.cwd ?? process.cwd());
    const cross = await detectCrossScopeDuplication({ repoDir, homeDir });

    // Only relevant once the developer uses user scope.
    if (!cross.userSynced) {
      return [];
    }

    // Each entry is one note for the developer; printNotes decides how they are
    // framed for whoever is reading.
    const notes: string[] = [];

    // Auto-sync (opt-in): kick off a detached background refresh so the hook
    // returns instantly, then — if it actually started (installed + enabled) —
    // cheaply probe whether this session loaded a stale version and, if so, nudge
    // the developer to restart. The current session can't reload its already-read
    // context, so a restart is the reliable way to pick up the update; the
    // background refresh makes that restart current.
    //
    // Read the throttle state BEFORE spawning (the spawned runner writes it): if a
    // sync ran within the interval the store is already current, so skip the probe
    // — no need to spend a network call or nag on every session start.
    const preState = await readAutosyncState(homeDir);
    const startedAutosync = await maybeStartBackgroundAutosync(
      homeDir,
      options.autosyncSpawn ? { spawn: options.autosyncSpawn } : {},
    );
    if (startedAutosync) {
      const config = await loadUserScopeConfig(homeDir);
      if (!isThrottled(preState, config.autosync.interval_minutes, new Date())) {
        const fresh = await probeUserScopeFreshness({
          home: homeDir,
          ...(options.probeLatest ? { fetchLatest: options.probeLatest } : {}),
        }).catch(() => ({ behind: false }) as const);
        if (fresh.behind) {
          notes.push(
            `Company standards were updated (${sanitizeForNote(String(fresh.current))} → ${sanitizeForNote(String(fresh.latest))}) since this session loaded its config. Restarting the session picks up the latest (the developer can also run \`agconf sync --scope user\`).`,
          );
        }
      }
    }

    const integrity = await checkUserScope({ homeDir });
    const hasIntegrityIssue = !integrity.ok && integrity.hasLockfile;

    // Self-heal nudge for the "store gained a target after the hook was installed"
    // drift — see findMissingHookTargets. Cheap (≤2 JSON reads) and never throws.
    const missingHooks = await findMissingHookTargets(homeDir);

    if (cross.findings.length > 0) {
      const lines = [
        "agconf-managed content is present in more than one scope, so it may load twice —",
        ...cross.findings.map(describeFinding),
        "  To stop the double-load, keep this content in a single scope: your user-scope copy already covers every repo, so the repo's copy can go (drop the content from this repo's sync, or set the type to `off`/`plugin` under `delivery:` in its `.agconf/config.yaml`).",
        "  If the duplication is deliberate, `agconf session-check --quiet` in the hook command silences this.",
      ];
      notes.push(lines.join("\n"));
    }

    if (hasIntegrityIssue) {
      notes.push(
        "Your user-scope agconf files changed since the last sync — run `agconf check --scope user` for details.",
      );
    }

    if (missingHooks.length > 0) {
      notes.push(
        `Your user store is synced for ${missingHooks.join(", ")}, but the session-check hook there is missing or out of date (a hook without \`--hook\` is discarded by Codex) — re-run \`agconf session-check --install-hook\` to fix ${missingHooks.length > 1 ? "them" : "it"}.`,
      );
    }

    return notes;
  } catch {
    // Session-start hooks must never break a session — swallow everything.
    return [];
  }
}

/**
 * `agconf session-check`: advisory, cross-scope duplication + user-scope integrity
 * check meant to run at session start. Never throws and always exits 0 so it can
 * never disrupt a session; output goes to stdout so a SessionStart hook injects it
 * into the agent's context.
 *
 * With `--install-hook`, registers itself as a SessionStart hook for each target
 * the user store was synced to (Claude → settings.json, Codex → hooks.json).
 */
export async function sessionCheckCommand(options: SessionCheckOptions = {}): Promise<void> {
  const homeDir = options.home ?? os.homedir();

  // Explicit admin action — surface failures instead of swallowing them (unlike
  // the advisory check path below, which must never break a session).
  if (options.installHook) {
    const results = await installStoreHooks(homeDir);
    if (results && !options.quiet) {
      for (const r of results) {
        // "Already present" is a non-event; an install or an upgrade changed the
        // developer's config, so it gets the ✓.
        const status = hookStatus(r);
        if (status === "present") {
          console.log(
            pc.dim(`agconf session-check hook already present for ${r.target} (${r.filePath})`),
          );
        } else if (status === "upgraded") {
          console.log(
            `${pc.green("✓")} Updated the agconf session-check hook for ${r.target} to \`${HOOK_COMMAND_FULL}\` (${r.filePath})`,
          );
        } else {
          console.log(
            `${pc.green("✓")} Installed agconf session-check SessionStart hook for ${r.target} (${r.filePath})`,
          );
        }
        const stale = staleHookWarning(r);
        if (stale) console.log(pc.yellow(`  ${stale}`));
      }
      // Guarded by !quiet so quiet mode never shells out to `codex features list`.
      const warning = await codexHooksDisabledWarning(results, options.codexFeaturesRun);
      if (warning) console.log(pc.yellow(warning));
    }
    return;
  }

  // Hook mode always prints the envelope, even with nothing to report: a clean
  // session is the common case, and empty stdout is not valid hook output.
  const notes = options.quiet ? [] : await collectNotes(options, homeDir);
  if (options.hook || notes.length > 0) printNotes(notes, options.hook ?? false);
}
