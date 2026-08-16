import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getGitHooksDir,
  getGitOrganization,
  getGitProjectName,
  getGitRoot,
  isGitRoot,
  redactGitCredentials,
} from "../../src/utils/git.js";

describe("git utilities", () => {
  let tempDir: string;
  let realTempDir: string; // Resolved path (handles macOS /var -> /private/var symlink)

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-git-test-"));
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

  describe("getGitHooksDir", () => {
    it("should return null for non-existent directory", async () => {
      const result = await getGitHooksDir("/non/existent/path");
      expect(result).toBeNull();
    });

    it("should return null for non-git directory", async () => {
      const result = await getGitHooksDir(tempDir);
      expect(result).toBeNull();
    });

    it("should return .git/hooks for a normal repo", async () => {
      const git = simpleGit(tempDir);
      await git.init();

      const result = await getGitHooksDir(tempDir);
      expect(result).not.toBeNull();
      // Compare via realpath to absorb macOS /var -> /private/var symlinks.
      expect(await fs.realpath(result as string)).toBe(path.join(realTempDir, ".git", "hooks"));
    });

    it("should resolve the shared hooks dir inside a linked worktree", async () => {
      const git = simpleGit(tempDir);
      await git.init();
      await git.addConfig("user.email", "test@example.com", false, "local");
      await git.addConfig("user.name", "Test", false, "local");
      // A worktree can only be added once the repo has a commit.
      await fs.writeFile(path.join(tempDir, "README.md"), "hello\n");
      await git.add("README.md");
      await git.commit("initial");

      const worktreeDir = path.join(tempDir, "wt");
      await git.raw(["worktree", "add", "-b", "feature", worktreeDir]);

      // Inside the worktree, `.git` is a file, not a directory.
      const dotGit = await fs.stat(path.join(worktreeDir, ".git"));
      expect(dotGit.isFile()).toBe(true);

      // Hooks are shared: the worktree resolves to the main repo's hooks dir.
      const result = await getGitHooksDir(worktreeDir);
      expect(result).not.toBeNull();
      expect(await fs.realpath(result as string)).toBe(path.join(realTempDir, ".git", "hooks"));
    });
  });

  describe("redactGitCredentials", () => {
    it("redacts an embedded x-access-token from a clone URL", () => {
      const token = "ghp_supersecrettokenvalue1234567890";
      const message = `fatal: Authentication failed for 'https://x-access-token:${token}@github.com/acme/repo.git/'`;

      const result = redactGitCredentials(message);

      expect(result).not.toContain(token);
      expect(result).not.toContain("x-access-token");
      expect(result).toBe(
        "fatal: Authentication failed for 'https://***@github.com/acme/repo.git/'",
      );
    });

    it("redacts a user:password style credential", () => {
      const result = redactGitCredentials(
        "clone https://alice:hunter2@example.com/repo.git failed",
      );
      expect(result).toBe("clone https://***@example.com/repo.git failed");
      expect(result).not.toContain("hunter2");
    });

    it("redacts a bare token with no colon", () => {
      const result = redactGitCredentials("https://ghp_abc123@github.com/org/repo.git");
      expect(result).toBe("https://***@github.com/org/repo.git");
      expect(result).not.toContain("ghp_abc123");
    });

    it("redacts every occurrence when multiple URLs are present", () => {
      const message =
        "https://x-access-token:tok1@github.com/a/b.git and https://x-access-token:tok2@github.com/c/d.git";

      const result = redactGitCredentials(message);

      expect(result).not.toContain("tok1");
      expect(result).not.toContain("tok2");
      expect(result).toBe("https://***@github.com/a/b.git and https://***@github.com/c/d.git");
    });

    it("leaves URLs without credentials untouched", () => {
      const message = "fatal: repository 'https://github.com/org/repo.git' not found";
      expect(redactGitCredentials(message)).toBe(message);
    });

    it("does not alter '//' occurrences that are not credentials", () => {
      const message = "see https://github.com/org/repo/blob/main/file.ts for details";
      expect(redactGitCredentials(message)).toBe(message);
    });

    it("returns non-URL text unchanged", () => {
      expect(redactGitCredentials("some unrelated error message")).toBe(
        "some unrelated error message",
      );
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

    it("should fallback to global user.name when no remote and no local user.name", async () => {
      const git = simpleGit(tempDir);
      await git.init();

      const result = await getGitOrganization(tempDir);
      // Result will be the global user.name if configured, or undefined if not
      const globalUserName = await git.getConfig("user.name", "global");
      expect(result).toBe(globalUserName.value ?? undefined);
    });
  });
});
