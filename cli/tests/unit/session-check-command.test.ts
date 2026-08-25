import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionCheckCommand } from "../../src/commands/session-check.js";
import { syncUserScopeCommand } from "../../src/commands/user-scope.js";
import { writeLockfile } from "../../src/core/lockfile.js";
import { installSessionStartHooks } from "../../src/core/session-check.js";

const localSource = { type: "local" as const, path: "/canonical" };

describe("session-check command", () => {
  let home: string;
  let repo: string;
  let canonical: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-scc-home-"));
    repo = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-scc-repo-"));
    canonical = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-scc-canon-"));
    await fs.mkdir(path.join(canonical, "instructions"), { recursive: true });
    await fs.mkdir(path.join(canonical, "skills"), { recursive: true });
    await fs.writeFile(
      path.join(canonical, "instructions", "AGENTS.md"),
      "# Company Standards\n\nBe excellent.",
      "utf-8",
    );
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);
  });

  afterEach(async () => {
    consoleLogSpy.mockRestore();
    mockExit.mockRestore();
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(repo, { recursive: true, force: true });
    await fs.rm(canonical, { recursive: true, force: true });
  });

  it("installs the SessionStart hook with --install-hook", async () => {
    await sessionCheckCommand({ installHook: true, home });
    const settings = JSON.parse(
      await fs.readFile(path.join(home, ".claude", "settings.json"), "utf-8"),
    );
    // `--hook` is what makes the output the SessionStart wire envelope, which
    // Codex requires and Claude accepts.
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe("agconf session-check --hook");
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("installs the Codex hook (~/.codex/hooks.json) when the user store targets codex", async () => {
    await writeLockfile(home, {
      source: localSource,
      globalBlockContent: "CANON",
      skills: [],
      targets: ["codex"],
      markerPrefix: "agconf",
    });
    // Inject a runner reporting hooks enabled so no warning + no real `codex` shell-out.
    await sessionCheckCommand({
      installHook: true,
      home,
      codexFeaturesRun: async () => "hooks stable true\n",
    });
    const config = JSON.parse(await fs.readFile(path.join(home, ".codex", "hooks.json"), "utf-8"));
    expect(config.hooks.SessionStart[0].hooks[0].command).toContain("session-check");
    // A codex-only store does not create Claude's settings.json.
    await expect(fs.access(path.join(home, ".claude", "settings.json"))).rejects.toThrow();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("warns when Codex hooks are disabled", async () => {
    await writeLockfile(home, {
      source: localSource,
      globalBlockContent: "CANON",
      skills: [],
      targets: ["codex"],
      markerPrefix: "agconf",
    });
    await sessionCheckCommand({
      installHook: true,
      home,
      codexFeaturesRun: async () => "hooks stable false\n",
    });
    const output = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("codex features enable hooks");
  });

  it("refuses to clobber a malformed ~/.codex/hooks.json on --install-hook", async () => {
    await writeLockfile(home, {
      source: localSource,
      globalBlockContent: "CANON",
      skills: [],
      targets: ["codex"],
      markerPrefix: "agconf",
    });
    await fs.mkdir(path.join(home, ".codex"), { recursive: true });
    const malformed = "{ not valid json";
    await fs.writeFile(path.join(home, ".codex", "hooks.json"), malformed);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const prevExitCode = process.exitCode;

    await sessionCheckCommand({
      installHook: true,
      home,
      codexFeaturesRun: async () => "hooks stable true\n",
    });

    expect(await fs.readFile(path.join(home, ".codex", "hooks.json"), "utf-8")).toBe(malformed);
    expect(errSpy.mock.calls.flat().join(" ")).toContain("not valid JSON");
    process.exitCode = prevExitCode; // don't leak the failure exit code to the runner
    errSpy.mockRestore();
  });

  it("--install-hook --quiet prints nothing and never shells out to codex", async () => {
    await writeLockfile(home, {
      source: localSource,
      globalBlockContent: "CANON",
      skills: [],
      targets: ["codex"],
      markerPrefix: "agconf",
    });
    const codexRun = vi.fn(async () => "hooks stable false\n");
    await sessionCheckCommand({ installHook: true, home, quiet: true, codexFeaturesRun: codexRun });

    // Hook is still installed...
    const config = JSON.parse(await fs.readFile(path.join(home, ".codex", "hooks.json"), "utf-8"));
    expect(config.hooks.SessionStart[0].hooks[0].command).toContain("session-check");
    // ...but quiet mode prints nothing and never probes the codex feature state.
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(codexRun).not.toHaveBeenCalled();
  });

  it("stays silent (and never exits) when user scope is not synced", async () => {
    await sessionCheckCommand({ cwd: repo, home });
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("warns when the same content is managed in both repo and user scope", async () => {
    execFileSync("git", ["init", "-q"], { cwd: repo });
    await writeLockfile(repo, {
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
    // Opt into auto-sync (its config file is the install marker), so the
    // background trigger fires.
    await fs.writeFile(path.join(home, ".agconf", "config.yaml"), "autosync:\n  enabled: true\n");

    // Inject a no-op spawn so the background auto-sync doesn't launch a real process.
    const autosyncSpawn = vi.fn();
    await sessionCheckCommand({ cwd: repo, home, autosyncSpawn });

    const output = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("more than one scope");
    expect(output).toContain("instructions");
    expect(mockExit).not.toHaveBeenCalled(); // advisory: always exit 0
    // The hook output is the agent's only channel to the developer, so it must
    // read as a relay instruction rather than as background context.
    expect(output).toContain("INSTRUCTION FOR THE CODING AGENT");
    expect(output).toContain("relay the following to the user");
    // Auto-sync is installed + enabled, so a background refresh is triggered.
    expect(autosyncSpawn).toHaveBeenCalledTimes(1);
  });

  it("upgrades a pre-`--hook` SessionStart entry instead of leaving it broken", async () => {
    const settingsPath = path.join(home, ".claude", "settings.json");
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(
      settingsPath,
      JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "agconf session-check" }] }],
        },
      }),
    );

    await sessionCheckCommand({ installHook: true, home });

    const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
    expect(settings.hooks.SessionStart).toHaveLength(1); // upgraded in place, not duplicated
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe("agconf session-check --hook");
    expect(consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("Updated");

    // Running it again is a no-op, not a second entry.
    const after = await fs.readFile(settingsPath, "utf-8");
    await sessionCheckCommand({ installHook: true, home });
    expect(await fs.readFile(settingsPath, "utf-8")).toBe(after);
  });

  it("emits the SessionStart wire envelope with --hook", async () => {
    execFileSync("git", ["init", "-q"], { cwd: repo });
    await writeLockfile(repo, {
      source: localSource,
      globalBlockContent: "REPO VERSION",
      skills: [],
      targets: ["claude"],
      markerPrefix: "agconf",
    });
    await writeLockfile(home, {
      source: localSource,
      globalBlockContent: "USER VERSION",
      skills: [],
      targets: ["claude"],
      markerPrefix: "agconf",
    });

    await sessionCheckCommand({ cwd: repo, home, hook: true });

    // Exactly one line of stdout, and it must validate as the envelope Codex
    // expects — anything else makes Codex drop the note ("hook Failed").
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(consoleLogSpy.mock.calls[0]?.[0]));
    expect(payload.hookSpecificOutput.hookEventName).toBe("SessionStart");
    const context = payload.hookSpecificOutput.additionalContext;
    expect(context).toContain("INSTRUCTION FOR THE CODING AGENT");
    expect(context).toContain("more than one scope");
    // No ANSI escapes leak into the agent's context.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting no escapes
    expect(context).not.toMatch(/\u001B\[/);
  });

  it("emits a valid envelope with --hook even when there is nothing to report", async () => {
    execFileSync("git", ["init", "-q"], { cwd: repo });
    await syncUserScopeCommand({ scope: "user", local: canonical, home, target: ["claude"] });
    await sessionCheckCommand({ installHook: true, home });
    consoleLogSpy.mockClear();

    await sessionCheckCommand({ cwd: repo, home, hook: true });

    // Empty stdout is not valid SessionStart hook output — Codex would report
    // `hook: SessionStart Failed` on the (common) clean path.
    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(consoleLogSpy.mock.calls[0]?.[0]));
    expect(payload.hookSpecificOutput).toEqual({
      hookEventName: "SessionStart",
      additionalContext: "",
    });
  });

  it("emits the envelope with --hook even when user scope is not set up", async () => {
    await sessionCheckCommand({ cwd: repo, home, hook: true });

    expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(consoleLogSpy.mock.calls[0]?.[0]));
    expect(payload.hookSpecificOutput.hookEventName).toBe("SessionStart");
  });

  it("addresses a human, not an agent, when stdout is a terminal", async () => {
    execFileSync("git", ["init", "-q"], { cwd: repo });
    await writeLockfile(repo, {
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
    const previous = process.stdout.isTTY;
    process.stdout.isTTY = true;
    try {
      await sessionCheckCommand({ cwd: repo, home });
    } finally {
      process.stdout.isTTY = previous;
    }

    const output = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("more than one scope");
    expect(output).not.toContain("INSTRUCTION FOR THE CODING AGENT");
  });

  it("--quiet silences the advisory notes without uninstalling the hook", async () => {
    execFileSync("git", ["init", "-q"], { cwd: repo });
    await writeLockfile(repo, {
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

    await sessionCheckCommand({ cwd: repo, home, quiet: true });

    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it("nudges when the installed hook predates --hook", async () => {
    execFileSync("git", ["init", "-q"], { cwd: repo });
    await syncUserScopeCommand({ scope: "user", local: canonical, home, target: ["claude"] });
    const settingsPath = path.join(home, ".claude", "settings.json");
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(
      settingsPath,
      JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "agconf session-check" }] }],
        },
      }),
    );
    consoleLogSpy.mockClear();

    await sessionCheckCommand({ cwd: repo, home });

    // Without this, a Codex user whose hook predates the flag is never told —
    // the note that would tell them is the note Codex discards.
    const output = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("missing or out of date");
    expect(output).toContain("--install-hook");
  });

  it("warns instead of rewriting a customized session-check hook command", async () => {
    const settingsPath = path.join(home, ".claude", "settings.json");
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    const custom = "agconf session-check >> /tmp/agconf.log 2>&1";
    await fs.writeFile(
      settingsPath,
      JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: "command", command: custom }] }] },
      }),
    );

    await sessionCheckCommand({ installHook: true, home });

    const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
    // Someone else's command line is left exactly as written, and no second
    // entry is added beside it (that would double every note).
    expect(settings.hooks.SessionStart).toHaveLength(1);
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe(custom);
    const output = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("without `--hook`");
  });

  it("prints the relay instruction once, however many notes there are", async () => {
    execFileSync("git", ["init", "-q"], { cwd: repo });
    await writeLockfile(repo, {
      source: localSource,
      globalBlockContent: "CANON",
      skills: [],
      targets: ["claude"],
      markerPrefix: "agconf",
    });
    await syncUserScopeCommand({ scope: "user", local: canonical, home, target: ["claude"] });
    consoleLogSpy.mockClear();

    await sessionCheckCommand({ cwd: repo, home });

    const output = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    // Duplication finding + missing-hook nudge — two notes, one header.
    expect(output).toContain("more than one scope");
    expect(output).toContain("--install-hook");
    expect(output.match(/INSTRUCTION FOR THE CODING AGENT/g)).toHaveLength(1);
  });

  it("nudges the developer to restart when the probe reports the store is behind", async () => {
    execFileSync("git", ["init", "-q"], { cwd: repo });
    await writeLockfile(home, {
      source: { type: "github", repository: "o/r", commit_sha: "abc123", ref: "v1.0.0" },
      globalBlockContent: "CANON",
      skills: [],
      targets: ["claude"],
      markerPrefix: "agconf",
      pinnedVersion: "1.0.0",
    });
    await fs.writeFile(path.join(home, ".agconf", "config.yaml"), "autosync:\n  enabled: true\n");

    const autosyncSpawn = vi.fn();
    await sessionCheckCommand({
      cwd: repo,
      home,
      autosyncSpawn,
      probeLatest: async () => "1.1.0", // canonical is ahead
    });

    const output = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("1.0.0 → 1.1.0");
    expect(output).toContain("Restarting the session");
    expect(autosyncSpawn).toHaveBeenCalledTimes(1);
  });

  it("reports an already-present hook instead of claiming a fresh install", async () => {
    await sessionCheckCommand({ installHook: true, home });
    const settingsPath = path.join(home, ".claude", "settings.json");
    const first = await fs.readFile(settingsPath, "utf-8");
    consoleLogSpy.mockClear();

    await sessionCheckCommand({ installHook: true, home });

    const output = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("already present");
    expect(output).not.toContain("Installed agconf session-check");
    // Idempotent: the file is byte-identical, no duplicate hook entry.
    expect(await fs.readFile(settingsPath, "utf-8")).toBe(first);
  });

  it("flags divergent instructions differently from identical ones", async () => {
    execFileSync("git", ["init", "-q"], { cwd: repo });
    await writeLockfile(repo, {
      source: localSource,
      globalBlockContent: "REPO VERSION",
      skills: [],
      targets: ["claude"],
      markerPrefix: "agconf",
    });
    await writeLockfile(home, {
      source: localSource,
      globalBlockContent: "USER VERSION",
      skills: [],
      targets: ["claude"],
      markerPrefix: "agconf",
    });

    await sessionCheckCommand({ cwd: repo, home });

    const output = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("divergent");
    expect(output).toContain("conflicting guidance");
    expect(output).not.toContain("identical");
  });

  it("names the specific skills/rules/agents duplicated across scopes", async () => {
    execFileSync("git", ["init", "-q"], { cwd: repo });
    const content = {
      globalBlockContent: "CANON",
      skills: ["shared-skill", "repo-only"],
      targets: ["claude"],
      markerPrefix: "agconf",
      rules: { files: ["security/shared.md"], content_hash: "sha256:aaaaaaaaaaaa" },
      agents: { files: ["shared-agent.md"], content_hash: "sha256:bbbbbbbbbbbb" },
    };
    await writeLockfile(repo, { source: localSource, ...content });
    await writeLockfile(home, {
      source: localSource,
      ...content,
      skills: ["shared-skill", "user-only"],
    });

    await sessionCheckCommand({ cwd: repo, home });

    const output = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("skills (shared-skill)");
    expect(output).toContain("rules (security/shared.md)");
    expect(output).toContain("agents (shared-agent.md)");
    // Objects that exist in only one scope are not a double-load.
    expect(output).not.toContain("repo-only");
    expect(output).not.toContain("user-only");
  });

  it("notes user-scope drift even when there is no cross-scope duplication", async () => {
    execFileSync("git", ["init", "-q"], { cwd: repo });
    // Only user scope is synced (no repo lockfile) → no duplication findings.
    await syncUserScopeCommand({ scope: "user", local: canonical, home, target: ["claude"] });
    const claudeMd = path.join(home, ".claude", "CLAUDE.md");
    const projected = await fs.readFile(claudeMd, "utf-8");
    await fs.writeFile(claudeMd, projected.replace("Be excellent.", "TAMPERED"), "utf-8");
    consoleLogSpy.mockClear();

    await sessionCheckCommand({ cwd: repo, home });

    const output = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("check --scope user");
    expect(output).not.toContain("more than one scope");
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("stays silent when user scope is synced and everything is consistent", async () => {
    execFileSync("git", ["init", "-q"], { cwd: repo });
    await syncUserScopeCommand({ scope: "user", local: canonical, home, target: ["claude"] });
    // "Consistent" includes having the hook installed for every synced target —
    // otherwise the missing-hook nudge fires and silence is the wrong assertion.
    await sessionCheckCommand({ installHook: true, home });
    consoleLogSpy.mockClear();

    await sessionCheckCommand({ cwd: repo, home });

    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it("does not trigger background auto-sync when it is not installed", async () => {
    execFileSync("git", ["init", "-q"], { cwd: repo });
    await writeLockfile(home, {
      source: localSource,
      globalBlockContent: "CANON",
      skills: [],
      targets: ["claude"],
      markerPrefix: "agconf",
    });
    // No ~/.agconf/config.yaml — user has synced but never ran `autosync --install`.
    const autosyncSpawn = vi.fn();
    await sessionCheckCommand({ cwd: repo, home, autosyncSpawn });
    expect(autosyncSpawn).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("nudges to install the hook for a target the store gained after install", async () => {
    // Clean user scope synced for BOTH targets...
    await syncUserScopeCommand({
      scope: "user",
      local: canonical,
      home,
      target: ["claude", "codex"],
    });
    // ...but only the Claude hook was ever installed (the drift the finding describes:
    // resolveHookTargets is snapshotted at install time and never re-reconciled).
    await installSessionStartHooks(home, ["claude"]);
    consoleLogSpy.mockClear();

    const autosyncSpawn = vi.fn();
    await sessionCheckCommand({ cwd: repo, home, autosyncSpawn });

    const output = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("agconf session-check --install-hook");
    expect(output).toContain("codex");
    // The installed Claude hook is not falsely reported as missing.
    expect(output).not.toContain("claude");
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("stays silent when a clean store has all its hooks installed", async () => {
    await syncUserScopeCommand({
      scope: "user",
      local: canonical,
      home,
      target: ["claude", "codex"],
    });
    await installSessionStartHooks(home, ["claude", "codex"]);
    consoleLogSpy.mockClear();

    const autosyncSpawn = vi.fn();
    await sessionCheckCommand({ cwd: repo, home, autosyncSpawn });

    // Nothing to say: no cross-scope dup (user scope only), integrity clean, hooks present.
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });
});
