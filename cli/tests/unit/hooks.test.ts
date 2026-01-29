import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installPreCommitHook, isPreCommitHookInstalled } from "../../src/core/hooks.js";

describe("hooks", () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory with .git/hooks structure
    tempDir = path.join(process.cwd(), `.test-hooks-${Date.now()}`);
    await fs.mkdir(path.join(tempDir, ".git", "hooks"), { recursive: true });
  });

  afterEach(async () => {
    // Clean up
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("installPreCommitHook", () => {
    it("should install the pre-commit hook in a fresh repo", async () => {
      const result = await installPreCommitHook(tempDir);

      expect(result.installed).toBe(true);
      expect(result.alreadyExisted).toBe(false);
      expect(result.wasUpdated).toBe(false);

      // Verify the file exists
      const hookPath = path.join(tempDir, ".git", "hooks", "pre-commit");
      const content = await fs.readFile(hookPath, "utf-8");
      expect(content).toContain("# agent-conf pre-commit hook");
    });

    it("should not overwrite a custom pre-commit hook", async () => {
      const hookPath = path.join(tempDir, ".git", "hooks", "pre-commit");
      const customContent = "#!/bin/bash\n# Custom hook\necho 'Running custom hook'";
      await fs.writeFile(hookPath, customContent);

      const result = await installPreCommitHook(tempDir);

      expect(result.installed).toBe(false);
      expect(result.alreadyExisted).toBe(true);
      expect(result.wasUpdated).toBe(false);

      // Verify custom hook was preserved
      const content = await fs.readFile(hookPath, "utf-8");
      expect(content).toBe(customContent);
    });

    it("should update an outdated agent-conf hook", async () => {
      const hookPath = path.join(tempDir, ".git", "hooks", "pre-commit");
      const outdatedContent = "#!/bin/bash\n# agent-conf pre-commit hook\n# Old version";
      await fs.writeFile(hookPath, outdatedContent);

      const result = await installPreCommitHook(tempDir);

      expect(result.installed).toBe(true);
      expect(result.alreadyExisted).toBe(true);
      expect(result.wasUpdated).toBe(true);

      // Verify hook was updated
      const content = await fs.readFile(hookPath, "utf-8");
      expect(content).not.toBe(outdatedContent);
      expect(content).toContain("# agent-conf pre-commit hook");
    });

    it("should report unchanged for up-to-date agent-conf hook", async () => {
      // First install
      await installPreCommitHook(tempDir);

      // Second install should report unchanged
      const result = await installPreCommitHook(tempDir);

      expect(result.installed).toBe(true);
      expect(result.alreadyExisted).toBe(true);
      expect(result.wasUpdated).toBe(false);
    });
  });

  describe("isPreCommitHookInstalled", () => {
    it("should return false when no hook exists", async () => {
      const result = await isPreCommitHookInstalled(tempDir);
      expect(result).toBe(false);
    });

    it("should return true when agent-conf hook is installed", async () => {
      await installPreCommitHook(tempDir);
      const result = await isPreCommitHookInstalled(tempDir);
      expect(result).toBe(true);
    });

    it("should return false when a custom hook exists", async () => {
      const hookPath = path.join(tempDir, ".git", "hooks", "pre-commit");
      await fs.writeFile(hookPath, "#!/bin/bash\necho 'Custom hook'");

      const result = await isPreCommitHookInstalled(tempDir);
      expect(result).toBe(false);
    });
  });
});
