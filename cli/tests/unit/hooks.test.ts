import * as fs from "node:fs/promises";
import * as path from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  generateHookSection,
  generatePreCommitHook,
  getHookConfig,
  installPreCommitHook,
} from "../../src/core/hooks.js";

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
      expect(result.wasAppended).toBe(false);

      // Verify the file exists and contains markers
      const hookPath = path.join(tempDir, ".git", "hooks", "pre-commit");
      const content = await fs.readFile(hookPath, "utf-8");
      expect(content).toContain("# agconf pre-commit hook");
      expect(content).toContain("# agconf:hook:start");
      expect(content).toContain("# agconf:hook:end");
    });

    it("should append to a custom pre-commit hook", async () => {
      const hookPath = path.join(tempDir, ".git", "hooks", "pre-commit");
      const customContent = "#!/bin/bash\n# Custom hook\necho 'Running custom hook'\n";
      await fs.writeFile(hookPath, customContent);

      const result = await installPreCommitHook(tempDir);

      expect(result.installed).toBe(true);
      expect(result.alreadyExisted).toBe(true);
      expect(result.wasUpdated).toBe(false);
      expect(result.wasAppended).toBe(true);

      // Verify custom content is preserved and markers are present
      const content = await fs.readFile(hookPath, "utf-8");
      expect(content).toContain("echo 'Running custom hook'");
      expect(content).toContain("# agconf:hook:start");
      expect(content).toContain("# agconf:hook:end");
      expect(content).toContain("_agconf_check");
    });

    it("should update an outdated agconf hook (legacy, no markers)", async () => {
      const hookPath = path.join(tempDir, ".git", "hooks", "pre-commit");
      const outdatedContent = "#!/bin/bash\n# agconf pre-commit hook\n# Old version";
      await fs.writeFile(hookPath, outdatedContent);

      const result = await installPreCommitHook(tempDir);

      expect(result.installed).toBe(true);
      expect(result.alreadyExisted).toBe(true);
      expect(result.wasUpdated).toBe(true);
      expect(result.wasAppended).toBe(false);

      // Verify hook was replaced with new format including markers
      const content = await fs.readFile(hookPath, "utf-8");
      expect(content).not.toBe(outdatedContent);
      expect(content).toContain("# agconf pre-commit hook");
      expect(content).toContain("# agconf:hook:start");
      expect(content).toContain("# agconf:hook:end");
    });

    it("should report unchanged for up-to-date agconf hook", async () => {
      // First install
      await installPreCommitHook(tempDir);

      // Second install should report unchanged
      const result = await installPreCommitHook(tempDir);

      expect(result.installed).toBe(true);
      expect(result.alreadyExisted).toBe(true);
      expect(result.wasUpdated).toBe(false);
      // wasAppended is true because the hook contains markers (even standalone hooks do)
      expect(result.wasAppended).toBe(true);
    });

    it("should update an appended section when outdated", async () => {
      const hookPath = path.join(tempDir, ".git", "hooks", "pre-commit");
      const customContent = "#!/bin/bash\necho 'lint'\n";

      // Write custom hook with an outdated agconf section
      const outdatedSection = [
        "# agconf:hook:start",
        "# agconf pre-commit hook - DO NOT EDIT THIS SECTION",
        "# outdated content here",
        "# agconf:hook:end",
      ].join("\n");
      await fs.writeFile(hookPath, `${customContent}\n${outdatedSection}\n`);

      const result = await installPreCommitHook(tempDir);

      expect(result.installed).toBe(true);
      expect(result.alreadyExisted).toBe(true);
      expect(result.wasUpdated).toBe(true);
      expect(result.wasAppended).toBe(true);

      // Verify custom content is still there and section was updated
      const content = await fs.readFile(hookPath, "utf-8");
      expect(content).toContain("echo 'lint'");
      expect(content).toContain("_agconf_check");
      expect(content).not.toContain("# outdated content here");
    });

    it("should no-op when appended section is already current", async () => {
      const hookPath = path.join(tempDir, ".git", "hooks", "pre-commit");
      const customContent = "#!/bin/bash\necho 'lint'\n";

      // First: write custom hook, then install to append
      await fs.writeFile(hookPath, customContent);
      await installPreCommitHook(tempDir);

      // Second: re-install — should be a no-op
      const result = await installPreCommitHook(tempDir);

      expect(result.installed).toBe(true);
      expect(result.alreadyExisted).toBe(true);
      expect(result.wasUpdated).toBe(false);
      expect(result.wasAppended).toBe(true);
    });

    it("should preserve content before and after the agconf section", async () => {
      const hookPath = path.join(tempDir, ".git", "hooks", "pre-commit");
      const before = "#!/bin/bash\necho 'before'\n";
      const after = "\necho 'after'\n";

      // Write custom hook, install to append, then add content after
      await fs.writeFile(hookPath, before);
      await installPreCommitHook(tempDir);

      // Read current content and append trailing content
      const currentContent = await fs.readFile(hookPath, "utf-8");
      await fs.writeFile(hookPath, currentContent + after);

      // Now make the agconf section "outdated" by tweaking it
      const tweakedContent = (await fs.readFile(hookPath, "utf-8")).replace(
        "_agconf_check() {",
        "_agconf_check_old() {",
      );
      await fs.writeFile(hookPath, tweakedContent);

      // Re-install — should update only the section
      const result = await installPreCommitHook(tempDir);

      expect(result.installed).toBe(true);
      expect(result.wasUpdated).toBe(true);
      expect(result.wasAppended).toBe(true);

      const finalContent = await fs.readFile(hookPath, "utf-8");
      expect(finalContent).toContain("echo 'before'");
      expect(finalContent).toContain("echo 'after'");
      expect(finalContent).toContain("_agconf_check");
      expect(finalContent).not.toContain("_agconf_check_old");
    });

    it("should migrate a legacy agconf hook to the new format", async () => {
      const hookPath = path.join(tempDir, ".git", "hooks", "pre-commit");
      // Simulate an old-format agconf hook (has identifier but no markers)
      const legacyContent = [
        "#!/bin/bash",
        "# agconf pre-commit hook",
        "set -e",
        "REPO_ROOT=$(git rev-parse --show-toplevel)",
        'if [ ! -f "$REPO_ROOT/.agconf/lockfile.json" ]; then exit 0; fi',
        "exit 0",
      ].join("\n");
      await fs.writeFile(hookPath, legacyContent);

      const result = await installPreCommitHook(tempDir);

      expect(result.installed).toBe(true);
      expect(result.wasUpdated).toBe(true);
      expect(result.wasAppended).toBe(false);

      const content = await fs.readFile(hookPath, "utf-8");
      expect(content).toContain("# agconf:hook:start");
      expect(content).toContain("# agconf:hook:end");
      expect(content).toContain("_agconf_check");
      // Legacy content should be replaced entirely
      expect(content).not.toContain("set -e");
    });

    it("should install into the shared hooks dir from a linked worktree", async () => {
      // A real git repo + worktree: inside a worktree `.git` is a file, so a
      // naive `mkdir .git/hooks` would throw ENOTDIR. The hook must land in
      // the main repo's shared hooks dir instead.
      const git = simpleGit(tempDir);
      await git.init();
      await git.addConfig("user.email", "test@example.com", false, "local");
      await git.addConfig("user.name", "Test", false, "local");
      await fs.writeFile(path.join(tempDir, "README.md"), "hello\n");
      await git.add("README.md");
      await git.commit("initial");

      const worktreeDir = path.join(tempDir, "wt");
      await git.raw(["worktree", "add", "-b", "feature", worktreeDir]);

      const result = await installPreCommitHook(worktreeDir);
      expect(result.installed).toBe(true);

      // The hook is written to the shared (main) hooks dir, not <wt>/.git/hooks.
      const sharedHook = path.join(tempDir, ".git", "hooks", "pre-commit");
      const content = await fs.readFile(sharedHook, "utf-8");
      expect(content).toContain("# agconf:hook:start");
      // Compare via realpath in case git canonicalized the worktree pointer.
      expect(await fs.realpath(result.path)).toBe(await fs.realpath(sharedHook));
    });
  });

  describe("generateHookSection", () => {
    it("should produce valid marker-wrapped content", () => {
      const config = getHookConfig();
      const section = generateHookSection(config);

      expect(section).toMatch(/^# agconf:hook:start\n/);
      expect(section).toMatch(/\n# agconf:hook:end$/);
      expect(section).toContain("_agconf_check() {");
      expect(section).toContain("_agconf_check || exit 1");
      expect(section).toContain("# agconf pre-commit hook");
    });

    it("should use custom config values", () => {
      const section = generateHookSection({
        cliName: "myagent",
        configDir: ".myagent",
        lockfileName: "lock.json",
      });

      expect(section).toContain("myagent check");
      expect(section).toContain(".myagent/lock.json");
      expect(section).toContain("command -v myagent");
    });

    it("should include branch detection for different behavior on feature vs protected branches", () => {
      const config = getHookConfig();
      const section = generateHookSection(config);

      // Should detect current branch
      expect(section).toContain("git symbolic-ref --short HEAD");
      // Should differentiate master/main from other branches
      expect(section).toContain("master|main");
      // On protected branches: block with error
      expect(section).toContain("return 1");
      // On feature branches: warn but don't block
      expect(section).toContain("Warning: committing changes to");
      expect(section).toContain("propose these changes upstream");
    });

    it("should block commits on protected branches with full error", () => {
      const config = getHookConfig();
      const section = generateHookSection(config);

      // Error message on master/main should have all options
      expect(section).toContain("Error: Cannot commit changes to");
      expect(section).toContain("Discard your changes");
      expect(section).toContain("Skip this check");
      expect(section).toContain("Restore managed files");
      expect(section).toContain("Propose changes upstream");
    });

    it("should mention propose command in both warning and error paths", () => {
      const config = getHookConfig();
      const section = generateHookSection(config);

      // propose should appear in both the error (protected) and warning (feature) paths
      const proposeMatches = section.match(/agconf propose/g);
      expect(proposeMatches).not.toBeNull();
      expect(proposeMatches!.length).toBe(2);
    });

    it("should use custom CLI name in propose suggestion", () => {
      const section = generateHookSection({
        cliName: "myagent",
        configDir: ".myagent",
        lockfileName: "lock.json",
      });

      expect(section).toContain("myagent propose");
    });
  });

  describe("generatePreCommitHook", () => {
    it("should produce a full hook with shebang and exit 0", () => {
      const config = getHookConfig();
      const hook = generatePreCommitHook(config);

      expect(hook).toMatch(/^#!\/bin\/bash\n/);
      expect(hook).toMatch(/\nexit 0\n$/);
      expect(hook).toContain("# agconf:hook:start");
      expect(hook).toContain("# agconf:hook:end");
    });
  });
});
