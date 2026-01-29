import * as path from "node:path";
import pc from "picocolors";
import { checkAllManagedFiles } from "../core/skill-metadata.js";
import { formatSourceString } from "../core/source.js";
import { getSyncStatus } from "../core/sync.js";
import { formatPath } from "../utils/logger.js";

export interface StatusOptions {
  check?: boolean;
}

export async function statusCommand(options: StatusOptions = {}): Promise<void> {
  const targetDir = process.cwd();
  const status = await getSyncStatus(targetDir);

  console.log();
  console.log(pc.bold("agent-conf sync status"));
  console.log();

  if (!status.hasSynced) {
    console.log(pc.yellow("Not synced"));
    console.log();
    console.log(pc.dim("Run `agent-conf init` to sync engineering standards to this repository."));
    console.log();
    return;
  }

  const lockfile = status.lockfile!;

  console.log(`${pc.green("Synced")}`);
  console.log();

  // Source info
  console.log(pc.bold("Source:"));
  console.log(`  ${formatSourceString(lockfile.source)}`);
  console.log();

  // Sync timestamp
  console.log(pc.bold("Last synced:"));
  const syncedAt = new Date(lockfile.synced_at);
  console.log(`  ${syncedAt.toLocaleString()}`);
  console.log();

  // Content
  console.log(pc.bold("Content:"));
  console.log(`  AGENTS.md: ${status.agentsMdExists ? pc.green("present") : pc.red("missing")}`);
  console.log(`  Skills: ${lockfile.content.skills.length} synced`);
  if (lockfile.content.skills.length > 0) {
    for (const skill of lockfile.content.skills) {
      console.log(`    - ${skill}`);
    }
  }
  console.log();

  // Check for modified files if --check flag is provided
  if (options.check) {
    const targets = lockfile.content.targets ?? ["claude"];
    const allFiles = await checkAllManagedFiles(targetDir, targets);
    const modifiedFiles = allFiles.filter((f) => f.hasChanges);

    console.log(pc.bold("File integrity:"));
    if (modifiedFiles.length === 0) {
      console.log(`  ${pc.green("✓")} All managed files are unchanged`);
    } else {
      console.log(`  ${pc.yellow("!")} ${modifiedFiles.length} file(s) manually modified:`);
      for (const file of modifiedFiles) {
        const label = file.type === "agents" ? "(global block)" : "";
        console.log(`    ${pc.yellow("~")} ${file.path} ${pc.dim(label)}`);
      }
      console.log();
      console.log(pc.dim("  These files will be overwritten on next sync. To preserve changes,"));
      console.log(pc.dim("  copy them elsewhere before running `agent-conf sync`."));
    }
    console.log();
  }

  // Lockfile location
  const lockfilePath = formatPath(path.join(targetDir, ".agent-conf", "agent-conf.lock"));
  console.log(pc.dim(`Lock file: ${lockfilePath}`));
  console.log(pc.dim(`CLI version: ${lockfile.cli_version}`));
  console.log();
}
