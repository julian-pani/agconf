import * as path from "node:path";
import pc from "picocolors";
import type { HookInstallResult } from "../core/hooks.js";
import type { ResolvedSource } from "../core/source.js";
import { formatSourceString } from "../core/source.js";
import type { SyncResult } from "../core/sync.js";
import { getTargetConfig, type Target } from "../core/targets.js";
import type { WorkflowSyncResult } from "../core/workflows.js";
import { formatPath } from "../utils/logger.js";

/** Everything `renderSyncSummary` needs to build the post-sync summary. */
export interface RenderSyncSummaryInput {
  result: SyncResult;
  targetDir: string;
  targets: Target[];
  /** Skills/rules/agents recorded in the previous lockfile (to flag new vs updated). */
  previousSkills: string[];
  previousRules: string[];
  previousAgents: string[];
  /** Outcome of orphaned-skill handling performed by the caller. */
  orphanResult: { deleted: string[]; skipped: string[] };
  /** Outcome of orphaned-rule handling performed by the caller. */
  ruleOrphanResult: { deleted: string[]; skipped: string[] };
  /** Outcome of orphaned-agent handling performed by the caller. */
  agentOrphanResult: { deleted: string[]; skipped: string[] };
  workflowResult: WorkflowSyncResult | null;
  /** Outcome of hook installation, or null if the step was skipped/failed. */
  hookResult: HookInstallResult | null;
  resolvedSource: ResolvedSource;
  resolvedVersion: { version: string | undefined };
  commandName: "init" | "sync";
  /** Show all change items instead of truncating to the first few. */
  expandChanges: boolean;
}

export interface RenderedSyncSummary {
  /** Lines to print to the console (colored), in order. */
  consoleLines: string[];
  /** Markdown bullet lines for the optional CI summary file. */
  summaryLines: string[];
}

const MAX_ITEMS_DEFAULT = 5;

/**
 * Build the "Sync complete" summary for both the console (colored) and the
 * optional markdown summary file.
 *
 * Pure: performs no I/O and no console output — it returns the lines so the
 * caller decides where they go. This keeps the rendering independently testable
 * and out of `performSync`'s orchestration body.
 */
