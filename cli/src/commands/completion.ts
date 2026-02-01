import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as prompts from "@clack/prompts";
import pc from "picocolors";
import tabtab from "tabtab";
// @ts-expect-error - tabtab internal module not typed
import tabtabInstaller from "tabtab/lib/installer.js";

const CLI_NAME = "agent-conf";

// Commands and their options for completion
const COMMANDS = {
  init: {
    description: "Initialize or sync agent-conf standards",
    options: ["-s", "--source", "--local", "-y", "--yes", "--override", "--ref", "-t", "--target"],
  },
  sync: {
    description: "Sync agent-conf standards",
    options: ["-s", "--source", "--local", "-y", "--yes", "--override", "--ref", "-t", "--target"],
  },
  status: {
    description: "Show current sync status",
    options: ["-c", "--check"],
  },
  update: {
    description: "Check for and apply updates",
    options: ["-y", "--yes", "-t", "--target"],
  },
  check: {
    description: "Check if managed files have been modified",
    options: ["-q", "--quiet"],
  },
  config: {
    description: "Manage global CLI configuration",
    options: [],
  },
  "upgrade-cli": {
    description: "Upgrade the CLI to latest version",
    options: ["-y", "--yes"],
  },
  canonical: {
    description: "Manage canonical repositories",
    options: [],
    subcommands: {
      init: {
        description: "Scaffold a new canonical repository",
        options: [
          "-n",
          "--name",
          "-o",
          "--org",
          "-d",
          "--dir",
          "--marker-prefix",
          "--cli-version",
          "--no-examples",
          "-y",
          "--yes",
        ],
      },
      update: {
        description: "Update CLI version in workflow files",
        options: ["--cli-version", "-y", "--yes"],
      },
    },
  },
  completion: {
    description: "Manage shell completions",
    options: [],
  },
};

const CONFIG_SUBCOMMANDS = ["show", "get", "set"];
const COMPLETION_SUBCOMMANDS = ["install", "uninstall"];
const CANONICAL_SUBCOMMANDS = ["init", "update"];
const TARGET_VALUES = ["claude", "codex"];

/**
 * Handle shell completion requests.
 * This should be called early in the CLI lifecycle.
 * Returns true if this was a completion request (and it was handled).
 */
export function handleCompletion(): boolean {
  const env = tabtab.parseEnv(process.env);

  if (!env.complete) {
    return false;
  }

  // Determine what to complete based on context
  const { prev, words } = env;

  // Complete command names
  if (prev === CLI_NAME || words === 1) {
    tabtab.log(
      Object.entries(COMMANDS).map(([name, info]) => ({
        name,
        description: info.description,
      })),
    );
    return true;
  }

  // Find which command we're completing for
  const commandIndex = 1; // words[0] is the CLI name
  const currentCommand = env.line.split(/\s+/)[commandIndex];

  // Complete subcommands for 'config'
  if (currentCommand === "config" && words === 2) {
    tabtab.log(
      CONFIG_SUBCOMMANDS.map((name) => ({
        name,
        description: `${name} configuration`,
      })),
    );
    return true;
  }

  // Complete subcommands for 'completion'
  if (currentCommand === "completion" && words === 2) {
    tabtab.log(
      COMPLETION_SUBCOMMANDS.map((name) => ({
        name,
        description: `${name} shell completions`,
      })),
    );
    return true;
  }

  // Complete subcommands for 'canonical'
  if (currentCommand === "canonical" && words === 2) {
    tabtab.log(
      CANONICAL_SUBCOMMANDS.map((name) => ({
        name,
        description:
          name === "init"
            ? "Scaffold a new canonical repository"
            : "Update CLI version in workflows",
      })),
    );
    return true;
  }

  // Complete options for 'canonical' subcommands
  if (currentCommand === "canonical" && words >= 3) {
    const subcommand = env.line.split(/\s+/)[2];
    const canonicalCmd = COMMANDS.canonical as {
      subcommands: Record<string, { options: string[] }>;
    };
    if (subcommand && subcommand in canonicalCmd.subcommands) {
      const subcommandConfig = canonicalCmd.subcommands[subcommand];
      if (subcommandConfig) {
        tabtab.log(subcommandConfig.options);
        return true;
      }
    }
  }

  // Complete --target values
  if (prev === "--target" || prev === "-t") {
    tabtab.log(TARGET_VALUES);
    return true;
  }

  // Complete options for the current command
  if (currentCommand && currentCommand in COMMANDS) {
    const command = COMMANDS[currentCommand as keyof typeof COMMANDS];
    tabtab.log(command.options);
    return true;
  }

  // Default: complete command names
  tabtab.log(Object.keys(COMMANDS));
  return true;
}

/**
 * Get the tabtab completion script path for this CLI.
 * tabtab stores completions in ~/.config/tabtab/<name>.<shell>
 */
function getTabtabCompletionFile(shell: string): string {
  const home = os.homedir();
  const ext = shell === "fish" ? "fish" : shell === "zsh" ? "zsh" : "bash";
  return path.join(home, ".config", "tabtab", `${CLI_NAME}.${ext}`);
}

