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

    await sessionCheckCommand({ cwd: repo, home });

    const output = consoleLogSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("more than one scope");
    expect(output).toContain("instructions");
    expect(mockExit).not.toHaveBeenCalled(); // advisory: always exit 0
  });
});
