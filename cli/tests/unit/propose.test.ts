import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addManagedMetadata } from "../../src/core/managed-content.js";
import { buildAgentsMd } from "../../src/core/markers.js";
import {
  applyProposedChanges,
  detectNewContent,
  detectProposedChanges,
  generateBranchName,
  type ProposedChange,
  slugifyTitle,
} from "../../src/core/propose.js";
import { StaleBaseError } from "../../src/core/propose-merge.js";

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

    describe("--files regex filter", () => {
      /**
       * Set up two managed rule files whose bodies have been locally edited
       * (the stored content hash no longer matches), so both show up as
       * modified absent any filter. Rules are used rather than skills so detect
       * never has to clone canonical — the `files` option is the thing under
       * test here, and rule modification is detected purely from frontmatter.
       */
      async function setupTwoModifiedRules(): Promise<void> {
        const ruleBody = (name: string) => `---
title: ${name}
---

# ${name}

ORIGINAL body.
`;

        const rulesDir = path.join(downstreamDir, ".claude", "rules", "security");
        await fs.mkdir(rulesDir, { recursive: true });
        for (const name of ["foo", "bar"]) {
          // Managed metadata baked in, then body tampered so the stored content
          // hash no longer matches → hasChanges === true.
          const tampered = addManagedMetadata(ruleBody(name)).replace(
            "ORIGINAL body.",
            "TAMPERED body.",
          );
          await fs.writeFile(path.join(rulesDir, `${name}.md`), tampered, "utf-8");
        }

        await fs.writeFile(
          path.join(canonicalDir, "agconf.yaml"),
          `version: "1.0.0"
meta:
  name: test-canonical
targets:
  - claude
`,
          "utf-8",
        );

        // Initialize canonical as a valid git repo for source/config resolution.
        initCanonicalGitRepo();

        const lockfile = {
          version: "1.0.0",
          synced_at: new Date().toISOString(),
          source: { type: "local" as const, path: canonicalDir },
          content: {
            agents_md: { global_block_hash: "sha256:abc", merged: true },
            skills: [],
            targets: ["claude"],
          },
        };
        await fs.mkdir(path.join(downstreamDir, ".agconf"), { recursive: true });
        await fs.writeFile(
          path.join(downstreamDir, ".agconf", "lockfile.json"),
          JSON.stringify(lockfile, null, 2),
          "utf-8",
        );
      }

      it("returns only the file whose relative path matches the regex pattern", async () => {
        await setupTwoModifiedRules();

        // Sanity: with no filter, both modified rules are proposed.
        const all = await detectProposedChanges({ cwd: downstreamDir });
        expect(all.changes.map((c) => c.canonicalPath).sort()).toEqual([
          "rules/security/bar.md",
          "rules/security/foo.md",
        ]);

        // `security/foo` is treated as a RegExp tested against the downstream
        // relative path (.claude/rules/security/foo.md), so only foo matches.
        const filtered = await detectProposedChanges({
          cwd: downstreamDir,
          files: ["security/foo"],
        });
        expect(filtered.changes.map((c) => c.canonicalPath)).toEqual(["rules/security/foo.md"]);
      });

      it("returns zero changes when the pattern matches nothing", async () => {
        await setupTwoModifiedRules();

        const filtered = await detectProposedChanges({
          cwd: downstreamDir,
          files: ["security/does-not-exist"],
        });
        expect(filtered.changes).toEqual([]);
      });

      it("treats the pattern as a regex, not a literal glob", async () => {
        await setupTwoModifiedRules();

        // A regex alternation matches both; a literal-glob interpretation would not.
        const filtered = await detectProposedChanges({
          cwd: downstreamDir,
          files: ["foo|bar"],
        });
        expect(filtered.changes.map((c) => c.canonicalPath).sort()).toEqual([
          "rules/security/bar.md",
          "rules/security/foo.md",
        ]);
      });
    });

    it("maps canonical paths under a custom skills_dir from agconf.yaml", async () => {
      const skillBody = `---
name: custom-skill
description: A skill living in a non-default canonical dir.
---

ORIGINAL body.
`;
      const originalAsset = "print('original')";
      const tamperedAsset = "print('TAMPERED')";

      // Canonical declares a non-default skills_dir and stores the skill there.
      await fs.writeFile(
        path.join(canonicalDir, "agconf.yaml"),
        `version: "1.0.0"
meta:
  name: custom-canonical
content:
  skills_dir: agent-skills
targets:
  - claude
`,
        "utf-8",
      );
      const canonicalRefs = path.join(canonicalDir, "agent-skills", "custom-skill", "references");
      await fs.mkdir(canonicalRefs, { recursive: true });
      await fs.writeFile(
        path.join(canonicalDir, "agent-skills", "custom-skill", "SKILL.md"),
        skillBody,
        "utf-8",
      );
      await fs.writeFile(path.join(canonicalRefs, "template.py"), originalAsset, "utf-8");
      initCanonicalGitRepo();

      // Downstream keeps the fixed .claude/skills/ target layout; both files differ.
      const downstreamSkillDir = path.join(downstreamDir, ".claude", "skills", "custom-skill");
      const downstreamRefs = path.join(downstreamSkillDir, "references");
      await fs.mkdir(downstreamRefs, { recursive: true });
      const tamperedSkill = addManagedMetadata(skillBody).replace(
        "ORIGINAL body.",
        "TAMPERED body.",
      );
      await fs.writeFile(path.join(downstreamSkillDir, "SKILL.md"), tamperedSkill, "utf-8");
      await fs.writeFile(path.join(downstreamRefs, "template.py"), tamperedAsset, "utf-8");

      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local" as const, path: canonicalDir },
        content: {
          agents_md: { global_block_hash: "sha256:abc", merged: true },
          skills: ["custom-skill"],
          targets: ["claude"],
        },
      };
      await fs.mkdir(path.join(downstreamDir, ".agconf"), { recursive: true });
      await fs.writeFile(
        path.join(downstreamDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
        "utf-8",
      );

      // Both the SKILL.md body change and the asset change must point at the
      // configured agent-skills/ dir, NOT the default skills/.
      const result = await detectProposedChanges({ cwd: downstreamDir });
      const paths = result.changes.map((c) => c.canonicalPath).sort();
      expect(paths).toEqual([
        "agent-skills/custom-skill/SKILL.md",
        "agent-skills/custom-skill/references/template.py",
      ]);
    });

    it("maps rule and agent canonical paths under custom rules_dir/agents_dir", async () => {
      // Canonical only needs agconf.yaml — the config drives the destination dirs.
      await fs.writeFile(
        path.join(canonicalDir, "agconf.yaml"),
        `version: "1.0.0"
meta:
  name: custom-canonical
content:
  rules_dir: my-rules
  agents_dir: my-agents
targets:
  - claude
`,
        "utf-8",
      );
      initCanonicalGitRepo();

      // Downstream: a managed rule and a managed agent, both modified.
      const ruleBody = `---
name: api-auth
---

ORIGINAL rule.
`;
      const agentBody = `---
name: reviewer
description: Reviews code.
---

ORIGINAL agent.
`;
      const ruleDir = path.join(downstreamDir, ".claude", "rules", "security");
      const agentDir = path.join(downstreamDir, ".claude", "agents");
      await fs.mkdir(ruleDir, { recursive: true });
      await fs.mkdir(agentDir, { recursive: true });
      await fs.writeFile(
        path.join(ruleDir, "api-auth.md"),
        addManagedMetadata(ruleBody).replace("ORIGINAL rule.", "TAMPERED rule."),
        "utf-8",
      );
      await fs.writeFile(
        path.join(agentDir, "reviewer.md"),
        addManagedMetadata(agentBody).replace("ORIGINAL agent.", "TAMPERED agent."),
        "utf-8",
      );

      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local" as const, path: canonicalDir },
        content: {
          agents_md: { global_block_hash: "sha256:abc", merged: true },
          skills: [],
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
      const paths = result.changes.map((c) => c.canonicalPath).sort();
      expect(paths).toEqual(["my-agents/reviewer.md", "my-rules/security/api-auth.md"]);
    });
  });

  describe("detectNewContent", () => {
    let tempDir: string;
    let downstreamDir: string;
    let canonicalDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-propose-new-test-"));
      downstreamDir = path.join(tempDir, "downstream");
      canonicalDir = path.join(tempDir, "canonical");
      await fs.mkdir(downstreamDir, { recursive: true });
      await fs.mkdir(canonicalDir, { recursive: true });
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    // `--allow-empty` so canonical can be an empty repo (no collisions) while
    // still being cloneable by detectNewContent.
    function initCanonicalGitRepo(): void {
      execSync("git init", { cwd: canonicalDir, stdio: "ignore" });
      execSync("git config user.email t@t.com", { cwd: canonicalDir, stdio: "ignore" });
      execSync("git config user.name Test", { cwd: canonicalDir, stdio: "ignore" });
      execSync("git add -A && git commit -m init --allow-empty", {
        cwd: canonicalDir,
        stdio: "ignore",
      });
    }

    async function writeLockfile(skills: string[] = []): Promise<void> {
      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local" as const, path: canonicalDir },
        content: {
          agents_md: { global_block_hash: "sha256:abc", merged: true },
          skills,
          targets: ["claude"],
        },
      };
      await fs.mkdir(path.join(downstreamDir, ".agconf"), { recursive: true });
      await fs.writeFile(
        path.join(downstreamDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
        "utf-8",
      );
    }

    async function writeDownstreamSkill(
      name: string,
      body: string,
      assets: Record<string, string> = {},
    ): Promise<void> {
      const dir = path.join(downstreamDir, ".claude", "skills", name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "SKILL.md"), body, "utf-8");
      for (const [rel, content] of Object.entries(assets)) {
        const full = path.join(dir, rel);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, content, "utf-8");
      }
    }

    const validSkill = (name: string) => `---
name: ${name}
description: A new skill authored locally.
---

# ${name}

Body.
`;

    it("discovers a new unmanaged skill with its assets", async () => {
      await writeDownstreamSkill("brand-new", validSkill("brand-new"), {
        "references/helper.py": "print('hi')",
      });
      initCanonicalGitRepo();
      await writeLockfile();

      const result = await detectNewContent({ cwd: downstreamDir });

      expect(result.candidates).toHaveLength(1);
      const candidate = result.candidates[0];
      expect(candidate?.type).toBe("skill");
      expect(candidate?.name).toBe("brand-new");
      expect(candidate?.downstreamPath).toBe(".claude/skills/brand-new");

      const canonicalPaths = candidate?.changes.map((c) => c.canonicalPath).sort();
      expect(canonicalPaths).toEqual([
        "skills/brand-new/SKILL.md",
        "skills/brand-new/references/helper.py",
      ]);
      const skillChange = candidate?.changes.find((c) => c.canonicalPath.endsWith("SKILL.md"));
      expect(skillChange?.type).toBe("skill");
      const assetChange = candidate?.changes.find((c) => c.type === "skill-asset");
      expect(assetChange?.canonicalPath).toBe("skills/brand-new/references/helper.py");
      // Clone is created and threaded through for apply to reuse.
      expect(result.canonicalCloneDir).toBeTruthy();
    });

    it("includes nested skill assets across subdirectories with POSIX canonical paths", async () => {
      await writeDownstreamSkill("nested", validSkill("nested"), {
        "references/a.md": "# A",
        "references/sub/b.md": "# B nested",
        "scripts/run.sh": "echo hi",
      });
      initCanonicalGitRepo();
      await writeLockfile();

      const result = await detectNewContent({ cwd: downstreamDir });
      expect(result.candidates).toHaveLength(1);
      const candidate = result.candidates[0];

      const byPath = new Map((candidate?.changes ?? []).map((c) => [c.canonicalPath, c]));
      expect([...byPath.keys()].sort()).toEqual([
        "skills/nested/SKILL.md",
        "skills/nested/references/a.md",
        "skills/nested/references/sub/b.md",
        "skills/nested/scripts/run.sh",
      ]);
      expect(byPath.get("skills/nested/SKILL.md")?.type).toBe("skill");
      expect(byPath.get("skills/nested/references/sub/b.md")?.type).toBe("skill-asset");
      // Canonical paths must use POSIX separators regardless of host OS.
      for (const p of byPath.keys()) expect(p).not.toContain("\\");
    });

    it("preserves binary skill asset bytes exactly (no utf-8 corruption)", async () => {
      const skillDir = path.join(downstreamDir, ".claude", "skills", "with-binary");
      await fs.mkdir(path.join(skillDir, "assets"), { recursive: true });
      await fs.writeFile(path.join(skillDir, "SKILL.md"), validSkill("with-binary"), "utf-8");
      const bytes = Buffer.from([0x00, 0x01, 0xff, 0x00, 0x50, 0x4e, 0x47, 0xfe]);
      await fs.writeFile(path.join(skillDir, "assets", "logo.png"), bytes);
      initCanonicalGitRepo();
      await writeLockfile();

      const result = await detectNewContent({ cwd: downstreamDir });
      const asset = result.candidates[0]?.changes.find(
        (c) => c.canonicalPath === "skills/with-binary/assets/logo.png",
      );
      expect(asset?.type).toBe("skill-asset");
      expect(Buffer.isBuffer(asset?.content)).toBe(true);
      expect((asset?.content as Buffer).equals(bytes)).toBe(true);
    });

    it("auto-selects a skill via a path filter and includes all its assets", async () => {
      await writeDownstreamSkill("alpha", validSkill("alpha"), {
        "references/a.md": "# A",
        "scripts/run.sh": "echo hi",
      });
      await writeDownstreamSkill("beta", validSkill("beta"));
      initCanonicalGitRepo();
      await writeLockfile();

      const result = await detectNewContent({ cwd: downstreamDir, path: ".claude/skills/alpha" });

      expect(result.autoSelect).toBe(true);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.name).toBe("alpha");
      expect(result.candidates[0]?.changes.map((c) => c.canonicalPath).sort()).toEqual([
        "skills/alpha/SKILL.md",
        "skills/alpha/references/a.md",
        "skills/alpha/scripts/run.sh",
      ]);
    });

    it("ships SKILL.md and all assets (incl. binary) to canonical when applied", async () => {
      const binary = Buffer.from([0x00, 0x10, 0xff, 0x42, 0x00]);
      const skillDir = path.join(downstreamDir, ".claude", "skills", "shipme");
      await fs.mkdir(path.join(skillDir, "assets"), { recursive: true });
      await fs.writeFile(path.join(skillDir, "SKILL.md"), validSkill("shipme"), "utf-8");
      await fs.writeFile(path.join(skillDir, "references.md"), "# refs", "utf-8");
      await fs.writeFile(path.join(skillDir, "assets", "logo.png"), binary);
      initCanonicalGitRepo();
      await writeLockfile();

      const detected = await detectNewContent({ cwd: downstreamDir });
      const proposeResult = {
        changes: detected.candidates.flatMap((c) => c.changes),
        source: detected.source,
        markerPrefix: detected.markerPrefix,
        downstream: detected.downstream,
        canonicalCloneDir: detected.canonicalCloneDir,
      };

      // Supply a git identity via env so the commit succeeds without global config.
      const envKeys = [
        "GIT_AUTHOR_NAME",
        "GIT_AUTHOR_EMAIL",
        "GIT_COMMITTER_NAME",
        "GIT_COMMITTER_EMAIL",
      ];
      const saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
      for (const k of envKeys) process.env[k] = k.endsWith("EMAIL") ? "t@t.com" : "Test";

      let cloneDir: string;
      try {
        const applyResult = await applyProposedChanges(proposeResult, {
          title: "Add shipme skill",
        });
        cloneDir = applyResult.cloneDir;
      } finally {
        for (const k of envKeys) {
          if (saved[k] === undefined) delete process.env[k];
          else process.env[k] = saved[k];
        }
      }

      // Files are written into the canonical clone's working tree before commit.
      const skillMd = await fs.readFile(
        path.join(cloneDir, "skills", "shipme", "SKILL.md"),
        "utf-8",
      );
      expect(skillMd).toContain("# shipme");
      const refs = await fs.readFile(
        path.join(cloneDir, "skills", "shipme", "references.md"),
        "utf-8",
      );
      expect(refs).toBe("# refs");
      const png = await fs.readFile(path.join(cloneDir, "skills", "shipme", "assets", "logo.png"));
      expect(png.equals(binary)).toBe(true);
    });

    it("ignores skills that are already managed", async () => {
      await writeDownstreamSkill("managed", addManagedMetadata(validSkill("managed")));
      initCanonicalGitRepo();
      await writeLockfile();

      const result = await detectNewContent({ cwd: downstreamDir });

      expect(result.candidates).toEqual([]);
      // No candidates → canonical is never cloned.
      expect(result.canonicalCloneDir).toBeUndefined();
    });

    it("classifies an identical collision as adoptable (a pending round-trip)", async () => {
      // Canonical already has this skill (it was proposed earlier and merged);
      // the local copy is still the unmanaged original.
      await fs.mkdir(path.join(canonicalDir, "skills", "dupe"), { recursive: true });
      await fs.writeFile(
        path.join(canonicalDir, "skills", "dupe", "SKILL.md"),
        validSkill("dupe"),
        "utf-8",
      );
      initCanonicalGitRepo();

      await writeDownstreamSkill("dupe", validSkill("dupe"));
      await writeLockfile();

      const result = await detectNewContent({ cwd: downstreamDir });

      expect(result.candidates).toEqual([]);
      expect(result.adoptable).toEqual([
        { type: "skill", name: "dupe", downstreamPath: ".claude/skills/dupe" },
      ]);
      // Identical content is not a conflict — no scary warning.
      expect(result.warnings).toEqual([]);
    });

    it("classifies a divergent collision as a conflict warning, not adoptable", async () => {
      await fs.mkdir(path.join(canonicalDir, "skills", "dupe"), { recursive: true });
      await fs.writeFile(
        path.join(canonicalDir, "skills", "dupe", "SKILL.md"),
        validSkill("dupe"),
        "utf-8",
      );
      initCanonicalGitRepo();

      // Local copy diverged from what is upstream.
      await writeDownstreamSkill("dupe", validSkill("dupe").replace("Body.", "Local-only edit."));
      await writeLockfile();

      const result = await detectNewContent({ cwd: downstreamDir });

      expect(result.candidates).toEqual([]);
      expect(result.adoptable).toEqual([]);
      expect(result.warnings.join("\n")).toContain("differs from your local copy");
    });

    it("skips a new skill with invalid frontmatter", async () => {
      const missingDescription = `---
name: incomplete
---

Body.
`;
      await writeDownstreamSkill("incomplete", missingDescription);
      initCanonicalGitRepo();
      await writeLockfile();

      const result = await detectNewContent({ cwd: downstreamDir });

      expect(result.candidates).toEqual([]);
      expect(result.warnings.join("\n")).toContain("description");
    });

    it("auto-selects when a path filter resolves to a single skill dir", async () => {
      await writeDownstreamSkill("alpha", validSkill("alpha"));
      await writeDownstreamSkill("beta", validSkill("beta"));
      initCanonicalGitRepo();
      await writeLockfile();

      const result = await detectNewContent({
        cwd: downstreamDir,
        path: ".claude/skills/alpha",
      });

      expect(result.autoSelect).toBe(true);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.name).toBe("alpha");
    });

    it("auto-selects when the path points at a single SKILL.md file", async () => {
      await writeDownstreamSkill("alpha", validSkill("alpha"));
      await writeDownstreamSkill("beta", validSkill("beta"));
      initCanonicalGitRepo();
      await writeLockfile();

      const result = await detectNewContent({
        cwd: downstreamDir,
        path: ".claude/skills/beta/SKILL.md",
      });

      expect(result.autoSelect).toBe(true);
      expect(result.candidates.map((c) => c.name)).toEqual(["beta"]);
    });

    it("does not auto-select when a path filter matches multiple candidates", async () => {
      await writeDownstreamSkill("alpha", validSkill("alpha"));
      await writeDownstreamSkill("beta", validSkill("beta"));
      initCanonicalGitRepo();
      await writeLockfile();

      const result = await detectNewContent({ cwd: downstreamDir, path: ".claude/skills" });

      expect(result.autoSelect).toBe(false);
      expect(result.candidates.map((c) => c.name).sort()).toEqual(["alpha", "beta"]);
    });

    it("discovers a new unmanaged rule", async () => {
      const ruleDir = path.join(downstreamDir, ".claude", "rules", "security");
      await fs.mkdir(ruleDir, { recursive: true });
      await fs.writeFile(path.join(ruleDir, "new-rule.md"), "# New Rule\n\nContent.\n", "utf-8");
      initCanonicalGitRepo();
      await writeLockfile();

      const result = await detectNewContent({ cwd: downstreamDir });

      expect(result.candidates).toHaveLength(1);
      const candidate = result.candidates[0];
      expect(candidate?.type).toBe("rule");
      expect(candidate?.name).toBe("security/new-rule.md");
      expect(candidate?.canonicalPath).toBe("rules/security/new-rule.md");
      expect(candidate?.changes).toHaveLength(1);
      expect(candidate?.changes[0]?.type).toBe("rule");
    });

    it("discovers valid agents and skips invalid ones", async () => {
      const agentsDir = path.join(downstreamDir, ".claude", "agents");
      await fs.mkdir(agentsDir, { recursive: true });
      await fs.writeFile(
        path.join(agentsDir, "reviewer.md"),
        `---
name: reviewer
description: Reviews code.
---

# Reviewer
`,
        "utf-8",
      );
      await fs.writeFile(path.join(agentsDir, "broken.md"), "No frontmatter here.\n", "utf-8");
      initCanonicalGitRepo();
      await writeLockfile();

      const result = await detectNewContent({ cwd: downstreamDir });

      expect(result.candidates.map((c) => c.name)).toEqual(["reviewer.md"]);
      expect(result.candidates[0]?.canonicalPath).toBe("agents/reviewer.md");
      expect(result.warnings.join("\n")).toContain("broken.md");
    });

    it("throws when no lockfile is present", async () => {
      await writeDownstreamSkill("x", validSkill("x"));
      await expect(detectNewContent({ cwd: downstreamDir })).rejects.toThrow("No lockfile");
    });
  });

  /**
   * Reconciliation against canonical HEAD. Each test builds real git history:
   * canonical is committed at a base commit, the downstream copy is "synced"
   * from that commit (managed metadata + `commit_sha` in the lockfile), and
   * canonical may then advance — so propose has a genuine three-way situation.
   */
  describe("detectProposedChanges against a moving canonical", () => {
    let tempDir: string;
    let downstreamDir: string;
    let canonicalDir: string;

    const SKILL_BASE = `---
name: demo
description: Demo skill.
---

# Demo

## Section A

Alpha original.

## Section B

Beta original.
`;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-propose-rebase-"));
      downstreamDir = path.join(tempDir, "downstream");
      canonicalDir = path.join(tempDir, "canonical");
      await fs.mkdir(downstreamDir, { recursive: true });
      await fs.mkdir(canonicalDir, { recursive: true });
      execSync("git init", { cwd: canonicalDir, stdio: "ignore" });
      execSync("git config user.email t@t.com", { cwd: canonicalDir, stdio: "ignore" });
      execSync("git config user.name Test", { cwd: canonicalDir, stdio: "ignore" });
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    /** Commit everything in canonical and return the resulting SHA. */
    function commitCanonical(message: string): string {
      execSync(`git add -A && git commit -m ${message}`, { cwd: canonicalDir, stdio: "ignore" });
      return execSync("git rev-parse HEAD", { cwd: canonicalDir }).toString().trim();
    }

    async function writeCanonicalFile(relPath: string, content: string): Promise<void> {
      const full = path.join(canonicalDir, relPath);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, "utf-8");
    }

    async function writeDownstreamFile(relPath: string, content: string): Promise<void> {
      const full = path.join(downstreamDir, relPath);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, "utf-8");
    }

    /** Point the lockfile at canonical, optionally pinning the synced commit. */
    async function writeLockfile(commitSha?: string): Promise<void> {
      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local" as const, path: canonicalDir, commit_sha: commitSha },
        content: {
          agents_md: { global_block_hash: "sha256:abc", merged: true },
          skills: ["demo"],
          targets: ["claude"],
        },
      };
      await fs.mkdir(path.join(downstreamDir, ".agconf"), { recursive: true });
      await fs.writeFile(
        path.join(downstreamDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
        "utf-8",
      );
    }

    /**
     * Canonical at `SKILL_BASE`, downstream synced from that commit with the
     * local body edited as described by `localBody`.
     */
    async function setupSyncedSkill(localBody: string, pinCommit = true): Promise<string> {
      await writeCanonicalFile("skills/demo/SKILL.md", SKILL_BASE);
      const baseSha = commitCanonical("base");
      await writeDownstreamFile(
        ".claude/skills/demo/SKILL.md",
        addManagedMetadata(SKILL_BASE).replace(
          "Alpha original.",
          localBody === SKILL_BASE ? "Alpha original." : localBody,
        ),
      );
      await writeLockfile(pinCommit ? baseSha : undefined);
      return baseSha;
    }

    function skillContent(result: { changes: ProposedChange[] }): string {
      const change = result.changes.find((c) => c.canonicalPath === "skills/demo/SKILL.md");
      if (!change) throw new Error("SKILL.md was not proposed");
      return typeof change.content === "string" ? change.content : change.content.toString("utf-8");
    }

    it("proposes the local copy verbatim when canonical has not moved", async () => {
      await setupSyncedSkill("Alpha LOCAL.");

      const result = await detectProposedChanges({ cwd: downstreamDir });

      expect(result.changes.map((c) => c.canonicalPath)).toEqual(["skills/demo/SKILL.md"]);
      expect(skillContent(result)).toContain("Alpha LOCAL.");
      expect(result.changes[0]?.rebased).toBeFalsy();
    });

    it("merges local edits onto canonical changes that touch a different region", async () => {
      await setupSyncedSkill("Alpha LOCAL.");
      // Canonical moves on, editing the *other* section.
      await writeCanonicalFile(
        "skills/demo/SKILL.md",
        SKILL_BASE.replace("Beta original.", "Beta UPSTREAM."),
      );
      commitCanonical("upstream");

      const result = await detectProposedChanges({ cwd: downstreamDir });

      const content = skillContent(result);
      expect(content).toContain("Alpha LOCAL.");
      // The upstream edit survives — this is the revert the merge prevents.
      expect(content).toContain("Beta UPSTREAM.");
      expect(content).not.toContain("Beta original.");
      expect(result.changes[0]?.rebased).toBe(true);
    });

    it("aborts when local edits overlap canonical changes", async () => {
      await setupSyncedSkill("Alpha LOCAL.");
      await writeCanonicalFile(
        "skills/demo/SKILL.md",
        SKILL_BASE.replace("Alpha original.", "Alpha UPSTREAM."),
      );
      commitCanonical("upstream");

      await expect(detectProposedChanges({ cwd: downstreamDir })).rejects.toThrow(StaleBaseError);
    });

    it("names the conflicting file and reason on the error", async () => {
      await setupSyncedSkill("Alpha LOCAL.");
      await writeCanonicalFile(
        "skills/demo/SKILL.md",
        SKILL_BASE.replace("Alpha original.", "Alpha UPSTREAM."),
      );
      commitCanonical("upstream");

      const error = await detectProposedChanges({ cwd: downstreamDir }).catch((e) => e);

      expect(error).toBeInstanceOf(StaleBaseError);
      expect(error.conflicts).toHaveLength(1);
      expect(error.conflicts[0].downstreamPath).toBe(".claude/skills/demo/SKILL.md");
      expect(error.conflicts[0].canonicalPath).toBe("skills/demo/SKILL.md");
      expect(error.conflicts[0].reason).toContain("overlap");
    });

    it("--override ships the local copy and discards the canonical change", async () => {
      await setupSyncedSkill("Alpha LOCAL.");
      await writeCanonicalFile(
        "skills/demo/SKILL.md",
        SKILL_BASE.replace("Alpha original.", "Alpha UPSTREAM."),
      );
      commitCanonical("upstream");

      const result = await detectProposedChanges({ cwd: downstreamDir, override: true });

      expect(skillContent(result)).toContain("Alpha LOCAL.");
      expect(result.changes[0]?.rebased).toBeFalsy();
    });

    it("drops a file whose local edit already matches canonical HEAD", async () => {
      await setupSyncedSkill("Alpha CONVERGED.");
      await writeCanonicalFile(
        "skills/demo/SKILL.md",
        SKILL_BASE.replace("Alpha original.", "Alpha CONVERGED."),
      );
      commitCanonical("upstream");

      const result = await detectProposedChanges({ cwd: downstreamDir });

      expect(result.changes).toEqual([]);
    });

    it("--override still merges a file that does not conflict", async () => {
      // Forcing one file must not revert canonical's work in the others, so
      // reconciliation keeps running under --override.
      await setupSyncedSkill("Alpha LOCAL.");
      await writeCanonicalFile(
        "skills/demo/SKILL.md",
        SKILL_BASE.replace("Beta original.", "Beta UPSTREAM."),
      );
      commitCanonical("upstream");

      const result = await detectProposedChanges({ cwd: downstreamDir, override: true });

      const content = skillContent(result);
      expect(content).toContain("Alpha LOCAL.");
      expect(content).toContain("Beta UPSTREAM.");
      expect(result.changes[0]?.rebased).toBe(true);
    });

    it("--override still drops a file the local repo never touched", async () => {
      await writeCanonicalFile("skills/demo/SKILL.md", SKILL_BASE);
      await writeCanonicalFile("skills/demo/references/template.txt", "line one\n");
      const baseSha = commitCanonical("base");
      await writeDownstreamFile(".claude/skills/demo/SKILL.md", addManagedMetadata(SKILL_BASE));
      await writeDownstreamFile(".claude/skills/demo/references/template.txt", "line one\n");
      await writeLockfile(baseSha);
      await writeCanonicalFile("skills/demo/references/template.txt", "line one UPSTREAM\n");
      commitCanonical("upstream");

      const result = await detectProposedChanges({ cwd: downstreamDir, override: true });

      expect(result.changes).toEqual([]);
      expect(result.dropped).toContain(".claude/skills/demo/references/template.txt");
    });

    it("reports dropped files so they are not silently invisible", async () => {
      await setupSyncedSkill("Alpha LOCAL.");
      await writeCanonicalFile(
        "skills/demo/SKILL.md",
        SKILL_BASE.replace("Alpha original.", "Alpha LOCAL."),
      );
      commitCanonical("upstream");

      const result = await detectProposedChanges({ cwd: downstreamDir });

      expect(result.changes).toEqual([]);
      expect(result.dropped).toEqual([".claude/skills/demo/SKILL.md"]);
    });

    it("records the synced base commit on the result", async () => {
      const baseSha = await setupSyncedSkill("Alpha LOCAL.");

      const result = await detectProposedChanges({ cwd: downstreamDir });

      expect(result.baseSha).toBe(baseSha);
    });

    describe("without a resolvable merge base", () => {
      it("aborts when the embedded hash shows canonical moved", async () => {
        await setupSyncedSkill("Alpha LOCAL.", false);
        await writeCanonicalFile(
          "skills/demo/SKILL.md",
          SKILL_BASE.replace("Beta original.", "Beta UPSTREAM."),
        );
        commitCanonical("upstream");

        const error = await detectProposedChanges({ cwd: downstreamDir }).catch((e) => e);

        expect(error).toBeInstanceOf(StaleBaseError);
        expect(error.conflicts[0].reason).toContain("merge base is unavailable");
      });

      it("proposes normally when canonical still matches the sync", async () => {
        await setupSyncedSkill("Alpha LOCAL.", false);

        const result = await detectProposedChanges({ cwd: downstreamDir });

        expect(skillContent(result)).toContain("Alpha LOCAL.");
      });
    });

    /**
     * `normalizeCanonical` and `readSyncedHash` both branch on content type —
     * rules/agents strip frontmatter metadata, the AGENTS.md global block trims
     * and uses a different hash function. Each branch needs its own end-to-end
     * case or a regression there would be silent.
     */
    describe("non-skill content types", () => {
      const RULE_BASE = `---
title: API auth
---

# API Auth

## Tokens

Token guidance original.

## Rotation

Rotation guidance original.
`;

      const AGENT_BASE = `---
name: reviewer
description: Reviews code.
---

# Reviewer

## Scope

Scope original.

## Output

Output original.
`;

      const GLOBAL_BASE = `# Engineering Standards

## Testing

Testing original.

## Style

Style original.
`;

      it("merges a rule edited on both sides in different places", async () => {
        await writeCanonicalFile("rules/security/auth.md", RULE_BASE);
        const baseSha = commitCanonical("base");
        await writeDownstreamFile(
          ".claude/rules/security/auth.md",
          addManagedMetadata(RULE_BASE).replace(
            "Token guidance original.",
            "Token guidance LOCAL.",
          ),
        );
        await writeLockfile(baseSha);
        await writeCanonicalFile(
          "rules/security/auth.md",
          RULE_BASE.replace("Rotation guidance original.", "Rotation guidance UPSTREAM."),
        );
        commitCanonical("upstream");

        const result = await detectProposedChanges({ cwd: downstreamDir });

        expect(result.changes.map((c) => c.canonicalPath)).toEqual(["rules/security/auth.md"]);
        expect(result.changes[0]?.rebased).toBe(true);
        expect(String(result.changes[0]?.content)).toContain("Token guidance LOCAL.");
        expect(String(result.changes[0]?.content)).toContain("Rotation guidance UPSTREAM.");
      });

      it("aborts on an overlapping rule edit", async () => {
        await writeCanonicalFile("rules/security/auth.md", RULE_BASE);
        const baseSha = commitCanonical("base");
        await writeDownstreamFile(
          ".claude/rules/security/auth.md",
          addManagedMetadata(RULE_BASE).replace(
            "Token guidance original.",
            "Token guidance LOCAL.",
          ),
        );
        await writeLockfile(baseSha);
        await writeCanonicalFile(
          "rules/security/auth.md",
          RULE_BASE.replace("Token guidance original.", "Token guidance UPSTREAM."),
        );
        commitCanonical("upstream");

        await expect(detectProposedChanges({ cwd: downstreamDir })).rejects.toThrow(StaleBaseError);
      });

      it("merges an agent edited on both sides in different places", async () => {
        await writeCanonicalFile("agents/reviewer.md", AGENT_BASE);
        const baseSha = commitCanonical("base");
        await writeDownstreamFile(
          ".claude/agents/reviewer.md",
          addManagedMetadata(AGENT_BASE).replace("Scope original.", "Scope LOCAL."),
        );
        await writeLockfile(baseSha);
        await writeCanonicalFile(
          "agents/reviewer.md",
          AGENT_BASE.replace("Output original.", "Output UPSTREAM."),
        );
        commitCanonical("upstream");

        const result = await detectProposedChanges({ cwd: downstreamDir });

        expect(result.changes.map((c) => c.canonicalPath)).toEqual(["agents/reviewer.md"]);
        expect(result.changes[0]?.rebased).toBe(true);
        expect(String(result.changes[0]?.content)).toContain("Scope LOCAL.");
        expect(String(result.changes[0]?.content)).toContain("Output UPSTREAM.");
      });

      it("merges the AGENTS.md global block across both sides", async () => {
        await writeCanonicalFile("instructions/AGENTS.md", GLOBAL_BASE);
        const baseSha = commitCanonical("base");
        // A downstream AGENTS.md whose global block was synced from GLOBAL_BASE
        // and then locally edited.
        await writeDownstreamFile(
          "AGENTS.md",
          `${buildAgentsMd(GLOBAL_BASE, "Repo-specific notes.", {})}\n`.replace(
            "Testing original.",
            "Testing LOCAL.",
          ),
        );
        await writeLockfile(baseSha);
        await writeCanonicalFile(
          "instructions/AGENTS.md",
          GLOBAL_BASE.replace("Style original.", "Style UPSTREAM."),
        );
        commitCanonical("upstream");

        const result = await detectProposedChanges({ cwd: downstreamDir });

        expect(result.changes.map((c) => c.canonicalPath)).toEqual(["instructions/AGENTS.md"]);
        expect(result.changes[0]?.rebased).toBe(true);
        const content = String(result.changes[0]?.content);
        expect(content).toContain("Testing LOCAL.");
        expect(content).toContain("Style UPSTREAM.");
        // Repo-specific content never leaves the downstream repo.
        expect(content).not.toContain("Repo-specific notes.");
      });

      it("drops the global block when only canonical changed it", async () => {
        await writeCanonicalFile("instructions/AGENTS.md", GLOBAL_BASE);
        const baseSha = commitCanonical("base");
        await writeDownstreamFile(
          "AGENTS.md",
          `${buildAgentsMd(GLOBAL_BASE, "Repo-specific notes.", {})}\n`,
        );
        await writeLockfile(baseSha);
        await writeCanonicalFile(
          "instructions/AGENTS.md",
          GLOBAL_BASE.replace("Style original.", "Style UPSTREAM."),
        );
        commitCanonical("upstream");

        const result = await detectProposedChanges({ cwd: downstreamDir });

        expect(result.changes).toEqual([]);
      });
    });

    describe("skill assets", () => {
      const ASSET = "line one\nline two\nline three\n";

      /** Canonical skill + asset, downstream synced from it and untouched. */
      async function setupSyncedAsset(): Promise<string> {
        await writeCanonicalFile("skills/demo/SKILL.md", SKILL_BASE);
        await writeCanonicalFile("skills/demo/references/template.txt", ASSET);
        const baseSha = commitCanonical("base");
        await writeDownstreamFile(".claude/skills/demo/SKILL.md", addManagedMetadata(SKILL_BASE));
        await writeDownstreamFile(".claude/skills/demo/references/template.txt", ASSET);
        await writeLockfile(baseSha);
        return baseSha;
      }

      it("does not propose an untouched asset that canonical has since changed", async () => {
        // The reported bug in asset form: the local copy differs from HEAD only
        // because canonical moved, so proposing it would revert the upstream edit.
        await setupSyncedAsset();
        await writeCanonicalFile(
          "skills/demo/references/template.txt",
          ASSET.replace("line two", "line two UPSTREAM"),
        );
        commitCanonical("upstream");

        const result = await detectProposedChanges({ cwd: downstreamDir });

        expect(result.changes).toEqual([]);
      });

      it("merges an asset edited on both sides in different places", async () => {
        await setupSyncedAsset();
        await writeDownstreamFile(
          ".claude/skills/demo/references/template.txt",
          ASSET.replace("line one", "line one LOCAL"),
        );
        await writeCanonicalFile(
          "skills/demo/references/template.txt",
          ASSET.replace("line three", "line three UPSTREAM"),
        );
        commitCanonical("upstream");

        const result = await detectProposedChanges({ cwd: downstreamDir });

        expect(result.changes).toHaveLength(1);
        const change = result.changes[0];
        expect(change?.canonicalPath).toBe("skills/demo/references/template.txt");
        expect(change?.rebased).toBe(true);
        const merged =
          typeof change?.content === "string" ? change.content : change?.content.toString("utf-8");
        expect(merged).toContain("line one LOCAL");
        expect(merged).toContain("line three UPSTREAM");
      });

      it("aborts when an asset was edited on both sides in the same place", async () => {
        await setupSyncedAsset();
        await writeDownstreamFile(
          ".claude/skills/demo/references/template.txt",
          ASSET.replace("line two", "line two LOCAL"),
        );
        await writeCanonicalFile(
          "skills/demo/references/template.txt",
          ASSET.replace("line two", "line two UPSTREAM"),
        );
        commitCanonical("upstream");

        await expect(detectProposedChanges({ cwd: downstreamDir })).rejects.toThrow(StaleBaseError);
      });

      it("ignores a conflicting asset that --files excludes", async () => {
        await setupSyncedAsset();
        await writeDownstreamFile(
          ".claude/skills/demo/references/template.txt",
          ASSET.replace("line two", "line two LOCAL"),
        );
        await writeCanonicalFile(
          "skills/demo/references/template.txt",
          ASSET.replace("line two", "line two UPSTREAM"),
        );
        commitCanonical("upstream");
        // A file the filter keeps, so the propose has something to ship.
        await writeDownstreamFile(".claude/skills/demo/scripts/new.sh", "echo new\n");

        const result = await detectProposedChanges({
          cwd: downstreamDir,
          files: ["scripts/new\\.sh$"],
        });

        expect(result.changes.map((c) => c.canonicalPath)).toEqual(["skills/demo/scripts/new.sh"]);
      });

      it("still proposes an asset that only exists downstream", async () => {
        await setupSyncedAsset();
        await writeDownstreamFile(".claude/skills/demo/scripts/new.sh", "echo new\n");

        const result = await detectProposedChanges({ cwd: downstreamDir });

        expect(result.changes.map((c) => c.canonicalPath)).toEqual(["skills/demo/scripts/new.sh"]);
      });
    });
  });
});
