import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeLockfile } from "../../src/core/lockfile.js";
import {
  codexHooksDisabledWarning,
  detectCrossScopeDuplication,
  findMissingHookTargets,
  getCodexHooksState,
  installClaudeSessionStartHook,
  installCodexSessionStartHook,
  installSessionStartHooks,
  parseCodexHooksState,
  resolveHookTargets,
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

  describe("installClaudeSessionStartHook", () => {
    it("creates settings.json with a SessionStart hook", async () => {
      const result = await installClaudeSessionStartHook(home);
      expect(result.installed).toBe(true);
      expect(result.target).toBe("claude");
      const settings = JSON.parse(await fs.readFile(result.filePath, "utf-8"));
      const cmd = settings.hooks.SessionStart[0].hooks[0].command;
      expect(cmd).toContain("agconf session-check");
    });

    it("is idempotent (no duplicate hook on re-install)", async () => {
      await installClaudeSessionStartHook(home);
      const second = await installClaudeSessionStartHook(home);
      expect(second.alreadyPresent).toBe(true);
      const settings = JSON.parse(await fs.readFile(second.filePath, "utf-8"));
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

      await installClaudeSessionStartHook(home);
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

      await expect(installClaudeSessionStartHook(home)).rejects.toThrow(/not valid JSON/);
      // The user's file is left exactly as it was — never clobbered.
      expect(await fs.readFile(settingsPath, "utf-8")).toBe(malformed);
    });

    it("installs alongside a pre-existing malformed SessionStart entry without throwing", async () => {
      const settingsPath = path.join(home, ".claude", "settings.json");
      await fs.mkdir(path.dirname(settingsPath), { recursive: true });
      // SessionStart is a valid array, but a prior entry's `hooks` is a non-array
      // object. The presence scan must not choke on it (Array.isArray guard); our
      // entry is appended and the junk entry preserved.
      await fs.writeFile(
        settingsPath,
        JSON.stringify({ hooks: { SessionStart: [{ hooks: {} }] } }),
      );

      const result = await installClaudeSessionStartHook(home);
      expect(result.installed).toBe(true);
      const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
      expect(settings.hooks.SessionStart).toHaveLength(2); // junk entry + ours
      const cmds = settings.hooks.SessionStart.flatMap((e: { hooks?: unknown }) =>
        Array.isArray(e.hooks) ? e.hooks.map((h: { command?: string }) => h.command) : [],
      );
      expect(cmds).toContain("agconf session-check");
    });
  });

  describe("installCodexSessionStartHook", () => {
    const hooksPath = () => path.join(home, ".codex", "hooks.json");

    it("creates ~/.codex/hooks.json with a SessionStart hook", async () => {
      const result = await installCodexSessionStartHook(home);
      expect(result.installed).toBe(true);
      expect(result.target).toBe("codex");
      expect(result.filePath).toBe(hooksPath());
      const config = JSON.parse(await fs.readFile(result.filePath, "utf-8"));
      const entry = config.hooks.SessionStart[0];
      expect(entry.hooks[0].command).toContain("agconf session-check");
      // matcher "*" is the form verified against a real Codex install.
      expect(entry.matcher).toBe("*");
    });

    it("is idempotent (no duplicate hook on re-install)", async () => {
      await installCodexSessionStartHook(home);
      const second = await installCodexSessionStartHook(home);
      expect(second.alreadyPresent).toBe(true);
      const config = JSON.parse(await fs.readFile(hooksPath(), "utf-8"));
      expect(config.hooks.SessionStart).toHaveLength(1);
    });

    it("preserves existing hooks in hooks.json", async () => {
      await fs.mkdir(path.dirname(hooksPath()), { recursive: true });
      await fs.writeFile(
        hooksPath(),
        JSON.stringify({
          hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "echo hi" }] }] },
        }),
      );

      await installCodexSessionStartHook(home);
      const config = JSON.parse(await fs.readFile(hooksPath(), "utf-8"));
      expect(config.hooks.PreToolUse).toHaveLength(1); // preserved
      expect(config.hooks.SessionStart[0].hooks[0].command).toContain("session-check");
    });

    it("refuses to overwrite an existing but malformed hooks.json", async () => {
      await fs.mkdir(path.dirname(hooksPath()), { recursive: true });
      const malformed = "{ not valid json";
      await fs.writeFile(hooksPath(), malformed);

      await expect(installCodexSessionStartHook(home)).rejects.toThrow(/not valid JSON/);
      expect(await fs.readFile(hooksPath(), "utf-8")).toBe(malformed);
    });

    it("refuses (does not silently replace) when `hooks` is not an object", async () => {
      await fs.mkdir(path.dirname(hooksPath()), { recursive: true });
      const bad = JSON.stringify({ hooks: [] }); // array, not an object
      await fs.writeFile(hooksPath(), bad);

      await expect(installCodexSessionStartHook(home)).rejects.toThrow(
        /"hooks" is not a JSON object/,
      );
      expect(await fs.readFile(hooksPath(), "utf-8")).toBe(bad); // untouched
    });

    it("refuses when `hooks.SessionStart` is not an array", async () => {
      await fs.mkdir(path.dirname(hooksPath()), { recursive: true });
      const bad = JSON.stringify({ hooks: { SessionStart: { nope: true } } });
      await fs.writeFile(hooksPath(), bad);

      await expect(installCodexSessionStartHook(home)).rejects.toThrow(
        /"hooks\.SessionStart" is not an array/,
      );
      expect(await fs.readFile(hooksPath(), "utf-8")).toBe(bad); // untouched
    });
  });

  describe("installSessionStartHooks (dispatch)", () => {
    it("installs both targets, each to its own file", async () => {
      const results = await installSessionStartHooks(home, ["claude", "codex"]);
      expect(results.map((r) => r.target)).toEqual(["claude", "codex"]);
      await expect(fs.access(path.join(home, ".claude", "settings.json"))).resolves.toBeUndefined();
      await expect(fs.access(path.join(home, ".codex", "hooks.json"))).resolves.toBeUndefined();
    });

    it("installs only the requested target", async () => {
      await installSessionStartHooks(home, ["codex"]);
      await expect(fs.access(path.join(home, ".codex", "hooks.json"))).resolves.toBeUndefined();
      // Claude settings.json is NOT created when only codex is requested.
      await expect(fs.access(path.join(home, ".claude", "settings.json"))).rejects.toThrow();
    });

    it("is atomic — a malformed config for one target writes none", async () => {
      // A malformed codex hooks.json must abort the whole install in phase 1,
      // BEFORE Claude's settings.json is written (no partial install).
      await fs.mkdir(path.join(home, ".codex"), { recursive: true });
      await fs.writeFile(path.join(home, ".codex", "hooks.json"), "{ not json");

      await expect(installSessionStartHooks(home, ["claude", "codex"])).rejects.toThrow(
        /not valid JSON/,
      );
      await expect(fs.access(path.join(home, ".claude", "settings.json"))).rejects.toThrow();
    });
  });

  describe("resolveHookTargets", () => {
    it("defaults to claude when no user store is synced", async () => {
      expect(await resolveHookTargets(home)).toEqual(["claude"]);
    });

    it("returns the user lockfile's targets", async () => {
      await writeLockfile(home, {
        source: localSource,
        globalBlockContent: "CANON",
        skills: [],
        targets: ["codex"],
        markerPrefix: "agconf",
      });
      expect(await resolveHookTargets(home)).toEqual(["codex"]);
    });

    it("keeps both targets and drops unknown ones", async () => {
      await writeLockfile(home, {
        source: localSource,
        globalBlockContent: "CANON",
        skills: [],
        targets: ["claude", "codex", "bogus"],
        markerPrefix: "agconf",
      });
      expect(await resolveHookTargets(home)).toEqual(["claude", "codex"]);
    });
  });

  describe("findMissingHookTargets", () => {
    const claudeStore = () =>
      writeLockfile(home, {
        source: localSource,
        globalBlockContent: "CANON",
        skills: [],
        targets: ["claude"],
        markerPrefix: "agconf",
      });
    const bothTargetStore = () =>
      writeLockfile(home, {
        source: localSource,
        globalBlockContent: "CANON",
        skills: [],
        targets: ["claude", "codex"],
        markerPrefix: "agconf",
      });

    it("reports the default claude target missing when no store and no hook exist", async () => {
      // No user store → resolveHookTargets defaults to ["claude"]; no settings.json → missing.
      expect(await findMissingHookTargets(home)).toEqual(["claude"]);
    });

    it("returns empty once the default claude hook is installed", async () => {
      await installSessionStartHooks(home, ["claude"]);
      expect(await findMissingHookTargets(home)).toEqual([]);
    });

    it("detects a target the store gained after the hook was installed", async () => {
      // The exact drift: hook installed while claude-only, store later gains codex.
      await installSessionStartHooks(home, ["claude"]);
      await bothTargetStore();
      expect(await findMissingHookTargets(home)).toEqual(["codex"]);
    });

    it("returns empty when every synced target has its hook", async () => {
      await bothTargetStore();
      await installSessionStartHooks(home, ["claude", "codex"]);
      expect(await findMissingHookTargets(home)).toEqual([]);
    });

    it("reports a target whose config exists but lacks the session-check hook", async () => {
      await claudeStore();
      const settingsPath = path.join(home, ".claude", "settings.json");
      await fs.mkdir(path.dirname(settingsPath), { recursive: true });
      await fs.writeFile(
        settingsPath,
        JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "x" }] }] } }),
      );
      expect(await findMissingHookTargets(home)).toEqual(["claude"]);
    });

    it("treats a malformed hook config as installed (never nags on unparseable config)", async () => {
      await claudeStore();
      const settingsPath = path.join(home, ".claude", "settings.json");
      await fs.mkdir(path.dirname(settingsPath), { recursive: true });
      // A file we can't parse is the user's to fix; --install-hook would refuse it
      // too, so nagging would be pointless. Treated as "can't tell" → not missing.
      await fs.writeFile(settingsPath, "{ not json");
      expect(await findMissingHookTargets(home)).toEqual([]);
    });

    it("does not nag on config shapes --install-hook would refuse to modify", async () => {
      await claudeStore();
      const settingsPath = path.join(home, ".claude", "settings.json");
      await fs.mkdir(path.dirname(settingsPath), { recursive: true });
      // Each of these is a shape the installer throws on rather than touch, so
      // nudging the developer to run --install-hook would only error. All → "installed".
      const refuseShapes = [
        JSON.stringify([]), // non-object root
        JSON.stringify("nope"), // non-object root (primitive)
        JSON.stringify({ hooks: [] }), // `hooks` is an array, not an object
        JSON.stringify({ hooks: { SessionStart: { nope: true } } }), // SessionStart not an array
        "{ not json", // unparseable
      ];
      for (const shape of refuseShapes) {
        await fs.writeFile(settingsPath, shape);
        expect(await findMissingHookTargets(home)).toEqual([]);
      }
    });

    it("does not throw on a SessionStart array with a malformed entry (reports it missing)", async () => {
      await claudeStore();
      const settingsPath = path.join(home, ".claude", "settings.json");
      await fs.mkdir(path.dirname(settingsPath), { recursive: true });
      // SessionStart IS a valid array (not a refuse-shape), but an entry's `hooks`
      // is a non-array object — `entry.hooks.some` would throw a TypeError without
      // the Array.isArray guard. Our command isn't present, and --install-hook would
      // successfully append it, so this is correctly reported as missing.
      await fs.writeFile(
        settingsPath,
        JSON.stringify({ hooks: { SessionStart: [{ hooks: {} }] } }),
      );
      expect(await findMissingHookTargets(home)).toEqual(["claude"]);
    });
  });

  describe("Codex hooks feature detection", () => {
    const listOutput = (state: string) =>
      `apps                 stable             true\nhooks                stable             ${state}\nmemories             experimental       true\n`;

    it("parses enabled / disabled / unknown from `codex features list`", () => {
      expect(parseCodexHooksState(listOutput("true"))).toBe("enabled");
      expect(parseCodexHooksState(listOutput("false"))).toBe("disabled");
      expect(parseCodexHooksState("apps stable true\n")).toBe("unknown"); // hooks not listed
    });

    it("getCodexHooksState returns 'unknown' when the runner throws (codex absent)", async () => {
      const state = await getCodexHooksState(async () => {
        throw new Error("command not found: codex");
      });
      expect(state).toBe("unknown");
    });

    it("warns only when codex is a target AND its hooks feature is disabled", async () => {
      const claudeOnly = [
        { target: "claude" as const, installed: true, alreadyPresent: false, filePath: "x" },
      ];
      const withCodex = [
        { target: "codex" as const, installed: true, alreadyPresent: false, filePath: "y" },
      ];
      const disabled = async () => listOutput("false");
      const enabled = async () => listOutput("true");

      // No codex target → never warns (even if the runner would say disabled).
      expect(await codexHooksDisabledWarning(claudeOnly, disabled)).toBeNull();
      // Codex target but hooks enabled → no warning.
      expect(await codexHooksDisabledWarning(withCodex, enabled)).toBeNull();
      // Codex target + hooks disabled → warns with the exact re-enable command.
      const warning = await codexHooksDisabledWarning(withCodex, disabled);
      expect(warning).toContain("codex features enable hooks");
    });
  });
});
