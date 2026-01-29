import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getGitConfig,
  getGitOrganization,
  getGitProjectName,
  getGitRoot,
  isGitRoot,
} from "../../src/utils/git.js";

describe("git utilities", () => {
  let tempDir: string;
  let realTempDir: string; // Resolved path (handles macOS /var -> /private/var symlink)

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-conf-git-test-"));
    realTempDir = await fs.realpath(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("getGitRoot", () => {
    it("should return null for non-existent directory", async () => {
      const result = await getGitRoot("/non/existent/path");
      expect(result).toBeNull();
    });

    it("should return null for non-git directory", async () => {
      const result = await getGitRoot(tempDir);
      expect(result).toBeNull();
    });

    it("should return git root for git repository", async () => {
      const git = simpleGit(tempDir);
      await git.init();

      const result = await getGitRoot(tempDir);
      expect(result).toBe(realTempDir);
    });

    it("should return git root from subdirectory", async () => {
      const git = simpleGit(tempDir);
      await git.init();

      const subDir = path.join(tempDir, "sub", "dir");
      await fs.mkdir(subDir, { recursive: true });

      const result = await getGitRoot(subDir);
      expect(result).toBe(realTempDir);
    });
  });

  describe("getGitProjectName", () => {
    it("should return null for non-existent directory", async () => {
      const result = await getGitProjectName("/non/existent/path");
      expect(result).toBeNull();
    });

    it("should return null for non-git directory", async () => {
      const result = await getGitProjectName(tempDir);
      expect(result).toBeNull();
    });

    it("should return directory name for git repository", async () => {
      const git = simpleGit(tempDir);
      await git.init();

      const result = await getGitProjectName(tempDir);
      expect(result).toBe(path.basename(tempDir));
    });

    it("should return root directory name from subdirectory", async () => {
      const git = simpleGit(tempDir);
      await git.init();

      const subDir = path.join(tempDir, "sub", "dir");
      await fs.mkdir(subDir, { recursive: true });

      const result = await getGitProjectName(subDir);
      expect(result).toBe(path.basename(tempDir));
    });
  });

  describe("isGitRoot", () => {
    it("should return false for non-existent directory", async () => {
      const result = await isGitRoot("/non/existent/path");
      expect(result).toBe(false);
    });

    it("should return false for non-git directory", async () => {
      const result = await isGitRoot(tempDir);
      expect(result).toBe(false);
    });

    it("should return true for git root directory", async () => {
      const git = simpleGit(tempDir);
      await git.init();

      const result = await isGitRoot(tempDir);
      expect(result).toBe(true);
    });

    it("should return false for subdirectory of git repo", async () => {
      const git = simpleGit(tempDir);
      await git.init();

      const subDir = path.join(tempDir, "sub", "dir");
      await fs.mkdir(subDir, { recursive: true });

      const result = await isGitRoot(subDir);
      expect(result).toBe(false);
    });
  });

  describe("getGitConfig", () => {
    it("should return undefined for non-existent directory", async () => {
      const result = await getGitConfig("/non/existent/path", "user.name");
      expect(result).toBeUndefined();
    });

    it("should return undefined for non-git directory", async () => {
      const result = await getGitConfig(tempDir, "user.name");
      expect(result).toBeUndefined();
    });

    it("should return config value when set", async () => {
      const git = simpleGit(tempDir);
      await git.init();
      await git.addConfig("user.name", "Test User", false, "local");

      const result = await getGitConfig(tempDir, "user.name");
      expect(result).toBe("Test User");
    });

    it("should return undefined for unset config", async () => {
      const git = simpleGit(tempDir);
      await git.init();

      const result = await getGitConfig(tempDir, "some.nonexistent.key");
      expect(result).toBeUndefined();
    });
  });

  describe("getGitOrganization", () => {
    it("should return undefined for non-existent directory", async () => {
      const result = await getGitOrganization("/non/existent/path");
      expect(result).toBeUndefined();
    });

    it("should return undefined for non-git directory", async () => {
      const result = await getGitOrganization(tempDir);
      expect(result).toBeUndefined();
    });

    it("should extract org from HTTPS GitHub remote", async () => {
      const git = simpleGit(tempDir);
      await git.init();
      await git.addRemote("origin", "https://github.com/acme-corp/my-repo.git");

      const result = await getGitOrganization(tempDir);
      expect(result).toBe("acme-corp");
    });

    it("should extract org from SSH GitHub remote", async () => {
      const git = simpleGit(tempDir);
      await git.init();
      await git.addRemote("origin", "git@github.com:test-org/test-repo.git");

      const result = await getGitOrganization(tempDir);
      expect(result).toBe("test-org");
    });

    it("should fall back to user.name when no GitHub remote", async () => {
      const git = simpleGit(tempDir);
      await git.init();
      await git.addConfig("user.name", "Fallback User", false, "local");

      const result = await getGitOrganization(tempDir);
      expect(result).toBe("Fallback User");
    });

    it("should prefer GitHub remote org over user.name", async () => {
      const git = simpleGit(tempDir);
      await git.init();
      await git.addRemote("origin", "https://github.com/preferred-org/repo.git");
      await git.addConfig("user.name", "Ignored User", false, "local");

      const result = await getGitOrganization(tempDir);
      expect(result).toBe("preferred-org");
    });

    it("should return undefined when no remote and no user.name", async () => {
      const git = simpleGit(tempDir);
      await git.init();

      const result = await getGitOrganization(tempDir);
      expect(result).toBeUndefined();
    });
  });
});
