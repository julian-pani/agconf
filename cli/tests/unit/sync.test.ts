import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addManagedMetadata } from "../../src/core/skill-metadata.js";
import { deleteOrphanedSkills, findOrphanedSkills } from "../../src/core/sync.js";

describe("sync", () => {
  describe("findOrphanedSkills", () => {
    it("returns skills that were in previous but not in current", () => {
      const previous = ["skill-a", "skill-b", "skill-c"];
      const current = ["skill-a", "skill-c"];

      const orphans = findOrphanedSkills(previous, current);

      expect(orphans).toEqual(["skill-b"]);
    });

    it("returns empty array when no orphans", () => {
      const previous = ["skill-a", "skill-b"];
      const current = ["skill-a", "skill-b", "skill-c"];

      const orphans = findOrphanedSkills(previous, current);

      expect(orphans).toEqual([]);
    });

    it("returns all previous skills when current is empty", () => {
      const previous = ["skill-a", "skill-b"];
      const current: string[] = [];

      const orphans = findOrphanedSkills(previous, current);

      expect(orphans).toEqual(["skill-a", "skill-b"]);
    });

    it("returns empty array when previous is empty", () => {
      const previous: string[] = [];
      const current = ["skill-a", "skill-b"];

      const orphans = findOrphanedSkills(previous, current);

      expect(orphans).toEqual([]);
    });
  });

  describe("deleteOrphanedSkills", () => {
    let tempDir: string;

    beforeEach(async () => {
      // Create a temporary directory for tests
      tempDir = await fs.mkdtemp(path.join(process.cwd(), ".test-"));
    });

    afterEach(async () => {
      // Clean up temporary directory
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    const createSkillFile = async (
      skillName: string,
      target: string,
      content: string,
    ): Promise<void> => {
      const skillDir = path.join(tempDir, `.${target}`, "skills", skillName);
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, "SKILL.md"), content);
    };

    const skillExists = async (skillName: string, target: string): Promise<boolean> => {
      try {
        await fs.access(path.join(tempDir, `.${target}`, "skills", skillName));
        return true;
      } catch {
        return false;
      }
    };

    const SAMPLE_SKILL = `---
name: test-skill
description: A test skill
---

# Test Skill
`;

    it("deletes managed skill that was in previous lockfile", async () => {
      const managedContent = addManagedMetadata(SAMPLE_SKILL);
      await createSkillFile("orphan-skill", "claude", managedContent);

      const result = await deleteOrphanedSkills(
        tempDir,
        ["orphan-skill"],
        ["claude"],
        ["orphan-skill"], // Was in previous lockfile
      );

      expect(result.deleted).toEqual(["orphan-skill"]);
      expect(result.skipped).toEqual([]);
      expect(await skillExists("orphan-skill", "claude")).toBe(false);
    });

    it("deletes managed skill with matching hash even if not in lockfile", async () => {
      // Create a managed skill that hasn't been modified
      const managedContent = addManagedMetadata(SAMPLE_SKILL);
      await createSkillFile("orphan-skill", "claude", managedContent);

      const result = await deleteOrphanedSkills(
        tempDir,
        ["orphan-skill"],
        ["claude"],
        [], // NOT in previous lockfile, but hash matches
      );

      expect(result.deleted).toEqual(["orphan-skill"]);
      expect(result.skipped).toEqual([]);
      expect(await skillExists("orphan-skill", "claude")).toBe(false);
    });

    it("skips managed skill not in lockfile AND modified", async () => {
      // Create a managed skill that has been modified
      const managedContent = addManagedMetadata(SAMPLE_SKILL);
      const modifiedContent = managedContent.replace("A test skill", "Modified description");
      await createSkillFile("orphan-skill", "claude", modifiedContent);

      const result = await deleteOrphanedSkills(
        tempDir,
        ["orphan-skill"],
        ["claude"],
        [], // NOT in previous lockfile
      );

      expect(result.deleted).toEqual([]);
      expect(result.skipped).toEqual(["orphan-skill"]);
      expect(await skillExists("orphan-skill", "claude")).toBe(true);
    });

    it("skips non-managed skills", async () => {
      // Create a skill without agent-conf metadata
      await createSkillFile("orphan-skill", "claude", SAMPLE_SKILL);

      const result = await deleteOrphanedSkills(
        tempDir,
        ["orphan-skill"],
        ["claude"],
        ["orphan-skill"], // Even if in lockfile, should skip if not marked as managed
      );

      expect(result.deleted).toEqual([]);
      expect(result.skipped).toEqual(["orphan-skill"]);
      expect(await skillExists("orphan-skill", "claude")).toBe(true);
    });

    it("skips skills without SKILL.md file", async () => {
      // Create skill directory without SKILL.md
      const skillDir = path.join(tempDir, ".claude", "skills", "orphan-skill");
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, "other-file.md"), "content");

      const result = await deleteOrphanedSkills(
        tempDir,
        ["orphan-skill"],
        ["claude"],
        ["orphan-skill"],
      );

      expect(result.deleted).toEqual([]);
      expect(result.skipped).toEqual(["orphan-skill"]);
      expect(await skillExists("orphan-skill", "claude")).toBe(true);
    });

    it("deletes skills from all targets", async () => {
      const managedContent = addManagedMetadata(SAMPLE_SKILL);
      await createSkillFile("orphan-skill", "claude", managedContent);
      await createSkillFile("orphan-skill", "codex", managedContent);

      const result = await deleteOrphanedSkills(
        tempDir,
        ["orphan-skill"],
        ["claude", "codex"],
        ["orphan-skill"],
      );

      expect(result.deleted).toEqual(["orphan-skill"]);
      expect(result.skipped).toEqual([]);
      expect(await skillExists("orphan-skill", "claude")).toBe(false);
      expect(await skillExists("orphan-skill", "codex")).toBe(false);
    });

    it("handles skill existing in some targets but not others", async () => {
      const managedContent = addManagedMetadata(SAMPLE_SKILL);
      await createSkillFile("orphan-skill", "claude", managedContent);
      // Not creating for codex

      const result = await deleteOrphanedSkills(
        tempDir,
        ["orphan-skill"],
        ["claude", "codex"],
        ["orphan-skill"],
      );

      expect(result.deleted).toEqual(["orphan-skill"]);
      expect(result.skipped).toEqual([]);
      expect(await skillExists("orphan-skill", "claude")).toBe(false);
    });

    it("handles non-existent skill directories gracefully", async () => {
      const result = await deleteOrphanedSkills(
        tempDir,
        ["non-existent-skill"],
        ["claude"],
        ["non-existent-skill"],
      );

      expect(result.deleted).toEqual([]);
      expect(result.skipped).toEqual([]);
    });

    it("handles multiple orphaned skills", async () => {
      const managedContent = addManagedMetadata(SAMPLE_SKILL);
      await createSkillFile("skill-a", "claude", managedContent);
      await createSkillFile("skill-b", "claude", managedContent);
      await createSkillFile("skill-c", "claude", SAMPLE_SKILL); // Not managed

      const result = await deleteOrphanedSkills(
        tempDir,
        ["skill-a", "skill-b", "skill-c"],
        ["claude"],
        ["skill-a", "skill-b", "skill-c"],
      );

      expect(result.deleted.sort()).toEqual(["skill-a", "skill-b"]);
      expect(result.skipped).toEqual(["skill-c"]);
      expect(await skillExists("skill-a", "claude")).toBe(false);
      expect(await skillExists("skill-b", "claude")).toBe(false);
      expect(await skillExists("skill-c", "claude")).toBe(true);
    });
  });
});
