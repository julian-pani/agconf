import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addManagedMetadata } from "../../src/core/managed-content.js";
import {
  detectProposedChanges,
  generateBranchName,
  type ProposedChange,
  slugifyTitle,
} from "../../src/core/propose.js";

describe("propose", () => {
  describe("slugifyTitle", () => {
    it("should convert a title to a valid branch slug", () => {
      expect(slugifyTitle("Update code review skill")).toBe("update-code-review-skill");
    });

    it("should strip special characters", () => {
      expect(slugifyTitle("Fix: API auth (v2)")).toBe("fix-api-auth-v2");
    });

    it("should trim leading/trailing hyphens", () => {
      expect(slugifyTitle("  --hello world--  ")).toBe("hello-world");
    });

    it("should truncate long titles to 50 chars", () => {
      const longTitle = "a".repeat(100);
      expect(slugifyTitle(longTitle).length).toBeLessThanOrEqual(50);
    });

    it("should not end with a hyphen after truncation", () => {
      // "word word word..." truncated mid-slug could leave trailing hyphen
      const title = "aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn ooo";
      const slug = slugifyTitle(title);
      expect(slug).not.toMatch(/-$/);
      expect(slug.length).toBeLessThanOrEqual(50);
    });

    it("should collapse multiple non-alphanumeric chars into single hyphen", () => {
      expect(slugifyTitle("foo   bar---baz")).toBe("foo-bar-baz");
    });

    it("should handle numeric titles", () => {
      expect(slugifyTitle("123 test")).toBe("123-test");
    });

    it("should handle single word titles", () => {
      expect(slugifyTitle("hotfix")).toBe("hotfix");
    });

    it("should handle unicode characters by stripping them", () => {
      expect(slugifyTitle("fix café issue")).toBe("fix-caf-issue");
    });
  });

  describe("generateBranchName", () => {
    it("should prefix with propose/", () => {
      const name = generateBranchName("Update code review skill");
      expect(name).toBe("propose/update-code-review-skill");
    });

    it("should handle special characters in title", () => {
      const name = generateBranchName("Fix: security rules (OWASP)");
      expect(name).toBe("propose/fix-security-rules-owasp");
    });

    it("should produce a valid git branch name", () => {
      const name = generateBranchName("Spaces & Special!! Characters (here)");
      // Must not contain spaces or consecutive slashes
      expect(name).not.toMatch(/\s/);
      expect(name).not.toMatch(/\/\//);
      // Must start with propose/
      expect(name).toMatch(/^propose\//);
    });

    it("should truncate very long titles", () => {
      const longTitle =
        "This is a very long proposal title that goes on and on and really should be truncated";
      const name = generateBranchName(longTitle);
      // propose/ (8 chars) + slug (max 50 chars) = max 58
      expect(name.length).toBeLessThanOrEqual(58);
    });
  });

  describe("ProposedChange path mapping conventions", () => {
    // These test the expected canonical path formats for each content type
    it("skill canonical path should be under skills/", () => {
      const change: ProposedChange = {
        downstreamPath: ".claude/skills/code-review/SKILL.md",
        canonicalPath: "skills/code-review/SKILL.md",
        content: "# Code Review",
        type: "skill",
      };
      expect(change.canonicalPath).toMatch(/^skills\//);
      expect(change.canonicalPath).not.toMatch(/^\./);
    });

    it("rule canonical path should be under rules/", () => {
      const change: ProposedChange = {
        downstreamPath: ".claude/rules/security/api-auth.md",
        canonicalPath: "rules/security/api-auth.md",
        content: "# API Auth",
        type: "rule",
      };
      expect(change.canonicalPath).toMatch(/^rules\//);
    });

    it("agent canonical path should be under agents/", () => {
      const change: ProposedChange = {
        downstreamPath: ".claude/agents/reviewer.md",
        canonicalPath: "agents/reviewer.md",
        content: "# Reviewer",
        type: "agent",
      };
      expect(change.canonicalPath).toMatch(/^agents\//);
    });

    it("agents-md-global canonical path should be instructions/AGENTS.md", () => {
      const change: ProposedChange = {
        downstreamPath: "AGENTS.md",
        canonicalPath: "instructions/AGENTS.md",
        content: "# Global",
        type: "agents-md-global",
      };
      expect(change.canonicalPath).toBe("instructions/AGENTS.md");
    });

    it("skill-asset canonical path should be under skills/<skill>/", () => {
      const change: ProposedChange = {
        downstreamPath: ".claude/skills/python-logging/references/template.py",
        canonicalPath: "skills/python-logging/references/template.py",
        content: Buffer.from("print('hi')"),
        type: "skill-asset",
      };
      expect(change.canonicalPath).toBe("skills/python-logging/references/template.py");
    });
  });

  describe("detectProposedChanges with skill assets", () => {
    let tempDir: string;
    let downstreamDir: string;
    let canonicalDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-propose-test-"));
      downstreamDir = path.join(tempDir, "downstream");
      canonicalDir = path.join(tempDir, "canonical");
      await fs.mkdir(downstreamDir, { recursive: true });
      await fs.mkdir(canonicalDir, { recursive: true });
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    /**
     * Initialise `canonicalDir` as a real git repo so cloneCanonical (used by
     * detectProposedChanges) can clone it. detect now reaches canonical to
     * byte-diff non-SKILL.md files, so we need actual git history.
     */
    function initCanonicalGitRepo(): void {
      execSync("git init", { cwd: canonicalDir, stdio: "ignore" });
      execSync("git config user.email t@t.com", { cwd: canonicalDir, stdio: "ignore" });
      execSync("git config user.name Test", { cwd: canonicalDir, stdio: "ignore" });
      execSync("git add -A && git commit -m init", { cwd: canonicalDir, stdio: "ignore" });
    }

    it("ships both SKILL.md and references/ edits when both differ from canonical", async () => {
      // 1) Canonical: original skill + original template
      const skillBody = `---
name: python-logging
description: Configure Python logging.
---

# Python Logging

ORIGINAL skill body.
`;
      const originalAsset = "print('original')";
      const tamperedAsset = "print('TAMPERED')";

      const canonicalSkillDir = path.join(canonicalDir, "skills", "python-logging", "references");
      await fs.mkdir(canonicalSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(canonicalDir, "skills", "python-logging", "SKILL.md"),
        skillBody,
        "utf-8",
      );
      await fs.writeFile(path.join(canonicalSkillDir, "template.py"), originalAsset, "utf-8");
      initCanonicalGitRepo();

      // 2) Downstream: SKILL.md and template both tampered
      const downstreamSkillDir = path.join(downstreamDir, ".claude", "skills", "python-logging");
      const downstreamRefs = path.join(downstreamSkillDir, "references");
      await fs.mkdir(downstreamRefs, { recursive: true });

      const managedSkill = addManagedMetadata(skillBody);
      const tamperedSkill = managedSkill.replace("ORIGINAL skill body.", "TAMPERED skill body.");
      await fs.writeFile(path.join(downstreamSkillDir, "SKILL.md"), tamperedSkill, "utf-8");
      await fs.writeFile(path.join(downstreamRefs, "template.py"), tamperedAsset, "utf-8");

      // 3) Lockfile points at the local canonical
      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local" as const, path: canonicalDir },
        content: {
          agents_md: { global_block_hash: "sha256:abc", merged: true },
          skills: ["python-logging"],
          targets: ["claude"],
        },
      };
      await fs.mkdir(path.join(downstreamDir, ".agconf"), { recursive: true });
      await fs.writeFile(
        path.join(downstreamDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
        "utf-8",
      );

      // 4) Detect proposed changes — both files should appear
      const result = await detectProposedChanges({ cwd: downstreamDir });
      const paths = result.changes.map((c) => c.canonicalPath).sort();
      expect(paths).toEqual([
        "skills/python-logging/SKILL.md",
        "skills/python-logging/references/template.py",
      ]);

      const assetChange = result.changes.find((c) => c.type === "skill-asset");
      expect(assetChange).toBeDefined();
      const assetBytes =
        typeof assetChange?.content === "string"
          ? Buffer.from(assetChange.content)
          : (assetChange?.content as Buffer);
      expect(assetBytes.toString("utf-8")).toBe(tamperedAsset);

      // Canonical clone should be carried through for apply to reuse
      expect(result.canonicalCloneDir).toBeTruthy();
    });

    it("does NOT propose references/ files that match canonical exactly", async () => {
      const skillBody = `---
name: skill-a
description: A skill.
---

Body.
`;
      const asset = "print('same')";

      // Canonical and downstream both contain the exact same template
      const canonicalSkillDir = path.join(canonicalDir, "skills", "skill-a", "references");
      await fs.mkdir(canonicalSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(canonicalDir, "skills", "skill-a", "SKILL.md"),
        skillBody,
        "utf-8",
      );
      await fs.writeFile(path.join(canonicalSkillDir, "template.py"), asset, "utf-8");
      initCanonicalGitRepo();

      const downstreamSkillDir = path.join(downstreamDir, ".claude", "skills", "skill-a");
      const downstreamRefs = path.join(downstreamSkillDir, "references");
      await fs.mkdir(downstreamRefs, { recursive: true });
      // SKILL.md unmodified — managed metadata baked in
      await fs.writeFile(
        path.join(downstreamSkillDir, "SKILL.md"),
        addManagedMetadata(skillBody),
        "utf-8",
      );
      await fs.writeFile(path.join(downstreamRefs, "template.py"), asset, "utf-8");

      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local" as const, path: canonicalDir },
        content: {
          agents_md: { global_block_hash: "sha256:abc", merged: true },
          skills: ["skill-a"],
          targets: ["claude"],
        },
      };
      await fs.mkdir(path.join(downstreamDir, ".agconf"), { recursive: true });
      await fs.writeFile(
        path.join(downstreamDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
        "utf-8",
      );

      const result = await detectProposedChanges({ cwd: downstreamDir });
      expect(result.changes).toEqual([]);
    });

    it("proposes references/ files that exist downstream but not in canonical", async () => {
      const skillBody = `---
name: skill-b
description: Skill with downstream-only file.
---

Body.
`;

      await fs.mkdir(path.join(canonicalDir, "skills", "skill-b"), { recursive: true });
      await fs.writeFile(
        path.join(canonicalDir, "skills", "skill-b", "SKILL.md"),
        skillBody,
        "utf-8",
      );
      initCanonicalGitRepo();

      const downstreamSkillDir = path.join(downstreamDir, ".claude", "skills", "skill-b");
      const downstreamScripts = path.join(downstreamSkillDir, "scripts");
      await fs.mkdir(downstreamScripts, { recursive: true });
      await fs.writeFile(
        path.join(downstreamSkillDir, "SKILL.md"),
        addManagedMetadata(skillBody),
        "utf-8",
      );
      await fs.writeFile(path.join(downstreamScripts, "new.sh"), "echo new", "utf-8");

      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local" as const, path: canonicalDir },
        content: {
          agents_md: { global_block_hash: "sha256:abc", merged: true },
          skills: ["skill-b"],
          targets: ["claude"],
        },
      };
      await fs.mkdir(path.join(downstreamDir, ".agconf"), { recursive: true });
      await fs.writeFile(
        path.join(downstreamDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
        "utf-8",
      );

      const result = await detectProposedChanges({ cwd: downstreamDir });
      expect(result.changes.map((c) => c.canonicalPath)).toEqual(["skills/skill-b/scripts/new.sh"]);
      expect(result.changes[0]?.type).toBe("skill-asset");
    });
  });
});
