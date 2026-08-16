import * as os from "node:os";
import pc from "picocolors";
import { maybeStartBackgroundAutosync, type SpawnFn } from "../core/autosync.js";
import {
  type DuplicationFinding,
  detectCrossScopeDuplication,
  installSessionStartHook,
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
  /** Install the SessionStart hook into ~/.claude/settings.json instead of checking. */
  installHook?: boolean | undefined;
  /** Test seam: inject the spawn used to launch the background auto-sync. */
  autosyncSpawn?: SpawnFn | undefined;
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
 * With `--install-hook`, registers itself as a Claude Code SessionStart hook.
 */
export async function sessionCheckCommand(options: SessionCheckOptions = {}): Promise<void> {
  const homeDir = options.home ?? os.homedir();

  // Explicit admin action — surface failures instead of swallowing them (unlike
  // the advisory check path below, which must never break a session).
  if (options.installHook) {
    try {
      const result = await installSessionStartHook(homeDir);
      if (!options.quiet) {
        console.log(
          result.alreadyPresent
            ? pc.dim(`agconf session-check hook already present in ${result.settingsPath}`)
            : `${pc.green("✓")} Installed agconf session-check SessionStart hook (${result.settingsPath})`,
        );
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
    const startedAutosync = await maybeStartBackgroundAutosync(
      homeDir,
      options.autosyncSpawn ? { spawn: options.autosyncSpawn } : {},
    );
    if (startedAutosync) {
      const fresh = await probeUserScopeFreshness(homeDir).catch(
        () => ({ behind: false }) as const,
      );
      if (fresh.behind) {
        console.log(
          pc.dim(
            `Note for the developer: company standards were updated (${fresh.current} → ${fresh.latest}) since this session loaded its config — restart the session (or run \`agconf sync --scope user\`) to pick up the latest.`,
          ),
        );
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
