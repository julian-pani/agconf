import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addManagedMetadata } from "../../src/core/managed-content.js";
import {
  applyProposedChanges,
  detectNewContent,
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

        // No managed skills → detect skips cloning canonical entirely.
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
});
