import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock modules before importing the module under test
vi.mock("../../src/utils/git.js", () => ({
  getGitRoot: vi.fn(),
}));

vi.mock("../../src/core/source.js", () => ({
  resolveLocalSource: vi.fn(),
  resolveGithubSource: vi.fn(),
  formatSourceString: vi.fn((source: { type: string; repository?: string; path?: string }) => {
    if (source.type === "github") return `github:${source.repository}@abc1234`;
    return `local:${source.path}`;
  }),
}));

vi.mock("../../src/core/version.js", () => ({
  getLatestRelease: vi.fn(),
  isVersionRef: vi.fn((ref: string) => {
    const normalized = ref.startsWith("v") ? ref.slice(1) : ref;
    return /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(normalized);
  }),
  parseVersion: vi.fn((tag: string) => (tag.startsWith("v") ? tag.slice(1) : tag)),
  formatTag: vi.fn((version: string) => (version.startsWith("v") ? version : `v${version}`)),
}));

vi.mock("../../src/core/managed-content.js", () => ({
  getModifiedManagedFiles: vi.fn(),
}));

vi.mock("../../src/utils/fs.js", () => ({
  createTempDir: vi.fn(),
  removeTempDir: vi.fn(),
  resolvePath: vi.fn((p: string) => path.resolve(p)),
}));

vi.mock("@clack/prompts", () => ({
  confirm: vi.fn(),
  select: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn(() => false),
}));

import * as prompts from "@clack/prompts";
import type { ResolvedVersion, SharedSyncOptions } from "../../src/commands/shared.js";
import {
  checkModifiedFilesBeforeSync,
  parseAndValidateTargets,
  promptMergeOrOverride,
  resolveSource,
  resolveTargetDirectory,
  resolveVersion,
} from "../../src/commands/shared.js";
import { getModifiedManagedFiles } from "../../src/core/managed-content.js";
import { resolveGithubSource, resolveLocalSource } from "../../src/core/source.js";
import type { SyncStatus } from "../../src/core/sync.js";
import { getLatestRelease } from "../../src/core/version.js";
import { createTempDir, removeTempDir } from "../../src/utils/fs.js";
import { getGitRoot } from "../../src/utils/git.js";

