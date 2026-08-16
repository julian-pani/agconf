import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autosyncCommand } from "../../src/commands/autosync.js";
import { syncUserScopeCommand } from "../../src/commands/user-scope.js";
import { isAutosyncInstalled, loadUserScopeConfig } from "../../src/config/loader.js";
import { getAutosyncPaths, writeAutosyncState } from "../../src/core/autosync.js";

describe("autosync command", () => {
  let home: string;
  let canonical: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-as-home-"));
    canonical = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-as-canon-"));
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
    await fs.rm(canonical, { recursive: true, force: true });
  });

  const readLog = () => fs.readFile(getAutosyncPaths(home).logPath, "utf-8").catch(() => "");
  const seedUserScope = () =>
    syncUserScopeCommand({ scope: "user", local: canonical, home, target: ["claude"] });

  it("syncs and records state + log when the store has a source", async () => {
    await seedUserScope();

    await autosyncCommand({ home, trigger: "manual" });

    const log = await readLog();
    expect(log).toMatch(/result=(synced|up-to-date)/);
    const statePath = getAutosyncPaths(home).statePath;
    expect(
      await fs
        .access(statePath)
        .then(() => true)
        .catch(() => false),
    ).toBe(true);
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("does nothing (logs disabled) when autosync is turned off", async () => {
    await fs.mkdir(path.join(home, ".agconf"), { recursive: true });
    await fs.writeFile(path.join(home, ".agconf", "config.yaml"), "autosync:\n  enabled: false\n");

    await autosyncCommand({ home, trigger: "startup" });

    expect(await readLog()).toContain("result=disabled");
    // No harness files were written.
    expect(
      await fs
        .access(path.join(home, ".claude", "CLAUDE.md"))
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  });

  it("skips when throttled (recent attempt, no --force)", async () => {
    await seedUserScope();
    await writeAutosyncState(home, { version: 1, last_attempt: new Date().toISOString() });

    await autosyncCommand({ home, trigger: "startup" });

    expect(await readLog()).toContain("result=throttled");
  });

  it("logs an error (never throws / exits) when there is no source", async () => {
    // Fresh home — no store lockfile.
    await expect(autosyncCommand({ home, trigger: "startup" })).resolves.toBeUndefined();
    expect(await readLog()).toContain("result=error");
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("records an error (never process.exit) when the source can't be resolved", async () => {
    await seedUserScope(); // records a local source in the store lockfile
    await fs.rm(canonical, { recursive: true, force: true }); // ...then it vanishes

    // resolveSource now throws (throwOnResolveError) instead of process.exit, so
    // the best-effort catch records it rather than the process dying.
    await expect(
      autosyncCommand({ home, trigger: "manual", force: true }),
    ).resolves.toBeUndefined();
    expect(await readLog()).toContain("result=error");
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("--install installs the SessionStart hook and enables auto-sync", async () => {
    await autosyncCommand({ home, install: true });

    const settings = JSON.parse(
      await fs.readFile(path.join(home, ".claude", "settings.json"), "utf-8"),
    );
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain("session-check");
    expect(await isAutosyncInstalled(home)).toBe(true);
    expect((await loadUserScopeConfig(home)).autosync.enabled).toBe(true);
  });

  it("--install installs the Codex hook when the user store targets codex", async () => {
    await syncUserScopeCommand({ scope: "user", local: canonical, home, target: ["codex"] });
    // Inject a runner reporting hooks enabled so no warning + no real `codex` shell-out.
    await autosyncCommand({
      home,
      install: true,
      codexFeaturesRun: async () => "hooks stable true\n",
    });

    const config = JSON.parse(await fs.readFile(path.join(home, ".codex", "hooks.json"), "utf-8"));
    expect(config.hooks.SessionStart[0].hooks[0].command).toContain("session-check");
    expect((await loadUserScopeConfig(home)).autosync.enabled).toBe(true);
    // A codex-only store does not create Claude's settings.json.
    await expect(fs.access(path.join(home, ".claude", "settings.json"))).rejects.toThrow();
  });

  it("--uninstall disables auto-sync but leaves the shared hook in place", async () => {
    await autosyncCommand({ home, install: true });
    await autosyncCommand({ home, uninstall: true });

    // The hook remains (it also powers the cross-scope duplication check)...
    const settings = JSON.parse(
      await fs.readFile(path.join(home, ".claude", "settings.json"), "utf-8"),
    );
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain("session-check");
    // ...but auto-sync is now off.
    expect((await loadUserScopeConfig(home)).autosync.enabled).toBe(false);
  });

  it("--disable then --enable flip the config flag", async () => {
    await autosyncCommand({ home, disable: true });
    expect((await loadUserScopeConfig(home)).autosync.enabled).toBe(false);

    await autosyncCommand({ home, enable: true });
    expect((await loadUserScopeConfig(home)).autosync.enabled).toBe(true);
  });

  it("refuses to clobber a malformed settings.json on --install", async () => {
    const settingsPath = path.join(home, ".claude", "settings.json");
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    const malformed = "{ not valid json";
    await fs.writeFile(settingsPath, malformed);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const prevExitCode = process.exitCode;

    await autosyncCommand({ home, install: true });

    expect(await fs.readFile(settingsPath, "utf-8")).toBe(malformed); // untouched
    expect(errSpy.mock.calls.flat().join(" ")).toContain("not valid JSON");

    process.exitCode = prevExitCode; // don't leak the failure exit code to the runner
    errSpy.mockRestore();
  });
});
