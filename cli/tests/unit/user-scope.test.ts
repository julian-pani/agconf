import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getMarkers } from "../../src/core/markers.js";
import { resolveLocalSource } from "../../src/core/source.js";
import {
  checkUserScope,
  getUserPaths,
  projectGlobalBlock,
  syncUserScope,
} from "../../src/core/user-scope.js";

const markers = getMarkers();

describe("user-scope", () => {
  describe("projectGlobalBlock (pure)", () => {
    it("prepends the block + personal line to a fresh file", () => {
      const out = projectGlobalBlock("", "CANON", {
        markerPrefix: "agconf",
        personalLine: "@~/.agconf/USER.md",
      });
      expect(out).toContain(markers.globalStart);
      expect(out).toContain("CANON");
      expect(out).toContain("@~/.agconf/USER.md");
    });

    it("preserves pre-existing personal content", () => {
      const out = projectGlobalBlock("# My notes\n\nhello", "CANON", {
        markerPrefix: "agconf",
        personalLine: "@~/.agconf/USER.md",
      });
      expect(out).toContain("# My notes");
      expect(out).toContain("hello");
      expect(out).toContain(markers.globalStart);
    });

    it("preserves the user's own blank lines in prepended content", () => {
      // A fenced code block that intentionally contains 3 consecutive newlines.
      const userContent = "# Notes\n\nfirst\n\n\nsecond\n";
      const out = projectGlobalBlock(userContent, "CANON", {
        markerPrefix: "agconf",
        personalLine: "@~/.agconf/USER.md",
      });
      // The user's double-blank-line gap survives verbatim (not collapsed).
      expect(out).toContain("first\n\n\nsecond");
    });

    it("replaces the managed block in place on re-projection (no personal-line dup)", () => {
      const first = projectGlobalBlock("existing user text", "CANON", {
        markerPrefix: "agconf",
        personalLine: "@~/.agconf/USER.md",
      });
      const second = projectGlobalBlock(first, "CANON-V2", {
        markerPrefix: "agconf",
        personalLine: "@~/.agconf/USER.md",
      });
      expect(second).toContain("CANON-V2");
      expect(second).not.toContain("CANON\n"); // old content gone
      expect(second).toContain("existing user text");
      // Personal line added once (not duplicated on re-sync).
      expect(second.match(/@~\/\.agconf\/USER\.md/g)?.length).toBe(1);
    });
  });

  describe("syncUserScope + checkUserScope", () => {
    let home: string;
    let canonical: string;

    const writeCanonical = async (content: string) => {
      await fs.mkdir(path.join(canonical, "instructions"), { recursive: true });
      await fs.mkdir(path.join(canonical, "skills"), { recursive: true });
      await fs.writeFile(path.join(canonical, "instructions", "AGENTS.md"), content, "utf-8");
    };

    beforeEach(async () => {
      home = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-userscope-home-"));
      canonical = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-userscope-canon-"));
      await writeCanonical("# Company Standards\n\nDo the company things.");
    });

    afterEach(async () => {
      await fs.rm(home, { recursive: true, force: true });
      await fs.rm(canonical, { recursive: true, force: true });
    });

    const claudeFile = () => path.join(home, ".claude", "CLAUDE.md");
    const codexFile = () => path.join(home, ".codex", "AGENTS.md");

    const read = (p: string) => fs.readFile(p, "utf-8");
    const exists = (p: string) =>
      fs
        .access(p)
        .then(() => true)
        .catch(() => false);

    it("projects the global block into both harness files and populates the store", async () => {
      const source = await resolveLocalSource({ path: canonical });
      const result = await syncUserScope(source, {
        targets: ["claude", "codex"],
        homeDir: home,
        now: "2026-08-05T00:00:00.000Z",
      });

      // Claude: block + native import.
      const claude = await read(claudeFile());
      expect(claude).toContain(markers.globalStart);
      expect(claude).toContain("Do the company things.");
      expect(claude).toContain("@~/.agconf/USER.md");

      // Codex: block + read-note (no import).
      const codex = await read(codexFile());
      expect(codex).toContain("Do the company things.");
      expect(codex).toContain("read ~/.agconf/USER.md");

      // Store: USER.md scaffolded, global.md mirror, lockfile.
      const paths = getUserPaths(home);
      expect(await exists(paths.userMdPath)).toBe(true);
      expect(await read(paths.globalMdPath)).toContain("Do the company things.");
      expect(await exists(path.join(paths.storeDir, "lockfile.json"))).toBe(true);
      expect(result.userMdCreated).toBe(true);
      expect(result.committed).toBe(true); // store git-committed
    });

    it("writes a store .gitignore excluding machine-local artifacts", async () => {
      const source = await resolveLocalSource({ path: canonical });
      await syncUserScope(source, { targets: ["claude"], homeDir: home });

      const gitignore = await read(path.join(getUserPaths(home).storeDir, ".gitignore"));
      expect(gitignore).toContain("backups/");
      expect(gitignore).toContain("logs/");
      expect(gitignore).toContain("autosync-state.json");
    });

    it("never overwrites USER.md after it exists", async () => {
      const source = await resolveLocalSource({ path: canonical });
      await syncUserScope(source, { targets: ["claude"], homeDir: home });

      const paths = getUserPaths(home);
      await fs.writeFile(paths.userMdPath, "MY PERSONAL PREFS", "utf-8");

      const second = await syncUserScope(source, { targets: ["claude"], homeDir: home });
      expect(second.userMdCreated).toBe(false);
      expect(await read(paths.userMdPath)).toBe("MY PERSONAL PREFS");
    });

    it("backs up a pre-existing unmanaged file before overwriting it", async () => {
      await fs.mkdir(path.join(home, ".claude"), { recursive: true });
      await fs.writeFile(claudeFile(), "# my own claude notes\n", "utf-8");

      const source = await resolveLocalSource({ path: canonical });
      const result = await syncUserScope(source, {
        targets: ["claude"],
        homeDir: home,
        now: "2026-08-05T00:00:00.000Z",
      });

      const claudeResult = result.files.find((f) => f.target === "claude");
      expect(claudeResult?.backedUp).toBeTruthy();
      // The backup holds the original content...
      expect(await read(claudeResult?.backedUp as string)).toContain("my own claude notes");
      // ...and the projected file preserves it beneath the managed block.
      const projected = await read(claudeFile());
      expect(projected).toContain(markers.globalStart);
      expect(projected).toContain("my own claude notes");
    });

    it("check passes after sync, flags edits, and flags a deleted file", async () => {
      const source = await resolveLocalSource({ path: canonical });
      await syncUserScope(source, { targets: ["claude", "codex"], homeDir: home });

      expect((await checkUserScope({ homeDir: home })).ok).toBe(true);

      // Tamper with the managed block content in the Claude file.
      const claude = await read(claudeFile());
      await fs.writeFile(claudeFile(), claude.replace("Do the company things.", "HACKED"), "utf-8");

      // Delete the Codex file.
      await fs.rm(codexFile());

      const check = await checkUserScope({ homeDir: home });
      expect(check.ok).toBe(false);
      expect(check.modified.some((m) => m.target === "claude")).toBe(true);
      expect(check.missing.some((m) => m.target === "codex")).toBe(true);
    });

    it("reports no lockfile when the store is empty", async () => {
      const result = await checkUserScope({ homeDir: home });
      expect(result.hasLockfile).toBe(false);
      expect(result.ok).toBe(true);
    });
  });

  describe("content types (skills / agents / rules)", () => {
    let home: string;
    let canonical: string;

    const exists = (p: string) =>
      fs
        .access(p)
        .then(() => true)
        .catch(() => false);

    beforeEach(async () => {
      home = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-usc-content-home-"));
      canonical = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-usc-content-canon-"));
      await fs.mkdir(path.join(canonical, "instructions"), { recursive: true });
      await fs.mkdir(path.join(canonical, "skills", "my-skill"), { recursive: true });
      await fs.mkdir(path.join(canonical, "agents"), { recursive: true });
      await fs.mkdir(path.join(canonical, "rules", "security"), { recursive: true });
      await fs.writeFile(
        path.join(canonical, "instructions", "AGENTS.md"),
        "# Standards\n\nDo things.",
      );
      await fs.writeFile(
        path.join(canonical, "skills", "my-skill", "SKILL.md"),
        "---\nname: my-skill\ndescription: A skill\n---\n\n# My Skill\n",
      );
      await fs.writeFile(
        path.join(canonical, "agents", "reviewer.md"),
        "---\nname: reviewer\ndescription: Reviews code\n---\n\nReview.\n",
      );
      await fs.writeFile(
        path.join(canonical, "rules", "security", "auth.md"),
        "---\ntitle: Auth\n---\n\n# Auth\n\nUse auth.\n",
      );
      await fs.writeFile(
        path.join(canonical, "agconf.yaml"),
        [
          'version: "1.0.0"',
          "meta:",
          "  name: test",
          "content:",
          "  agents_dir: agents",
          "  rules_dir: rules",
          "targets: [claude, codex]",
          "",
        ].join("\n"),
      );
    });

    afterEach(async () => {
      await fs.rm(home, { recursive: true, force: true });
      await fs.rm(canonical, { recursive: true, force: true });
    });

    it("projects skills, agents, and rules into the per-user locations", async () => {
      const source = await resolveLocalSource({ path: canonical });
      const result = await syncUserScope(source, { targets: ["claude", "codex"], homeDir: home });

      // Skills → both harness skill dirs (~/.claude/skills, ~/.agents/skills).
      expect(await exists(path.join(home, ".claude", "skills", "my-skill", "SKILL.md"))).toBe(true);
      expect(await exists(path.join(home, ".agents", "skills", "my-skill", "SKILL.md"))).toBe(true);
      // Subagents → Claude .md + Codex .toml.
      expect(await exists(path.join(home, ".claude", "agents", "reviewer.md"))).toBe(true);
      expect(await exists(path.join(home, ".codex", "agents", "reviewer.toml"))).toBe(true);
      // Rules → Claude files + a Codex rules section in ~/.codex/AGENTS.md.
      expect(await exists(path.join(home, ".claude", "rules", "security", "auth.md"))).toBe(true);
      expect(await fs.readFile(path.join(home, ".codex", "AGENTS.md"), "utf-8")).toContain("Auth");

      expect(result.skills).toEqual(["my-skill"]);
      expect(result.rules).toContain("security/auth.md");
      expect(result.agents).toContain("reviewer.md");
    });

    it("check --scope user passes after sync and flags a tampered skill", async () => {
      const source = await resolveLocalSource({ path: canonical });
      await syncUserScope(source, { targets: ["claude"], homeDir: home });
      expect((await checkUserScope({ homeDir: home })).ok).toBe(true);

      await fs.appendFile(
        path.join(home, ".claude", "skills", "my-skill", "SKILL.md"),
        "\ntampered\n",
      );
      const check = await checkUserScope({ homeDir: home });
      expect(check.ok).toBe(false);
      expect(check.modified.some((m) => m.path.includes("my-skill"))).toBe(true);
    });

    it("backs up a divergent unmanaged skill before projecting over it", async () => {
      // Developer already has their own my-skill (unmanaged, different content).
      await fs.mkdir(path.join(home, ".claude", "skills", "my-skill"), { recursive: true });
      await fs.writeFile(
        path.join(home, ".claude", "skills", "my-skill", "SKILL.md"),
        "---\nname: my-skill\ndescription: MINE\n---\n\n# My own version\n",
      );

      const source = await resolveLocalSource({ path: canonical });
      const result = await syncUserScope(source, {
        targets: ["claude"],
        homeDir: home,
        now: "2026-08-05T00:00:00.000Z",
      });

      // A backup was taken and holds the developer's original content.
      const backedUp = result.contentBackups.find((p) => p.includes("my-skill"));
      expect(backedUp).toBeTruthy();
      const backupSkill = await fs.readFile(path.join(backedUp as string, "SKILL.md"), "utf-8");
      expect(backupSkill).toContain("My own version");

      // The projected skill is now the managed canonical version.
      const projected = await fs.readFile(
        path.join(home, ".claude", "skills", "my-skill", "SKILL.md"),
        "utf-8",
      );
      expect(projected).toContain("# My Skill");
    });

    it("check flags a skill deleted from disk as missing (absolute path)", async () => {
      const source = await resolveLocalSource({ path: canonical });
      await syncUserScope(source, { targets: ["claude"], homeDir: home });

      await fs.rm(path.join(home, ".claude", "skills", "my-skill"), {
        recursive: true,
        force: true,
      });

      const check = await checkUserScope({ homeDir: home });
      expect(check.ok).toBe(false);
      const miss = check.missing.find((m) => m.path.includes("my-skill"));
      expect(miss).toBeTruthy();
      expect(path.isAbsolute(miss?.path as string)).toBe(true);
    });

    it("check flags a managed skill dropped from the lockfile as a ghost", async () => {
      const source = await resolveLocalSource({ path: canonical });
      await syncUserScope(source, { targets: ["claude"], homeDir: home });

      // Drop my-skill from the lockfile's tracked set while it stays on disk.
      const lockPath = path.join(getUserPaths(home).storeDir, "lockfile.json");
      const lock = JSON.parse(await fs.readFile(lockPath, "utf-8"));
      lock.content.skills = [];
      await fs.writeFile(lockPath, JSON.stringify(lock, null, 2), "utf-8");

      const check = await checkUserScope({ homeDir: home });
      expect(check.ok).toBe(false);
      const ghost = check.ghosts.find((g) => g.path.includes("my-skill"));
      expect(ghost).toBeTruthy();
      expect(path.isAbsolute(ghost?.path as string)).toBe(true);
    });

    it("removes a skill dropped from canonical (orphan cleanup)", async () => {
      let source = await resolveLocalSource({ path: canonical });
      await syncUserScope(source, { targets: ["claude", "codex"], homeDir: home });
      expect(await exists(path.join(home, ".claude", "skills", "my-skill", "SKILL.md"))).toBe(true);

      await fs.rm(path.join(canonical, "skills", "my-skill"), { recursive: true, force: true });
      source = await resolveLocalSource({ path: canonical });
      const result = await syncUserScope(source, { targets: ["claude", "codex"], homeDir: home });

      expect(result.removed.skills).toContain("my-skill");
      expect(await exists(path.join(home, ".claude", "skills", "my-skill", "SKILL.md"))).toBe(
        false,
      );
      expect(await exists(path.join(home, ".agents", "skills", "my-skill", "SKILL.md"))).toBe(
        false,
      );
    });
  });
});
