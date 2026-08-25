import pc from "picocolors";
import {
  type CodexFeaturesRunner,
  codexHooksDisabledWarning,
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

/** Report what `installStoreHooks` did, one dimmed line per target. */
export async function printHookLines(
  hooks: HookInstallResult[],
  codexFeaturesRun?: CodexFeaturesRunner,
): Promise<void> {
  for (const hook of hooks) {
    console.log(
      hook.alreadyPresent
        ? pc.dim(`  SessionStart hook already present for ${hook.target} (${hook.filePath})`)
        : pc.dim(`  Installed SessionStart hook for ${hook.target} (${hook.filePath})`),
    );
  }
  const warning = await codexHooksDisabledWarning(hooks, codexFeaturesRun);
  if (warning) console.log(pc.yellow(`  ${warning}`));
}
