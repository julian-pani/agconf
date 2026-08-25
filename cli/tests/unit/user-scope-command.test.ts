import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The two seams that would reach the network are stubbed; everything else runs
// for real against temp directories.
vi.mock("../../src/core/version.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/version.js")>()),
  getLatestRelease: vi.fn(),
}));

vi.mock("../../src/core/source.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/core/source.js")>()),
  resolveGithubSource: vi.fn(async () => {
    throw new Error("clone attempted");
  }),
}));

import {
  checkUserScopeCommand,
  probeUserScopeFreshness,
  runUserScopeSync,
  syncUserScopeCommand,
} from "../../src/commands/user-scope.js";
import { writeLockfile } from "../../src/core/lockfile.js";
import { resolveGithubSource } from "../../src/core/source.js";
import { getUserPaths } from "../../src/core/user-scope.js";
import { getLatestRelease } from "../../src/core/version.js";

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
    // Call counts would otherwise accumulate across tests, so a new test earlier
    // in the file silently breaks a `toHaveBeenCalledTimes` assertion later.
    vi.mocked(getLatestRelease).mockClear();
    vi.mocked(resolveGithubSource).mockClear();
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
    // Standalone sync still points at auto-sync (init suppresses this tip).
    expect(consoleLogSpy.mock.calls.map((c) => c.join(" ")).join("\n")).toContain(
      "agconf autosync --install",
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("honours an explicit --source over a local source recorded in the store", async () => {
    await syncUserScopeCommand({ scope: "user", local: canonical, home, target: ["claude"] });

    // The recorded local must not silently win: it would make switching a store
    // to the company repo impossible (every sync rewrites the lockfile as local).
    await expect(
      syncUserScopeCommand({ scope: "user", source: "acme/standards", home }),
    ).rejects.toThrow("process.exit called");
    expect(getLatestRelease).toHaveBeenCalledWith("acme/standards");
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

  it("offers propose alongside sync when the drift is a local edit", async () => {
    await syncUserScopeCommand({ scope: "user", local: canonical, home, target: ["claude"] });
    const claudeFile = path.join(home, ".claude", "CLAUDE.md");
    const content = await fs.readFile(claudeFile, "utf-8");
    await fs.writeFile(claudeFile, content.replace("Be excellent.", "My edit."), "utf-8");

    expect(await checkUserScopeCommand({ home })).toBe(true);

    // Pointing only at sync would tell the developer to discard the edit.
    const out = consoleLogSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toContain("propose --scope user");
    expect(out).toContain("sync --scope user");
  });

  it("reports removed content and backed-up files, and skips a no-op commit", async () => {
    // First sync brings a skill down...
    await fs.mkdir(path.join(canonical, "skills", "code-review"), { recursive: true });
    await fs.writeFile(
      path.join(canonical, "skills", "code-review", "SKILL.md"),
      "---\nname: code-review\ndescription: Review code\n---\n\n# Code Review\n",
      "utf-8",
    );
    // ...and a pre-existing, divergent local skill of the same name is backed up
    // rather than silently overwritten (user scope runs unattended).
    const localSkill = path.join(home, ".claude", "skills", "code-review", "SKILL.md");
    await fs.mkdir(path.dirname(localSkill), { recursive: true });
    await fs.writeFile(
      localSkill,
      "---\nname: code-review\ndescription: My own version\n---\n\n# Mine\n",
      "utf-8",
    );

    await syncUserScopeCommand({ scope: "user", local: canonical, home, target: ["claude"] });
    expect(consoleLogSpy.mock.calls.map((c) => c.join(" ")).join("\n")).toMatch(
      /backed up 1 of your own file\(s\)/,
    );
    consoleLogSpy.mockClear();

    // Dropping the skill from canonical removes the projected copy.
    await fs.rm(path.join(canonical, "skills", "code-review"), { recursive: true, force: true });
    await syncUserScopeCommand({ scope: "user", home });

    const out = consoleLogSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(out).toContain("removed (dropped from canonical): 1 skill(s)");
    expect(await exists(localSkill)).toBe(false);
  });

  it("still projects (reporting a skipped commit) when the store's git is unusable", async () => {
    // `.git` as a regular file: git commands in the store fail, which must be
    // non-fatal — the projection is the point, the git history is a convenience.
    const storeDir = getUserPaths(home).storeDir;
    await fs.mkdir(storeDir, { recursive: true });
    await fs.writeFile(path.join(storeDir, ".git"), "not a git dir", "utf-8");

    await syncUserScopeCommand({ scope: "user", local: canonical, home, target: ["claude"] });

    expect(consoleLogSpy.mock.calls.map((c) => c.join(" ")).join("\n")).toContain(
      "git commit skipped",
    );
    expect(await exists(path.join(home, ".claude", "CLAUDE.md"))).toBe(true);
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("propagates an unexpected projection failure instead of swallowing it", async () => {
    // A directory where CLAUDE.md must be written: the write fails with EISDIR.
    // Only StoreBusy / no-source are handled; anything else must surface.
    await fs.mkdir(path.join(home, ".claude", "CLAUDE.md"), { recursive: true });

    await expect(
      syncUserScopeCommand({ scope: "user", local: canonical, home, target: ["claude"] }),
    ).rejects.toThrow(/EISDIR|illegal operation on a directory/i);

    expect(mockExit).not.toHaveBeenCalled();
  });

  it("exits non-zero (without throwing) when another sync holds the store lock", async () => {
    const storeDir = getUserPaths(home).storeDir;
    await fs.mkdir(storeDir, { recursive: true });
    // A fresh (non-stale) lock file: a live holder.
    await fs.writeFile(path.join(storeDir, ".lock"), String(Date.now()), "utf-8");
    const previousExitCode = process.exitCode;

    try {
      await syncUserScopeCommand({ scope: "user", local: canonical, home, target: ["claude"] });

      expect(process.exitCode).toBe(1);
      expect(consoleErrorSpy.mock.calls.map((c) => c.join(" ")).join("\n")).toContain(
        "already running",
      );
      // Nothing was projected while the lock was held.
      expect(await exists(path.join(home, ".claude", "CLAUDE.md"))).toBe(false);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  describe("runUserScopeSync (shared core)", () => {
    const seedGithubStore = (pinnedVersion: string) =>
      writeLockfile(home, {
        source: { type: "github", repository: "acme/standards", commit_sha: "abc123", ref: "v1" },
        globalBlockContent: "CANON",
        skills: [],
        targets: ["claude"],
        markerPrefix: "agconf",
        pinnedVersion,
      });

    it("skips the clone entirely when the store is already at the latest version", async () => {
      await seedGithubStore("1.1.0");
      vi.mocked(getLatestRelease).mockResolvedValue({
        tag: "v1.1.0",
        version: "1.1.0",
        commitSha: "abc123",
        publishedAt: "2026-01-01T00:00:00Z",
        tarballUrl: "https://example.invalid/1.1.0",
      });

      const result = await runUserScopeSync({ home, skipIfUpToDate: true });

      expect(result).toEqual({ result: null, upToDate: true, pinnedVersion: "1.1.0" });
      // The repository was recovered from the store lockfile, and no clone ran.
      expect(getLatestRelease).toHaveBeenCalledWith("acme/standards");
      expect(resolveGithubSource).not.toHaveBeenCalled();
    });

    it("does not skip when the store is behind (the fast path is freshness-gated)", async () => {
      await seedGithubStore("1.0.0");
      vi.mocked(getLatestRelease).mockResolvedValue({
        tag: "v1.1.0",
        version: "1.1.0",
        commitSha: "abc123",
        publishedAt: "2026-01-01T00:00:00Z",
        tarballUrl: "https://example.invalid/1.1.0",
      });

      // throwOnResolveError so the stubbed clone surfaces instead of exiting.
      await expect(
        runUserScopeSync({ home, skipIfUpToDate: true, throwOnResolveError: true }),
      ).rejects.toThrow("clone attempted");
      expect(resolveGithubSource).toHaveBeenCalledTimes(1);
    });
  });

  describe("probeUserScopeFreshness", () => {
    const seedGithubStore = (pinnedVersion: string) =>
      writeLockfile(home, {
        source: { type: "github", repository: "o/r", commit_sha: "abc123", ref: "v1.0.0" },
        globalBlockContent: "CANON",
        skills: [],
        targets: ["claude"],
        markerPrefix: "agconf",
        pinnedVersion,
      });

    it("reports behind when canonical's latest release is newer", async () => {
      await seedGithubStore("1.0.0");
      const probe = await probeUserScopeFreshness({
        home,
        fetchLatest: async () => "1.1.0",
      });
      expect(probe.behind).toBe(true);
      expect(probe.current).toBe("1.0.0");
      expect(probe.latest).toBe("1.1.0");
    });

    it("reports not-behind when the store is at the latest", async () => {
      await seedGithubStore("1.1.0");
      const probe = await probeUserScopeFreshness({ home, fetchLatest: async () => "1.1.0" });
      expect(probe.behind).toBe(false);
    });

    it("is a no-op (behind:false) when the lookup can't resolve a version", async () => {
      await seedGithubStore("1.0.0");
      const probe = await probeUserScopeFreshness({ home, fetchLatest: async () => null });
      expect(probe.behind).toBe(false);
    });

    it("swallows a failing lookup (never throws at session start)", async () => {
      await seedGithubStore("1.0.0");
      const probe = await probeUserScopeFreshness({
        home,
        fetchLatest: async () => {
          throw new Error("boom");
        },
      });
      expect(probe.behind).toBe(false);
    });

    it("is a no-op for a local source (never hits the network)", async () => {
      await syncUserScopeCommand({ scope: "user", local: canonical, home, target: ["claude"] });
      let called = false;
      const probe = await probeUserScopeFreshness({
        home,
        fetchLatest: async () => {
          called = true;
          return "9.9.9";
        },
      });
      expect(probe.behind).toBe(false);
      expect(called).toBe(false); // local source short-circuits before any lookup
    });
  });
});
