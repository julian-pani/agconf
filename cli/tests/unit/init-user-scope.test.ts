import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Never reach the network: a GitHub source must fail loudly rather than clone.
vi.mock("../../src/core/version.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/version.js")>()),
  getLatestRelease: vi.fn(async () => null),
}));

vi.mock("../../src/core/source.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/source.js")>()),
  resolveGithubSource: vi.fn(async () => {
    throw new Error("clone attempted");
  }),
}));

// The shell-completion offer is interactive; stub it and assert on the call.
vi.mock("../../src/commands/completion.js", () => ({
  promptCompletionInstall: vi.fn(),
}));

vi.mock("@clack/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clack/prompts")>()),
  confirm: vi.fn(),
  text: vi.fn(),
  multiselect: vi.fn(),
  isCancel: vi.fn(() => false),
}));

import * as prompts from "@clack/prompts";
import { autosyncCommand } from "../../src/commands/autosync.js";
import { promptCompletionInstall } from "../../src/commands/completion.js";
import { initCommand } from "../../src/commands/init.js";
import { initUserScopeCommand } from "../../src/commands/init-user-scope.js";
import { writeLockfile } from "../../src/core/lockfile.js";
import { getUserPaths } from "../../src/core/user-scope.js";
import { getLatestRelease } from "../../src/core/version.js";

/**
 * `agconf init --scope user`: the guided one-shot setup. These cover the
 * orchestration (sync → hook → auto-sync, in that order), the flag paths, and
 * the prompts — the individual steps are tested by their own suites.
 */
