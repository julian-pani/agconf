import { execSync } from "node:child_process";
import * as prompts from "@clack/prompts";
import pc from "picocolors";
import { getCliVersion } from "../core/lockfile.js";
import { compareVersions } from "../core/version.js";
import { createLogger } from "../utils/logger.js";
import {
  buildInstallCommand,
  detectPackageManager,
  isPackageManager,
  PACKAGE_MANAGERS,
  TOOL_MANAGERS,
} from "../utils/package-manager.js";

const NPM_PACKAGE_NAME = "agconf";

export interface UpgradeCliOptions {
  yes?: boolean;
  packageManager?: string;
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
  prompts.intro(pc.bold("agconf upgrade-cli"));

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

  // Detect package manager
  const override = options.packageManager;
  if (override !== undefined && !isPackageManager(override)) {
    logger.error(`Invalid package manager: ${override}`);
    logger.info(`Valid options: ${PACKAGE_MANAGERS.join(", ")}`);
    if ((TOOL_MANAGERS as readonly string[]).includes(override)) {
      logger.info(
        `${override} is detected automatically and its shims are rebuilt after the install — pass the underlying installer instead.`,
      );
    }
    process.exit(1);
  }
  const pm = detectPackageManager(NPM_PACKAGE_NAME, override ? { override } : {});

  console.log(`Package manager: ${pc.cyan(pm.name)} (${pm.detectedVia})`);
  if (pm.toolManager && pm.toolManager !== pm.name) {
    // Only `volta install` sticks under volta, so an override that installs
    // some other way may not take effect at all.
    const voltaNote =
      pm.toolManager === "volta" ? pc.dim(" (upgrades only stick via volta install)") : "";
    console.log(`Tool manager:    ${pc.cyan(pm.toolManager)}${voltaNote}`);
  }

  // Name every command up front: these are the commands the upgrade runs.
  console.log(`Will run:        ${pc.cyan(pm.installCommand)}`);
  if (pm.postInstallCommand) {
    console.log(`                 ${pc.cyan(pm.postInstallCommand)}`);
  }
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
    execSync(pm.installCommand, {
      stdio: "pipe",
    });
    installSpinner.succeed("CLI upgraded");
  } catch (error) {
    installSpinner.fail("Upgrade failed");
    logger.error(error instanceof Error ? error.message : String(error));
    logger.info(`\nYou can try manually: ${pm.installCommand}`);
    if (!override) {
      const otherPms = PACKAGE_MANAGERS.filter((p) => p !== pm.name);
      logger.info(
        `If ${pm.name} is not your package manager, try: agconf upgrade-cli --package-manager <${otherPms.join("|")}>`,
      );
    }
    process.exit(1);
  }

  // Rebuild the tool manager's shims so the new binary is the one on $PATH.
  let reshimFailed = false;
  if (pm.postInstallCommand) {
    const reshimSpinner = logger.spinner(`Rebuilding ${pm.toolManager} shims...`);
    reshimSpinner.start();
    try {
      execSync(pm.postInstallCommand, { stdio: "pipe" });
      reshimSpinner.succeed(`${pm.toolManager} shims rebuilt`);
    } catch (error) {
      reshimFailed = true;
      reshimSpinner.fail(`Failed to rebuild ${pm.toolManager} shims`);
      logger.warn(error instanceof Error ? error.message : String(error));
      logger.info(`You can try manually: ${pc.cyan(pm.postInstallCommand)}`);
    }
  }

  // Post-install verification: confirm the binary in $PATH is actually updated
  let installedVersion: string | null = null;
  try {
    installedVersion = execSync("agconf --version", { encoding: "utf-8", stdio: "pipe" }).trim();
  } catch {
    // If we can't run agconf --version, skip verification
  }

  if (installedVersion && installedVersion !== latestVersion) {
    console.log();
    logger.warn(
      `Version mismatch: installed ${latestVersion} but the agconf binary in $PATH is still ${installedVersion}`,
    );

    // Point at whatever is left to do, never at a step that already ran and
    // did not help.
    if (pm.postInstallCommand && reshimFailed) {
      logger.info(
        `Rebuild the ${pm.toolManager} shims, then re-check: ${pc.cyan(pm.postInstallCommand)}`,
      );
    } else if (pm.name === "volta" || pm.postInstallCommand) {
      // `--package-manager volta` can select volta as the installer without any
      // shim being detected, so name the step by whichever of the two applies.
      const step = pm.toolManager ?? pm.name;
      logger.info(
        `The ${step} step already ran. Either another agconf is earlier in $PATH (check: ${pc.cyan("which -a agconf")}), or the install landed under a different Node version than the active one.`,
      );
    } else if (pm.toolManager === "volta") {
      logger.info(
        `Volta detected. Run: ${pc.cyan(buildInstallCommand("volta", NPM_PACKAGE_NAME))}`,
      );
    } else {
      logger.info(
        `Another agconf may be earlier in $PATH, or installed under a different global prefix. Check with: ${pc.cyan("which -a agconf")}`,
      );
    }

    console.log();
    prompts.outro(pc.yellow("Upgrade installed but not active in $PATH"));
  } else if (reshimFailed) {
    console.log();
    prompts.outro(
      pc.yellow(
        `CLI upgraded to ${latestVersion}, but the ${pm.toolManager} shim rebuild failed — run \`${pm.postInstallCommand}\` if the old version persists`,
      ),
    );
  } else {
    console.log();
    prompts.outro(pc.green(`CLI upgraded to ${latestVersion}!`));
  }
}
