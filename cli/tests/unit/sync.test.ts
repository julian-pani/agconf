import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addManagedMetadata, isManaged } from "../../src/core/managed-content.js";
import { deleteOrphanedSkills, findOrphanedSkills, syncRules } from "../../src/core/sync.js";

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
      // Create a skill without agconf metadata
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

    describe("custom metadata prefix", () => {
      const CUSTOM_PREFIX = "fbagents";

      it("deletes skill managed with custom prefix when using custom prefix", async () => {
        const managedContent = addManagedMetadata(SAMPLE_SKILL, { metadataPrefix: CUSTOM_PREFIX });
        await createSkillFile("orphan-skill", "claude", managedContent);

        // Verify it's managed with custom prefix
        expect(isManaged(managedContent, { metadataPrefix: CUSTOM_PREFIX })).toBe(true);
        expect(isManaged(managedContent)).toBe(false); // Not managed with default prefix

        const result = await deleteOrphanedSkills(
          tempDir,
          ["orphan-skill"],
          ["claude"],
          ["orphan-skill"],
          { metadataPrefix: CUSTOM_PREFIX },
        );

        expect(result.deleted).toEqual(["orphan-skill"]);
        expect(result.skipped).toEqual([]);
        expect(await skillExists("orphan-skill", "claude")).toBe(false);
      });

      it("skips skill managed with default prefix when using custom prefix", async () => {
        // Skill is managed with default prefix
        const managedContent = addManagedMetadata(SAMPLE_SKILL);
        await createSkillFile("orphan-skill", "claude", managedContent);

        // Should skip because we're looking for custom prefix managed skills
        const result = await deleteOrphanedSkills(
          tempDir,
          ["orphan-skill"],
          ["claude"],
          ["orphan-skill"],
          { metadataPrefix: CUSTOM_PREFIX },
        );

        expect(result.deleted).toEqual([]);
        expect(result.skipped).toEqual(["orphan-skill"]);
        expect(await skillExists("orphan-skill", "claude")).toBe(true);
      });

      it("skips skill managed with custom prefix when using default prefix", async () => {
        // Skill is managed with custom prefix
        const managedContent = addManagedMetadata(SAMPLE_SKILL, { metadataPrefix: CUSTOM_PREFIX });
        await createSkillFile("orphan-skill", "claude", managedContent);

        // Should skip because we're looking for default prefix managed skills
        const result = await deleteOrphanedSkills(
          tempDir,
          ["orphan-skill"],
          ["claude"],
          ["orphan-skill"],
          // No prefix option = use default
        );

        expect(result.deleted).toEqual([]);
        expect(result.skipped).toEqual(["orphan-skill"]);
        expect(await skillExists("orphan-skill", "claude")).toBe(true);
      });
    });
  });

  describe("rules sync", () => {
    let tempDir: string;
    let sourceRulesPath: string;
    let targetDir: string;

    beforeEach(async () => {
      // Create a temporary directory for tests
      tempDir = await fs.mkdtemp(path.join(process.cwd(), ".test-rules-"));
      sourceRulesPath = path.join(tempDir, "source-rules");
      targetDir = path.join(tempDir, "target");
      await fs.mkdir(sourceRulesPath, { recursive: true });
      await fs.mkdir(targetDir, { recursive: true });
    });

    afterEach(async () => {
      // Clean up temporary directory
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    const createRuleFile = async (relativePath: string, content: string): Promise<void> => {
      const fullPath = path.join(sourceRulesPath, relativePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf-8");
    };

    const readFile = async (filePath: string): Promise<string> => {
      return fs.readFile(filePath, "utf-8");
    };

    const fileExists = async (filePath: string): Promise<boolean> => {
      try {
        await fs.access(filePath);
        return true;
      } catch {
        return false;
      }
    };

    describe("syncRules", () => {
      it("should sync rules to Claude target", async () => {
        // Create source rules
        await createRuleFile("code-style.md", "# Code Style\n\nFollow these guidelines.");
        await createRuleFile(
          "security/auth.md",
          "---\npaths:\n  - src/auth/**/*.ts\n---\n\n# Authentication\n\nSecure auth rules.",
        );

        const agentsMdContent = "# AGENTS.md\n\nProject instructions.";

        const result = await syncRules({
          sourceRulesPath,
          targetDir,
          targets: ["claude"],
          markerPrefix: "agconf",
          metadataPrefix: "agent_conf",
          agentsMdContent,
        });

        // Verify rules were discovered
        expect(result.rules.length).toBe(2);

        // Verify Claude files were created
        expect(result.claudeFiles.length).toBe(2);
        expect(result.claudeFiles).toContain("code-style.md");
        expect(result.claudeFiles).toContain("security/auth.md");

        // Verify files exist in .claude/rules/
        const claudeRulesDir = path.join(targetDir, ".claude", "rules");
        expect(await fileExists(path.join(claudeRulesDir, "code-style.md"))).toBe(true);
        expect(await fileExists(path.join(claudeRulesDir, "security", "auth.md"))).toBe(true);

        // Verify metadata was added to Claude files
        const codeStyleContent = await readFile(path.join(claudeRulesDir, "code-style.md"));
        expect(codeStyleContent).toContain("agent_conf_managed");
        expect(codeStyleContent).toContain("agent_conf_content_hash");
        expect(codeStyleContent).toContain("agent_conf_source_path");

        // AGENTS.md should NOT be updated for Claude-only target
        expect(result.updatedAgentsMd).toBeNull();
      });

      it("should concatenate rules into AGENTS.md for Codex target", async () => {
        // Create source rules
        await createRuleFile("code-style.md", "# Code Style\n\nFollow these guidelines.");
        await createRuleFile(
          "testing.md",
          "# Testing\n\n## Unit Tests\n\nWrite comprehensive tests.",
        );

        const agentsMdContent = `<!-- agconf:global:start -->
# Global Instructions
<!-- agconf:global:end -->

<!-- agconf:repo:start -->
# Repo Specific
<!-- agconf:repo:end -->`;

        const result = await syncRules({
          sourceRulesPath,
          targetDir,
          targets: ["codex"],
          markerPrefix: "agconf",
          metadataPrefix: "agent_conf",
          agentsMdContent,
        });

        // Verify rules were discovered
        expect(result.rules.length).toBe(2);

        // Verify AGENTS.md was updated
        expect(result.updatedAgentsMd).not.toBeNull();
        expect(result.updatedAgentsMd).toContain("<!-- agconf:rules:start -->");
        expect(result.updatedAgentsMd).toContain("<!-- agconf:rules:end -->");
        expect(result.updatedAgentsMd).toContain("# Project Rules");

        // Verify heading levels were adjusted (+1)
        expect(result.updatedAgentsMd).toContain("## Code Style");
        expect(result.updatedAgentsMd).toContain("## Testing");
        expect(result.updatedAgentsMd).toContain("### Unit Tests");

        // Verify rule source comments
        expect(result.updatedAgentsMd).toContain("<!-- Rule: code-style.md -->");
        expect(result.updatedAgentsMd).toContain("<!-- Rule: testing.md -->");

        // No Claude files for Codex-only target
        expect(result.claudeFiles.length).toBe(0);
      });

      it("should handle canonical without rules_dir gracefully", async () => {
        // Empty rules directory simulating no rules configured
        const agentsMdContent = "# AGENTS.md\n\nProject instructions.";

        const result = await syncRules({
          sourceRulesPath: path.join(tempDir, "non-existent-rules"),
          targetDir,
          targets: ["claude"],
          markerPrefix: "agconf",
          metadataPrefix: "agent_conf",
          agentsMdContent,
        });

        // Should complete without error, with empty results
        expect(result.rules.length).toBe(0);
        expect(result.claudeFiles.length).toBe(0);
        expect(result.updatedAgentsMd).toBeNull();
      });

      it("should preserve rules subdirectory structure for Claude", async () => {
        // Create nested rules
        await createRuleFile("security/apis/auth.md", "# API Auth");
        await createRuleFile("security/data/validation.md", "# Data Validation");
        await createRuleFile("frontend/components/forms.md", "# Form Rules");

        const agentsMdContent = "# AGENTS.md";

        const result = await syncRules({
          sourceRulesPath,
          targetDir,
          targets: ["claude"],
          markerPrefix: "agconf",
          metadataPrefix: "agent_conf",
          agentsMdContent,
        });

        // Verify subdirectory structure preserved
        const claudeRulesDir = path.join(targetDir, ".claude", "rules");
        expect(await fileExists(path.join(claudeRulesDir, "security", "apis", "auth.md"))).toBe(
          true,
        );
        expect(
          await fileExists(path.join(claudeRulesDir, "security", "data", "validation.md")),
        ).toBe(true);
        expect(
          await fileExists(path.join(claudeRulesDir, "frontend", "components", "forms.md")),
        ).toBe(true);

        // Verify relative paths in result
        expect(result.claudeFiles).toContain("security/apis/auth.md");
        expect(result.claudeFiles).toContain("security/data/validation.md");
        expect(result.claudeFiles).toContain("frontend/components/forms.md");
      });

      it("should include paths frontmatter as comment for Codex", async () => {
        // Create rule with paths frontmatter
        await createRuleFile(
          "api-security.md",
          `---
paths:
  - "src/api/**/*.ts"
  - "src/services/**/*.ts"
---

# API Security

Use secure patterns.`,
        );

        const agentsMdContent = "# AGENTS.md";

        const result = await syncRules({
          sourceRulesPath,
          targetDir,
          targets: ["codex"],
          markerPrefix: "agconf",
          metadataPrefix: "agent_conf",
          agentsMdContent,
        });

        // Verify paths comment is included
        expect(result.updatedAgentsMd).not.toBeNull();
        expect(result.updatedAgentsMd).toContain("<!-- Applies to:");
        expect(result.updatedAgentsMd).toContain("src/api/**/*.ts");
        expect(result.updatedAgentsMd).toContain("src/services/**/*.ts");
      });

      it("should sync to both Claude and Codex targets", async () => {
        await createRuleFile("shared-rule.md", "# Shared Rule\n\nApplies to both.");

        const agentsMdContent = "# AGENTS.md";

        const result = await syncRules({
          sourceRulesPath,
          targetDir,
          targets: ["claude", "codex"],
          markerPrefix: "agconf",
          metadataPrefix: "agent_conf",
          agentsMdContent,
        });

        // Both targets should be processed
        expect(result.claudeFiles.length).toBe(1);
        expect(result.updatedAgentsMd).not.toBeNull();

        // Claude file exists
        const claudeRulesDir = path.join(targetDir, ".claude", "rules");
        expect(await fileExists(path.join(claudeRulesDir, "shared-rule.md"))).toBe(true);

        // AGENTS.md updated for Codex
        expect(result.updatedAgentsMd).toContain("## Shared Rule");
      });

      it("should handle empty rules directory", async () => {
        // Create empty rules directory
        await fs.mkdir(sourceRulesPath, { recursive: true });

        const agentsMdContent = "# AGENTS.md";

        const result = await syncRules({
          sourceRulesPath,
          targetDir,
          targets: ["claude", "codex"],
          markerPrefix: "agconf",
          metadataPrefix: "agent_conf",
          agentsMdContent,
        });

        // Should complete without error, with empty results
        expect(result.rules.length).toBe(0);
        expect(result.claudeFiles.length).toBe(0);
        // No rules means no rules section update
        expect(result.updatedAgentsMd).toBeNull();
      });

      it("should skip non-markdown files", async () => {
        await createRuleFile("valid-rule.md", "# Valid Rule");
        await fs.writeFile(path.join(sourceRulesPath, "config.json"), '{"key": "value"}');
        await fs.writeFile(path.join(sourceRulesPath, "notes.txt"), "Some notes");

        const agentsMdContent = "# AGENTS.md";

        const result = await syncRules({
          sourceRulesPath,
          targetDir,
          targets: ["claude"],
          markerPrefix: "agconf",
          metadataPrefix: "agent_conf",
          agentsMdContent,
        });

        // Only markdown file should be synced
        expect(result.rules.length).toBe(1);
        expect(result.claudeFiles).toEqual(["valid-rule.md"]);
      });

      it("should return content hash for lockfile tracking", async () => {
        await createRuleFile("rule-a.md", "# Rule A");
        await createRuleFile("rule-b.md", "# Rule B");

        const agentsMdContent = "# AGENTS.md";

        const result = await syncRules({
          sourceRulesPath,
          targetDir,
          targets: ["claude"],
          markerPrefix: "agconf",
          metadataPrefix: "agent_conf",
          agentsMdContent,
        });

        // Should return a content hash in standard format
        expect(result.contentHash).toBeDefined();
        expect(result.contentHash).toMatch(/^sha256:[a-f0-9]{12}$/);
      });

      it("should use custom marker prefix", async () => {
        await createRuleFile("rule.md", "# Custom Prefix Rule");

        const agentsMdContent = "# AGENTS.md";

        const result = await syncRules({
          sourceRulesPath,
          targetDir,
          targets: ["codex"],
          markerPrefix: "my-custom-prefix",
          metadataPrefix: "my_custom_prefix",
          agentsMdContent,
        });

        // Verify custom prefix is used in markers
        expect(result.updatedAgentsMd).toContain("<!-- my-custom-prefix:rules:start -->");
        expect(result.updatedAgentsMd).toContain("<!-- my-custom-prefix:rules:end -->");
      });

      it("should use custom metadata prefix for Claude files", async () => {
        await createRuleFile("rule.md", "# Custom Prefix Rule");

        const agentsMdContent = "# AGENTS.md";

        const result = await syncRules({
          sourceRulesPath,
          targetDir,
          targets: ["claude"],
          markerPrefix: "my-custom-prefix",
          metadataPrefix: "my_custom_prefix",
          agentsMdContent,
        });

        // Verify rules were synced
        expect(result.claudeFiles).toContain("rule.md");

        // Verify custom metadata prefix is used
        const claudeRulesDir = path.join(targetDir, ".claude", "rules");
        const ruleContent = await readFile(path.join(claudeRulesDir, "rule.md"));
        expect(ruleContent).toContain("my_custom_prefix_managed");
        expect(ruleContent).toContain("my_custom_prefix_content_hash");
      });
    });
  });
});
