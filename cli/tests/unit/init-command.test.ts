import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The shell-completion prompt is interactive; stub it and assert on the call.
vi.mock("../../src/commands/completion.js", () => ({
  promptCompletionInstall: vi.fn(),
}));

vi.mock("@clack/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clack/prompts")>()),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
}));

import * as prompts from "@clack/prompts";
import { promptCompletionInstall } from "../../src/commands/completion.js";
import { initCommand } from "../../src/commands/init.js";

/**
 * Command-level tests for `agconf init`: the guards and prompts that the
 * `--yes` integration suite never reaches (schema compatibility, the
 * already-synced re-sync prompt, the completion offer).
 */
describe("initCommand", () => {
  let repo: string;
  let canonical: string;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-init-repo-"));
    canonical = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-init-canon-"));
    execFileSync("git", ["init", "-q"], { cwd: repo });

    await fs.mkdir(path.join(canonical, "instructions"), { recursive: true });
    await fs.writeFile(
      path.join(canonical, "instructions", "AGENTS.md"),
      "# Global Standards\n\nBe excellent.",
      "utf-8",
    );
    await fs.mkdir(path.join(canonical, "skills", "code-review"), { recursive: true });
    await fs.writeFile(
      path.join(canonical, "skills", "code-review", "SKILL.md"),
      "---\nname: code-review\ndescription: Review code\n---\n\n# Code Review\n",
      "utf-8",
    );

    mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0}) called`);
    }) as () => never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    mockExit.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
    vi.mocked(promptCompletionInstall).mockReset();
    vi.mocked(prompts.confirm).mockReset();
    vi.mocked(prompts.isCancel).mockReset().mockReturnValue(false);
    await fs.rm(repo, { recursive: true, force: true });
    await fs.rm(canonical, { recursive: true, force: true });
  });

  const logOutput = () => logSpy.mock.calls.map((c) => c.join(" ")).join("\n");
  const errorOutput = () => errSpy.mock.calls.map((c) => c.join(" ")).join("\n");

  /** Write a lockfile so the repo reads as already synced, with a chosen schema version. */
  const seedLockfile = async (schemaVersion = "1.0.0") => {
    await fs.mkdir(path.join(repo, ".agconf"), { recursive: true });
    await fs.writeFile(
      path.join(repo, ".agconf", "lockfile.json"),
      JSON.stringify({
        version: schemaVersion,
        synced_at: new Date().toISOString(),
        source: { type: "local", path: canonical },
        content: {
          agents_md: { global_block_hash: "sha256:abc123def456", merged: true },
          skills: [],
          targets: ["claude"],
        },
      }),
      "utf-8",
    );
  };

  it("refuses to init against an incompatible lockfile schema", async () => {
    await seedLockfile("2.0.0");

    await expect(initCommand({ cwd: repo, local: canonical, yes: true })).rejects.toThrow(
      "process.exit(1) called",
    );

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(errorOutput()).toContain("requires a newer CLI");
  });

  it("warns but proceeds on a newer minor lockfile schema", async () => {
    await seedLockfile("1.1.0");

    await initCommand({ cwd: repo, local: canonical, yes: true });

    expect(logOutput()).toContain("Some features may not work");
    await expect(
      fs.access(path.join(repo, ".claude", "skills", "code-review", "SKILL.md")),
    ).resolves.toBeUndefined();
  });

  it("asks before re-syncing an already-synced repo and aborts (exit 0) when declined", async () => {
    await seedLockfile();
    vi.mocked(prompts.confirm).mockResolvedValue(false);

    await expect(initCommand({ cwd: repo, local: canonical })).rejects.toThrow(
      "process.exit(0) called",
    );

    expect(prompts.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("already been synced") }),
    );
    expect(mockExit).toHaveBeenCalledWith(0);
    // Nothing was written.
    await expect(fs.access(path.join(repo, ".claude", "skills"))).rejects.toThrow();
  });

  it("aborts (exit 0) when the re-sync prompt is cancelled", async () => {
    await seedLockfile();
    vi.mocked(prompts.confirm).mockResolvedValue(true);
    vi.mocked(prompts.isCancel).mockReturnValue(true);

    await expect(initCommand({ cwd: repo, local: canonical })).rejects.toThrow(
      "process.exit(0) called",
    );
    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("skips the re-sync prompt under --yes", async () => {
    await seedLockfile();

    await initCommand({ cwd: repo, local: canonical, yes: true });

    expect(prompts.confirm).not.toHaveBeenCalled();
    expect(promptCompletionInstall).not.toHaveBeenCalled(); // non-interactive
  });

  it("offers to install shell completions only in interactive mode", async () => {
    await initCommand({ cwd: repo, local: canonical });

    expect(promptCompletionInstall).toHaveBeenCalledTimes(1);
  });
});
