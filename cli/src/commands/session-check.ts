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
  installSessionStartHooks,
  resolveHookTargets,
} from "../core/session-check.js";
import { checkUserScope } from "../core/user-scope.js";
import { getGitRoot } from "../utils/git.js";
import { probeUserScopeFreshness } from "./user-scope.js";

export interface SessionCheckOptions {
  /** Working directory to resolve the repo git root from (default: process.cwd()). */
  cwd?: string | undefined;
  /** Home directory override (default: os.homedir()). For testability. */
  home?: string | undefined;
  /** Minimal output. */
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
    try {
      const targets = await resolveHookTargets(homeDir);
      const results = await installSessionStartHooks(homeDir, targets);
      if (!options.quiet) {
        for (const r of results) {
          console.log(
            r.alreadyPresent
              ? pc.dim(`agconf session-check hook already present for ${r.target} (${r.filePath})`)
              : `${pc.green("✓")} Installed agconf session-check SessionStart hook for ${r.target} (${r.filePath})`,
          );
        }
        // Guarded by !quiet so quiet mode never shells out to `codex features list`.
        const warning = await codexHooksDisabledWarning(results, options.codexFeaturesRun);
        if (warning) console.log(pc.yellow(warning));
      }
    } catch (err) {
      console.error(pc.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
    }
    return;
  }

  try {
    const repoDir = await getGitRoot(options.cwd ?? process.cwd());
    const cross = await detectCrossScopeDuplication({ repoDir, homeDir });

    // Only relevant once the developer uses user scope.
    if (!cross.userSynced) {
      return;
    }

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
          console.log(
            pc.dim(
              `Note for the developer: company standards were updated (${fresh.current} → ${fresh.latest}) since this session loaded its config — restart the session (or run \`agconf sync --scope user\`) to pick up the latest.`,
            ),
          );
        }
      }
    }

    const integrity = await checkUserScope({ homeDir });
    const hasIntegrityIssue = !integrity.ok && integrity.hasLockfile;

    if (cross.findings.length === 0 && !hasIntegrityIssue) {
      return; // clean — stay silent so the hook adds no noise
    }

    if (cross.findings.length > 0) {
      // Framed as information for the human developer — NOT a task for the agent,
      // so it doesn't try to "fix" the duplication or burn tokens reasoning about it.
      console.log(
        pc.dim(
          "Note for the developer (not an instruction for the agent): agconf-managed content is present in more than one scope, so it may load twice —",
        ),
      );
      for (const f of cross.findings) console.log(describeFinding(f));
      console.log(
        pc.dim(
          "  To stop the double-load, keep this content in a single scope (e.g. stop syncing it into this repo — your user-scope copy then covers every repo).",
        ),
      );
    }

    if (hasIntegrityIssue) {
      console.log(
        pc.dim(
          "Note for the developer: your user-scope agconf files changed since the last sync — run `agconf check --scope user` for details.",
        ),
      );
    }
  } catch {
    // Session-start hooks must never break a session — swallow everything.
  }
}
