import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify as yamlStringify } from "yaml";
import { getMarkers } from "../../src/core/markers.js";

// Use getMarkers() to get marker strings for tests
const markers = getMarkers();
const GLOBAL_START_MARKER = markers.globalStart;
const GLOBAL_END_MARKER = markers.globalEnd;
const REPO_START_MARKER = markers.repoStart;
const REPO_END_MARKER = markers.repoEnd;

import { resolveLocalSource } from "../../src/core/source.js";
import { getSyncStatus, sync } from "../../src/core/sync.js";

describe("init integration", () => {
  let tempTargetDir: string;
  let agentConfDir: string;

  beforeEach(async () => {
    // Create temp directories
    tempTargetDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-target-"));
    agentConfDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-source-"));

    // Create mock agconf repo structure
    await fs.mkdir(path.join(agentConfDir, "instructions"), { recursive: true });
    await fs.mkdir(path.join(agentConfDir, "skills", "test-skill", "references"), {
      recursive: true,
    });

    // Write mock AGENTS.md
    await fs.writeFile(
      path.join(agentConfDir, "instructions", "AGENTS.md"),
      "# Global Engineering Standards\n\nThese are the company standards.",
      "utf-8",
    );

    // Write mock skill files
    await fs.writeFile(
      path.join(agentConfDir, "skills", "test-skill", "SKILL.md"),
      "# Test Skill\n\nSkill instructions.",
      "utf-8",
    );
    await fs.writeFile(
      path.join(agentConfDir, "skills", "test-skill", "README.md"),
      "# Test Skill README\n\nHuman-readable docs.",
      "utf-8",
    );
  });

  afterEach(async () => {
    await fs.rm(tempTargetDir, { recursive: true, force: true });
    await fs.rm(agentConfDir, { recursive: true, force: true });
  });

  it("should sync from local source to empty target", async () => {
    const resolvedSource = await resolveLocalSource({ path: agentConfDir });
    const result = await sync(tempTargetDir, resolvedSource, {
      override: false,
      targets: ["claude"],
    });

    // Check AGENTS.md was created in root with markers
    const agentsMdPath = path.join(tempTargetDir, "AGENTS.md");
    const agentsMd = await fs.readFile(agentsMdPath, "utf-8");
    expect(agentsMd).toContain(GLOBAL_START_MARKER);
    expect(agentsMd).toContain(GLOBAL_END_MARKER);
    expect(agentsMd).toContain(REPO_START_MARKER);
    expect(agentsMd).toContain(REPO_END_MARKER);
    expect(agentsMd).toContain("# Global Engineering Standards");

    // Check CLAUDE.md was created in root with correct reference
    const claudeMdPath = path.join(tempTargetDir, "CLAUDE.md");
    const claudeMd = await fs.readFile(claudeMdPath, "utf-8");
    expect(claudeMd).toContain("@AGENTS.md");

    // Check skills were copied
    const skillPath = path.join(tempTargetDir, ".claude", "skills", "test-skill", "SKILL.md");
    const skillContent = await fs.readFile(skillPath, "utf-8");
    expect(skillContent).toContain("# Test Skill");

    // Check lockfile was created
    const lockfilePath = path.join(tempTargetDir, ".agconf", "lockfile.json");
    const lockfileExists = await fs
      .access(lockfilePath)
      .then(() => true)
      .catch(() => false);
    expect(lockfileExists).toBe(true);

    // Check result summary
    expect(result.agentsMd.merged).toBe(false);
    expect(result.claudeMd.created).toBe(true);
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]?.target).toBe("claude");
    expect(result.skills.synced).toContain("test-skill");
    expect(result.skills.totalCopied).toBeGreaterThan(0);
  });

  it("should preserve repo content on subsequent syncs", async () => {
    // First sync
    const resolvedSource = await resolveLocalSource({ path: agentConfDir });
    await sync(tempTargetDir, resolvedSource, { override: false, targets: ["claude"] });

    // Modify repo block content (AGENTS.md is in root)
    const agentsMdPath = path.join(tempTargetDir, "AGENTS.md");
    let agentsMd = await fs.readFile(agentsMdPath, "utf-8");
    agentsMd = agentsMd.replace(
      `${REPO_START_MARKER}\n<!-- Repository-specific instructions below -->`,
      `${REPO_START_MARKER}\n<!-- Repository-specific instructions below -->\n\n# My Custom Instructions\nDo special things.`,
    );
    await fs.writeFile(agentsMdPath, agentsMd, "utf-8");

    // Update source
    await fs.writeFile(
      path.join(agentConfDir, "instructions", "AGENTS.md"),
      "# Updated Global Standards\n\nNew version of standards.",
      "utf-8",
    );

    // Second sync
    const resolvedSource2 = await resolveLocalSource({ path: agentConfDir });
    const result = await sync(tempTargetDir, resolvedSource2, {
      override: false,
      targets: ["claude"],
    });

    // Verify merge behavior
    expect(result.agentsMd.merged).toBe(true);
    expect(result.agentsMd.preservedRepoContent).toBe(true);

    // Verify content
    const updatedAgentsMd = await fs.readFile(agentsMdPath, "utf-8");
    expect(updatedAgentsMd).toContain("# Updated Global Standards");
    expect(updatedAgentsMd).toContain("# My Custom Instructions");
  });

  it("should report correct status", async () => {
    // Initially not synced
    let status = await getSyncStatus(tempTargetDir);
    expect(status.hasSynced).toBe(false);
    expect(status.lockfile).toBeNull();

    // After sync
    const resolvedSource = await resolveLocalSource({ path: agentConfDir });
    await sync(tempTargetDir, resolvedSource, { override: false, targets: ["claude"] });

    status = await getSyncStatus(tempTargetDir);
    expect(status.hasSynced).toBe(true);
    expect(status.lockfile).not.toBeNull();
    expect(status.agentsMdExists).toBe(true);
    expect(status.skillsExist).toBe(true);
    expect(status.lockfile?.source.type).toBe("local");
  });

  it("should sync to multiple targets", async () => {
    const resolvedSource = await resolveLocalSource({ path: agentConfDir });
    const result = await sync(tempTargetDir, resolvedSource, {
      override: false,
      targets: ["claude", "codex"],
    });

    // Check skills were copied to both targets. Codex discovers project skills
    // under `.agents/skills` (not `.codex/skills`).
    const claudeSkillPath = path.join(tempTargetDir, ".claude", "skills", "test-skill", "SKILL.md");
    const codexSkillPath = path.join(tempTargetDir, ".agents", "skills", "test-skill", "SKILL.md");

    const claudeSkillExists = await fs
      .access(claudeSkillPath)
      .then(() => true)
      .catch(() => false);
    const codexSkillExists = await fs
      .access(codexSkillPath)
      .then(() => true)
      .catch(() => false);

    expect(claudeSkillExists).toBe(true);
    expect(codexSkillExists).toBe(true);

    // Check CLAUDE.md was created (only Claude uses instructions files)
    const claudeMdPath = path.join(tempTargetDir, "CLAUDE.md");
    const claudeMd = await fs.readFile(claudeMdPath, "utf-8");
    expect(claudeMd).toContain("@AGENTS.md");

    // Codex does NOT need a CODEX.md - it reads AGENTS.md directly
    const codexMdPath = path.join(tempTargetDir, ".codex", "CODEX.md");
    const codexMdExists = await fs
      .access(codexMdPath)
      .then(() => true)
      .catch(() => false);
    expect(codexMdExists).toBe(false);

    // Check result has both targets
    expect(result.targets).toHaveLength(2);
    expect(result.targets.map((t) => t.target)).toContain("claude");
    expect(result.targets.map((t) => t.target)).toContain("codex");
  });

  it("migrates legacy .codex/skills to .agents/skills on sync", async () => {
    const resolvedSource = await resolveLocalSource({ path: agentConfDir });

    // First sync writes Codex skills to the current `.agents/skills` location.
    await sync(tempTargetDir, resolvedSource, { override: false, targets: ["codex"] });
    const newSkillDir = path.join(tempTargetDir, ".agents", "skills", "test-skill");
    const legacySkillDir = path.join(tempTargetDir, ".codex", "skills", "test-skill");

    // Simulate a repo synced by an older agconf: a managed, unmodified copy of
    // the skill still living under the legacy `.codex/skills` path.
    await fs.cp(newSkillDir, legacySkillDir, { recursive: true });

    // Re-sync: the legacy copy should be migrated away, the new one kept.
    const result = await sync(tempTargetDir, resolvedSource, {
      override: false,
      targets: ["codex"],
    });

    expect(result.migratedCodexSkills.moved).toContain("test-skill");
    expect(result.migratedCodexSkills.skipped).toEqual([]);

    const legacyExists = await fs
      .access(legacySkillDir)
      .then(() => true)
      .catch(() => false);
    expect(legacyExists).toBe(false);

    // The emptied `.codex/skills` dir is pruned; the new skill remains.
    const legacyRootExists = await fs
      .access(path.join(tempTargetDir, ".codex", "skills"))
      .then(() => true)
      .catch(() => false);
    expect(legacyRootExists).toBe(false);
    const newExists = await fs
      .access(path.join(newSkillDir, "SKILL.md"))
      .then(() => true)
      .catch(() => false);
    expect(newExists).toBe(true);
  });

  it("should consolidate root CLAUDE.md into AGENTS.md and update root reference", async () => {
    // Create a root CLAUDE.md with content
    const rootClaudeMdPath = path.join(tempTargetDir, "CLAUDE.md");
    await fs.writeFile(rootClaudeMdPath, "# My Root CLAUDE Content\nSome instructions", "utf-8");

    const resolvedSource = await resolveLocalSource({ path: agentConfDir });
    const result = await sync(tempTargetDir, resolvedSource, {
      override: false,
      targets: ["claude"],
    });

    // Root CLAUDE.md should exist with reference (updated, not deleted)
    const rootClaudeMd = await fs.readFile(rootClaudeMdPath, "utf-8");
    expect(rootClaudeMd).toContain("@AGENTS.md");

    // .claude/CLAUDE.md should NOT exist
    const dotClaudeExists = await fs
      .access(path.join(tempTargetDir, ".claude", "CLAUDE.md"))
      .then(() => true)
      .catch(() => false);
    expect(dotClaudeExists).toBe(false);

    // Content should be merged into AGENTS.md
    const agentsMdPath = path.join(tempTargetDir, "AGENTS.md");
    const agentsMd = await fs.readFile(agentsMdPath, "utf-8");
    expect(agentsMd).toContain("# My Root CLAUDE Content");

    // Check result
    expect(result.claudeMd.updated).toBe(true);
    expect(result.claudeMd.deletedDotClaudeClaudeMd).toBe(false);
  });

  it("should consolidate CLAUDE.md even when only Codex is target", async () => {
    // Create a root CLAUDE.md with content (no @AGENTS.md reference)
    const rootClaudeMdPath = path.join(tempTargetDir, "CLAUDE.md");
    await fs.writeFile(rootClaudeMdPath, "# Codex-only test\nSome instructions", "utf-8");

    const resolvedSource = await resolveLocalSource({ path: agentConfDir });
    const result = await sync(tempTargetDir, resolvedSource, {
      override: false,
      targets: ["codex"], // Only Codex target
    });

    // Root CLAUDE.md should exist with reference (updated with @AGENTS.md)
    const rootClaudeMd = await fs.readFile(rootClaudeMdPath, "utf-8");
    expect(rootClaudeMd).toContain("@AGENTS.md");

    // Content should be merged into AGENTS.md (available to Codex)
    const agentsMdPath = path.join(tempTargetDir, "AGENTS.md");
    const agentsMd = await fs.readFile(agentsMdPath, "utf-8");
    expect(agentsMd).toContain("# Codex-only test");

    expect(result.claudeMd.updated).toBe(true);
    expect(result.claudeMd.deletedDotClaudeClaudeMd).toBe(false);
  });

  it("should merge content from both CLAUDE.md files during sync", async () => {
    // Create both CLAUDE.md files with different content
    const rootClaudeMdPath = path.join(tempTargetDir, "CLAUDE.md");
    await fs.writeFile(rootClaudeMdPath, "# Root content\nFrom root file", "utf-8");

    await fs.mkdir(path.join(tempTargetDir, ".claude"), { recursive: true });
    const dotClaudeMdPath = path.join(tempTargetDir, ".claude", "CLAUDE.md");
    await fs.writeFile(dotClaudeMdPath, "# Dotclaude content\nFrom .claude file", "utf-8");

    const resolvedSource = await resolveLocalSource({ path: agentConfDir });
    const result = await sync(tempTargetDir, resolvedSource, {
      override: false,
      targets: ["claude"],
    });

    // Both contents should be merged into AGENTS.md
    const agentsMdPath = path.join(tempTargetDir, "AGENTS.md");
    const agentsMd = await fs.readFile(agentsMdPath, "utf-8");
    expect(agentsMd).toContain("# Root content");
    expect(agentsMd).toContain("# Dotclaude content");

    // Root CLAUDE.md should have reference (updated)
    const rootClaudeMd = await fs.readFile(rootClaudeMdPath, "utf-8");
    expect(rootClaudeMd).toContain("@AGENTS.md");

    // .claude/CLAUDE.md should be deleted
    const dotClaudeExists = await fs
      .access(dotClaudeMdPath)
      .then(() => true)
      .catch(() => false);
    expect(dotClaudeExists).toBe(false);

    expect(result.claudeMd.deletedDotClaudeClaudeMd).toBe(true);
  });

  it("should use custom marker prefix from canonical config", async () => {
    const CUSTOM_PREFIX = "fbagents";

    // Create agconf.yaml with custom marker prefix
    const canonicalConfig = {
      version: "1.0.0",
      meta: {
        name: "test-canonical",
        organization: "test-org",
      },
      markers: {
        prefix: CUSTOM_PREFIX,
      },
    };
    await fs.writeFile(
      path.join(agentConfDir, "agconf.yaml"),
      yamlStringify(canonicalConfig),
      "utf-8",
    );

    // Create skill with proper frontmatter
    await fs.writeFile(
      path.join(agentConfDir, "skills", "test-skill", "SKILL.md"),
      `---
name: test-skill
description: A test skill
---

# Test Skill

Skill instructions.`,
      "utf-8",
    );

    const resolvedSource = await resolveLocalSource({ path: agentConfDir });
    await sync(tempTargetDir, resolvedSource, {
      override: false,
      targets: ["claude"],
    });

    // Check AGENTS.md uses custom prefix markers
    const agentsMdPath = path.join(tempTargetDir, "AGENTS.md");
    const agentsMd = await fs.readFile(agentsMdPath, "utf-8");

    expect(agentsMd).toContain(`<!-- ${CUSTOM_PREFIX}:global:start -->`);
    expect(agentsMd).toContain(`<!-- ${CUSTOM_PREFIX}:global:end -->`);
    expect(agentsMd).toContain(`<!-- ${CUSTOM_PREFIX}:repo:start -->`);
    expect(agentsMd).toContain(`<!-- ${CUSTOM_PREFIX}:repo:end -->`);
    // Should NOT contain default prefix
    expect(agentsMd).not.toContain("agconf:global");
    expect(agentsMd).not.toContain("agconf:repo");

    // Check skill metadata uses custom prefix
    const skillPath = path.join(tempTargetDir, ".claude", "skills", "test-skill", "SKILL.md");
    const skillContent = await fs.readFile(skillPath, "utf-8");

    // Should use custom prefix (with underscores)
    expect(skillContent).toContain("fbagents_managed");
    expect(skillContent).toContain("fbagents_content_hash");
    // Should NOT contain default prefix
    expect(skillContent).not.toContain("agent_conf_managed");
    expect(skillContent).not.toContain("agent_conf_content_hash");
  });
});
