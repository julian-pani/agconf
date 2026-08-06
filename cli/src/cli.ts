import { Command } from "commander";
import pc from "picocolors";
import { canonicalInitCommand } from "./commands/canonical.js";
import { checkCommand } from "./commands/check.js";
import { compileCommand } from "./commands/compile.js";
import { handleCompletion, installCompletion, uninstallCompletion } from "./commands/completion.js";
import { configGetCommand, configSetCommand, configShowCommand } from "./commands/config.js";
import { initCommand } from "./commands/init.js";
import { proposeCommand } from "./commands/propose.js";
import { sessionCheckCommand } from "./commands/session-check.js";
import { syncCommand } from "./commands/sync.js";
import { upgradeCliCommand } from "./commands/upgrade-cli.js";
import { checkCliVersionMismatch, getCliVersion } from "./core/lockfile.js";
import { getGitRoot } from "./utils/git.js";

// Handle shell completion requests before anything else
// This must happen synchronously at module load time
if (handleCompletion()) {
  process.exit(0);
}

/**
 * Checks if the installed CLI is outdated compared to the version used in the last sync.
 * Shows a warning if the lockfile was created with a newer CLI version.
 */
async function warnIfCliOutdated(): Promise<void> {
  try {
    const cwd = process.cwd();
    const gitRoot = await getGitRoot(cwd);
    if (!gitRoot) return;

    const mismatch = await checkCliVersionMismatch(gitRoot);
    if (mismatch) {
      console.log();
      console.log(
        pc.yellow(
          `⚠ CLI is outdated: v${mismatch.currentVersion} installed, but repo was synced with v${mismatch.lockfileVersion}`,
        ),
      );
      console.log(pc.yellow("  Run: agconf upgrade-cli"));
      console.log();
    }
  } catch {
    // Silently ignore errors - this is a best-effort check
  }
}

