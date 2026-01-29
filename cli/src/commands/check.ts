import * as fs from "node:fs/promises";
import * as path from "node:path";
import pc from "picocolors";
import { readLockfile } from "../core/lockfile.js";
import {
  computeGlobalBlockHash,
  parseAgentsMd,
  parseGlobalBlockMetadata,
  stripMetadataComments,
} from "../core/markers.js";
import {
  checkAllManagedFiles,
  computeContentHash,
  parseFrontmatter,
} from "../core/skill-metadata.js";

export interface CheckOptions {
  quiet?: boolean;
}

export interface CheckResult {
  synced: boolean;
  modifiedFiles: ModifiedFileInfo[];
}

export interface ModifiedFileInfo {
  path: string;
  type: "skill" | "agents";
  expectedHash: string;
  currentHash: string;
}

/**
 * Check if managed files have been modified.
 * Exits with code 0 if all files are unchanged, code 1 if changes detected.
 */
export async function checkCommand(options: CheckOptions = {}): Promise<void> {
  const targetDir = process.cwd();

  // Check if synced (lockfile exists)
  const lockfile = await readLockfile(targetDir);

  if (!lockfile) {
    if (!options.quiet) {
      console.log();
      console.log(pc.yellow("Not synced"));
      console.log();
      console.log(pc.dim("This repository has not been synced with agent-conf."));
      console.log(pc.dim("Run `agent-conf init` to sync engineering standards."));
      console.log();
    }
    // Exit 0 - not synced is not an error for the check command
    return;
  }

  const targets = lockfile.content.targets ?? ["claude"];
  const modifiedFiles: ModifiedFileInfo[] = [];

  // Check all managed files
  const allFiles = await checkAllManagedFiles(targetDir, targets);

  // Gather detailed info for modified files
  for (const file of allFiles) {
    if (!file.hasChanges) continue;

    if (file.type === "agents") {
      // Get hash info for AGENTS.md
      const agentsMdPath = path.join(targetDir, "AGENTS.md");
      const content = await fs.readFile(agentsMdPath, "utf-8");
      const parsed = parseAgentsMd(content);

      if (parsed.globalBlock) {
        const metadata = parseGlobalBlockMetadata(parsed.globalBlock);
        const contentWithoutMeta = stripMetadataComments(parsed.globalBlock);
        const currentHash = computeGlobalBlockHash(contentWithoutMeta);

        modifiedFiles.push({
          path: "AGENTS.md",
          type: "agents",
          expectedHash: metadata.contentHash ?? "unknown",
          currentHash,
        });
      }
    } else if (file.type === "skill") {
      // Get hash info for skill file
      const skillPath = path.join(targetDir, file.path);
      const content = await fs.readFile(skillPath, "utf-8");
      const { frontmatter } = parseFrontmatter(content);

      const metadata = frontmatter.metadata as Record<string, string> | undefined;
      const storedHash = metadata?.["agent_conf_content_hash"] ?? "unknown";
      const currentHash = computeContentHash(content);

      modifiedFiles.push({
        path: file.path,
        type: "skill",
        expectedHash: storedHash,
        currentHash,
      });
    }
  }

  // Output results
  if (options.quiet) {
    // Quiet mode: just exit with appropriate code
    if (modifiedFiles.length > 0) {
      process.exit(1);
    }
    return;
  }

  console.log();
  console.log(pc.bold("agent-conf check"));
  console.log();
  console.log("Checking managed files...");
  console.log();

  if (modifiedFiles.length === 0) {
    console.log(`${pc.green("✓")} All managed files are unchanged`);
    console.log();
    return;
  }

  // Modified files found
  console.log(`${pc.red("✗")} ${modifiedFiles.length} managed file(s) have been modified:`);
  console.log();

  for (const file of modifiedFiles) {
    const label = file.type === "agents" ? " (global block)" : "";
    console.log(`  ${file.path}${pc.dim(label)}`);
    console.log(`    Expected hash: ${pc.dim(file.expectedHash)}`);
    console.log(`    Current hash:  ${pc.dim(file.currentHash)}`);
    console.log();
  }

  console.log(pc.dim("These files are managed by agent-conf and should not be modified manually."));
  console.log(pc.dim("Run 'agent-conf sync' to restore them to the expected state."));
  console.log();

  process.exit(1);
}
