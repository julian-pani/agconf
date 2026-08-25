import pc from "picocolors";
import {
  type CodexFeaturesRunner,
  codexHooksDisabledWarning,
  HOOK_COMMAND_FULL,
  type HookInstallResult,
  installSessionStartHooks,
  resolveHookTargets,
} from "../core/session-check.js";

/**
 * Install the `agconf session-check` SessionStart hook for every target the user
 * store was synced to, reporting failure identically everywhere: the message on
 * stderr and a non-zero exit code, with `null` returned so the caller can stop
 * claiming success.
 *
 * Shared by `session-check --install-hook`, `autosync --install|--enable` and
 * `init --scope user` — all three explicit admin actions, hence surfacing the
 * failure rather than swallowing it the way the advisory session-check path must.
 */
export async function installStoreHooks(homeDir: string): Promise<HookInstallResult[] | null> {
  try {
    return await installSessionStartHooks(homeDir, await resolveHookTargets(homeDir));
  } catch (err) {
    console.error(pc.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
    return null;
  }
}

/**
 * What happened to one target's hook. Shared so every entry point
 * (`session-check --install-hook`, `autosync`, `init --scope user`) treats an
 * upgrade as its own outcome instead of reporting it as a fresh install or as a
 * no-op; the wording stays with each caller, whose surrounding output differs.
 */
export function hookStatus(hook: HookInstallResult): "installed" | "upgraded" | "present" {
  if (hook.upgraded) return "upgraded";
  return hook.alreadyPresent ? "present" : "installed";
}

/**
 * The one case agconf cannot fix for the developer: a session-check command they
 * customized, which agconf won't rewrite, and which Codex discards for lack of
 * `--hook`. `null` when there is nothing to say.
 */
export function staleHookWarning(hook: HookInstallResult): string | null {
  if (!hook.stale) return null;
  return `Your ${hook.target} SessionStart hook runs a customized session-check command without \`--hook\`. agconf left it alone — add \`--hook\` to it yourself, or Codex will keep discarding its output (${hook.filePath}).`;
}

/** Report what `installStoreHooks` did, one dimmed line per target. */
export async function printHookLines(
  hooks: HookInstallResult[],
  codexFeaturesRun?: CodexFeaturesRunner,
): Promise<void> {
  for (const hook of hooks) {
    const status = hookStatus(hook);
    const what =
      status === "upgraded"
        ? `Updated the SessionStart hook for ${hook.target} to \`${HOOK_COMMAND_FULL}\``
        : status === "present"
          ? `SessionStart hook already present for ${hook.target}`
          : `Installed SessionStart hook for ${hook.target}`;
    console.log(pc.dim(`  ${what} (${hook.filePath})`));
    const stale = staleHookWarning(hook);
    if (stale) console.log(pc.yellow(`  ${stale}`));
  }
  const warning = await codexHooksDisabledWarning(hooks, codexFeaturesRun);
  if (warning) console.log(pc.yellow(`  ${warning}`));
}
