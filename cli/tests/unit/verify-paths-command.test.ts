import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyPathsCommand } from "../../src/commands/verify-paths.js";

describe("verify-paths command", () => {
  let tempDir: string;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  async function write(relPath: string, content = "x"): Promise<void> {
    const full = path.join(tempDir, relPath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf-8");
  }

  async function commitAll(): Promise<void> {
    const git = simpleGit(tempDir);
    await git.add("-A");
    await git.commit("baseline");
  }

  /** Everything written to console.error, joined for substring assertions. */
  function errorOutput(): string {
    return consoleErrorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-verify-paths-cmd-"));
    const git = simpleGit(tempDir);
    await git.init();
    await git.addConfig("user.email", "test@example.com");
    await git.addConfig("user.name", "Test");

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
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("exits cleanly when every change is agconf-owned", async () => {
    await write("src/index.ts");
    await commitAll();

    await write(".claude/skills/foo/SKILL.md");

    await verifyPathsCommand({ cwd: tempDir });
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("exits cleanly on a clean worktree", async () => {
    await write("src/index.ts");
    await commitAll();

    await verifyPathsCommand({ cwd: tempDir });
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("exits 1 and names the offending path when a change falls outside", async () => {
    await write("src/index.ts", "original");
    await commitAll();

    await write("src/index.ts", "rewritten");

    await expect(verifyPathsCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(errorOutput()).toContain("src/index.ts");
  });

  it("lists the allowed patterns so a violation is actionable", async () => {
    await write("src/index.ts", "original");
    await commitAll();
    await write("src/index.ts", "rewritten");

    await expect(verifyPathsCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");
    const output = errorOutput();
    expect(output).toContain(".claude/**");
    expect(output).toContain(".claude/**");
  });

  it("fails closed outside a git repository", async () => {
    const nonRepo = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-not-a-repo-"));
    try {
      await expect(verifyPathsCommand({ cwd: nonRepo })).rejects.toThrow("process.exit called");
      expect(mockExit).toHaveBeenCalledWith(1);
    } finally {
      await fs.rm(nonRepo, { recursive: true, force: true });
    }
  });

  it("suppresses the success output with --quiet but still exits 0", async () => {
    await write(".claude/skills/foo/SKILL.md");

    await verifyPathsCommand({ cwd: tempDir, quiet: true });
    expect(mockExit).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });
});