/**
 * Check if shell completions are already installed for the current shell.
 */
export function isCompletionInstalled(): boolean {
  const shell = detectShell();
  if (!shell) return false;

  // Check if the tabtab completion file exists for this CLI
  const completionFile = getTabtabCompletionFile(shell);
  if (fs.existsSync(completionFile)) {
    return true;
  }

  // Fallback: check if the shell config mentions this CLI's completions
  const configFile = getShellConfigFile(shell);
  if (!configFile || !fs.existsSync(configFile)) return false;

  try {
    const content = fs.readFileSync(configFile, "utf-8");
    return (
      content.includes(`tabtab source for ${CLI_NAME}`) || content.includes(`begin ${CLI_NAME}`)
    );
  } catch {
    return false;
  }
}

/**
 * Detect shell from $SHELL environment variable.
 * Uses the same detection method as tabtab for consistency.
 * Exported for testing.
 */
export function detectShell(): string | null {
  const shell = process.env.SHELL || "";
  if (shell.includes("fish")) return "fish";
  if (shell.includes("zsh")) return "zsh";
  if (shell.includes("bash")) return "bash";
  return null;
}

/** Get the config file path for a given shell. Exported for testing. */
export function getShellConfigFile(shell: string): string | null {
  const home = os.homedir();
  switch (shell) {
    case "zsh":
      return path.join(home, ".zshrc");
    case "bash": {
      // Check for .bash_profile first (macOS), then .bashrc
      const bashProfile = path.join(home, ".bash_profile");
      if (fs.existsSync(bashProfile)) return bashProfile;
      return path.join(home, ".bashrc");
    }
    case "fish":
      return path.join(home, ".config", "fish", "config.fish");
    default:
      return null;
  }
}

/**
 * Install shell completions directly without prompting for shell.
 * Uses the detected shell from $SHELL environment variable.
 */
async function installCompletionForShell(shell: string): Promise<void> {
  const location = getShellConfigFile(shell);
  if (!location) {
    throw new Error(`Unsupported shell: ${shell}`);
  }

  await tabtabInstaller.install({
    name: CLI_NAME,
    completer: CLI_NAME,
    location,
  });
}

/**
 * Install shell completions.
 */
export async function installCompletion(): Promise<void> {
  console.log();
  prompts.intro(pc.bold("Installing shell completions"));

  const shell = detectShell();
  if (!shell) {
    prompts.log.warn("Could not detect shell. Supported shells: bash, zsh, fish");
    prompts.outro("Completions not installed");
    return;
  }

  prompts.log.info(`Detected shell: ${pc.cyan(shell)}`);

  if (isCompletionInstalled()) {
    prompts.log.success("Shell completions are already installed");
    prompts.outro("Nothing to do");
    return;
  }

  try {
    await installCompletionForShell(shell);

    prompts.log.success(`Completions installed for ${pc.cyan(shell)}`);
    prompts.log.info(
      `Restart your shell or run: ${pc.cyan(`source ${getShellConfigFile(shell)}`)}`,
    );
    prompts.outro("Done!");
  } catch (error) {
    prompts.log.error(`Failed to install completions: ${error}`);
    prompts.outro("Installation failed");
    process.exit(1);
  }
}

/**
 * Uninstall shell completions.
 */
export async function uninstallCompletion(): Promise<void> {
  console.log();
  prompts.intro(pc.bold("Uninstalling shell completions"));

  try {
    await tabtab.uninstall({
      name: CLI_NAME,
    });

    prompts.log.success("Shell completions uninstalled");
    prompts.outro("Done!");
  } catch (error) {
    prompts.log.error(`Failed to uninstall completions: ${error}`);
    prompts.outro("Uninstallation failed");
    process.exit(1);
  }
}

/**
 * Prompt user to install completions if not already installed.
 * Used during 'init' command.
 * Returns true if completions were installed.
 */
export async function promptCompletionInstall(): Promise<boolean> {
  if (isCompletionInstalled()) {
    return false;
  }

  const shell = detectShell();
  if (!shell) {
    // Don't prompt if we can't detect the shell
    return false;
  }

  const shouldInstall = await prompts.confirm({
    message: `Install shell completions for ${shell}?`,
  });

  if (prompts.isCancel(shouldInstall) || !shouldInstall) {
    prompts.log.info(`You can install later with: ${pc.cyan("agent-conf completion install")}`);
    return false;
  }

  try {
    await installCompletionForShell(shell);

    prompts.log.success(`Completions installed for ${pc.cyan(shell)}`);
    prompts.log.info(
      `Restart your shell or run: ${pc.cyan(`source ${getShellConfigFile(shell)}`)}`,
    );
    return true;
  } catch (error) {
    prompts.log.warn(`Could not install completions: ${error}`);
    prompts.log.info(`You can try again with: ${pc.cyan("agent-conf completion install")}`);
    return false;
  }
}