describe("shared command utilities", () => {
  let mockExit: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    mockExit.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  // ───────────────────────────────────────────────────────────────────
  // parseAndValidateTargets
  // ───────────────────────────────────────────────────────────────────
  describe("parseAndValidateTargets", () => {
    it("returns ['claude'] for undefined input (default)", async () => {
      const result = await parseAndValidateTargets(undefined);
      expect(result).toEqual(["claude"]);
    });

    it("returns parsed targets for valid single target", async () => {
      const result = await parseAndValidateTargets(["claude"]);
      expect(result).toEqual(["claude"]);
    });

    it("returns parsed targets for valid codex target", async () => {
      const result = await parseAndValidateTargets(["codex"]);
      expect(result).toEqual(["codex"]);
    });

    it("returns parsed targets for multiple valid targets", async () => {
      const result = await parseAndValidateTargets(["claude", "codex"]);
      expect(result).toEqual(["claude", "codex"]);
    });

    it("supports comma-separated targets", async () => {
      const result = await parseAndValidateTargets(["claude,codex"]);
      expect(result).toEqual(["claude", "codex"]);
    });

    it("calls process.exit(1) for invalid target", async () => {
      await expect(parseAndValidateTargets(["invalid-target"])).rejects.toThrow(
        "process.exit called",
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("calls process.exit(1) for partially invalid targets", async () => {
      await expect(parseAndValidateTargets(["claude", "bogus"])).rejects.toThrow(
        "process.exit called",
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("logs supported targets on error", async () => {
      await expect(parseAndValidateTargets(["bad"])).rejects.toThrow("process.exit called");
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Supported targets"));
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // resolveTargetDirectory
  // ───────────────────────────────────────────────────────────────────
  describe("resolveTargetDirectory", () => {
    it("returns git root when inside a git repo", async () => {
      const mockGitRoot = "/fake/git/root";
      vi.mocked(getGitRoot).mockResolvedValue(mockGitRoot);
      // Make process.cwd() return the same as git root to avoid the info log
      const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(mockGitRoot);

      const result = await resolveTargetDirectory();
      expect(result).toBe(mockGitRoot);
      expect(getGitRoot).toHaveBeenCalled();

      cwdSpy.mockRestore();
    });

    it("logs info when in a subdirectory of git root", async () => {
      const mockGitRoot = "/fake/git/root";
      vi.mocked(getGitRoot).mockResolvedValue(mockGitRoot);
      const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue("/fake/git/root/sub/dir");

      const result = await resolveTargetDirectory();
      expect(result).toBe(mockGitRoot);
      // Should have logged an info message about syncing to root
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Syncing to repository root"),
      );

      cwdSpy.mockRestore();
    });

    it("calls process.exit(1) when not in a git repo", async () => {
      vi.mocked(getGitRoot).mockResolvedValue(null);

      await expect(resolveTargetDirectory()).rejects.toThrow("process.exit called");
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("logs error message when not in git repo", async () => {
      vi.mocked(getGitRoot).mockResolvedValue(null);

      await expect(resolveTargetDirectory()).rejects.toThrow("process.exit called");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Not inside a git repository"),
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // resolveVersion
  // ───────────────────────────────────────────────────────────────────
  describe("resolveVersion", () => {
    const baseStatus: SyncStatus = {
      hasSynced: false,
      lockfile: null,
      agentsMdExists: false,
      skillsExist: false,
      schemaWarning: null,
      schemaError: null,
    };

    it("returns local version when --local is used", async () => {
      const options: SharedSyncOptions = { local: true };
      const result = await resolveVersion(options, baseStatus, "init");
      expect(result).toEqual({
        ref: "local",
        version: undefined,
        isRelease: false,
        releaseInfo: null,
      });
    });

    it("returns local version when --local is a string path", async () => {
      const options: SharedSyncOptions = { local: "/some/path" };
      const result = await resolveVersion(options, baseStatus, "init");
      expect(result).toEqual({
        ref: "local",
        version: undefined,
        isRelease: false,
        releaseInfo: null,
      });
    });

    it("uses explicit --ref as version tag when ref is a version", async () => {
      const options: SharedSyncOptions = { ref: "v1.2.3" };
      const result = await resolveVersion(options, baseStatus, "init");
      expect(result).toEqual({
        ref: "v1.2.3",
        version: "1.2.3",
        isRelease: true,
        releaseInfo: null,
      });
    });

    it("uses explicit --ref as version tag without v prefix", async () => {
      const options: SharedSyncOptions = { ref: "2.0.0" };
      const result = await resolveVersion(options, baseStatus, "init");
      expect(result).toEqual({
        ref: "v2.0.0",
        version: "2.0.0",
        isRelease: true,
        releaseInfo: null,
      });
    });

    it("uses explicit --ref as branch ref when not a version", async () => {
      const options: SharedSyncOptions = { ref: "feature-branch" };
      const result = await resolveVersion(options, baseStatus, "init");
      expect(result).toEqual({
        ref: "feature-branch",
        version: undefined,
        isRelease: false,
        releaseInfo: null,
      });
    });

    it("uses lockfile pinned version when --pinned is specified", async () => {
      const statusWithLockfile: SyncStatus = {
        ...baseStatus,
        hasSynced: true,
        lockfile: {
          version: "1.0.0",
          pinned_version: "3.5.0",
          synced_at: new Date().toISOString(),
          source: { type: "local", path: "/some/path" },
          content: {
            agents_md: { global_block_hash: "sha256:abc", merged: true },
            skills: [],
          },
        },
      };
      const options: SharedSyncOptions = { pinned: true };
      const result = await resolveVersion(options, statusWithLockfile, "sync");
      expect(result).toEqual({
        ref: "v3.5.0",
        version: "3.5.0",
        isRelease: true,
        releaseInfo: null,
      });
    });

    it("calls process.exit(1) when --pinned but no pinned version in lockfile", async () => {
      const statusNoPin: SyncStatus = {
        ...baseStatus,
        hasSynced: true,
        lockfile: {
          version: "1.0.0",
          synced_at: new Date().toISOString(),
          source: { type: "local", path: "/some/path" },
          content: {
            agents_md: { global_block_hash: "sha256:abc", merged: true },
            skills: [],
          },
        },
      };
      const options: SharedSyncOptions = { pinned: true };
      await expect(resolveVersion(options, statusNoPin, "sync")).rejects.toThrow(
        "process.exit called",
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("falls back to master when no repo is provided", async () => {
      const options: SharedSyncOptions = {};
      const result = await resolveVersion(options, baseStatus, "init");
      expect(result).toEqual({
        ref: "master",
        version: undefined,
        isRelease: false,
        releaseInfo: null,
      });
    });

    it("fetches latest release when repo is provided", async () => {
      const mockRelease = {
        tag: "v2.1.0",
        version: "2.1.0",
        commitSha: "abc123",
        publishedAt: "2025-01-01T00:00:00Z",
        tarballUrl: "https://example.com/tarball",
      };
      vi.mocked(getLatestRelease).mockResolvedValue(mockRelease);

      const options: SharedSyncOptions = {};
      const result = await resolveVersion(options, baseStatus, "init", "org/repo");
      expect(result).toEqual({
        ref: "v2.1.0",
        version: "2.1.0",
        isRelease: true,
        releaseInfo: mockRelease,
      });
      expect(getLatestRelease).toHaveBeenCalledWith("org/repo");
    });

    it("falls back to master when getLatestRelease fails", async () => {
      vi.mocked(getLatestRelease).mockRejectedValue(new Error("Network error"));

      const options: SharedSyncOptions = {};
      const result = await resolveVersion(options, baseStatus, "init", "org/repo");
      expect(result).toEqual({
        ref: "master",
        version: undefined,
        isRelease: false,
        releaseInfo: null,
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // resolveSource
  // ───────────────────────────────────────────────────────────────────
  describe("resolveSource", () => {
    const localResolvedVersion: ResolvedVersion = {
      ref: "local",
      version: undefined,
      isRelease: false,
      releaseInfo: null,
    };

    const githubResolvedVersion: ResolvedVersion = {
      ref: "v1.0.0",
      version: "1.0.0",
      isRelease: true,
      releaseInfo: null,
    };

    it("resolves local source when --local is true", async () => {
      const mockSource = {
        source: { type: "local" as const, path: "/auto/found" },
        basePath: "/auto/found",
        agentsMdPath: "/auto/found/instructions/AGENTS.md",
        skillsPath: "/auto/found/skills",
        rulesPath: null,
        agentsPath: null,
        markerPrefix: "agconf",
      };
      vi.mocked(resolveLocalSource).mockResolvedValue(mockSource);

      const options: SharedSyncOptions = { local: true };
      const result = await resolveSource(options, localResolvedVersion);

      expect(result.resolvedSource).toBe(mockSource);
      expect(result.tempDir).toBeNull();
      expect(result.repository).toBe("");
      expect(resolveLocalSource).toHaveBeenCalledWith({});
    });

    it("resolves local source with explicit path when --local is a string", async () => {
      const mockSource = {
        source: { type: "local" as const, path: "/explicit/path" },
        basePath: "/explicit/path",
        agentsMdPath: "/explicit/path/instructions/AGENTS.md",
        skillsPath: "/explicit/path/skills",
        rulesPath: null,
        agentsPath: null,
        markerPrefix: "agconf",
      };
      vi.mocked(resolveLocalSource).mockResolvedValue(mockSource);

      const options: SharedSyncOptions = { local: "/explicit/path" };
      const result = await resolveSource(options, localResolvedVersion);

      expect(result.resolvedSource).toBe(mockSource);
      expect(resolveLocalSource).toHaveBeenCalledWith({
        path: expect.any(String),
      });
    });

    it("calls process.exit(1) when no source specified for GitHub", async () => {
      const options: SharedSyncOptions = {}; // no source, no local
      await expect(resolveSource(options, githubResolvedVersion)).rejects.toThrow(
        "process.exit called",
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("resolves GitHub source with temp dir", async () => {
      const mockSource = {
        source: {
          type: "github" as const,
          repository: "org/repo",
          commit_sha: "abc",
          ref: "v1.0.0",
        },
        basePath: "/tmp/agconf-xyz",
        agentsMdPath: "/tmp/agconf-xyz/instructions/AGENTS.md",
        skillsPath: "/tmp/agconf-xyz/skills",
        rulesPath: null,
        agentsPath: null,
        markerPrefix: "agconf",
      };
      vi.mocked(createTempDir).mockResolvedValue("/tmp/agconf-xyz");
      vi.mocked(resolveGithubSource).mockResolvedValue(mockSource);

      const options: SharedSyncOptions = { source: "org/repo" };
      const result = await resolveSource(options, githubResolvedVersion);

      expect(result.resolvedSource).toBe(mockSource);
      expect(result.tempDir).toBe("/tmp/agconf-xyz");
      expect(result.repository).toBe("org/repo");
      expect(createTempDir).toHaveBeenCalled();
      expect(resolveGithubSource).toHaveBeenCalledWith(
        { repository: "org/repo", ref: "v1.0.0" },
        "/tmp/agconf-xyz",
      );
    });

    it("cleans up temp dir on GitHub source resolution failure", async () => {
      vi.mocked(createTempDir).mockResolvedValue("/tmp/agconf-fail");
      vi.mocked(resolveGithubSource).mockRejectedValue(new Error("Clone failed"));

      const options: SharedSyncOptions = { source: "org/repo" };
      await expect(resolveSource(options, githubResolvedVersion)).rejects.toThrow(
        "process.exit called",
      );
      expect(removeTempDir).toHaveBeenCalledWith("/tmp/agconf-fail");
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("calls process.exit(1) when local source resolution fails", async () => {
      vi.mocked(resolveLocalSource).mockRejectedValue(new Error("Not a canonical repo"));

      const options: SharedSyncOptions = { local: true };
      await expect(resolveSource(options, localResolvedVersion)).rejects.toThrow(
        "process.exit called",
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // checkModifiedFilesBeforeSync
  // ───────────────────────────────────────────────────────────────────
  describe("checkModifiedFilesBeforeSync", () => {
    it("returns true when no modified files", async () => {
      vi.mocked(getModifiedManagedFiles).mockResolvedValue([]);

      const result = await checkModifiedFilesBeforeSync("/target", ["claude"], {}, null);
      expect(result).toBe(true);
    });

    it("warns and proceeds when modified files exist with --yes flag", async () => {
      vi.mocked(getModifiedManagedFiles).mockResolvedValue([
        {
          path: ".claude/skills/test-skill/SKILL.md",
          type: "skill",
          skillName: "test-skill",
          isManaged: true,
          hasChanges: true,
        },
      ]);

      const result = await checkModifiedFilesBeforeSync("/target", ["claude"], { yes: true }, null);
      expect(result).toBe(true);
      // Should have logged the modified file path
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("1 managed file(s)"));
    });

    it("displays modified files when they exist", async () => {
      vi.mocked(getModifiedManagedFiles).mockResolvedValue([
        {
          path: "AGENTS.md",
          type: "agents",
          isManaged: true,
          hasChanges: true,
        },
        {
          path: ".claude/skills/my-skill/SKILL.md",
          type: "skill",
          skillName: "my-skill",
          isManaged: true,
          hasChanges: true,
        },
      ]);

      // Mock confirm to return true (user says yes)
      vi.mocked(prompts.confirm).mockResolvedValue(true);

      const result = await checkModifiedFilesBeforeSync("/target", ["claude"], {}, null);
      expect(result).toBe(true);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("2 managed file(s)"));
    });

    it("calls process.exit(0) when user cancels confirmation", async () => {
      vi.mocked(getModifiedManagedFiles).mockResolvedValue([
        {
          path: "AGENTS.md",
          type: "agents",
          isManaged: true,
          hasChanges: true,
        },
      ]);

      // User declines
      vi.mocked(prompts.confirm).mockResolvedValue(false);

      await expect(checkModifiedFilesBeforeSync("/target", ["claude"], {}, null)).rejects.toThrow(
        "process.exit called",
      );
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("cleans up temp dir when user cancels", async () => {
      vi.mocked(getModifiedManagedFiles).mockResolvedValue([
        {
          path: "AGENTS.md",
          type: "agents",
          isManaged: true,
          hasChanges: true,
        },
      ]);

      vi.mocked(prompts.confirm).mockResolvedValue(false);

      await expect(
        checkModifiedFilesBeforeSync("/target", ["claude"], {}, "/tmp/cleanup-me"),
      ).rejects.toThrow("process.exit called");
      expect(removeTempDir).toHaveBeenCalledWith("/tmp/cleanup-me");
    });

    it("calls process.exit(0) when user cancels via isCancel", async () => {
      vi.mocked(getModifiedManagedFiles).mockResolvedValue([
        {
          path: "AGENTS.md",
          type: "agents",
          isManaged: true,
          hasChanges: true,
        },
      ]);

      // prompts.isCancel returns true for Symbol.cancel
      vi.mocked(prompts.isCancel).mockReturnValue(true);
      vi.mocked(prompts.confirm).mockResolvedValue(Symbol("cancel") as unknown as boolean);

      await expect(checkModifiedFilesBeforeSync("/target", ["claude"], {}, null)).rejects.toThrow(
        "process.exit called",
      );
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("shows (global block) label for agents type", async () => {
      vi.mocked(getModifiedManagedFiles).mockResolvedValue([
        {
          path: "AGENTS.md",
          type: "agents",
          isManaged: true,
          hasChanges: true,
        },
      ]);

      vi.mocked(prompts.confirm).mockResolvedValue(true);

      await checkModifiedFilesBeforeSync("/target", ["claude"], {}, null);
      // The "(global block)" label should appear for type "agents"
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("(global block)"));
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // promptMergeOrOverride
  // ───────────────────────────────────────────────────────────────────
  describe("promptMergeOrOverride", () => {
    it("returns override flag value when already synced", async () => {
      const status: SyncStatus = {
        hasSynced: true,
        lockfile: null,
        agentsMdExists: true,
        skillsExist: true,
        schemaWarning: null,
        schemaError: null,
      };

      const result = await promptMergeOrOverride(status, { override: true }, null);
      expect(result).toBe(true);
    });

    it("returns false (merge) when already synced and no override", async () => {
      const status: SyncStatus = {
        hasSynced: true,
        lockfile: null,
        agentsMdExists: true,
        skillsExist: true,
        schemaWarning: null,
        schemaError: null,
      };

      const result = await promptMergeOrOverride(status, {}, null);
      expect(result).toBe(false);
    });

    it("returns false (merge) when no existing AGENTS.md", async () => {
      const status: SyncStatus = {
        hasSynced: false,
        lockfile: null,
        agentsMdExists: false,
        skillsExist: false,
        schemaWarning: null,
        schemaError: null,
      };

      const result = await promptMergeOrOverride(status, {}, null);
      expect(result).toBe(false);
    });

    it("prompts user when AGENTS.md exists and not synced and not --yes", async () => {
      const status: SyncStatus = {
        hasSynced: false,
        lockfile: null,
        agentsMdExists: true,
        skillsExist: false,
        schemaWarning: null,
        schemaError: null,
      };

      vi.mocked(prompts.select).mockResolvedValue("merge");

      const result = await promptMergeOrOverride(status, {}, null);
      expect(result).toBe(false);
      expect(prompts.select).toHaveBeenCalled();
    });

    it("returns true when user selects override from prompt", async () => {
      const status: SyncStatus = {
        hasSynced: false,
        lockfile: null,
        agentsMdExists: true,
        skillsExist: false,
        schemaWarning: null,
        schemaError: null,
      };

      vi.mocked(prompts.select).mockResolvedValue("override");

      const result = await promptMergeOrOverride(status, {}, null);
      expect(result).toBe(true);
    });

    it("calls process.exit(0) when user cancels prompt", async () => {
      const status: SyncStatus = {
        hasSynced: false,
        lockfile: null,
        agentsMdExists: true,
        skillsExist: false,
        schemaWarning: null,
        schemaError: null,
      };

      vi.mocked(prompts.isCancel).mockReturnValue(true);
      vi.mocked(prompts.select).mockResolvedValue(Symbol("cancel") as unknown as string);

      await expect(promptMergeOrOverride(status, {}, null)).rejects.toThrow("process.exit called");
      expect(mockExit).toHaveBeenCalledWith(0);
    });

    it("cleans up temp dir when user cancels prompt", async () => {
      const status: SyncStatus = {
        hasSynced: false,
        lockfile: null,
        agentsMdExists: true,
        skillsExist: false,
        schemaWarning: null,
        schemaError: null,
      };

      vi.mocked(prompts.isCancel).mockReturnValue(true);
      vi.mocked(prompts.select).mockResolvedValue(Symbol("cancel") as unknown as string);

      await expect(promptMergeOrOverride(status, {}, "/tmp/should-cleanup")).rejects.toThrow(
        "process.exit called",
      );
      expect(removeTempDir).toHaveBeenCalledWith("/tmp/should-cleanup");
    });

    it("skips prompt when --yes is passed even with existing AGENTS.md", async () => {
      const status: SyncStatus = {
        hasSynced: false,
        lockfile: null,
        agentsMdExists: true,
        skillsExist: false,
        schemaWarning: null,
        schemaError: null,
      };

      const result = await promptMergeOrOverride(status, { yes: true }, null);
      expect(result).toBe(false);
      expect(prompts.select).not.toHaveBeenCalled();
    });

    it("skips prompt when --override is passed even with existing AGENTS.md", async () => {
      const status: SyncStatus = {
        hasSynced: false,
        lockfile: null,
        agentsMdExists: true,
        skillsExist: false,
        schemaWarning: null,
        schemaError: null,
      };

      const result = await promptMergeOrOverride(status, { override: true }, null);
      expect(result).toBe(true);
      expect(prompts.select).not.toHaveBeenCalled();
    });
  });
});
