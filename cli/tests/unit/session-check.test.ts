import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeLockfile } from "../../src/core/lockfile.js";
import {
  detectCrossScopeDuplication,
  installSessionStartHook,
} from "../../src/core/session-check.js";

const localSource = { type: "local" as const, path: "/canonical" };

describe("session-check core", () => {
  let repoDir: string;
  let home: string;

  beforeEach(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-sc-repo-"));
    home = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-sc-home-"));
  });

  afterEach(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
    await fs.rm(home, { recursive: true, force: true });
  });

  describe("detectCrossScopeDuplication", () => {
    it("returns no findings when only one scope is synced", async () => {
      await writeLockfile(repoDir, {
        source: localSource,
        globalBlockContent: "CANON",
        skills: ["s1"],
        targets: ["claude"],
        markerPrefix: "agconf",
      });
      const result = await detectCrossScopeDuplication({ repoDir, homeDir: home });
      expect(result.repoSynced).toBe(true);
      expect(result.userSynced).toBe(false);
      expect(result.findings).toEqual([]);
    });

    it("flags instructions as identical when both scopes hold the same global block", async () => {
      await writeLockfile(repoDir, {
        source: localSource,
        globalBlockContent: "CANON",
        skills: [],
        targets: ["claude"],
        markerPrefix: "agconf",
      });
      await writeLockfile(home, {
        source: localSource,
        globalBlockContent: "CANON",
        skills: [],
        targets: ["claude"],
        markerPrefix: "agconf",
      });
      const { findings } = await detectCrossScopeDuplication({ repoDir, homeDir: home });
      const instr = findings.find((f) => f.type === "instructions");
      expect(instr).toBeDefined();
      expect(instr?.divergent).toBe(false);
    });

    it("flags instructions as divergent when the two copies differ (identity, not equality)", async () => {
      await writeLockfile(repoDir, {
        source: localSource,
        globalBlockContent: "CANON-REPO",
        skills: [],
        targets: ["claude"],
        markerPrefix: "agconf",
      });
      await writeLockfile(home, {
        source: localSource,
        globalBlockContent: "CANON-USER",
        skills: [],
        targets: ["claude"],
        markerPrefix: "agconf",
      });
      const { findings } = await detectCrossScopeDuplication({ repoDir, homeDir: home });
      // Still flagged even though contents differ — divergence is worse, not exempt.
      expect(findings.find((f) => f.type === "instructions")?.divergent).toBe(true);
    });

    it("flags skills present in both scopes", async () => {
      await writeLockfile(repoDir, {
        source: localSource,
        globalBlockContent: "CANON",
        skills: ["s1"],
        targets: ["claude"],
        markerPrefix: "agconf",
      });
      await writeLockfile(home, {
        source: localSource,
        globalBlockContent: "CANON",
        skills: ["u1"],
        targets: ["claude"],
        markerPrefix: "agconf",
      });
      const { findings } = await detectCrossScopeDuplication({ repoDir, homeDir: home });
      expect(findings.some((f) => f.type === "skills")).toBe(true);
    });
  });

  describe("installSessionStartHook", () => {
    it("creates settings.json with a SessionStart hook", async () => {
      const result = await installSessionStartHook(home);
      expect(result.installed).toBe(true);
      const settings = JSON.parse(await fs.readFile(result.settingsPath, "utf-8"));
      const cmd = settings.hooks.SessionStart[0].hooks[0].command;
      expect(cmd).toContain("agconf session-check");
    });

    it("is idempotent (no duplicate hook on re-install)", async () => {
      await installSessionStartHook(home);
      const second = await installSessionStartHook(home);
      expect(second.alreadyPresent).toBe(true);
      const settings = JSON.parse(await fs.readFile(second.settingsPath, "utf-8"));
      expect(settings.hooks.SessionStart).toHaveLength(1);
    });

    it("preserves existing settings and other hooks", async () => {
      const settingsPath = path.join(home, ".claude", "settings.json");
      await fs.mkdir(path.dirname(settingsPath), { recursive: true });
      await fs.writeFile(
        settingsPath,
        JSON.stringify({
          model: "opus",
          hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "echo hi" }] }] },
        }),
      );

      await installSessionStartHook(home);
      const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
      expect(settings.model).toBe("opus"); // preserved
      expect(settings.hooks.PreToolUse).toHaveLength(1); // preserved
      expect(settings.hooks.SessionStart[0].hooks[0].command).toContain("session-check");
    });

    it("refuses to overwrite an existing but malformed settings.json", async () => {
      const settingsPath = path.join(home, ".claude", "settings.json");
      await fs.mkdir(path.dirname(settingsPath), { recursive: true });
      const malformed = '{ "model": "opus", bad json here';
      await fs.writeFile(settingsPath, malformed);

      await expect(installSessionStartHook(home)).rejects.toThrow(/not valid JSON/);
      // The user's file is left exactly as it was — never clobbered.
      expect(await fs.readFile(settingsPath, "utf-8")).toBe(malformed);
    });
  });
});
