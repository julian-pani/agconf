import * as fs from "node:fs/promises";
import * as path from "node:path";
import pc from "picocolors";
import { readLockfile } from "../core/lockfile.js";
import {
  checkAllManagedFiles,
  computeContentHash,
  parseFrontmatter,
  stripManagedMetadata,
} from "../core/managed-content.js";
import {
  computeGlobalBlockHash,
  computeRulesSectionHash,
  parseAgentsMd,
  parseGlobalBlockMetadata,
  parseRulesSection,
  parseRulesSectionMetadata,
  stripMetadataComments,
  stripRulesSectionMetadata,
} from "../core/markers.js";
import { toMetadataPrefix } from "../utils/prefix.js";

export interface CheckOptions {
  quiet?: boolean;
  debug?: boolean;
  cwd?: string;
}

export interface ModifiedFileInfo {
  path: string;
  type: "skill" | "agents" | "rule" | "rules-section" | "agent";
  expectedHash: string;
  currentHash: string;
  /** Rule source path if type is rule */
  rulePath?: string;
  /** Agent path if type is agent */
  agentPath?: string;
}

/**
 * Check if managed files have been modified.
 * Exits with code 0 if all files are unchanged, code 1 if changes detected.
 */
export async function checkCommand(options: CheckOptions = {}): Promise<void> {
  const targetDir = options.cwd ?? process.cwd();

  // Check if synced (lockfile exists)
  const result = await readLockfile(targetDir);

  if (!result) {
    if (!options.quiet) {
      console.log();
      console.log(pc.yellow("Not synced"));
      console.log();
      console.log(pc.dim("This repository has not been synced with agconf."));
      console.log(pc.dim("Run `agconf init` to sync engineering standards."));
      console.log();
    }
    // Exit 0 - not synced is not an error for the check command
    return;
  }

  // Check schema compatibility
  const { lockfile, schemaCompatibility } = result;
  if (!schemaCompatibility.compatible) {
    if (!options.quiet) {
      console.log();
      console.log(pc.red(`Schema error: ${schemaCompatibility.error}`));
      console.log();
    }
    process.exit(1);
  }
  if (schemaCompatibility.warning && !options.quiet) {
    console.log();
    console.log(pc.yellow(`Warning: ${schemaCompatibility.warning}`));
    console.log();
  }

  const targets = lockfile.content.targets ?? ["claude"];
  const markerPrefix = lockfile.content.marker_prefix;
  const modifiedFiles: ModifiedFileInfo[] = [];

  // Build options for checking managed files
  const checkOptions = markerPrefix ? { markerPrefix, metadataPrefix: markerPrefix } : {};

  // Check all managed files
  const allFiles = await checkAllManagedFiles(targetDir, targets, checkOptions);

  // Gather detailed info for modified files
  // Compute the metadata key prefix (convert dashes to underscores)
  const keyPrefix = markerPrefix ? `${toMetadataPrefix(markerPrefix)}_` : "agconf_";

  for (const file of allFiles) {
    if (!file.hasChanges) continue;

    if (file.type === "agents") {
      // Get hash info for AGENTS.md
      const agentsMdPath = path.join(targetDir, "AGENTS.md");
      const content = await fs.readFile(agentsMdPath, "utf-8");
      const parsed = parseAgentsMd(content, markerPrefix ? { prefix: markerPrefix } : undefined);

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
      const storedHash = metadata?.[`${keyPrefix}content_hash`] ?? "unknown";
      const currentHash = computeContentHash(
        content,
        markerPrefix ? { metadataPrefix: markerPrefix } : undefined,
      );

      modifiedFiles.push({
        path: file.path,
        type: "skill",
        expectedHash: storedHash,
        currentHash,
      });
    } else if (file.type === "rule") {
      // Get hash info for rule file
      const rulePath = path.join(targetDir, file.path);
      const content = await fs.readFile(rulePath, "utf-8");
      const { frontmatter } = parseFrontmatter(content);

      const metadata = frontmatter.metadata as Record<string, string> | undefined;
      const storedHash = metadata?.[`${keyPrefix}content_hash`] ?? "unknown";
      const currentHash = computeContentHash(
        content,
        markerPrefix ? { metadataPrefix: markerPrefix } : undefined,
      );

      // Debug logging for rule hash computation
      if (options.debug) {
        console.log(pc.cyan(`\n[DEBUG] Rule: ${file.path}`));
        console.log(pc.dim(`  Marker prefix: ${markerPrefix}`));
        console.log(pc.dim(`  Key prefix: ${keyPrefix}`));
        console.log(pc.dim(`  Stored hash: ${storedHash}`));
        console.log(pc.dim(`  Computed hash: ${currentHash}`));
        console.log(pc.dim(`  Frontmatter keys: ${Object.keys(frontmatter).join(", ")}`));
        if (frontmatter.metadata) {
          console.log(
            pc.dim(`  Metadata keys: ${Object.keys(frontmatter.metadata as object).join(", ")}`),
          );
        }

        // Show what content is being hashed
        const strippedContent = stripManagedMetadata(
          content,
          markerPrefix ? { metadataPrefix: markerPrefix } : undefined,
        );
        console.log(
          pc.dim(
            `  Stripped content (for hashing):\n${pc.gray(strippedContent.slice(0, 500))}${strippedContent.length > 500 ? "..." : ""}`,
          ),
        );
      }

      const ruleInfo: ModifiedFileInfo = {
        path: file.path,
        type: "rule",
        expectedHash: storedHash,
        currentHash,
      };
      if (file.rulePath) {
        ruleInfo.rulePath = file.rulePath;
      }
      modifiedFiles.push(ruleInfo);
    } else if (file.type === "rules-section") {
      // Get hash info for rules section in AGENTS.md (Codex target)
      const agentsMdPath = path.join(targetDir, "AGENTS.md");
      const content = await fs.readFile(agentsMdPath, "utf-8");
      const parsed = parseRulesSection(
        content,
        markerPrefix ? { prefix: markerPrefix } : undefined,
      );

      if (parsed.content) {
        const metadata = parseRulesSectionMetadata(parsed.content);
        const contentWithoutMeta = stripRulesSectionMetadata(parsed.content);
        const currentHash = computeRulesSectionHash(contentWithoutMeta);

        modifiedFiles.push({
          path: "AGENTS.md",
          type: "rules-section",
          expectedHash: metadata.contentHash ?? "unknown",
          currentHash,
        });
      }
    } else if (file.type === "agent") {
      // Get hash info for agent file
      const agentFilePath = path.join(targetDir, file.path);
      const content = await fs.readFile(agentFilePath, "utf-8");
      const { frontmatter } = parseFrontmatter(content);

      const metadata = frontmatter.metadata as Record<string, string> | undefined;
      const storedHash = metadata?.[`${keyPrefix}content_hash`] ?? "unknown";
      const currentHash = computeContentHash(
        content,
        markerPrefix ? { metadataPrefix: markerPrefix } : undefined,
      );

      const agentInfo: ModifiedFileInfo = {
        path: file.path,
        type: "agent",
        expectedHash: storedHash,
        currentHash,
      };
      if (file.agentPath) {
        agentInfo.agentPath = file.agentPath;
      }
      modifiedFiles.push(agentInfo);
    }
  }

  // Check if any managed files were found
  if (allFiles.length === 0) {
    if (options.quiet) {
      process.exit(1);
    }
    console.log();
    console.log(pc.bold("agconf check"));
    console.log();
    console.log(`${pc.red("✗")} No managed files found`);
    console.log();
    console.log(pc.dim("This repository appears to be synced but no managed files were detected."));
    if (markerPrefix) {
      console.log(pc.dim(`Expected marker prefix: ${markerPrefix}`));
    }
    console.log(pc.dim("Run 'agconf sync' to restore the managed files."));
    console.log();
    process.exit(1);
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
  console.log(pc.bold("agconf check"));
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
    let label = "";
    if (file.type === "agents") {
      label = " (global block)";
    } else if (file.type === "rules-section") {
      label = " (rules section)";
    } else if (file.type === "rule" && file.rulePath) {
      label = ` (rule: ${file.rulePath})`;
    } else if (file.type === "agent" && file.agentPath) {
      label = ` (agent: ${file.agentPath})`;
    }
    console.log(`  ${file.path}${pc.dim(label)}`);
    console.log(`    Expected hash: ${pc.dim(file.expectedHash)}`);
    console.log(`    Current hash:  ${pc.dim(file.currentHash)}`);
    console.log();
  }

  console.log(pc.dim("These files are managed by agconf and should not be modified manually."));
  console.log(pc.dim("To propose these changes to canonical: agconf propose"));
  console.log(pc.dim("To restore original content: agconf sync"));
  console.log();

  process.exit(1);
}
