import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installStoreHooks, printHookLines } from "../../src/commands/hook-install.js";
import { writeLockfile } from "../../src/core/lockfile.js";

/**
 * The one copy of "resolve the store's targets → install the SessionStart hook →
 * report failure identically", shared by `session-check --install-hook`,
 * `autosync --install|--enable` and `init --scope user`. Its contract is the
 * `null` return: callers use it to stop reporting success.
 */
describe("installStoreHooks", () => {
  let home: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let priorExitCode: typeof process.exitCode;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-hookinstall-"));
    priorExitCode = process.exitCode;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = priorExitCode;
    await fs.rm(home, { recursive: true, force: true });
  });

  const seedStore = (targets: string[]) =>
    writeLockfile(home, {
      source: { type: "github", repository: "acme/standards", commit_sha: "abc", ref: "v1" },
      globalBlockContent: "CANON",
      skills: [],
      targets,
      markerPrefix: "agconf",
      pinnedVersion: "1.0.0",
    });

  it("installs a hook for each target recorded in the store", async () => {
    await seedStore(["claude", "codex"]);

    const hooks = await installStoreHooks(home);

    expect(hooks?.map((h) => h.target).sort()).toEqual(["claude", "codex"]);
    expect(hooks?.every((h) => !h.alreadyPresent)).toBe(true);
    const settings = await fs.readFile(path.join(home, ".claude", "settings.json"), "utf-8");
    expect(settings).toContain("agconf session-check");
    expect(process.exitCode).toBe(priorExitCode);
  });

  it("is idempotent — a second call reports the hooks as already present", async () => {
    await seedStore(["claude"]);
    await installStoreHooks(home);

    const hooks = await installStoreHooks(home);

    expect(hooks?.[0]?.alreadyPresent).toBe(true);
  });

  it("defaults to claude when the store records no targets", async () => {
    const hooks = await installStoreHooks(home);
    expect(hooks?.map((h) => h.target)).toEqual(["claude"]);
  });

  it("returns null and sets a non-zero exit code rather than throwing", async () => {
    await seedStore(["claude"]);
    await fs.mkdir(path.join(home, ".claude"), { recursive: true });
    // A config we refuse to clobber.
    await fs.writeFile(path.join(home, ".claude", "settings.json"), "{ not valid json", "utf-8");

    const hooks = await installStoreHooks(home);

    // null is the whole contract: it is how a composing caller knows not to
    // print "Done." after a setup step that did not happen.
    expect(hooks).toBeNull();
    expect(process.exitCode).toBe(1);
    expect(errSpy.mock.calls.flat().join("\n")).toMatch(/settings\.json/);
  });
});

describe("printHookLines", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => logSpy.mockRestore());

  it("distinguishes a fresh install from an already-present hook", async () => {
    await printHookLines([
      { target: "claude", filePath: "/h/.claude/settings.json", alreadyPresent: false },
      { target: "codex", filePath: "/h/.codex/hooks.json", alreadyPresent: true },
    ]);

    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("Installed SessionStart hook for claude");
    expect(out).toContain("already present for codex");
  });

  it("reports an upgraded hook as an upgrade, not an install or a no-op", async () => {
    await printHookLines([
      {
        target: "claude",
        filePath: "/h/.claude/settings.json",
        installed: false,
        alreadyPresent: false,
        upgraded: true,
        stale: false,
      },
    ]);

    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("Updated the SessionStart hook for claude");
    expect(out).toContain("agconf session-check --hook");
  });

  it("warns about a customized hook command that agconf will not rewrite", async () => {
    await printHookLines([
      {
        target: "codex",
        filePath: "/h/.codex/hooks.json",
        installed: false,
        alreadyPresent: true,
        upgraded: false,
        stale: true,
      },
    ]);

    // Without `--hook` Codex discards the output, and only the developer can fix
    // a command they wrote themselves.
    const out = logSpy.mock.calls.flat().join("\n");
    expect(out).toContain("without `--hook`");
  });

  it("surfaces the codex-hooks-disabled warning when the probe reports it", async () => {
    await printHookLines(
      [{ target: "codex", filePath: "/h/.codex/hooks.json", alreadyPresent: false }],
      async () => "hooks stable false\n",
    );

    // Without this, the hook is installed but silently never fires.
    expect(logSpy.mock.calls.flat().join("\n")).toContain("codex features enable hooks");
  });

  it("stays quiet when codex hooks are enabled", async () => {
    await printHookLines(
      [{ target: "codex", filePath: "/h/.codex/hooks.json", alreadyPresent: false }],
      async () => "hooks stable true\n",
    );

    expect(logSpy.mock.calls.flat().join("\n")).not.toContain("codex features enable");
  });
});
