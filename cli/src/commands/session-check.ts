import * as os from "node:os";
import pc from "picocolors";
import {
  type DuplicationFinding,
  detectCrossScopeDuplication,
  installSessionStartHook,
} from "../core/session-check.js";
import { checkUserScope } from "../core/user-scope.js";
import { getGitRoot } from "../utils/git.js";

export interface SessionCheckOptions {
  /** Working directory to resolve the repo git root from (default: process.cwd()). */
  cwd?: string | undefined;
  /** Home directory override (default: os.homedir()). For testability. */
  home?: string | undefined;
  /** Minimal output. */
  quiet?: boolean | undefined;
  /** Install the SessionStart hook into ~/.claude/settings.json instead of checking. */
  installHook?: boolean | undefined;
}

function describeFinding(f: DuplicationFinding): string {
  const scopes = f.scopes.join(" + ");
  if (f.type === "instructions") {
    const note = f.divergent
      ? pc.red("divergent — conflicting guidance")
      : pc.dim("identical — duplicated context");
    return `  ${pc.yellow("instructions")}: ${scopes} scope (${note})`;
  }
  return `  ${pc.yellow(f.type)}: ${scopes} scope`;
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

    const integrity = await checkUserScope({ homeDir });
    const hasIntegrityIssue = !integrity.ok && integrity.hasLockfile;

    if (cross.findings.length === 0 && !hasIntegrityIssue) {
      return; // clean — stay silent so the hook adds no noise
    }

    if (cross.findings.length > 0) {
      console.log(
        pc.yellow("⚠ agconf: content is managed in more than one scope — you may load it twice:"),
      );
      for (const f of cross.findings) console.log(describeFinding(f));
      console.log(
        pc.dim(
          "  Consolidate: stop syncing this repo per-repo, or exclude it from your user-scope install.",
        ),
      );
    }

    if (hasIntegrityIssue) {
      console.log(pc.yellow("⚠ agconf: your user-scope files changed since the last sync."));
      console.log(pc.dim("  Run `agconf check --scope user` for details."));
    }
  } catch {
    // Session-start hooks must never break a session — swallow everything.
  }
}
