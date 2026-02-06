import * as fs from "node:fs/promises";
import * as path from "node:path";
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