export function renderSyncSummary(input: RenderSyncSummaryInput): RenderedSyncSummary {
  const {
    result,
    targetDir,
    targets,
    previousSkills,
    previousRules,
    previousAgents,
    orphanResult,
    ruleOrphanResult,
    agentOrphanResult,
    workflowResult,
    hookResult,
    resolvedSource,
    resolvedVersion,
    commandName,
    expandChanges,
  } = input;

  const consoleLines: string[] = [];
  const summaryLines: string[] = [];

  // Summary header
  consoleLines.push("");
  consoleLines.push(pc.bold("Sync complete:"));
  consoleLines.push("");

  // AGENTS.md status
  const agentsMdPath = formatPath(path.join(targetDir, "AGENTS.md"));
  if (!result.agentsMd.merged) {
    consoleLines.push(`  ${pc.green("+")} ${agentsMdPath} ${pc.dim("(created)")}`);
    summaryLines.push("- `AGENTS.md` (created)");
  } else if (result.agentsMd.changed) {
    const label = commandName === "sync" ? "(updated)" : "(merged)";
    consoleLines.push(`  ${pc.green("+")} ${agentsMdPath} ${pc.dim(label)}`);
    summaryLines.push(`- \`AGENTS.md\` ${label}`);
  } else {
    consoleLines.push(`  ${pc.dim("-")} ${agentsMdPath} ${pc.dim("(unchanged)")}`);
    summaryLines.push("- `AGENTS.md` (unchanged)");
  }

  // CLAUDE.md status (consolidation result, shown once regardless of targets)
  {
    const claudeMdPath = formatPath(path.join(targetDir, "CLAUDE.md"));
    const claudeMdRelPath = "CLAUDE.md";

    if (result.claudeMd.created) {
      consoleLines.push(`  ${pc.green("+")} ${claudeMdPath} ${pc.dim("(created)")}`);
      summaryLines.push(`- \`${claudeMdRelPath}\` (created)`);
    } else if (result.claudeMd.updated) {
      const hint = result.claudeMd.deletedDotClaudeClaudeMd
        ? "(content merged into AGENTS.md, reference added)"
        : "(reference added)";
      consoleLines.push(`  ${pc.yellow("~")} ${claudeMdPath} ${pc.dim(hint)}`);
      summaryLines.push(`- \`${claudeMdRelPath}\` ${hint}`);
    } else {
      consoleLines.push(`  ${pc.dim("-")} ${claudeMdPath} ${pc.dim("(unchanged)")}`);
      summaryLines.push(`- \`${claudeMdRelPath}\` (unchanged)`);
    }

    // Show deleted .claude/CLAUDE.md
    if (result.claudeMd.deletedDotClaudeClaudeMd) {
      const dotClaudeMdPath = formatPath(path.join(targetDir, ".claude", "CLAUDE.md"));
      consoleLines.push(
        `  ${pc.red("-")} ${dotClaudeMdPath} ${pc.dim("(deleted, content merged into AGENTS.md)")}`,
      );
      summaryLines.push("- `.claude/CLAUDE.md` (deleted, content merged into AGENTS.md)");
    }
  }

  // Helper to display change lists with truncation
  const shouldExpand = expandChanges === true;
  const formatChangeList = (
    items: string[],
    icon: string,
    colorFn: (s: string) => string,
    label: string,
    mdLabel: string,
    formatItem: (item: string) => { display: string; summary: string },
  ) => {
    if (items.length === 0) return;

    const maxDisplay = shouldExpand ? items.length : MAX_ITEMS_DEFAULT;
    const displayItems = items.slice(0, maxDisplay);
    const hiddenCount = items.length - displayItems.length;

    for (const item of displayItems) {
      const { display, summary } = formatItem(item);
      consoleLines.push(`    ${colorFn(icon)} ${display} ${pc.dim(`(${label})`)}`);
      summaryLines.push(`  - ${summary} (${mdLabel})`);
    }

    if (hiddenCount > 0) {
      consoleLines.push(`    ${pc.dim(`  ... ${hiddenCount} more ${label}`)}`);
      summaryLines.push(`  - ... ${hiddenCount} more ${mdLabel}`);
    }
  };

  // Per-target results
  for (const targetResult of result.targets) {
    const config = getTargetConfig(targetResult.target);

    // Skills status for this target
    const skillsPath = formatPath(path.join(targetDir, config.dir, "skills"));
    const skillsRelPath = `${config.dir}/skills/`;

    // Compute new vs actually modified skills
    const newSkills = result.skills.synced.filter((s) => !previousSkills.includes(s)).sort();
    // Only show as "updated" if content actually changed (not just re-synced)
    const updatedSkills = result.skills.modified.filter((s) => previousSkills.includes(s)).sort();
    const removedSkills = orphanResult.deleted.sort();

    // Determine if skills had any changes
    const skillsHadChanges =
      newSkills.length > 0 || updatedSkills.length > 0 || removedSkills.length > 0;
    const skillsStatusIcon = skillsHadChanges ? pc.green("+") : pc.dim("-");
    const skillsStatusLabel = skillsHadChanges ? "(updated)" : "(unchanged)";

    // Summary line for skills directory
    consoleLines.push(
      `  ${skillsStatusIcon} ${skillsPath}/ ${pc.dim(`(total: ${result.skills.synced.length} skills, ${targetResult.skills.copied} files) ${skillsStatusLabel}`)}`,
    );
    summaryLines.push(
      `- \`${skillsRelPath}\` (total: ${result.skills.synced.length} skills, ${targetResult.skills.copied} files) ${skillsStatusLabel}`,
    );

    const formatSkillItem = (skill: string) => ({
      display: `${formatPath(path.join(targetDir, config.dir, "skills", skill))}/`,
      summary: `\`${config.dir}/skills/${skill}/\``,
    });

    // Show new skills
    formatChangeList(newSkills, "+", pc.green, "new", "new", formatSkillItem);

    // Show updated skills
    formatChangeList(updatedSkills, "~", pc.yellow, "updated", "updated", formatSkillItem);

    // Show removed skills
    for (const skill of removedSkills) {
      const orphanPath = formatPath(path.join(targetDir, config.dir, "skills", skill));
      const orphanRelPath = `${config.dir}/skills/${skill}/`;
      consoleLines.push(`    ${pc.red("-")} ${orphanPath}/ ${pc.dim("(removed)")}`);
      summaryLines.push(`  - \`${orphanRelPath}\` (removed)`);
    }

    // Show skipped orphans
    if (orphanResult.skipped.length > 0) {
      for (const skill of orphanResult.skipped) {
        const orphanPath = formatPath(path.join(targetDir, config.dir, "skills", skill));
        const orphanRelPath = `${config.dir}/skills/${skill}/`;
        consoleLines.push(
          `    ${pc.yellow("!")} ${orphanPath}/ ${pc.dim("(orphaned but skipped)")}`,
        );
        summaryLines.push(`  - \`${orphanRelPath}\` (orphaned but skipped)`);
      }
    }

    // Rules status for Claude target
    if (result.rules && result.rules.claudeFiles.length > 0 && targetResult.target === "claude") {
      const rulesPath = formatPath(path.join(targetDir, config.dir, "rules"));
      const rulesRelPath = `${config.dir}/rules/`;
      const rulesCount = result.rules.claudeFiles.length;

      // Compute new vs actually modified rules
      const newRules = result.rules.synced.filter((r) => !previousRules.includes(r)).sort();
      // Only show as "updated" if content actually changed (not just re-synced)
      const updatedRules = result.rules.modified.filter((r) => previousRules.includes(r)).sort();

      // Determine if rules had any changes
      const rulesHadChanges = newRules.length > 0 || updatedRules.length > 0;
      const rulesStatusIcon = rulesHadChanges ? pc.green("+") : pc.dim("-");
      const rulesStatusLabel = rulesHadChanges ? "(updated)" : "(unchanged)";

      consoleLines.push(
        `  ${rulesStatusIcon} ${rulesPath}/ ${pc.dim(`(total: ${rulesCount} rules) ${rulesStatusLabel}`)}`,
      );
      summaryLines.push(`- \`${rulesRelPath}\` (total: ${rulesCount} rules) ${rulesStatusLabel}`);

      const formatRuleItem = (rule: string) => ({
        display: formatPath(path.join(targetDir, config.dir, "rules", rule)),
        summary: `\`${config.dir}/rules/${rule}\``,
      });

      // Show new rules
      formatChangeList(newRules, "+", pc.green, "new", "new", formatRuleItem);

      // Show updated rules
      formatChangeList(updatedRules, "~", pc.yellow, "updated", "updated", formatRuleItem);
    }

    // Rules status for Codex target (concatenated into AGENTS.md)
    if (result.rules?.codexUpdated && targetResult.target === "codex") {
      const rulesCount = result.rules.synced.length;
      consoleLines.push(
        `  ${pc.green("+")} ${pc.dim("AGENTS.md rules section")} ${pc.dim(`(total: ${rulesCount} rules concatenated) (updated)`)}`,
      );
      summaryLines.push(
        `- AGENTS.md rules section (total: ${rulesCount} rules concatenated) (updated)`,
      );

      // Compute new vs actually modified rules for Codex
      const newRules = result.rules.synced.filter((r) => !previousRules.includes(r)).sort();
      // Only show as "updated" if content actually changed (not just re-synced)
      const updatedRules = result.rules.modified.filter((r) => previousRules.includes(r)).sort();

      const formatCodexRuleItem = (rule: string) => ({
        display: rule,
        summary: `\`${rule}\``,
      });

      // Show new rules
      formatChangeList(newRules, "+", pc.green, "new", "new", formatCodexRuleItem);

      // Show updated rules
      formatChangeList(updatedRules, "~", pc.yellow, "updated", "updated", formatCodexRuleItem);
    }

    // Agents status for Claude target (agents are only synced to Claude)
    if (result.agents && result.agents.synced.length > 0 && targetResult.target === "claude") {
      const agentsPath = formatPath(path.join(targetDir, config.dir, "agents"));
      const agentsRelPath = `${config.dir}/agents/`;
      const agentsCount = result.agents.synced.length;

      // Compute new vs actually modified agents
      const newAgents = result.agents.synced.filter((a) => !previousAgents.includes(a)).sort();
      const updatedAgents = result.agents.modified.filter((a) => previousAgents.includes(a)).sort();

      // Determine if agents had any changes
      const agentsHadChanges = newAgents.length > 0 || updatedAgents.length > 0;
      const agentsStatusIcon = agentsHadChanges ? pc.green("+") : pc.dim("-");
      const agentsStatusLabel = agentsHadChanges ? "(updated)" : "(unchanged)";

      consoleLines.push(
        `  ${agentsStatusIcon} ${agentsPath}/ ${pc.dim(`(total: ${agentsCount} agents) ${agentsStatusLabel}`)}`,
      );
      summaryLines.push(
        `- \`${agentsRelPath}\` (total: ${agentsCount} agents) ${agentsStatusLabel}`,
      );

      const formatAgentItem = (agent: string) => ({
        display: formatPath(path.join(targetDir, config.dir, "agents", agent)),
        summary: `\`${config.dir}/agents/${agent}\``,
      });

      // Show new agents
      formatChangeList(newAgents, "+", pc.green, "new", "new", formatAgentItem);

      // Show updated agents
      formatChangeList(updatedAgents, "~", pc.yellow, "updated", "updated", formatAgentItem);
    }

    // Warning when agents were skipped due to Codex-only target
    if (result.agents?.skipped && targetResult.target === "codex") {
      consoleLines.push(
        `  ${pc.yellow("!")} ${pc.dim("Agents skipped")} ${pc.yellow("(Codex does not support sub-agents)")}`,
      );
      summaryLines.push("- Agents skipped (Codex does not support sub-agents)");
    }

    // Removed / skipped orphaned rules and agents (Claude-managed files only).
    // Rendered regardless of whether any rules/agents remain, so a fully-removed
    // set is still reported.
    if (targetResult.target === "claude") {
      const renderOrphans = (
        orphans: { deleted: string[]; skipped: string[] },
        subdir: "rules" | "agents",
      ) => {
        for (const item of [...orphans.deleted].sort()) {
          const orphanPath = formatPath(path.join(targetDir, config.dir, subdir, item));
          consoleLines.push(`    ${pc.red("-")} ${orphanPath} ${pc.dim("(removed)")}`);
          summaryLines.push(`  - \`${config.dir}/${subdir}/${item}\` (removed)`);
        }
        for (const item of [...orphans.skipped].sort()) {
          const orphanPath = formatPath(path.join(targetDir, config.dir, subdir, item));
          consoleLines.push(
            `    ${pc.yellow("!")} ${orphanPath} ${pc.dim("(orphaned but skipped)")}`,
          );
          summaryLines.push(`  - \`${config.dir}/${subdir}/${item}\` (orphaned but skipped)`);
        }
      };

      renderOrphans(ruleOrphanResult, "rules");
      renderOrphans(agentOrphanResult, "agents");
    }
  }

  // Workflow files status
  if (workflowResult) {
    for (const filename of workflowResult.created) {
      const workflowPath = formatPath(path.join(targetDir, ".github/workflows", filename));
      consoleLines.push(`  ${pc.green("+")} ${workflowPath} ${pc.dim("(created)")}`);
      summaryLines.push(`- \`.github/workflows/${filename}\` (created)`);
    }
    for (const filename of workflowResult.updated) {
      const workflowPath = formatPath(path.join(targetDir, ".github/workflows", filename));
      consoleLines.push(`  ${pc.yellow("~")} ${workflowPath} ${pc.dim("(updated)")}`);
      summaryLines.push(`- \`.github/workflows/${filename}\` (updated)`);
    }
    for (const filename of workflowResult.unchanged) {
      const workflowPath = formatPath(path.join(targetDir, ".github/workflows", filename));
      consoleLines.push(`  ${pc.dim("-")} ${workflowPath} ${pc.dim("(unchanged)")}`);
      summaryLines.push(`- \`.github/workflows/${filename}\` (unchanged)`);
    }
  }

  // Lockfile status
  const lockfilePath = formatPath(path.join(targetDir, ".agconf", "agconf.lock"));
  consoleLines.push(`  ${pc.green("+")} ${lockfilePath}`);
  summaryLines.push("- `.agconf/lockfile.json` (updated)");

  // Git hook status
  const hookPath = formatPath(path.join(targetDir, ".git/hooks/pre-commit"));
  if (hookResult === null) {
    consoleLines.push(`  ${pc.yellow("!")} ${hookPath} ${pc.dim("(skipped)")}`);
    summaryLines.push("- `.git/hooks/pre-commit` (skipped)");
  } else if (hookResult.installed) {
    if (hookResult.wasAppended && hookResult.wasUpdated) {
      consoleLines.push(`  ${pc.yellow("~")} ${hookPath} ${pc.dim("(updated in existing hook)")}`);
      summaryLines.push("- `.git/hooks/pre-commit` (updated in existing hook)");
    } else if (hookResult.wasAppended && hookResult.alreadyExisted && !hookResult.wasUpdated) {
      consoleLines.push(`  ${pc.dim("-")} ${hookPath} ${pc.dim("(unchanged)")}`);
      summaryLines.push("- `.git/hooks/pre-commit` (unchanged)");
    } else if (hookResult.wasAppended && !hookResult.wasUpdated) {
      consoleLines.push(`  ${pc.green("+")} ${hookPath} ${pc.dim("(appended to existing hook)")}`);
      summaryLines.push("- `.git/hooks/pre-commit` (appended to existing hook)");
    } else if (hookResult.alreadyExisted && !hookResult.wasUpdated) {
      consoleLines.push(`  ${pc.dim("-")} ${hookPath} ${pc.dim("(unchanged)")}`);
      summaryLines.push("- `.git/hooks/pre-commit` (unchanged)");
    } else if (hookResult.wasUpdated) {
      consoleLines.push(`  ${pc.yellow("~")} ${hookPath} ${pc.dim("(updated)")}`);
      summaryLines.push("- `.git/hooks/pre-commit` (updated)");
    } else {
      consoleLines.push(`  ${pc.green("+")} ${hookPath} ${pc.dim("(installed)")}`);
      summaryLines.push("- `.git/hooks/pre-commit` (installed)");
    }
  } else if (hookResult.alreadyExisted) {
    consoleLines.push(
      `  ${pc.yellow("!")} ${hookPath} ${pc.dim("(skipped - custom hook exists)")}`,
    );
    summaryLines.push("- `.git/hooks/pre-commit` (skipped - custom hook exists)");
  }

  consoleLines.push("");
  consoleLines.push(pc.dim(`Source: ${formatSourceString(resolvedSource.source)}`));
  if (resolvedVersion.version) {
    consoleLines.push(pc.dim(`Version: ${resolvedVersion.version}`));
  }
  if (targets.length > 1) {
    consoleLines.push(pc.dim(`Targets: ${targets.join(", ")}`));
  }

  return { consoleLines, summaryLines };
}
