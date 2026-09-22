import pc from "picocolors";
import { verifyChangedPaths } from "../core/verify-paths.js";
import { getGitRoot } from "../utils/git.js";

export interface VerifyPathsOptions {
  /** Directory to resolve the repository from (defaults to process.cwd()). */
  cwd?: string | undefined;
  /** Minimal output, just the exit code. */
  quiet?: boolean | undefined;
}

/**
 * Verify that the working tree only changed paths agconf owns.
 *
 * Runs between `agconf sync` and the commit in the sync workflow, for both the
 * `pr` and `direct` strategies — an automated PR that silently reverts `src/`
 * is as much of a problem as a direct commit doing it, and gets rubber-stamped
 * more easily.
 *
 * Fails closed: anything that stops the guard from answering (not a git repo,
 * unreadable config) exits non-zero rather than passing the sync through
 * unverified.
 */
export async function verifyPathsCommand(options: VerifyPathsOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const repoRoot = await getGitRoot(cwd);

  if (!repoRoot) {
    console.error(pc.red("Not a git repository — cannot verify which paths changed."));
    process.exit(1);
    return;
  }

  let result: Awaited<ReturnType<typeof verifyChangedPaths>>;
  try {
    result = await verifyChangedPaths(repoRoot);
  } catch (error) {
    // Most likely git itself failing — not runnable, or a repository state it
    // refuses to report on. Print a one-line error rather than an unhandled
    // rejection: the guard still fails closed, but the reader needs to know why.
    console.error(pc.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
    return;
  }

  if (result.violations.length > 0) {
    console.error();
    console.error(pc.red(`Sync changed ${result.violations.length} path(s) it does not own:`));
    console.error();
    for (const violation of result.violations) {
      console.error(`  ${pc.red("✗")} ${violation.path} ${pc.dim(`(${violation.change})`)}`);
    }
    console.error();
    console.error(pc.dim("Allowed paths:"));
    for (const pattern of result.patterns) {
      console.error(pc.dim(`  ${pattern}`));
    }
    console.error();
    console.error(
      pc.dim(
        "The list above is everything agconf is allowed to write here, and\n" +
          "nothing widens it. A path outside it means either the canonical\n" +
          "content is writing somewhere it should not, or agconf has a bug.",
      ),
    );
    console.error();
    process.exit(1);
    return;
  }

  if (!options.quiet) {
    console.log();
    if (result.allowed.length === 0) {
      console.log(pc.green("✓ No changes to verify"));
    } else {
      console.log(pc.green(`✓ ${result.allowed.length} changed path(s), all agconf-owned`));
      for (const filePath of result.allowed) {
        console.log(pc.dim(`  ${filePath}`));
      }
    }
    console.log();
  }
}
