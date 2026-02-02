import { Command } from "commander";
import pc from "picocolors";
import { canonicalInitCommand } from "./commands/canonical.js";
import { checkCommand } from "./commands/check.js";
import { handleCompletion, installCompletion, uninstallCompletion } from "./commands/completion.js";
import { configGetCommand, configSetCommand, configShowCommand } from "./commands/config.js";
import { initCommand } from "./commands/init.js";
import { statusCommand } from "./commands/status.js";
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
      console.log(pc.yellow("  Run: agent-conf upgrade-cli"));
      console.log();
    }
  } catch {
    // Silently ignore errors - this is a best-effort check
  }
}

export function createCli(): Command {
  const program = new Command();

  program
    .name("agent-conf")
    .description("Sync company engineering standards from agent-conf repository")
    .version(getCliVersion())
    .hook("preAction", async () => {
      await warnIfCliOutdated();
    });

  program
    .command("init")
    .description("Initialize or sync agent-conf standards to the current repository")
    .option(
      "-s, --source <repo>",
      "Canonical repository in owner/repo format (e.g., acme/standards)",
    )
    .option("--local [path]", "Use local canonical repository (auto-discover or specify path)")
    .option("-y, --yes", "Non-interactive mode (merge by default)")
    .option("--override", "Override existing AGENTS.md instead of merging")
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
    .option("--override", "Override existing AGENTS.md instead of merging")
    .option("--ref <ref>", "GitHub ref/version to sync from")
    .option("--pinned", "Use lockfile version without fetching latest")
    .option("-t, --target <targets...>", "Target platforms (claude, codex)")
    .option("--summary-file <path>", "Write sync summary to file (markdown, for CI)")
    .option("--expand-changes", "Show all items in output (default: first 5)")
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
      }) => {
        await syncCommand(options);
      },
    );

  program
    .command("status")
    .description("Show current sync status")
    .option("-c, --check", "Check for manually modified skill files")
    .action(async (options: { check?: boolean }) => {
      await statusCommand(options);
    });

  program
    .command("check")
    .description("Check if managed files have been modified")
    .option("-q, --quiet", "Minimal output, just exit code")
    .action(async (options: { quiet?: boolean }) => {
      await checkCommand(options);
    });

  program
    .command("upgrade-cli")
    .description("Upgrade the agent-conf CLI to the latest version")
    .option("-y, --yes", "Non-interactive mode")
    .action(async (options: { yes?: boolean }) => {
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
    .option("--marker-prefix <prefix>", "Marker prefix (default: agent-conf)")
    .option("--no-examples", "Skip example skill creation")
    .option("--rules-dir <directory>", "Rules directory (e.g., 'rules')")
    .option("-y, --yes", "Non-interactive mode")
    .action(
      async (options: {
        name?: string;
        org?: string;
        dir?: string;
        markerPrefix?: string;
        examples?: boolean;
        rulesDir?: string;
        yes?: boolean;
      }) => {
        await canonicalInitCommand({
          name: options.name,
          org: options.org,
          dir: options.dir,
          markerPrefix: options.markerPrefix,
          includeExamples: options.examples,
          rulesDir: options.rulesDir,
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
