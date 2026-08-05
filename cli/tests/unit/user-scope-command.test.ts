import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkUserScopeCommand, syncUserScopeCommand } from "../../src/commands/user-scope.js";
import { getUserPaths } from "../../src/core/user-scope.js";

describe("user-scope commands", () => {
  let home: string;
  let canonical: string;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-usc-home-"));
    canonical = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-usc-canon-"));
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
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    mockExit.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(canonical, { recursive: true, force: true });
  });

  const exists = (p: string) =>
    fs
      .access(p)
      .then(() => true)
      .catch(() => false);

  it("sync --scope user --local projects into ~/.claude and ~/.codex", async () => {
    await syncUserScopeCommand({
      scope: "user",
      local: canonical,
      home,
      target: ["claude", "codex"],
    });

    expect(await exists(path.join(home, ".claude", "CLAUDE.md"))).toBe(true);
    expect(await exists(path.join(home, ".codex", "AGENTS.md"))).toBe(true);
    expect(await exists(path.join(getUserPaths(home).storeDir, "lockfile.json"))).toBe(true);
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("re-syncs from the store lockfile without re-specifying --local", async () => {
    await syncUserScopeCommand({ scope: "user", local: canonical, home, target: ["claude"] });
    // Second run: no --local, source recovered from ~/.agconf/lockfile.json.
    await syncUserScopeCommand({ scope: "user", home });

    expect(await exists(path.join(home, ".claude", "CLAUDE.md"))).toBe(true);
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("errors when no source and no prior user sync", async () => {
    await expect(syncUserScopeCommand({ scope: "user", home })).rejects.toThrow(
      "process.exit called",
    );
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("No canonical source"));
  });

  it("check --scope user: false when clean, true when tampered, false when unsynced", async () => {
    // Unsynced.
    expect(await checkUserScopeCommand({ home })).toBe(false);

    await syncUserScopeCommand({ scope: "user", local: canonical, home, target: ["claude"] });
    // Clean.
    expect(await checkUserScopeCommand({ home })).toBe(false);

    // Tamper with the managed block.
    const claudeFile = path.join(home, ".claude", "CLAUDE.md");
    const content = await fs.readFile(claudeFile, "utf-8");
    await fs.writeFile(claudeFile, content.replace("Be excellent.", "TAMPERED"), "utf-8");
    expect(await checkUserScopeCommand({ home })).toBe(true);
  });
});
