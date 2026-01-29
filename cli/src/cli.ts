import { Command } from "commander";
import pc from "picocolors";
import { checkCommand } from "./commands/check.js";
import {
  handleCompletion,
  installCompletion,
  uninstallCompletion,
} from "./commands/completion.js";
import { configGetCommand, configSetCommand, configShowCommand } from "./commands/config.js";
import { initCommand } from "./commands/init.js";
import { initCanonicalRepoCommand } from "./commands/init-canonical-repo.js";
import { statusCommand } from "./commands/status.js";
import { syncCommand } from "./commands/sync.js";
import { updateCommand } from "./commands/update.js";
import { upgradeCliCommand } from "./commands/upgrade-cli.js";
import { checkCliVersionMismatch, getCliVersion } from "./core/lockfile.js";
import { getGitRoot } from "./utils/git.js";

// Handle shell completion requests before anything else
// This must happen synchronously at module load time
if (handleCompletion()) {
  process.exit(0);
}

/**
 * Checks if the installed CLI is outdated compared to the lockfile's source commit.
 * Shows a warning if they don't match.
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
          `⚠ CLI is outdated: built from ${mismatch.cliCommit}, but repo was synced from ${mismatch.lockfileCommit}`,
        ),
      );
      console.log(
        pc.yellow("  Rebuild the CLI: cd <agent-conf-repo>/cli && pnpm build && pnpm link --global"),
      );
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
    .option("-s, --source <repo>", "Canonical repository in owner/repo format (e.g., acme/standards)")
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
    .description("Sync agent-conf standards (skips initial setup prompts)")
    .option("-s, --source <repo>", "Canonical repository in owner/repo format (e.g., acme/standards)")
    .option("--local [path]", "Use local canonical repository (auto-discover or specify path)")
    .option("-y, --yes", "Non-interactive mode (merge by default)")
    .option("--override", "Override existing AGENTS.md instead of merging")
    .option("--ref <ref>", "GitHub ref/version to sync from (default: lockfile version)")
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
    .command("update")
    .description("Check for and apply updates from the canonical repository")
    .option("-y, --yes", "Non-interactive mode")
    .option("-t, --target <targets...>", "Target platforms (claude, codex)", ["claude"])
    .action(
      async (options: {
        yes?: boolean;
        target?: string[];
      }) => {
        await updateCommand(options);
      },
    );

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
    .option("-r, --repo <repo>", "CLI repository in owner/repo format")
    .option("-y, --yes", "Non-interactive mode")
    .action(
      async (options: {
        repo?: string;
        yes?: boolean;
      }) => {
        await upgradeCliCommand(options);
      },
    );

  // Config command with subcommands
  const configCmd = program
    .command("config")
    .description("Manage global CLI configuration");

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

  program
    .command("init-canonical-repo")
    .description("Scaffold a new canonical repository structure")
    .option("-n, --name <name>", "Name for the canonical repository")
    .option("-o, --org <organization>", "Organization name")
    .option("-d, --dir <directory>", "Target directory (default: current)")
    .option("--marker-prefix <prefix>", "Marker prefix (default: agent-conf)")
    .option("--no-examples", "Skip example skill creation")
    .option("-y, --yes", "Non-interactive mode")
    .action(
      async (options: {
        name?: string;
        org?: string;
        dir?: string;
        markerPrefix?: string;
        examples?: boolean;
        yes?: boolean;
      }) => {
        await initCanonicalRepoCommand({
          name: options.name,
          org: options.org,
          dir: options.dir,
          markerPrefix: options.markerPrefix,
          includeExamples: options.examples,
          yes: options.yes,
        });
      },
    );

  // Default command: show help
  program.action(() => {
    program.help();
  });

  return program;
}
