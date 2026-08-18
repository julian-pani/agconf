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
    migratedCodexSkills: { moved: [], skipped: [] },
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

  it("reports CLAUDE.md as created, reference-only, or unchanged", () => {
    const created = renderSyncSummary(
      baseInput({
        result: baseResult({
          claudeMd: { created: true, updated: false, deletedDotClaudeClaudeMd: false },
        }),
      }),
    );
    expect(created.summaryLines).toContain("- `CLAUDE.md` (created)");

    // Updated without a .claude/CLAUDE.md consolidation → reference-only hint.
    const referenced = renderSyncSummary(
      baseInput({
        result: baseResult({
          claudeMd: { created: false, updated: true, deletedDotClaudeClaudeMd: false },
        }),
      }),
    );
    expect(referenced.summaryLines).toContain("- `CLAUDE.md` (reference added)");
    expect(referenced.summaryLines.some((l) => l.includes(".claude/CLAUDE.md"))).toBe(false);

    const unchanged = renderSyncSummary(baseInput());
    expect(unchanged.summaryLines).toContain("- `CLAUDE.md` (unchanged)");
  });

  it("marks skills as unchanged when nothing was added, updated, or removed", () => {
    const { summaryLines } = renderSyncSummary(
      baseInput({
        previousSkills: ["alpha"],
        result: baseResult({
          targets: [{ target: "claude", skills: { copied: 2 } }],
          skills: { synced: ["alpha"], modified: [], totalCopied: 2, validationErrors: [] },
        }),
      }),
    );
    expect(summaryLines).toContain("- `.claude/skills/` (total: 1 skills, 2 files) (unchanged)");
    // No per-skill new/updated bullets when the re-sync changed nothing.
    const skillItems = summaryLines.filter((l) => l.includes("`.claude/skills/alpha/`"));
    expect(skillItems).toEqual([]);
  });

  it("distinguishes deleted from skipped orphaned skills", () => {
    const { summaryLines } = renderSyncSummary(
      baseInput({
        previousSkills: ["gone", "kept-locally"],
        orphanResult: { deleted: ["gone"], skipped: ["kept-locally"] },
      }),
    );
    expect(summaryLines).toContain("  - `.claude/skills/gone/` (removed)");
    expect(summaryLines).toContain("  - `.claude/skills/kept-locally/` (orphaned but skipped)");
  });

  it("renders orphaned rules and agents (removed and skipped) even when none remain", () => {
    const { summaryLines } = renderSyncSummary(
      baseInput({
        ruleOrphanResult: { deleted: ["security/old.md"], skipped: ["security/mine.md"] },
        agentOrphanResult: { deleted: ["old-agent.md"], skipped: ["my-agent.md"] },
      }),
    );
    expect(summaryLines).toContain("  - `.claude/rules/security/old.md` (removed)");
    expect(summaryLines).toContain("  - `.claude/rules/security/mine.md` (orphaned but skipped)");
    expect(summaryLines).toContain("  - `.claude/agents/old-agent.md` (removed)");
    expect(summaryLines).toContain("  - `.claude/agents/my-agent.md` (orphaned but skipped)");
  });

  it("maps orphaned Codex agents to their .toml filenames and skips rule orphans", () => {
    const { summaryLines } = renderSyncSummary(
      baseInput({
        targets: ["codex"],
        result: baseResult({ targets: [{ target: "codex", skills: { copied: 0 } }] }),
        // Codex rules live in the AGENTS.md section, so file-based rule orphans
        // must not be reported for that target.
        ruleOrphanResult: { deleted: ["security/old.md"], skipped: [] },
        agentOrphanResult: { deleted: ["old-agent.md"], skipped: [] },
      }),
    );
    expect(summaryLines).toContain("  - `.codex/agents/old-agent.toml` (removed)");
    expect(summaryLines.some((l) => l.includes("rules/security/old.md"))).toBe(false);
  });

  it("reports the legacy .codex/skills cleanup (removed and left in place)", () => {
    const { consoleLines, summaryLines } = renderSyncSummary(
      baseInput({
        targets: ["codex"],
        result: baseResult({
          targets: [{ target: "codex", skills: { copied: 0 } }],
          migratedCodexSkills: { moved: ["beta", "alpha"], skipped: ["mine"] },
        }),
      }),
    );
    expect(
      summaryLines.some((l) => l.includes("Removed 2 legacy Codex skill(s)") && l.includes("2")),
    ).toBe(true);
    // Sorted for a stable summary.
    const legacy = summaryLines.filter((l) => l.startsWith("  - `.codex/skills/"));
    expect(legacy).toEqual([
      "  - `.codex/skills/alpha/` (legacy removed)",
      "  - `.codex/skills/beta/` (legacy removed)",
      "  - `.codex/skills/mine/` (legacy, left in place)",
    ]);
    expect(consoleLines.some((l) => l.includes("legacy, left in place"))).toBe(true);
  });

  it("lists created, updated, and unchanged workflow files", () => {
    const { summaryLines } = renderSyncSummary(
      baseInput({
        workflowResult: {
          created: ["agconf-sync.yml"],
          updated: ["agconf-check.yml"],
          unchanged: ["agconf-other.yml"],
        } as RenderSyncSummaryInput["workflowResult"],
      }),
    );
    expect(summaryLines).toContain("- `.github/workflows/agconf-sync.yml` (created)");
    expect(summaryLines).toContain("- `.github/workflows/agconf-check.yml` (updated)");
    expect(summaryLines).toContain("- `.github/workflows/agconf-other.yml` (unchanged)");
  });

  it("appends the version and multi-target footers only when applicable", () => {
    const single = renderSyncSummary(baseInput());
    expect(single.consoleLines.some((l) => l.includes("Version:"))).toBe(false);
    expect(single.consoleLines.some((l) => l.includes("Targets:"))).toBe(false);

    const multi = renderSyncSummary(
      baseInput({
        resolvedVersion: { version: "1.4.0" },
        targets: ["claude", "codex"],
        result: baseResult({
          targets: [
            { target: "claude", skills: { copied: 0 } },
            { target: "codex", skills: { copied: 0 } },
          ],
        }),
      }),
    );
    expect(multi.consoleLines.some((l) => l.includes("Version: 1.4.0"))).toBe(true);
    expect(multi.consoleLines.some((l) => l.includes("Targets: claude, codex"))).toBe(true);
  });

  describe("standalone git hook status", () => {
    const hook = (
      overrides: Partial<NonNullable<RenderSyncSummaryInput["hookResult"]>>,
    ): RenderSyncSummaryInput["hookResult"] => ({
      installed: true,
      path: "/repo/.git/hooks/pre-commit",
      alreadyExisted: false,
      wasUpdated: false,
      wasAppended: false,
      ...overrides,
    });

    const hookLine = (overrides: Partial<NonNullable<RenderSyncSummaryInput["hookResult"]>>) =>
      renderSyncSummary(baseInput({ hookResult: hook(overrides) })).summaryLines.find((l) =>
        l.includes(".git/hooks/pre-commit"),
      );

    it("reports a fresh install", () => {
      expect(hookLine({})).toBe("- `.git/hooks/pre-commit` (installed)");
    });

    it("reports an agconf section updated inside an existing custom hook", () => {
      expect(hookLine({ wasAppended: true, wasUpdated: true, alreadyExisted: true })).toBe(
        "- `.git/hooks/pre-commit` (updated in existing hook)",
      );
    });

    it("reports an unchanged agconf section in an existing custom hook", () => {
      expect(hookLine({ wasAppended: true, alreadyExisted: true })).toBe(
        "- `.git/hooks/pre-commit` (unchanged)",
      );
    });

    it("reports a first-time append to a custom hook", () => {
      expect(hookLine({ wasAppended: true })).toBe(
        "- `.git/hooks/pre-commit` (appended to existing hook)",
      );
    });

    it("reports an unchanged agconf-owned hook", () => {
      expect(hookLine({ alreadyExisted: true })).toBe("- `.git/hooks/pre-commit` (unchanged)");
    });

    it("reports an updated agconf-owned hook", () => {
      expect(hookLine({ wasUpdated: true })).toBe("- `.git/hooks/pre-commit` (updated)");
    });

    it("reports a skip when a custom hook exists and agconf did not install", () => {
      expect(hookLine({ installed: false, alreadyExisted: true })).toBe(
        "- `.git/hooks/pre-commit` (skipped - custom hook exists)",
      );
    });

    it("emits no hook line at all when nothing was installed and nothing existed", () => {
      expect(hookLine({ installed: false })).toBeUndefined();
    });

    it("defaults a pre-commit result with no action to '(unchanged)'", () => {
      const { summaryLines } = renderSyncSummary(
        baseInput({
          hookResult: {
            mode: "pre-commit",
            installed: true,
            path: "/repo/.pre-commit-config.yaml",
            alreadyExisted: true,
            wasUpdated: false,
            wasAppended: false,
          },
        }),
      );
      expect(summaryLines).toContain("- `.pre-commit-config.yaml` (agconf-check hook unchanged)");
    });

    it("labels a newly created .pre-commit-config.yaml", () => {
      const { summaryLines } = renderSyncSummary(
        baseInput({
          hookResult: {
            mode: "pre-commit",
            installed: true,
            path: "/repo/.pre-commit-config.yaml",
            alreadyExisted: false,
            wasUpdated: false,
            wasAppended: false,
            preCommit: { action: "created", installNeeded: false },
          },
        }),
      );
      expect(summaryLines).toContain(
        "- `.pre-commit-config.yaml` (created, agconf-check hook registered)",
      );
    });
  });

  it("renders Codex agents under .codex/agents as .toml files", () => {
    const input = baseInput({
      targets: ["codex"],
      previousAgents: [],
      result: baseResult({
        targets: [{ target: "codex", skills: { copied: 0 } }],
        agents: {
          synced: ["code-reviewer.md"],
          modified: ["code-reviewer.md"],
          contentHash: "sha256:abcabcabcabc",
          validationErrors: [],
        },
      }),
    });
    const { summaryLines } = renderSyncSummary(input);
    expect(summaryLines).toContain("- `.codex/agents/` (total: 1 agents) (updated)");
    // Identity is the canonical `.md`, but the on-disk Codex file is `.toml`.
    expect(summaryLines.some((l) => l.includes(".codex/agents/code-reviewer.toml"))).toBe(true);
    expect(summaryLines.some((l) => l.includes("code-reviewer.md"))).toBe(false);
  });
});
