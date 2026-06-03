import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncCommand } from "../../src/commands/sync.js";

/**
 * Command-level tests for `agconf sync`: the mutually-exclusive flag guards and
 * the `cwd`-injected target resolution (no `process.cwd` monkey-patching). These
 * paths are not reachable through the e2e happy-path suite.
 */
describe("syncCommand", () => {
  let mockExit: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    mockExit.mockRestore();
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  const errorOutput = () => errSpy.mock.calls.map((c) => c.join(" ")).join("\n");

  it("rejects --pinned combined with --ref", async () => {
    await expect(syncCommand({ pinned: true, ref: "v1.2.0" })).rejects.toThrow(
      "process.exit called",
    );
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(errorOutput()).toContain("Cannot use --pinned with --ref");
  });

  it("rejects --pinned combined with --local", async () => {
    await expect(syncCommand({ pinned: true, local: true })).rejects.toThrow("process.exit called");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(errorOutput()).toContain("Cannot use --pinned with --local");
  });

  it("resolves the target from options.cwd and errors when it is not a git repo", async () => {
    const nonGitDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-sync-cmd-"));
    try {
      // If cwd were not threaded through, resolveTargetDirectory would fall back
      // to process.cwd() (this repo, a valid git root) and not exit here.
      await expect(syncCommand({ cwd: nonGitDir })).rejects.toThrow("process.exit called");
      expect(mockExit).toHaveBeenCalledWith(1);
      expect(errorOutput()).toContain("Not inside a git repository");
    } finally {
      await fs.rm(nonGitDir, { recursive: true, force: true });
    }
  });
});
