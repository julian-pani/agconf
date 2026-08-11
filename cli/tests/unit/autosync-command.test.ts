import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { autosyncCommand } from "../../src/commands/autosync.js";
import { syncUserScopeCommand } from "../../src/commands/user-scope.js";
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

    await autosyncCommand({ home, trigger: "cron" });

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

  it("logs an error (never throws) when there is no source", async () => {
    // Fresh home — no store lockfile.
    await expect(autosyncCommand({ home, trigger: "cron" })).resolves.toBeUndefined();
    expect(await readLog()).toContain("result=error");
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("--install writes the SessionStart hook and a cron entry (injected io)", async () => {
    let written = "";
    const io = {
      read: async () => "",
      write: async (c: string) => {
        written = c;
      },
    };

    await autosyncCommand({
      home,
      install: true,
      invocation: "agconf autosync --trigger cron",
      crontabIo: io,
    });

    const settings = JSON.parse(
      await fs.readFile(path.join(home, ".claude", "settings.json"), "utf-8"),
    );
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain("session-check");
    expect(written).toContain("# agconf-autosync");
    expect(written).toContain("*/10 * * * *");
  });
});
