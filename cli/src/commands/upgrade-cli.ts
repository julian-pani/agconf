import { execSync } from "node:child_process";
import * as path from "node:path";
import * as prompts from "@clack/prompts";
import pc from "picocolors";
import { getCliRepository, setCliRepository } from "../core/global-config.js";
import { getCliVersion } from "../core/lockfile.js";
import { compareVersions, getLatestRelease, type ReleaseInfo } from "../core/version.js";
import { createTempDir, removeTempDir } from "../utils/fs.js";
import { createLogger } from "../utils/logger.js";

export interface UpgradeCliOptions {
  repo?: string;
  yes?: boolean;
}

/**
 * Detects available package manager (prefers pnpm)
 */
function getPackageManager(): "pnpm" | "npm" {
  try {
    execSync("pnpm --version", { stdio: "pipe" });
    return "pnpm";
  } catch {
    return "npm";
  }
}

/**
 * Runs a shell command with output
 */
function runCommand(command: string, cwd: string): void {
  execSync(command, { cwd, stdio: "inherit" });
}

export async function upgradeCliCommand(options: UpgradeCliOptions): Promise<void> {
  const logger = createLogger();
  const currentVersion = getCliVersion();

  console.log();
  prompts.intro(pc.bold("agent-conf upgrade-cli"));

  // Determine CLI repository
  let cliRepo = options.repo;

  if (!cliRepo) {
    cliRepo = await getCliRepository();
  }

  if (!cliRepo) {
    logger.error(
      `No CLI repository configured.

Specify the CLI repository using one of these methods:

  1. Use the --repo flag:
     agent-conf upgrade-cli --repo your-org/agent-conf

  2. Set it in your global config (one-time setup):
     agent-conf config set cli-repo your-org/agent-conf

The CLI repository is where the agent-conf CLI tool is hosted,
NOT your canonical repository.`,
    );
    process.exit(1);
  }

  // Save CLI repo to config if provided via flag
  if (options.repo) {
    await setCliRepository(options.repo);
    logger.info(`Saved CLI repository to config: ${options.repo}`);
  }

  // Check for updates
  const spinner = logger.spinner("Checking for CLI updates...");
  spinner.start();

  let latestRelease: ReleaseInfo;
  try {
    latestRelease = await getLatestRelease(cliRepo);
    spinner.stop();
  } catch (error) {
    spinner.fail("Failed to check for CLI updates");
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Display version info
  console.log();
  console.log(`Current CLI version: ${pc.cyan(currentVersion)}`);
  console.log(`Latest CLI release: ${pc.cyan(latestRelease.tag)}`);
  console.log(`CLI repository: ${pc.dim(cliRepo)}`);

  // Check if update is needed
  const needsUpdate = compareVersions(currentVersion, latestRelease.version) < 0;

  if (!needsUpdate) {
    console.log();
    prompts.outro(pc.green("CLI is already up to date!"));
    return;
  }

  console.log();
  console.log(`${pc.yellow("→")} Update available: ${currentVersion} → ${latestRelease.version}`);
  console.log();

  // Confirm update
  if (!options.yes) {
    const shouldUpdate = await prompts.confirm({
      message: "Proceed with CLI upgrade?",
      initialValue: true,
    });

    if (prompts.isCancel(shouldUpdate) || !shouldUpdate) {
      prompts.cancel("Upgrade cancelled");
      process.exit(0);
    }
  }

  // Perform upgrade
  const pm = getPackageManager();
  let tempDir: string | null = null;

  try {
    // Clone repository
    const cloneSpinner = logger.spinner(`Cloning ${cliRepo}@${latestRelease.tag}...`);
    cloneSpinner.start();

    tempDir = await createTempDir("agent-conf-upgrade-");
    const repoUrl = `https://github.com/${cliRepo}.git`;

    runCommand(`git clone --depth 1 --branch ${latestRelease.tag} ${repoUrl} .`, tempDir);
    cloneSpinner.succeed("Repository cloned");

    // Install dependencies
    const cliDir = path.join(tempDir, "cli");
    const installSpinner = logger.spinner("Installing dependencies...");
    installSpinner.start();

    if (pm === "pnpm") {
      runCommand("pnpm install --frozen-lockfile", cliDir);
    } else {
      runCommand("npm ci", cliDir);
    }
    installSpinner.succeed("Dependencies installed");

    // Build
    const buildSpinner = logger.spinner("Building CLI...");
    buildSpinner.start();
    runCommand(`${pm} run build`, cliDir);
    buildSpinner.succeed("Build complete");

    // Pack and install globally
    const installGlobalSpinner = logger.spinner("Installing globally...");
    installGlobalSpinner.start();

    // Use npm pack to create tarball, then install globally
    const packOutput = execSync("npm pack --pack-destination /tmp", {
      cwd: cliDir,
      encoding: "utf-8",
    }).trim();
    const tarballPath = `/tmp/${packOutput}`;

    runCommand(`npm install -g "${tarballPath}"`, cliDir);

    // Clean up tarball
    execSync(`rm -f "${tarballPath}"`, { stdio: "pipe" });

    installGlobalSpinner.succeed("Installed globally");

    console.log();
    prompts.outro(pc.green(`CLI upgraded to ${latestRelease.version}!`));
  } catch (error) {
    logger.error("Upgrade failed");
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    // Clean up temp directory
    if (tempDir) {
      await removeTempDir(tempDir);
    }
  }
}
