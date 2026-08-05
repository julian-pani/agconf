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
});
