import { execSync } from "node:child_process";
import * as prompts from "@clack/prompts";
import pc from "picocolors";
import { getCliVersion } from "../core/lockfile.js";
import { compareVersions } from "../core/version.js";
import { createLogger } from "../utils/logger.js";

const NPM_PACKAGE_NAME = "agconf";

export interface UpgradeCliOptions {
  yes?: boolean;
}

/**
 * Fetches the latest version from the npm registry.
 */
async function getLatestNpmVersion(): Promise<string> {
  const response = await fetch(`https://registry.npmjs.org/${NPM_PACKAGE_NAME}/latest`);

  if (!response.ok) {
    throw new Error(`Failed to fetch package info: ${response.statusText}`);
  }

  const data = (await response.json()) as { version: string };
  return data.version;
}

export async function upgradeCliCommand(options: UpgradeCliOptions): Promise<void> {
  const logger = createLogger();
  const currentVersion = getCliVersion();

  console.log();
  prompts.intro(pc.bold("agent-conf upgrade-cli"));

  // Check for updates
  const spinner = logger.spinner("Checking for CLI updates...");
  spinner.start();

  let latestVersion: string;
  try {
    latestVersion = await getLatestNpmVersion();
    spinner.stop();
  } catch (error) {
    spinner.fail("Failed to check for CLI updates");
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Display version info
  console.log();
  console.log(`Current version: ${pc.cyan(currentVersion)}`);
  console.log(`Latest version:  ${pc.cyan(latestVersion)}`);

  // Check if update is needed
  const needsUpdate = compareVersions(currentVersion, latestVersion) < 0;

  if (!needsUpdate) {
    console.log();
    prompts.outro(pc.green("CLI is already up to date!"));
    return;
  }

  console.log();
  console.log(`${pc.yellow("→")} Update available: ${currentVersion} → ${latestVersion}`);
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
  const installSpinner = logger.spinner("Upgrading CLI...");
  installSpinner.start();

  try {
    execSync(`npm install -g ${NPM_PACKAGE_NAME}@latest`, {
      stdio: "pipe",
    });
    installSpinner.succeed("CLI upgraded");

    console.log();
    prompts.outro(pc.green(`CLI upgraded to ${latestVersion}!`));
  } catch (error) {
    installSpinner.fail("Upgrade failed");
    logger.error(error instanceof Error ? error.message : String(error));
    logger.info(`\nYou can try manually: npm install -g ${NPM_PACKAGE_NAME}@latest`);
    process.exit(1);
  }
}
