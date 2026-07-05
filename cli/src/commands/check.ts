import * as fs from "node:fs/promises";
import * as path from "node:path";
import pc from "picocolors";
import { loadCanonicalRepoConfig, loadDownstreamConfig } from "../config/loader.js";
import type { CanonicalRepoConfig, EnrollmentConfig } from "../config/schema.js";
import { buildEnrollmentPlan, readClaudeSettings, verifyEnrollment } from "../core/enrollment.js";
import { readLockfile } from "../core/lockfile.js";
import {
  checkAllManagedFiles,
  computeContentHash,
  findOrphanedManagedFiles,
  getManagedMetadata,
  type OrphanedManagedFile,
  parseFrontmatter,
  readCodexAgentMetadata,
  readManagedMetadata,
  stripCodexAgentMetadata,
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
import { resolvePluginTargets, verifyPluginsFresh } from "../core/plugins.js";
import { resolveLocalSource } from "../core/source.js";
import { getCurrentBranch } from "../utils/git.js";
import { toMetadataPrefix } from "../utils/prefix.js";

export interface CheckOptions {
  quiet?: boolean;
  debug?: boolean;
  cwd?: string;
  /**
   * Pre-commit mode. Runs the normal integrity check, then applies a
   * branch-aware verdict: block (exit 1) on `master`/`main`, warn-and-allow
   * (exit 0) on any other branch or a detached HEAD. Used by the pre-commit
   * framework hook (`agconf check --hook`); a no-op that exits 0 in unsynced
   * repos so it never disrupts commits there.
   */
  hook?: boolean;
}

/** Branches on which a failing check blocks the commit in `--hook` mode. */
const PROTECTED_BRANCHES = new Set(["master", "main"]);

export interface ModifiedFileInfo {
  path: string;
  type: "skill" | "agents" | "rule" | "rules-section" | "agent" | "codex-agent";
  expectedHash: string;
  currentHash: string;
  /** Rule source path if type is rule */
  rulePath?: string;
  /** Agent path if type is agent or codex-agent */
  agentPath?: string;
  /** For skill: whether SKILL.md body itself was modified */
  contentChanged?: boolean;
  /** For skill: whether sibling assets (references/, scripts/, ...) were modified */
  assetsChanged?: boolean;
}

/**
 * Check that this repository is consistent with its source(s) of truth.
 *
 * The command is context-aware:
 * - **Canonical repo** (agconf.yaml with a `plugins` block): verifies the
 *   committed plugin/marketplace artifacts match what compilation would produce
 *   now (the freshness gate; see `core/plugins.ts`).
 * - **Downstream repo** (a `.agconf/lockfile.json` exists): verifies synced
 *   managed files (skills/rules/agents/AGENTS.md) are unmodified and reconciled
 *   against the lockfile.
 *
 * A repo can be both; whichever context applies runs. Exits 1 if any problems
 * are found, 0 otherwise.
 */
export async function checkCommand(options: CheckOptions = {}): Promise<void> {
  const targetDir = options.cwd ?? process.cwd();

  // Best-effort: a malformed/incompatible agconf.yaml co-located with a lockfile
  // must not make `check` throw — degrade to "no plugin context" so the
  // downstream check still runs (preserving pre-plugins behavior).
  let canonicalConfig: Awaited<ReturnType<typeof loadCanonicalRepoConfig>>;
  try {
    canonicalConfig = await loadCanonicalRepoConfig(targetDir);
  } catch {
    canonicalConfig = undefined;
  }
  const hasPlugins = Boolean(canonicalConfig?.plugins);

  // Downstream config may declare experimental plugin enrollment. Best-effort:
  // a malformed config must not make `check` throw.
  let downstreamConfig: Awaited<ReturnType<typeof loadDownstreamConfig>>;
  try {
    downstreamConfig = await loadDownstreamConfig(targetDir);
  } catch {
    downstreamConfig = undefined;
  }
  const enrollment = downstreamConfig?.experimental?.enrollment;

  // Check if synced (lockfile exists)
  const result = await readLockfile(targetDir);

  // None of the recognized contexts apply.
  if (!hasPlugins && !result && !enrollment) {
    // In hook mode this must be a silent no-op so it never disrupts commits in
    // repos that don't use agconf.
    if (!options.quiet && !options.hook) {
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

  let hasProblems = false;

  if (hasPlugins && canonicalConfig) {
    const pluginProblems = await checkCanonicalPlugins(targetDir, canonicalConfig, options);
    hasProblems = hasProblems || pluginProblems;
  }

  if (enrollment) {
    const enrollmentProblems = await checkEnrollment(targetDir, enrollment, options);
    hasProblems = hasProblems || enrollmentProblems;
  }

  if (result) {
    const downstreamProblems = await checkDownstream(targetDir, result, options);
    hasProblems = hasProblems || downstreamProblems;
  }

  // Pre-commit mode: turn the check result into a branch-aware commit verdict.
  // The detailed report above (modified files, hashes, propose/sync hints) has
  // already printed, so here we only add the verdict line(s).
  if (options.hook) {
    if (hasProblems) {
      await printHookVerdict(targetDir);
    }
    return;
  }

  if (hasProblems) {
    process.exit(1);
  }
}

/**
 * Print the pre-commit verdict for a failing check and, on a protected branch,
 * block the commit via `process.exit(1)`. On feature branches (or a detached
 * HEAD) it warns and returns so the commit is allowed — mirroring the
 * branch-aware behavior of the standalone shell hook.
 */
async function printHookVerdict(targetDir: string): Promise<void> {
  const branch = await getCurrentBranch(targetDir);
  const isProtected = branch !== null && PROTECTED_BRANCHES.has(branch);

  console.log();
  if (isProtected) {
    console.log(pc.red(`✗ Cannot commit: agconf-managed files were modified on '${branch}'.`));
    console.log();
    console.log("Options:");
    console.log(pc.dim("  1. Discard changes:  git checkout -- <file>"));
    console.log(pc.dim("  2. Restore managed:  agconf sync"));
    console.log(pc.dim("  3. Propose upstream: agconf propose"));
    console.log(
      pc.dim("  4. Bypass this hook: SKIP=agconf-check git commit  (or git commit --no-verify)"),
    );
    console.log();
    process.exit(1);
  }

  const branchLabel = branch ?? "this branch";
  console.log(
    pc.yellow(
      `⚠ Committing changes to agconf-managed files on '${branchLabel}' (allowed on feature branches).`,
    ),
  );
  console.log(pc.dim("  Propose these changes upstream when ready: agconf propose"));
  console.log();
}

/**
 * Verify the committed plugin artifacts in a canonical repo are up to date with
 * the canonical source. Returns true if drift was found (a problem).
 */
async function checkCanonicalPlugins(
  targetDir: string,
  canonicalConfig: CanonicalRepoConfig,
  options: CheckOptions,
): Promise<boolean> {
  const pluginsConfig = canonicalConfig.plugins;
  if (!pluginsConfig) return false;

  const { targets, warnings } = resolvePluginTargets(pluginsConfig, canonicalConfig.targets);
  if (!options.quiet) {
    for (const w of warnings) console.log(pc.yellow(`Warning: ${w}`));
  }
  if (targets.length === 0) return false;

  let source: Awaited<ReturnType<typeof resolveLocalSource>>;
  try {
    source = await resolveLocalSource({ path: targetDir });
  } catch (error) {
    if (!options.quiet) {
      console.log();
      console.log(
        pc.red(`✗ Cannot verify plugins: ${error instanceof Error ? error.message : error}`),
      );
      console.log();
    }
    return true;
  }

  const drift = await verifyPluginsFresh(targetDir, source, pluginsConfig, targets);
  const hasDrift = drift.drifted.length > 0 || drift.missing.length > 0 || drift.extra.length > 0;

  if (!hasDrift) {
    if (!options.quiet) {
      console.log();
      console.log(`${pc.green("✓")} Compiled plugins are up to date`);
      console.log();
    }
    return false;
  }

  if (options.quiet) return true;

  console.log();
  console.log(`${pc.red("✗")} Compiled plugin artifacts are out of date with canonical source:`);
  console.log();
  printDriftList("Stale (content differs)", drift.drifted);
  printDriftList("Missing (expected but absent)", drift.missing);
  printDriftList("Stale (no longer produced)", drift.extra);
  console.log(pc.dim("Run `agconf compile` and commit the result."));
  console.log();
  return true;
}

function printDriftList(label: string, files: string[]): void {
  if (files.length === 0) return;
  console.log(`${pc.yellow(label)}:`);
  for (const f of files) {
    console.log(`  ${f.split(path.sep).join("/")}`);
  }
  console.log();
}

/**
 * Verify the committed `.claude/settings.json` still satisfies the downstream's
 * `experimental.enrollment` declaration (marketplace registered with the pinned
 * source, and every declared plugin enabled). Returns true if drift was found.
 */
async function checkEnrollment(
  targetDir: string,
  enrollment: EnrollmentConfig,
  options: CheckOptions,
): Promise<boolean> {
  const plan = buildEnrollmentPlan(enrollment);

  let settings: Record<string, unknown>;
  try {
    settings = await readClaudeSettings(targetDir);
  } catch (error) {
    if (!options.quiet) {
      console.log();
      console.log(
        pc.red(`✗ Cannot verify enrollment: ${error instanceof Error ? error.message : error}`),
      );
      console.log();
    }
    return true;
  }

  const problems = verifyEnrollment(settings, plan);
  if (problems.length === 0) {
    if (!options.quiet) {
      console.log();
      console.log(`${pc.green("✓")} Plugin enrollment is up to date`);
      console.log();
    }
    return false;
  }

  if (options.quiet) return true;

  console.log();
  console.log(`${pc.red("✗")} .claude/settings.json is out of sync with configured enrollment:`);
  console.log();
  for (const p of problems) console.log(`  ${p}`);
  console.log();
  console.log(pc.dim("Run `agconf enroll` to update .claude/settings.json."));
  console.log();
  return true;
}

/**
 * Check synced managed files in a downstream repo against the lockfile.
 * Returns true if any problems were found (modifications, ghosts, missing,
 * schema incompatibility, or no managed files).
 */
async function checkDownstream(
  targetDir: string,
  result: NonNullable<Awaited<ReturnType<typeof readLockfile>>>,
  options: CheckOptions,
): Promise<boolean> {
  // Check schema compatibility
  const { lockfile, schemaCompatibility } = result;
  if (!schemaCompatibility.compatible) {
    if (!options.quiet) {
      console.log();
      console.log(pc.red(`Schema error: ${schemaCompatibility.error}`));
      console.log();
    }
    return true;
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
      // Get hash info for skill file. A skill modification can mean either
      // SKILL.md itself changed (content_hash mismatch) or one of its sibling
      // asset files changed (assets_hash mismatch). Both are reported.
      const skillPath = path.join(targetDir, file.path);
      const content = await fs.readFile(skillPath, "utf-8");
      const storedHash = getManagedMetadata(content, markerPrefix).contentHash ?? "unknown";
      const currentHash = computeContentHash(
        content,
        markerPrefix ? { metadataPrefix: markerPrefix } : undefined,
      );

      const info: ModifiedFileInfo = {
        path: file.path,
        type: "skill",
        expectedHash: storedHash,
        currentHash,
      };
      if (file.contentChanged !== undefined) info.contentChanged = file.contentChanged;
      if (file.assetsChanged !== undefined) info.assetsChanged = file.assetsChanged;
      modifiedFiles.push(info);
    } else if (file.type === "rule") {
      // Get hash info for rule file
      const rulePath = path.join(targetDir, file.path);
      const content = await fs.readFile(rulePath, "utf-8");
      const { frontmatter } = parseFrontmatter(content);
      const storedHash =
        readManagedMetadata(frontmatter.metadata, markerPrefix).contentHash ?? "unknown";
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
      const storedHash = getManagedMetadata(content, markerPrefix).contentHash ?? "unknown";
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
    } else if (file.type === "codex-agent") {
      // Codex agent TOML: hash the metadata-free body, mirroring how it was
      // stored during sync (see buildCodexAgentToml).
      const agentFilePath = path.join(targetDir, file.path);
      const content = await fs.readFile(agentFilePath, "utf-8");
      const metaOpts = markerPrefix ? { metadataPrefix: markerPrefix } : undefined;
      const storedHash = readCodexAgentMetadata(content, metaOpts).contentHash ?? "unknown";
      const currentHash = computeContentHash(stripCodexAgentMetadata(content, metaOpts));

      const agentInfo: ModifiedFileInfo = {
        path: file.path,
        type: "codex-agent",
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
      return true;
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
    return true;
  }

  // Reconcile managed files on disk against the lockfile's expected set. This
  // surfaces objects removed from canonical but left behind downstream (ghosts)
  // and lockfile-tracked objects deleted manually after sync (missing).
  const expected = {
    skills: lockfile.content.skills ?? [],
    rules: lockfile.content.rules?.files ?? [],
    agents: lockfile.content.agents?.files ?? [],
  };
  const { ghosts, missing } = await findOrphanedManagedFiles(
    targetDir,
    targets,
    expected,
    checkOptions,
  );

  const hasProblems = modifiedFiles.length > 0 || ghosts.length > 0 || missing.length > 0;

  // Output results
  if (options.quiet) {
    // Quiet mode: just return whether problems were found
    return hasProblems;
  }

  console.log();
  console.log(pc.bold("agconf check"));
  console.log();
  console.log("Checking managed files...");
  console.log();

  if (!hasProblems) {
    console.log(`${pc.green("✓")} All managed files are unchanged`);
    console.log();
    return false;
  }

  const typeLabel = (type: OrphanedManagedFile["type"]): string => type;

  // Modified files
  if (modifiedFiles.length > 0) {
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
      } else if (file.type === "codex-agent" && file.agentPath) {
        label = ` (codex agent: ${file.agentPath})`;
      } else if (file.type === "skill") {
        // Distinguish "SKILL.md body changed" from "sibling assets changed"
        // so users know where to look (and that `propose` has more detail).
        const parts: string[] = [];
        if (file.contentChanged) parts.push("body");
        if (file.assetsChanged) parts.push("assets");
        if (parts.length > 0) label = ` (${parts.join(" + ")})`;
      }
      console.log(`  ${file.path}${pc.dim(label)}`);
      console.log(`    Expected hash: ${pc.dim(file.expectedHash)}`);
      console.log(`    Current hash:  ${pc.dim(file.currentHash)}`);
      console.log();
    }
  }

  // Orphaned files: removed from canonical but still present on disk.
  if (ghosts.length > 0) {
    console.log(
      `${pc.red("✗")} ${ghosts.length} orphaned managed file(s) are no longer in canonical but remain on disk:`,
    );
    console.log();
    for (const ghost of ghosts) {
      console.log(`  ${ghost.path} ${pc.dim(`(orphaned ${typeLabel(ghost.type)})`)}`);
    }
    console.log();
  }

  // Missing files: tracked in the lockfile but deleted from disk.
  if (missing.length > 0) {
    console.log(
      `${pc.red("✗")} ${missing.length} managed file(s) are tracked in the lockfile but missing on disk:`,
    );
    console.log();
    for (const file of missing) {
      console.log(`  ${file.path} ${pc.dim(`(missing ${typeLabel(file.type)})`)}`);
    }
    console.log();
  }

  if (modifiedFiles.length > 0) {
    console.log(pc.dim("Modified files are managed by agconf and should not be edited manually."));
    console.log(pc.dim("To propose these changes to canonical: agconf propose"));
  }
  if (ghosts.length > 0 || missing.length > 0) {
    console.log(pc.dim("Run 'agconf sync' to remove orphaned files and restore missing ones."));
  } else {
    console.log(pc.dim("To restore original content: agconf sync"));
  }
  console.log();

  return true;
}
