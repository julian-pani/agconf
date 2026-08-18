import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the two network seams so the GitHub-source paths stay offline.
vi.mock("../../src/core/version.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/version.js")>()),
  getLatestRelease: vi.fn(),
}));

vi.mock("../../src/core/source.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/source.js")>()),
  resolveGithubSource: vi.fn(),
}));

import { autosyncCommand } from "../../src/commands/autosync.js";
import { syncUserScopeCommand } from "../../src/commands/user-scope.js";
import { isAutosyncInstalled, loadUserScopeConfig } from "../../src/config/loader.js";
import { getAutosyncPaths, writeAutosyncState } from "../../src/core/autosync.js";
import { writeLockfile } from "../../src/core/lockfile.js";
import { resolveGithubSource } from "../../src/core/source.js";
import { getUserPaths } from "../../src/core/user-scope.js";
import { getLatestRelease } from "../../src/core/version.js";

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
    vi.mocked(getLatestRelease).mockReset();
    vi.mocked(resolveGithubSource).mockReset();
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(canonical, { recursive: true, force: true });
  });

  const readLog = () => fs.readFile(getAutosyncPaths(home).logPath, "utf-8").catch(() => "");
  const output = () => consoleLogSpy.mock.calls.map((c) => c.join(" ")).join("\n");
  const seedUserScope = () =>
    syncUserScopeCommand({ scope: "user", local: canonical, home, target: ["claude"] });
  /** Record a GitHub-sourced store at `pinnedVersion` (no clone involved). */
  const seedGithubStore = (pinnedVersion: string) =>
    writeLockfile(home, {
      source: { type: "github", repository: "acme/standards", commit_sha: "abc123", ref: "v1" },
      globalBlockContent: "CANON",
      skills: [],
      targets: ["claude"],
      markerPrefix: "agconf",
      pinnedVersion,
    });
  const release = (version: string) => ({
    tag: `v${version}`,
    version,
    commitSha: "abc123",
    publishedAt: "2026-01-01T00:00:00Z",
    tarballUrl: `https://example.invalid/${version}`,
  });

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

  it("takes the up-to-date fast path (no clone) and reports it on a manual run", async () => {
    await seedGithubStore("1.1.0");
    vi.mocked(getLatestRelease).mockResolvedValue(release("1.1.0"));

    await autosyncCommand({ home, trigger: "manual", force: true });

    expect(await readLog()).toContain("result=up-to-date version=1.1.0");
    expect(resolveGithubSource).not.toHaveBeenCalled();
    expect(output()).toContain("Already up to date.");
  });

  it("tells the user why a manual run did nothing (disabled / throttled)", async () => {
    await fs.mkdir(path.join(home, ".agconf"), { recursive: true });
    await fs.writeFile(path.join(home, ".agconf", "config.yaml"), "autosync:\n  enabled: false\n");

    await autosyncCommand({ home, trigger: "manual" });
    expect(output()).toContain("Auto-sync is disabled");
    consoleLogSpy.mockClear();

    await fs.writeFile(path.join(home, ".agconf", "config.yaml"), "autosync:\n  enabled: true\n");
    await writeAutosyncState(home, { version: 1, last_attempt: new Date().toISOString() });

    await autosyncCommand({ home, trigger: "manual" });
    expect(output()).toContain("Use --force to sync now.");
    expect(await readLog()).toContain("result=throttled");
  });

  it("stays silent in quiet mode even on a manual run", async () => {
    await autosyncCommand({ home, trigger: "manual", quiet: true }); // no source → error path
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(await readLog()).toContain("result=error");
  });

  it("logs result=locked (never an error) when another sync holds the store lock", async () => {
    await seedUserScope();
    const storeDir = getUserPaths(home).storeDir;
    await fs.writeFile(path.join(storeDir, ".lock"), String(Date.now()), "utf-8");

    await expect(
      autosyncCommand({ home, trigger: "startup", force: true }),
    ).resolves.toBeUndefined();

    const log = await readLog();
    expect(log).toContain("result=locked");
    expect(log).not.toContain("result=error");
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("redacts embedded git credentials from the persisted error state and log", async () => {
    await seedGithubStore("1.0.0");
    vi.mocked(getLatestRelease).mockResolvedValue(release("1.1.0"));
    vi.mocked(resolveGithubSource).mockRejectedValue(
      new Error(
        "fatal: could not read from https://x-access-token:ghp_SUPERSECRET@github.com/acme/standards.git",
      ),
    );

    await autosyncCommand({ home, trigger: "startup", force: true });

    const log = await readLog();
    expect(log).toContain("result=error");
    expect(log).not.toContain("ghp_SUPERSECRET");
    expect(log).toContain("//***@github.com");
    const state = JSON.parse(await fs.readFile(getAutosyncPaths(home).statePath, "utf-8"));
    expect(state.last_result).toBe("error");
    expect(state.last_error).not.toContain("ghp_SUPERSECRET");
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

  it("--install is idempotent and says so on a second run", async () => {
    await autosyncCommand({ home, install: true });
    consoleLogSpy.mockClear();

    await autosyncCommand({ home, install: true });

    expect(output()).toContain("SessionStart hook already present for claude");
    expect((await loadUserScopeConfig(home)).autosync.enabled).toBe(true);
  });

  it("--install --quiet installs without printing anything", async () => {
    await autosyncCommand({ home, install: true, quiet: true });

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(await isAutosyncInstalled(home)).toBe(true);
  });

  it("--disable --quiet turns auto-sync off without printing anything", async () => {
    await autosyncCommand({ home, disable: true, quiet: true });

    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect((await loadUserScopeConfig(home)).autosync.enabled).toBe(false);
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
