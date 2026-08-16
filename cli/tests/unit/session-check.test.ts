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

    it("flags only skills that actually overlap between scopes", async () => {
      await writeLockfile(repoDir, {
        source: localSource,
        globalBlockContent: "CANON",
        skills: ["s1", "shared"],
        targets: ["claude"],
        markerPrefix: "agconf",
      });
      await writeLockfile(home, {
        source: localSource,
        globalBlockContent: "CANON",
        skills: ["u1", "shared"],
        targets: ["claude"],
        markerPrefix: "agconf",
      });
      const { findings } = await detectCrossScopeDuplication({ repoDir, homeDir: home });
      const skills = findings.find((f) => f.type === "skills");
      expect(skills).toBeDefined();
      // Names the real overlap, not the disjoint skills.
      expect(skills?.objects).toEqual(["shared"]);
    });

    it("does not flag skills when the two scopes have no overlap", async () => {
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
      // Repo skill s1 + user skill u1 is not a collision — instructions is the
      // only shared thing here (both carry the "CANON" block).
      expect(findings.some((f) => f.type === "skills")).toBe(false);
    });

    it("flags overlapping rules and agents by their real intersection", async () => {
      const common = {
        source: localSource,
        globalBlockContent: "CANON",
        skills: [],
        targets: ["claude"] as string[],
        markerPrefix: "agconf",
      };
      await writeLockfile(repoDir, {
        ...common,
        rules: { files: ["security/auth.md", "repo-only.md"], content_hash: "sha256:aaa" },
        agents: { files: ["reviewer.md", "repo-agent.md"], content_hash: "sha256:bbb" },
      });
      await writeLockfile(home, {
        ...common,
        rules: { files: ["security/auth.md", "user-only.md"], content_hash: "sha256:ccc" },
        agents: { files: ["reviewer.md", "user-agent.md"], content_hash: "sha256:ddd" },
      });
      const { findings } = await detectCrossScopeDuplication({ repoDir, homeDir: home });
      expect(findings.find((f) => f.type === "rules")?.objects).toEqual(["security/auth.md"]);
      expect(findings.find((f) => f.type === "agents")?.objects).toEqual(["reviewer.md"]);
    });

    it("degrades to 'no findings' when a scope's lockfile is corrupt (does not throw)", async () => {
      await writeLockfile(home, {
        source: localSource,
        globalBlockContent: "CANON",
        skills: [],
        targets: ["claude"],
        markerPrefix: "agconf",
      });
      // A torn repo lockfile must not throw (it would kill the whole session hook).
      await fs.mkdir(path.join(repoDir, ".agconf"), { recursive: true });
      await fs.writeFile(path.join(repoDir, ".agconf", "lockfile.json"), "{ not json");

      const result = await detectCrossScopeDuplication({ repoDir, homeDir: home });
      expect(result.userSynced).toBe(true);
      expect(result.repoSynced).toBe(false); // corrupt repo lockfile → treated as unsynced
      expect(result.findings).toEqual([]);
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
