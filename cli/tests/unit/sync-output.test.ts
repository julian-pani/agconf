import { describe, expect, it } from "vitest";
import { type RenderSyncSummaryInput, renderSyncSummary } from "../../src/commands/sync-output.js";
import type { SyncResult } from "../../src/core/sync.js";

function baseResult(overrides: Partial<SyncResult> = {}): SyncResult {
  return {
    lockfile: {} as SyncResult["lockfile"],
    agentsMd: { merged: true, changed: false, preservedRepoContent: false },
    claudeMd: { created: false, updated: false, deletedDotClaudeClaudeMd: false },
    targets: [{ target: "claude", skills: { copied: 0 } }],
    skills: { synced: [], modified: [], totalCopied: 0, validationErrors: [] },
    adopted: [],
    ...overrides,
  };
}

function baseInput(overrides: Partial<RenderSyncSummaryInput> = {}): RenderSyncSummaryInput {
  return {
    result: baseResult(),
    targetDir: "/repo",
    targets: ["claude"],
    previousSkills: [],
    previousRules: [],
    previousAgents: [],
    orphanResult: { deleted: [], skipped: [] },
    ruleOrphanResult: { deleted: [], skipped: [] },
    agentOrphanResult: { deleted: [], skipped: [] },
    workflowResult: null,
    hookResult: {
      installed: true,
      path: "/repo/.git/hooks/pre-commit",
      alreadyExisted: false,
      wasUpdated: false,
      wasAppended: false,
    },
    resolvedSource: {
      source: { type: "local", path: "/canonical" },
      basePath: "/canonical",
      agentsMdPath: "/canonical/AGENTS.md",
      skillsPath: "/canonical/skills",
      rulesPath: null,
      agentsPath: null,
      mcpsPath: null,
      markerPrefix: "agconf",
    },
    resolvedVersion: { version: undefined },
    commandName: "sync",
    expandChanges: false,
    ...overrides,
  };
}

describe("renderSyncSummary", () => {
  it("returns both console and markdown lines without performing I/O", () => {
    const { consoleLines, summaryLines } = renderSyncSummary(baseInput());
    expect(consoleLines.length).toBeGreaterThan(0);
    expect(summaryLines.length).toBeGreaterThan(0);
    // Header is console-only, never part of the markdown summary.
    expect(consoleLines.some((l) => l.includes("Sync complete:"))).toBe(true);
    expect(summaryLines.some((l) => l.includes("Sync complete:"))).toBe(false);
  });

  it("marks the pre-commit hook as skipped when installation was not performed", () => {
    const { consoleLines, summaryLines } = renderSyncSummary(baseInput({ hookResult: null }));
    expect(summaryLines).toContain("- `.git/hooks/pre-commit` (skipped)");
    expect(consoleLines.some((l) => l.includes("pre-commit") && l.includes("(skipped)"))).toBe(
      true,
    );
  });

  it("renders the .pre-commit-config.yaml registration for the pre-commit path", () => {
    const { consoleLines, summaryLines } = renderSyncSummary(
      baseInput({
        hookResult: {
          mode: "pre-commit",
          installed: true,
          path: "/repo/.pre-commit-config.yaml",
          alreadyExisted: true,
          wasUpdated: false,
          wasAppended: true,
          preCommit: { action: "registered", installNeeded: false },
        },
      }),
    );
    expect(summaryLines).toContain("- `.pre-commit-config.yaml` (agconf-check hook registered)");
    // The standalone git-hook line must not appear on the pre-commit path.
    expect(summaryLines.some((l) => l.includes(".git/hooks/pre-commit"))).toBe(false);
    expect(
      consoleLines.some((l) => l.includes(".pre-commit-config.yaml") && l.includes("registered")),
    ).toBe(true);
  });

  it("uses '(updated)' and an install hint for a pre-commit update needing activation", () => {
    const { consoleLines, summaryLines } = renderSyncSummary(
      baseInput({
        hookResult: {
          mode: "pre-commit",
          installed: true,
          path: "/repo/.pre-commit-config.yaml",
          alreadyExisted: true,
          wasUpdated: true,
          wasAppended: false,
          preCommit: { action: "updated", installNeeded: true },
        },
      }),
    );
    expect(summaryLines).toContain("- `.pre-commit-config.yaml` (agconf-check hook updated)");
    expect(summaryLines).toContain("  - Run `pre-commit install` to activate the hook");
    expect(consoleLines.some((l) => l.includes("pre-commit install"))).toBe(true);
  });

  it("reports AGENTS.md as created when not merged", () => {
    const input = baseInput({
      result: baseResult({
        agentsMd: { merged: false, changed: false, preservedRepoContent: false },
      }),
    });
    const { summaryLines } = renderSyncSummary(input);
    expect(summaryLines).toContain("- `AGENTS.md` (created)");
  });

  it("uses '(updated)' for sync and '(merged)' for init when AGENTS.md changed", () => {
    const changed = baseResult({
      agentsMd: { merged: true, changed: true, preservedRepoContent: false },
    });
    const sync = renderSyncSummary(baseInput({ result: changed, commandName: "sync" }));
    expect(sync.summaryLines).toContain("- `AGENTS.md` (updated)");

    const init = renderSyncSummary(baseInput({ result: changed, commandName: "init" }));
    expect(init.summaryLines).toContain("- `AGENTS.md` (merged)");
  });

  it("lists new skills and notes the deleted legacy .claude/CLAUDE.md", () => {
    const input = baseInput({
      result: baseResult({
        claudeMd: { created: false, updated: true, deletedDotClaudeClaudeMd: true },
        targets: [{ target: "claude", skills: { copied: 4 } }],
        skills: { synced: ["alpha", "beta"], modified: [], totalCopied: 4, validationErrors: [] },
      }),
    });
    const { summaryLines } = renderSyncSummary(input);
    expect(summaryLines).toContain(
      "- `.claude/CLAUDE.md` (deleted, content merged into AGENTS.md)",
    );
    expect(summaryLines.some((l) => l.includes("`.claude/skills/alpha/` (new)"))).toBe(true);
    expect(summaryLines.some((l) => l.includes("`.claude/skills/beta/` (new)"))).toBe(true);
  });

  it("truncates change lists to 5 by default and expands when requested", () => {
    const synced = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"];
    const result = baseResult({
      targets: [{ target: "claude", skills: { copied: 7 } }],
      skills: { synced, modified: [], totalCopied: 7, validationErrors: [] },
    });

    const truncated = renderSyncSummary(baseInput({ result, expandChanges: false }));
    const newLines = truncated.summaryLines.filter((l) => l.includes("(new)"));
    expect(newLines).toHaveLength(5);
    expect(truncated.summaryLines.some((l) => l.includes("... 2 more new"))).toBe(true);

    const expanded = renderSyncSummary(baseInput({ result, expandChanges: true }));
    const expandedNew = expanded.summaryLines.filter((l) => l.includes("(new)"));
    expect(expandedNew).toHaveLength(7);
    expect(expanded.summaryLines.some((l) => l.includes("more new"))).toBe(false);
  });

  it("notes that agents are skipped for a Codex-only target", () => {
    const input = baseInput({
      targets: ["codex"],
      result: baseResult({
        targets: [{ target: "codex", skills: { copied: 0 } }],
        agents: {
          synced: [],
          modified: [],
          contentHash: "",
          validationErrors: [],
          skipped: true,
        },
      }),
    });
    const { summaryLines } = renderSyncSummary(input);
    expect(summaryLines).toContain("- Agents skipped (Codex does not support sub-agents)");
  });
});