describe("initUserScopeCommand", () => {
  let home: string;
  let canonical: string;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let outSpy: ReturnType<typeof vi.spyOn>;
  let priorExitCode: typeof process.exitCode;

  beforeEach(async () => {
    priorExitCode = process.exitCode;
    home = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-initus-home-"));
    canonical = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-initus-canon-"));
    await fs.mkdir(path.join(canonical, "instructions"), { recursive: true });
    await fs.mkdir(path.join(canonical, "skills"), { recursive: true });
    await fs.writeFile(
      path.join(canonical, "instructions", "AGENTS.md"),
      "# Company Standards\n\nBe excellent.",
      "utf-8",
    );

    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // @clack's intro/outro bypass console.log — capture stdout to assert on them.
    outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(async () => {
    mockExit.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
    outSpy.mockRestore();
    // clearAllMocks() clears CALLS but not implementations, so a `mockReturnValue`
    // set in one test would leak into the next and silently no-op it.
    vi.mocked(prompts.isCancel).mockReset().mockReturnValue(false);
    vi.mocked(prompts.confirm).mockReset();
    vi.mocked(prompts.multiselect).mockReset();
    vi.mocked(prompts.text).mockReset();
    vi.mocked(promptCompletionInstall).mockReset();
    vi.mocked(getLatestRelease).mockClear();
    process.exitCode = priorExitCode;
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(canonical, { recursive: true, force: true });
  });

  const exists = (p: string) =>
    fs
      .access(p)
      .then(() => true)
      .catch(() => false);

  const readJson = async (p: string) => JSON.parse(await fs.readFile(p, "utf-8"));
  const logged = () => logSpy.mock.calls.flat().join("\n");
  const errored = () => errSpy.mock.calls.flat().join("\n");
  const stdout = () => outSpy.mock.calls.flat().join("");
  const configPath = () => path.join(home, ".agconf", "config.yaml");

  it("--yes does sync, hook install and auto-sync enable in one go", async () => {
    await initUserScopeCommand({
      scope: "user",
      local: canonical,
      home,
      yes: true,
      target: ["claude"],
    });

    // Synced.
    expect(await exists(path.join(home, ".claude", "CLAUDE.md"))).toBe(true);
    expect(await exists(path.join(home, ".agconf", "lockfile.json"))).toBe(true);
    // Hook installed.
    const settings = await readJson(path.join(home, ".claude", "settings.json"));
    expect(JSON.stringify(settings)).toContain("agconf session-check");
    // Auto-sync opted in (config presence IS the opt-in marker).
    const config = await fs.readFile(path.join(home, ".agconf", "config.yaml"), "utf-8");
    expect(config).toContain("enabled: true");
    expect(mockExit).not.toHaveBeenCalled();
    // The "run autosync --install" tip is suppressed — init just did it.
    expect(logged()).not.toContain("autosync --install");
    // Non-interactive: no prompts, no completion offer.
    expect(prompts.confirm).not.toHaveBeenCalled();
    expect(promptCompletionInstall).not.toHaveBeenCalled();
  });

  it("installs a hook for every target the store was synced to", async () => {
    await initUserScopeCommand({
      scope: "user",
      local: canonical,
      home,
      yes: true,
      target: ["claude", "codex"],
    });

    // Ordering guard: hooks resolve from the store lockfile, so they can only
    // cover both targets if the sync ran first.
    expect(await exists(path.join(home, ".claude", "settings.json"))).toBe(true);
    expect(await exists(path.join(home, ".codex", "hooks.json"))).toBe(true);
  });

  it("--no-autosync installs the hook but leaves auto-sync off", async () => {
    await initUserScopeCommand({
      scope: "user",
      local: canonical,
      home,
      yes: true,
      target: ["claude"],
      autosync: false,
    });

    const settings = await readJson(path.join(home, ".claude", "settings.json"));
    expect(JSON.stringify(settings)).toContain("agconf session-check");
    // The decline is RECORDED (enabled:false), not just left unwritten — an
    // unwritten decline reads as "never configured" and a later --yes run would
    // switch background sync back on.
    expect(await fs.readFile(configPath(), "utf-8")).toContain("enabled: false");
    expect(logged()).toContain("auto-sync left off");
  });

  it("--yes with no source and no store is a hard error, not a hang", async () => {
    await expect(initUserScopeCommand({ scope: "user", home, yes: true })).rejects.toThrow(
      "process.exit called",
    );
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(errored()).toContain("No canonical source");
    expect(prompts.text).not.toHaveBeenCalled();
  });

  it("prompts for targets and auto-sync, and honours a declined auto-sync", async () => {
    vi.mocked(prompts.multiselect).mockResolvedValue(["claude", "codex"] as never);
    vi.mocked(prompts.confirm).mockResolvedValue(false as never); // decline auto-sync

    await initUserScopeCommand({ scope: "user", local: canonical, home });

    expect(prompts.multiselect).toHaveBeenCalledTimes(1);
    expect(await exists(path.join(home, ".codex", "AGENTS.md"))).toBe(true);
    expect(await fs.readFile(configPath(), "utf-8")).toContain("enabled: false");
    // Hook still installed — it also powers the duplication/integrity checks.
    expect(await exists(path.join(home, ".claude", "settings.json"))).toBe(true);
    expect(promptCompletionInstall).toHaveBeenCalled();
  });

  it("prompts for the canonical repo on a first run with no source flag", async () => {
    vi.mocked(prompts.text).mockResolvedValue("acme/standards" as never);
    vi.mocked(prompts.multiselect).mockResolvedValue(["claude"] as never);
    vi.mocked(prompts.confirm).mockResolvedValue(false as never);

    // The answer is actually used: resolution proceeds against the repo typed
    // at the prompt (and then fails on the stubbed clone).
    await expect(initUserScopeCommand({ scope: "user", home })).rejects.toThrow(
      "process.exit called",
    );
    expect(prompts.text).toHaveBeenCalledTimes(1);
    expect(getLatestRelease).toHaveBeenCalledWith("acme/standards");
    expect(errored()).toContain("clone attempted");
  });

  it("re-running recovers the source from the store and asks before re-syncing", async () => {
    await initUserScopeCommand({
      scope: "user",
      local: canonical,
      home,
      yes: true,
      target: ["claude"],
    });
    vi.clearAllMocks();

    // Declining the re-run prompt changes nothing.
    vi.mocked(prompts.confirm).mockResolvedValueOnce(false as never);
    await initUserScopeCommand({ scope: "user", home });
    expect(prompts.multiselect).not.toHaveBeenCalled();

    // Accepting it re-syncs with no --local: the source comes from the store.
    // Delete the projection first, so its reappearance proves the re-sync ran
    // rather than just observing what the first run left behind.
    await fs.rm(path.join(home, ".claude", "CLAUDE.md"));
    vi.mocked(prompts.confirm).mockResolvedValue(true as never);
    vi.mocked(prompts.multiselect).mockResolvedValue(["claude"] as never);
    await initUserScopeCommand({ scope: "user", home });
    expect(await exists(path.join(home, ".claude", "CLAUDE.md"))).toBe(true);
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("cancelling the target prompt aborts without touching the home directory", async () => {
    vi.mocked(prompts.isCancel).mockReturnValue(true);
    vi.mocked(prompts.multiselect).mockResolvedValue(Symbol("cancel") as never);

    await initUserScopeCommand({ scope: "user", local: canonical, home });

    expect(await exists(path.join(home, ".claude"))).toBe(false);
    expect(await exists(path.join(home, ".agconf"))).toBe(false);
  });

  it("re-running does not resurrect auto-sync the developer disabled", async () => {
    await initUserScopeCommand({
      scope: "user",
      local: canonical,
      home,
      yes: true,
      target: ["claude"],
    });
    // The developer deliberately turns it off afterwards.
    await autosyncCommand({ home, disable: true });
    expect(await fs.readFile(configPath(), "utf-8")).toContain("enabled: false");

    // A --yes re-run must respect that, not reset it to the default.
    await initUserScopeCommand({ scope: "user", home, yes: true, target: ["claude"] });
    expect(await fs.readFile(configPath(), "utf-8")).toContain("enabled: false");

    // And interactively, the prompt is pre-answered "no" rather than "yes".
    // Accept the "already set up, run again?" prompt; leave every other confirm no.
    vi.mocked(prompts.confirm).mockImplementation((async (opts: { message: string }) =>
      opts.message.startsWith("User scope is already set up")) as never);
    vi.mocked(prompts.multiselect).mockResolvedValue(["claude"] as never);
    await initUserScopeCommand({ scope: "user", home });
    const autosyncPrompt = vi
      .mocked(prompts.confirm)
      .mock.calls.map((c) => c[0] as { message: string; initialValue?: boolean })
      .find((c) => c.message.includes("fresh automatically"));
    expect(autosyncPrompt?.initialValue).toBe(false);
    expect(await fs.readFile(configPath(), "utf-8")).toContain("enabled: false");
  });

  it("--no-autosync turns OFF auto-sync that was already enabled", async () => {
    await initUserScopeCommand({
      scope: "user",
      local: canonical,
      home,
      yes: true,
      target: ["claude"],
    });
    expect(await fs.readFile(configPath(), "utf-8")).toContain("enabled: true");

    await initUserScopeCommand({
      scope: "user",
      home,
      yes: true,
      target: ["claude"],
      autosync: false,
    });

    // Saying "auto-sync off" while leaving enabled:true would keep spawning
    // background syncs the developer just declined.
    expect(await fs.readFile(configPath(), "utf-8")).toContain("enabled: false");
    expect(logged()).toContain("auto-sync turned off");
  });

  it("reports failure instead of 'Done.' when the SessionStart hook can't be installed", async () => {
    await fs.mkdir(path.join(home, ".claude"), { recursive: true });
    await fs.writeFile(path.join(home, ".claude", "settings.json"), "{ not valid json", "utf-8");

    await initUserScopeCommand({
      scope: "user",
      local: canonical,
      home,
      yes: true,
      target: ["claude"],
    });

    expect(process.exitCode).toBe(1);
    expect(errored()).toMatch(/settings\.json/);
    // The standards did land, but nothing is wired to refresh or check them —
    // so the outro must not claim the setup is done.
    expect(await exists(path.join(home, ".claude", "CLAUDE.md"))).toBe(true);
    expect(await exists(configPath())).toBe(false);
    expect(stdout()).toContain("session setup failed");
    expect(stdout()).not.toContain("Done.");
    expect(promptCompletionInstall).not.toHaveBeenCalled();
  });

  it("exits non-zero without projecting when another sync holds the store lock", async () => {
    const storeDir = getUserPaths(home).storeDir;
    await fs.mkdir(storeDir, { recursive: true });
    await fs.writeFile(path.join(storeDir, ".lock"), String(Date.now()), "utf-8");

    await initUserScopeCommand({
      scope: "user",
      local: canonical,
      home,
      yes: true,
      target: ["claude"],
    });

    expect(process.exitCode).toBe(1);
    expect(errored()).toMatch(/lock|already running|in progress/i);
    expect(await exists(path.join(home, ".claude", "CLAUDE.md"))).toBe(false);
  });

  it("recovers a GitHub source from the store lockfile on a re-run", async () => {
    await writeLockfile(home, {
      source: { type: "github", repository: "acme/standards", commit_sha: "abc123", ref: "v1" },
      globalBlockContent: "CANON",
      skills: [],
      targets: ["claude"],
      markerPrefix: "agconf",
      pinnedVersion: "1.0.0",
    });

    // No --source: the repository must come from the store, not the prompt.
    await expect(
      initUserScopeCommand({ scope: "user", home, yes: true, target: ["claude"] }),
    ).rejects.toThrow("process.exit called");
    expect(getLatestRelease).toHaveBeenCalledWith("acme/standards");
    expect(prompts.text).not.toHaveBeenCalled();
  });

  it("warns that a de-selected target's content stays on disk", async () => {
    await initUserScopeCommand({
      scope: "user",
      local: canonical,
      home,
      yes: true,
      target: ["claude", "codex"],
    });
    expect(await exists(path.join(home, ".codex", "AGENTS.md"))).toBe(true);

    vi.mocked(prompts.confirm).mockResolvedValue(true as never);
    vi.mocked(prompts.multiselect).mockResolvedValue(["claude"] as never);
    await initUserScopeCommand({ scope: "user", home });

    // Dropping a target does not clean it up, and it drops out of the lockfile
    // (so `check --scope user` stops covering it) — the developer must be told.
    expect(await exists(path.join(home, ".codex", "AGENTS.md"))).toBe(true);
    expect(logged()).toContain("codex");
    expect(logged()).toMatch(/stays on disk/);
  });

  it("validates the canonical repository typed at the prompt", async () => {
    vi.mocked(prompts.text).mockResolvedValue("  acme/standards  " as never);
    vi.mocked(prompts.multiselect).mockResolvedValue(["claude"] as never);
    vi.mocked(prompts.confirm).mockResolvedValue(false as never);

    await expect(initUserScopeCommand({ scope: "user", home })).rejects.toThrow(
      "process.exit called",
    );
    // Surrounding whitespace is trimmed before use.
    expect(getLatestRelease).toHaveBeenCalledWith("acme/standards");

    const validate = (
      vi.mocked(prompts.text).mock.calls[0]?.[0] as {
        validate: (v: string) => string | undefined;
      }
    ).validate;
    expect(validate("acme/standards")).toBeUndefined();
    expect(validate("  acme/standards  ")).toBeUndefined();
    for (const bad of [
      "",
      "acme",
      "https://github.com/acme/standards",
      "acme/repo;rm -rf /",
      // These two are what separates the shared validator from a loose
      // `[\w.-]+/[\w.-]+` regex — traversal and a flag-shaped owner.
      "../..",
      "-x/repo",
    ]) {
      expect(validate(bad)).toMatch(/owner\/repo/);
    }
  });

  it("cancelling the auto-sync prompt aborts before anything is written", async () => {
    vi.mocked(prompts.multiselect).mockResolvedValue(["claude"] as never);
    vi.mocked(prompts.confirm).mockResolvedValue(Symbol("cancel") as never);
    // Cancel only the confirm — the multiselect answer must still be accepted.
    vi.mocked(prompts.isCancel).mockImplementation((v: unknown) => typeof v === "symbol");

    await initUserScopeCommand({ scope: "user", local: canonical, home });

    expect(await exists(path.join(home, ".claude"))).toBe(false);
    expect(await exists(path.join(home, ".agconf"))).toBe(false);
  });

  it("--yes without --target projects to claude only", async () => {
    await initUserScopeCommand({ scope: "user", local: canonical, home, yes: true });

    expect(await exists(path.join(home, ".claude", "CLAUDE.md"))).toBe(true);
    expect(await exists(path.join(home, ".codex", "AGENTS.md"))).toBe(false);
    expect(prompts.multiselect).not.toHaveBeenCalled();
  });

  it("a declined auto-sync survives a later --yes run", async () => {
    vi.mocked(prompts.multiselect).mockResolvedValue(["claude"] as never);
    vi.mocked(prompts.confirm).mockResolvedValue(false as never); // decline
    await initUserScopeCommand({ scope: "user", local: canonical, home });
    expect(await fs.readFile(configPath(), "utf-8")).toContain("enabled: false");

    // A --yes re-run (dotfiles bootstrap, a pasted command) must not quietly
    // start the background syncs that were declined a moment ago.
    await initUserScopeCommand({ scope: "user", home, yes: true, target: ["claude"] });
    expect(await fs.readFile(configPath(), "utf-8")).toContain("enabled: false");
  });

  it("an explicit --source overrides a local source recorded in the store", async () => {
    await initUserScopeCommand({
      scope: "user",
      local: canonical,
      home,
      yes: true,
      target: ["claude"],
    });

    // Switching a store from a local canonical to the company repo has to take
    // effect: silently keeping the recorded local path would sync stale content
    // forever while appearing to honour the flag.
    await expect(
      initUserScopeCommand({
        scope: "user",
        source: "acme/standards",
        home,
        yes: true,
        target: ["claude"],
      }),
    ).rejects.toThrow("process.exit called");
    expect(getLatestRelease).toHaveBeenCalledWith("acme/standards");
  });

  it("does not crash on a store lockfile naming an unknown target", async () => {
    await initUserScopeCommand({
      scope: "user",
      local: canonical,
      home,
      yes: true,
      target: ["claude"],
    });
    // As a newer agconf (or a hand edit) could leave behind.
    const lockPath = path.join(home, ".agconf", "lockfile.json");
    const lock = JSON.parse(await fs.readFile(lockPath, "utf-8"));
    lock.content.targets = ["claude", "some-future-harness"];
    await fs.writeFile(lockPath, JSON.stringify(lock, null, 2), "utf-8");

    vi.mocked(prompts.confirm).mockResolvedValue(true as never);
    vi.mocked(prompts.multiselect).mockResolvedValue(["claude"] as never);
    await initUserScopeCommand({ scope: "user", home });

    expect(await exists(path.join(home, ".claude", "CLAUDE.md"))).toBe(true);
  });

  it("records a declined auto-sync even when the hook install then fails", async () => {
    await initUserScopeCommand({
      scope: "user",
      local: canonical,
      home,
      yes: true,
      target: ["claude"],
    });
    expect(await fs.readFile(configPath(), "utf-8")).toContain("enabled: true");

    // Hook install will now fail — but turning auto-sync off must not depend on
    // it, or the already-installed hook keeps spawning the declined syncs.
    await fs.writeFile(path.join(home, ".claude", "settings.json"), "{ not valid json", "utf-8");
    await initUserScopeCommand({
      scope: "user",
      home,
      yes: true,
      target: ["claude"],
      autosync: false,
    });

    expect(await fs.readFile(configPath(), "utf-8")).toContain("enabled: false");
    expect(process.exitCode).toBe(1);
  });

  it("cancelling the source prompt aborts before anything is written", async () => {
    vi.mocked(prompts.text).mockResolvedValue(Symbol("cancel") as never);
    vi.mocked(prompts.isCancel).mockImplementation((v: unknown) => typeof v === "symbol");

    await initUserScopeCommand({ scope: "user", home });

    expect(await exists(path.join(home, ".claude"))).toBe(false);
    expect(await exists(path.join(home, ".agconf"))).toBe(false);
    expect(prompts.multiselect).not.toHaveBeenCalled();
  });

  it("initCommand routes --scope user here and rejects an unknown scope", async () => {
    await initCommand({ scope: "user", local: canonical, home, yes: true, target: ["claude"] });
    expect(await exists(path.join(home, ".agconf", "lockfile.json"))).toBe(true);

    await expect(initCommand({ scope: "usr", home, yes: true })).rejects.toThrow(
      "process.exit called",
    );
    expect(errored()).toContain('Invalid --scope "usr"');
  });
});
