import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  matchesAllowedPath,
  resolveAllowedPaths,
  verifyChangedPaths,
} from "../../src/core/verify-paths.js";

/** Minimal lockfile the guard can read a marker prefix out of. */
function lockfileWithPrefix(markerPrefix: string): string {
  return JSON.stringify({
    version: "1.0.0",
    synced_at: new Date().toISOString(),
    source: { type: "github", repository: "acme/standards", commit_sha: "abc123", ref: "master" },
    content: {
      agents_md: { global_block_hash: "sha256:000000000000", merged: true },
      skills: [],
      marker_prefix: markerPrefix,
    },
  });
}

describe("verify-paths", () => {
  let tempDir: string;

  /** Write a file, creating parent directories as needed. */
  async function write(relPath: string, content = "x"): Promise<void> {
    const full = path.join(tempDir, relPath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf-8");
  }

  /** Commit everything currently in the worktree, so later edits show as changes. */
  async function commitAll(): Promise<void> {
    const git = simpleGit(tempDir);
    await git.add("-A");
    await git.commit("baseline");
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-verify-paths-"));
    const git = simpleGit(tempDir);
    await git.init();
    await git.addConfig("user.email", "test@example.com");
    await git.addConfig("user.name", "Test");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("matchesAllowedPath", () => {
    it("matches everything under a /** directory pattern", () => {
      expect(matchesAllowedPath(".claude/skills/foo/SKILL.md", ".claude/**")).toBe(true);
      expect(matchesAllowedPath(".claude/settings.json", ".claude/**")).toBe(true);
    });

    it("does not accept a trailing-slash directory pattern, which the workflow rejects", () => {
      // The workflow's guard supports only `dir/**` and an exact path. Accepting
      // a third shape here would pass locally and then block the sync in CI.
      expect(matchesAllowedPath(".agconf/lockfile.json", ".agconf/")).toBe(false);
    });

    it("requires a directory boundary, so a name prefix does not match", () => {
      expect(matchesAllowedPath(".claudex/evil.md", ".claude/**")).toBe(false);
      expect(matchesAllowedPath("AGENTS.md.bak", "AGENTS.md")).toBe(false);
    });

    it("matches an exact file path only", () => {
      expect(matchesAllowedPath("AGENTS.md", "AGENTS.md")).toBe(true);
      expect(matchesAllowedPath("docs/AGENTS.md", "AGENTS.md")).toBe(false);
    });
  });

  describe("resolveAllowedPaths", () => {
    it("includes the agconf-owned directories and root files", async () => {
      const patterns = await resolveAllowedPaths(tempDir);
      expect(patterns).toContain("AGENTS.md");
      expect(patterns).toContain("CLAUDE.md");
      expect(patterns).toContain(".claude/**");
      expect(patterns).toContain(".codex/**");
      expect(patterns).toContain(".agents/**");
      expect(patterns).toContain(".agconf/**");
    });

    it("includes .pre-commit-config.yaml, which sync writes in pre-commit repos", async () => {
      const patterns = await resolveAllowedPaths(tempDir);
      expect(patterns).toContain(".pre-commit-config.yaml");
      expect(patterns).toContain(".pre-commit-config.yml");
    });

    it("defaults the workflow filenames to the agconf prefix", async () => {
      const patterns = await resolveAllowedPaths(tempDir);
      expect(patterns).toContain(".github/workflows/agconf-sync.yml");
      expect(patterns).toContain(".github/workflows/agconf-check.yml");
    });

    it("names the workflow files after the lockfile's marker prefix", async () => {
      await write(".agconf/lockfile.json", lockfileWithPrefix("acme"));

      const patterns = await resolveAllowedPaths(tempDir);
      expect(patterns).toContain(".github/workflows/acme-sync.yml");
      expect(patterns).toContain(".github/workflows/acme-check.yml");
      expect(patterns).not.toContain(".github/workflows/agconf-sync.yml");
    });
  });

  describe("verifyChangedPaths", () => {
    it("reports nothing for a clean worktree", async () => {
      await write("src/index.ts");
      await commitAll();

      const result = await verifyChangedPaths(tempDir);
      expect(result.violations).toEqual([]);
      expect(result.allowed).toEqual([]);
    });

    it("allows changes confined to agconf-owned paths", async () => {
      await write("src/index.ts");
      await write("AGENTS.md", "old");
      await commitAll();

      await write("AGENTS.md", "new");
      await write(".claude/skills/foo/SKILL.md");
      await write(".codex/agents/foo.toml");

      const result = await verifyChangedPaths(tempDir);
      expect(result.violations).toEqual([]);
      expect(result.allowed).toEqual([
        ".claude/skills/foo/SKILL.md",
        ".codex/agents/foo.toml",
        "AGENTS.md",
      ]);
    });

    it("flags a modified file outside the allowlist", async () => {
      await write("src/index.ts", "original");
      await commitAll();

      await write("src/index.ts", "rewritten");

      const result = await verifyChangedPaths(tempDir);
      expect(result.violations).toEqual([{ path: "src/index.ts", change: "modified" }]);
    });

    it("flags a deleted file outside the allowlist", async () => {
      await write("src/index.ts");
      await commitAll();

      await fs.rm(path.join(tempDir, "src/index.ts"));

      const result = await verifyChangedPaths(tempDir);
      expect(result.violations).toEqual([{ path: "src/index.ts", change: "deleted" }]);
    });

    it("does not let a trailing space in a filename pass as an allowed path", async () => {
      await write("AGENTS.md", "original");
      await commitAll();

      await write("AGENTS.md ", "a different file");

      const result = await verifyChangedPaths(tempDir);
      expect(result.allowed).not.toContain("AGENTS.md");
      expect(result.violations.map((v) => v.path)).toContain("AGENTS.md ");
    });

    it("flags an untracked file outside the allowlist", async () => {
      await write("README.md");
      await commitAll();

      await write("src/sneaky.ts");

      const result = await verifyChangedPaths(tempDir);
      expect(result.violations).toEqual([{ path: "src/sneaky.ts", change: "untracked" }]);
    });

    it("flags a CI workflow that is not one of agconf's own", async () => {
      await write(".github/workflows/ci.yml", "original");
      await commitAll();

      await write(".github/workflows/ci.yml", "rewritten");
      await write(".github/workflows/agconf-sync.yml");

      const result = await verifyChangedPaths(tempDir);
      expect(result.violations).toEqual([{ path: ".github/workflows/ci.yml", change: "modified" }]);
      expect(result.allowed).toEqual([".github/workflows/agconf-sync.yml"]);
    });

    it("allows the pre-commit config sync registers its hook in", async () => {
      await write(".pre-commit-config.yaml", "repos: []");
      await commitAll();

      await write(".pre-commit-config.yaml", "repos: [agconf-check]");

      const result = await verifyChangedPaths(tempDir);
      expect(result.violations).toEqual([]);
      expect(result.allowed).toEqual([".pre-commit-config.yaml"]);
    });

    it("catches a file moved out of an allowed directory", async () => {
      await write(".claude/skills/foo/SKILL.md");
      await commitAll();

      const git = simpleGit(tempDir);
      await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
      await git.mv(".claude/skills/foo/SKILL.md", "src/SKILL.md");

      const result = await verifyChangedPaths(tempDir);
      expect(result.violations.map((v) => v.path)).toContain("src/SKILL.md");
    });
  });
});
