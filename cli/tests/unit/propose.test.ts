import { createHash } from "node:crypto";
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

function hashBytes(content: string | Buffer): string {
  const buf = typeof content === "string" ? Buffer.from(content) : content;
  const hash = createHash("sha256").update(buf).digest("hex");
  return `sha256:${hash.slice(0, 12)}`;
}

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

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-propose-test-"));
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("ships both SKILL.md and references/ edits in the same proposal", async () => {
      // 1) Lay out a downstream tree with a managed skill + a tampered asset
      const skillDir = path.join(tempDir, ".claude", "skills", "python-logging");
      const refDir = path.join(skillDir, "references");
      await fs.mkdir(refDir, { recursive: true });

      const skillBody = `---
name: python-logging
description: Configure Python logging.
---

# Python Logging

ORIGINAL skill body.
`;
      const originalAsset = "print('original')";
      const tamperedAsset = "print('TAMPERED')";

      // SKILL.md is managed with content hash baked in; then modify it manually
      const managedSkill = addManagedMetadata(skillBody);
      const tamperedSkill = managedSkill.replace("ORIGINAL skill body.", "TAMPERED skill body.");
      await fs.writeFile(path.join(skillDir, "SKILL.md"), tamperedSkill, "utf-8");
      await fs.writeFile(path.join(refDir, "template.py"), tamperedAsset, "utf-8");

      // 2) Write a lockfile that pins the canonical asset hash
      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local" as const, path: "/canonical" },
        content: {
          agents_md: { global_block_hash: "sha256:abc", merged: true },
          skills: ["python-logging"],
          targets: ["claude"],
          skill_files: {
            "python-logging": {
              "references/template.py": hashBytes(originalAsset),
            },
          },
        },
      };
      await fs.mkdir(path.join(tempDir, ".agconf"), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
        "utf-8",
      );

      // 3) Detect proposed changes; both files should appear
      const result = await detectProposedChanges({ cwd: tempDir });

      const paths = result.changes.map((c) => c.canonicalPath).sort();
      expect(paths).toEqual([
        "skills/python-logging/SKILL.md",
        "skills/python-logging/references/template.py",
      ]);

      const skillChange = result.changes.find((c) => c.type === "skill");
      const assetChange = result.changes.find((c) => c.type === "skill-asset");
      expect(skillChange).toBeDefined();
      expect(assetChange).toBeDefined();

      // skill-asset content is delivered as raw bytes
      expect(
        Buffer.isBuffer(assetChange?.content) || typeof assetChange?.content === "string",
      ).toBe(true);
      const assetBytes =
        typeof assetChange?.content === "string"
          ? Buffer.from(assetChange.content)
          : (assetChange?.content as Buffer);
      expect(assetBytes.toString("utf-8")).toBe(tamperedAsset);
    });
  });
});
