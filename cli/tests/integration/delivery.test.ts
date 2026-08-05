import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify as yamlStringify } from "yaml";
import { resolveLocalSource } from "../../src/core/source.js";
import {
  deleteOrphanedSkills,
  findOrphanedSkills,
  sync,
  UnmanagedOverwriteError,
} from "../../src/core/sync.js";

/**
 * Integration coverage for the per-type delivery map (F2 in
 * cli/docs/DISTRIBUTION_SCOPES.md): skills/agents/mcps set to "plugin" or "off"
 * are skipped by sync and dropped from the lockfile, so a plugin can deliver them
 * without duplication.
 */
describe("delivery map (skills/agents/mcps)", () => {
  let targetDir: string;
  let sourceDir: string;

  const exists = (p: string): Promise<boolean> =>
    fs
      .access(p)
      .then(() => true)
      .catch(() => false);

  beforeEach(async () => {
    targetDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-delivery-target-"));
    sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-delivery-source-"));

    await fs.mkdir(path.join(sourceDir, "instructions"), { recursive: true });
    await fs.mkdir(path.join(sourceDir, "skills", "test-skill"), { recursive: true });
    await fs.mkdir(path.join(sourceDir, "agents"), { recursive: true });

    // Canonical config declares an agents dir so resolvedSource.agentsPath is set.
    await fs.writeFile(
      path.join(sourceDir, "agconf.yaml"),
      yamlStringify({
        version: "1.0.0",
        meta: { name: "test-canonical" },
        content: { agents_dir: "agents" },
        targets: ["claude"],
      }),
      "utf-8",
    );

    await fs.writeFile(
      path.join(sourceDir, "instructions", "AGENTS.md"),
      "# Global Standards\n\nCompany standards.",
      "utf-8",
    );
    await fs.writeFile(
      path.join(sourceDir, "skills", "test-skill", "SKILL.md"),
      "---\nname: test-skill\ndescription: A test skill\n---\n\n# Test Skill\n\nBody.",
      "utf-8",
    );
    await fs.writeFile(
      path.join(sourceDir, "agents", "reviewer.md"),
      "---\nname: reviewer\ndescription: Reviews code\n---\n\nReview things.",
      "utf-8",
    );
  });

  afterEach(async () => {
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.rm(sourceDir, { recursive: true, force: true });
  });

  const skillMd = () => path.join(targetDir, ".claude", "skills", "test-skill", "SKILL.md");
  const agentMd = () => path.join(targetDir, ".claude", "agents", "reviewer.md");

  it("defaults to syncing every type (back-compat, INV-9)", async () => {
    const resolvedSource = await resolveLocalSource({ path: sourceDir });
    const result = await sync(targetDir, resolvedSource, { override: false, targets: ["claude"] });

    expect(await exists(skillMd())).toBe(true);
    expect(await exists(agentMd())).toBe(true);
    expect(result.skills.synced).toEqual(["test-skill"]);
    expect(result.lockfile.content.skills).toEqual(["test-skill"]);
    expect(result.lockfile.content.agents?.files).toEqual(["reviewer.md"]);
  });

  it("skips skills when delivery.skills is 'plugin' and tracks none", async () => {
    const resolvedSource = await resolveLocalSource({ path: sourceDir });
    const result = await sync(targetDir, resolvedSource, {
      override: false,
      targets: ["claude"],
      delivery: { skills: "plugin" },
    });

    // Skills skipped...
    expect(await exists(skillMd())).toBe(false);
    expect(result.skills.synced).toEqual([]);
    expect(result.lockfile.content.skills).toEqual([]);
    // ...but instructions and agents (default sync) still land.
    expect(await exists(path.join(targetDir, "AGENTS.md"))).toBe(true);
    expect(await exists(agentMd())).toBe(true);
  });

  it("skips agents when delivery.agents is 'off' and tracks none", async () => {
    const resolvedSource = await resolveLocalSource({ path: sourceDir });
    const result = await sync(targetDir, resolvedSource, {
      override: false,
      targets: ["claude"],
      delivery: { agents: "off" },
    });

    expect(await exists(agentMd())).toBe(false);
    expect(result.lockfile.content.agents).toBeUndefined();
    // Skills (default sync) still land.
    expect(await exists(skillMd())).toBe(true);
    expect(result.lockfile.content.skills).toEqual(["test-skill"]);
  });

  it("emits an empty synced set on sync->plugin transition, which orphan-cleans prior files (INV-5)", async () => {
    // First sync with defaults: skill is written and tracked.
    let resolvedSource = await resolveLocalSource({ path: sourceDir });
    const first = await sync(targetDir, resolvedSource, { override: false, targets: ["claude"] });
    expect(await exists(skillMd())).toBe(true);
    const previousSkills = first.lockfile.content.skills;
    expect(previousSkills).toEqual(["test-skill"]);

    // Flip skills to plugin: sync now tracks none.
    resolvedSource = await resolveLocalSource({ path: sourceDir });
    const second = await sync(targetDir, resolvedSource, {
      override: false,
      targets: ["claude"],
      delivery: { skills: "plugin" },
    });
    expect(second.skills.synced).toEqual([]);
    expect(second.lockfile.content.skills).toEqual([]);

    // The empty synced set is what drives orphan cleanup (performSync wiring).
    const orphaned = findOrphanedSkills(previousSkills, second.skills.synced);
    expect(orphaned).toEqual(["test-skill"]);
    const { deleted } = await deleteOrphanedSkills(targetDir, orphaned, ["claude"], previousSkills);
    expect(deleted).toContain("test-skill");
    expect(await exists(skillMd())).toBe(false);
  });

  it("does not flag an unmanaged skill collision when skills are not synced", async () => {
    // Pre-existing unmanaged local skill that DIFFERS from canonical.
    await fs.mkdir(path.join(targetDir, ".claude", "skills", "test-skill"), { recursive: true });
    await fs.writeFile(skillMd(), "# Locally authored, different content", "utf-8");

    const resolvedSource = await resolveLocalSource({ path: sourceDir });

    // With skills synced this would throw UnmanagedOverwriteError; with skills
    // delivered by plugin the collision guard must not fire for skills.
    await expect(
      sync(targetDir, resolvedSource, {
        override: false,
        targets: ["claude"],
        delivery: { skills: "plugin" },
      }),
    ).resolves.toBeDefined();

    // The local file is left untouched.
    expect(await fs.readFile(skillMd(), "utf-8")).toContain("Locally authored");
  });

  it("throws for an unmanaged skill collision when skills ARE synced (guard still active)", async () => {
    await fs.mkdir(path.join(targetDir, ".claude", "skills", "test-skill"), { recursive: true });
    await fs.writeFile(skillMd(), "# Locally authored, different content", "utf-8");

    const resolvedSource = await resolveLocalSource({ path: sourceDir });
    await expect(
      sync(targetDir, resolvedSource, { override: false, targets: ["claude"] }),
    ).rejects.toBeInstanceOf(UnmanagedOverwriteError);
  });
});