export function createCli(): Command {
  const program = new Command();

  program
    .name("agconf")
    .description("Sync company engineering standards from canonical repository")
    .version(getCliVersion())
    .hook("preAction", async () => {
      await warnIfCliOutdated();
    });

  program
    .command("init")
    .description("Initialize or sync agconf standards to the current repository")
    .option(
      "-s, --source <repo>",
      "Canonical repository in owner/repo format (e.g., acme/standards)",
    )
    .option("--local [path]", "Use local canonical repository (auto-discover or specify path)")
    .option("-y, --yes", "Non-interactive mode (merge by default)")
    .option(
      "--override",
      "Let canonical win over local content (replace AGENTS.md instead of merging; overwrite divergent unmanaged skills/rules/agents)",
    )
    .option("--ref <ref>", "GitHub ref/version to sync from (default: latest release)")
    .option("-t, --target <targets...>", "Target platforms (claude, codex)", ["claude"])
    .action(
      async (options: {
        source?: string;
        local?: string | boolean;
        yes?: boolean;
        override?: boolean;
        ref?: string;
        target?: string[];
      }) => {
        await initCommand(options);
      },
    );

  program
    .command("sync")
    .description("Sync content from canonical repository (fetches latest by default)")
    .option(
      "-s, --source <repo>",
      "Canonical repository in owner/repo format (e.g., acme/standards)",
    )
    .option("--local [path]", "Use local canonical repository (auto-discover or specify path)")
    .option("-y, --yes", "Non-interactive mode (merge by default)")
    .option(
      "--override",
      "Let canonical win over local content (replace AGENTS.md instead of merging; overwrite divergent unmanaged skills/rules/agents)",
    )
    .option("--ref <ref>", "GitHub ref/version to sync from")
    .option("--pinned", "Use lockfile version without fetching latest")
    .option("-t, --target <targets...>", "Target platforms (claude, codex)")
    .option("--summary-file <path>", "Write sync summary to file (markdown, for CI)")
    .option("--expand-changes", "Show all items in output (default: first 5)")
    .option(
      "--scope <scope>",
      "Distribution scope: 'repo' (default) or 'user' (project into ~/.claude, ~/.codex via the ~/.agconf store)",
    )
    .action(
      async (options: {
        source?: string;
        local?: string | boolean;
        yes?: boolean;
        override?: boolean;
        ref?: string;
        pinned?: boolean;
        target?: string[];
        summaryFile?: string;
        expandChanges?: boolean;
        scope?: string;
      }) => {
        await syncCommand(options);
      },
    );

  program
    .command("check")
    .description("Check if managed files have been modified")
    .option("-q, --quiet", "Minimal output, just exit code")
    .option("--debug", "Show detailed debug information for hash computation")
    .option(
      "--hook",
      "Pre-commit mode: branch-aware exit (block on master/main, warn on feature branches)",
    )
    .option("--scope <scope>", "Check scope: 'repo' (default) or 'user' (~/.claude, ~/.codex)")
    .action(
      async (options: { quiet?: boolean; debug?: boolean; hook?: boolean; scope?: string }) => {
        await checkCommand(options);
      },
    );

  program
    .command("session-check")
    .description(
      "Advisory cross-scope duplication + user-scope integrity check (for a SessionStart hook)",
    )
    .option(
      "--install-hook",
      "Install this as a Claude Code SessionStart hook in ~/.claude/settings.json",
    )
    .option("-q, --quiet", "Minimal output")
    .action(async (options: { installHook?: boolean; quiet?: boolean }) => {
      await sessionCheckCommand(options);
    });

  program
    .command("compile")
    .description(
      "Compile installable plugins + marketplace from canonical content (canonical repos)",
    )
    .option("--check", "Verify committed artifacts match source; exit 1 if stale (CI gate)")
    .option(
      "--bump [level]",
      "Bump version of plugins whose content changed, then compile (auto|patch|minor|major)",
    )
    .option("-t, --target <targets...>", "Targets to compile (claude, codex)")
    .option("-o, --out <dir>", "Output directory (overrides plugins.output_dir)")
    .option("-q, --quiet", "Minimal output, just exit code")
    .action(
      async (options: {
        check?: boolean;
        bump?: string | boolean;
        target?: string[];
        out?: string;
        quiet?: boolean;
      }) => {
        await compileCommand(options);
      },
    );

  program
    .command("propose")
    .description("Propose local changes to managed content back to canonical repository")
    .option("-n, --dry-run", "Show what would be proposed without creating anything")
    .option("-t, --title <title>", "Proposal title (used for branch, commit, and PR)")
    .option("-m, --message <message>", "Message to include in the PR description")
    .option("--files <patterns...>", "Only propose files matching regex patterns (relative paths)")
    .option(
      "--new [path]",
      "Propose new (unmanaged) skills/rules/agents; optionally restrict to a path",
    )
    .option("-y, --yes", "Non-interactive mode")
    .action(
      async (options: {
        dryRun?: boolean;
        title?: string;
        message?: string;
        files?: string[];
        new?: string | boolean;
        yes?: boolean;
      }) => {
        await proposeCommand(options);
      },
    );

  program
    .command("upgrade-cli")
    .description("Upgrade the agconf CLI to the latest version")
    .option("-y, --yes", "Non-interactive mode")
    .option("-p, --package-manager <pm>", "Package manager to use (npm, pnpm, yarn, bun)")
    .action(async (options: { yes?: boolean; packageManager?: string }) => {
      await upgradeCliCommand(options);
    });

  // Config command with subcommands
  const configCmd = program.command("config").description("Manage global CLI configuration");

  configCmd
    .command("show")
    .description("Show all configuration values")
    .action(async () => {
      await configShowCommand();
    });

  configCmd
    .command("get <key>")
    .description("Get a configuration value")
    .action(async (key: string) => {
      await configGetCommand(key);
    });

  configCmd
    .command("set <key> <value>")
    .description("Set a configuration value")
    .action(async (key: string, value: string) => {
      await configSetCommand(key, value);
    });

  // Default for config command: show config
  configCmd.action(async () => {
    await configShowCommand();
  });

  // Completion command with subcommands
  const completionCmd = program
    .command("completion")
    .description("Manage shell completions (bash, zsh, fish)");

  completionCmd
    .command("install")
    .description("Install shell completions for your current shell")
    .action(async () => {
      await installCompletion();
    });

  completionCmd
    .command("uninstall")
    .description("Remove shell completions")
    .action(async () => {
      await uninstallCompletion();
    });

  // Default for completion command: install
  completionCmd.action(async () => {
    await installCompletion();
  });

  // Canonical command group
  const canonicalCmd = program.command("canonical").description("Manage canonical repositories");

  canonicalCmd
    .command("init")
    .description("Scaffold a new canonical repository structure")
    .option("-n, --name <name>", "Name for the canonical repository")
    .option("-o, --org <organization>", "Organization name")
    .option("-d, --dir <directory>", "Target directory (default: current)")
    .option("--marker-prefix <prefix>", "Marker prefix (default: agconf)")
    .option("--no-examples", "Skip example skill creation")
    .option("--rules-dir <directory>", "Rules directory (e.g., 'rules')")
    .option("--no-plugins", "Skip plugin compilation scaffolding (config, CI, initial compile)")
    .option("-y, --yes", "Non-interactive mode")
    .action(
      async (options: {
        name?: string;
        org?: string;
        dir?: string;
        markerPrefix?: string;
        examples?: boolean;
        rulesDir?: string;
        plugins?: boolean;
        yes?: boolean;
      }) => {
        await canonicalInitCommand({
          name: options.name,
          org: options.org,
          dir: options.dir,
          markerPrefix: options.markerPrefix,
          includeExamples: options.examples,
          rulesDir: options.rulesDir,
          includePlugins: options.plugins,
          yes: options.yes,
        });
      },
    );

  // Default for canonical command: show help
  canonicalCmd.action(() => {
    canonicalCmd.help();
  });

  // Default command: show help
  program.action(() => {
    program.help();
  });

  return program;
}
