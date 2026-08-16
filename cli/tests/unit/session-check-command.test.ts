import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionCheckCommand } from "../../src/commands/session-check.js";
import { writeLockfile } from "../../src/core/lockfile.js";

const localSource = { type: "local" as const, path: "/canonical" };

describe("session-check command", () => {
  let home: string;
  let repo: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-scc-home-"));
    repo = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-scc-repo-"));
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
  });

  it("installs the SessionStart hook with --install-hook", async () => {
    await sessionCheckCommand({ installHook: true, home });
    const settings = JSON.parse(
      await fs.readFile(path.join(home, ".claude", "settings.json"), "utf-8"),
    );
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain("session-check");
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
    // Auto-sync is installed + enabled, so a background refresh is triggered.
    expect(autosyncSpawn).toHaveBeenCalledTimes(1);
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
    expect(output).toContain("restart");
    expect(autosyncSpawn).toHaveBeenCalledTimes(1);
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
});
