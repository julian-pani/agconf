import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkCommand } from "../../src/commands/check.js";

// Mock process.cwd to return our test directory
const originalCwd = process.cwd;

describe("check command", () => {
  let tempDir: string;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // Create a temporary directory
    tempDir = path.join(process.cwd(), `.test-check-${Date.now()}`);
    await fs.mkdir(path.join(tempDir, ".agent-conf"), { recursive: true });
    await fs.mkdir(path.join(tempDir, ".claude", "skills", "test-skill"), { recursive: true });

    // Mock process.cwd
    process.cwd = () => tempDir;

    // Mock process.exit
    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);

    // Mock console.log
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    // Restore mocks
    process.cwd = originalCwd;
    mockExit.mockRestore();
    consoleLogSpy.mockRestore();

    // Clean up
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("when not synced", () => {
    it("should exit cleanly with message when no lockfile exists", async () => {
      await checkCommand({});

      // Should show "not synced" message
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Not synced"));

      // Should NOT call process.exit (exits cleanly)
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should exit silently in quiet mode when no lockfile exists", async () => {
      await checkCommand({ quiet: true });

      // Should not output anything
      expect(consoleLogSpy).not.toHaveBeenCalled();

      // Should NOT call process.exit
      expect(mockExit).not.toHaveBeenCalled();
    });
  });

  describe("when synced with no changes", () => {
    beforeEach(async () => {
      // Create a lockfile
      const lockfile = {
        version: "1",
        synced_at: new Date().toISOString(),
        source: { type: "local", path: "/some/path", ref: "abc123" },
        content: {
          agents_md: { global_block_hash: "sha256:abc123def456", merged: true },
          skills: ["test-skill"],
          targets: ["claude"],
        },
        cli_version: "1.0.0",
      };
      await fs.writeFile(
        path.join(tempDir, ".agent-conf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );

      // Create AGENTS.md without agent-conf markers (not managed)
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), "# AGENTS.md\n\nSome content");

      // Create a skill file without agent-conf metadata (not managed)
      const skillContent = `---
name: test-skill
description: A test skill
---

# Test Skill
`;
      await fs.writeFile(
        path.join(tempDir, ".claude", "skills", "test-skill", "SKILL.md"),
        skillContent,
      );
    });

    it("should report all files unchanged", async () => {
      await checkCommand({});

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("All managed files are unchanged"),
      );
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should exit with code 0 in quiet mode", async () => {
      await checkCommand({ quiet: true });

      expect(mockExit).not.toHaveBeenCalled();
    });
  });

  describe("when synced with modified skill file", () => {
    beforeEach(async () => {
      // Create a lockfile
      const lockfile = {
        version: "1",
        synced_at: new Date().toISOString(),
        source: { type: "local", path: "/some/path", ref: "abc123" },
        content: {
          agents_md: { global_block_hash: "sha256:abc123def456", merged: true },
          skills: ["test-skill"],
          targets: ["claude"],
        },
        cli_version: "1.0.0",
      };
      await fs.writeFile(
        path.join(tempDir, ".agent-conf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );

      // Create AGENTS.md without agent-conf markers
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), "# AGENTS.md\n\nSome content");

      // Create a managed skill file with a hash that won't match
      const skillContent = `---
name: test-skill
description: A test skill
metadata:
  agent_conf_managed: "true"
  agent_conf_content_hash: "sha256:originalHash"
---

# Test Skill - MODIFIED
`;
      await fs.writeFile(
        path.join(tempDir, ".claude", "skills", "test-skill", "SKILL.md"),
        skillContent,
      );
    });

    it("should detect modified skill file", async () => {
      await expect(checkCommand({})).rejects.toThrow("process.exit called");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("have been modified"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should exit with code 1 in quiet mode", async () => {
      await expect(checkCommand({ quiet: true })).rejects.toThrow("process.exit called");

      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe("when synced with modified AGENTS.md global block", () => {
    beforeEach(async () => {
      // Create a lockfile
      const lockfile = {
        version: "1",
        synced_at: new Date().toISOString(),
        source: { type: "local", path: "/some/path", ref: "abc123" },
        content: {
          agents_md: { global_block_hash: "sha256:abc123def456", merged: true },
          skills: [],
          targets: ["claude"],
        },
        cli_version: "1.0.0",
      };
      await fs.writeFile(
        path.join(tempDir, ".agent-conf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );

      // Create AGENTS.md with modified global block (hash won't match)
      const agentsMd = `<!-- agent-conf:global:start -->
<!-- DO NOT EDIT THIS SECTION - Managed by agent-conf CLI -->
<!-- Source: local:/some/path@abc123 -->
<!-- Last synced: 2024-01-01T00:00:00.000Z -->
<!-- Content hash: sha256:originalHash -->

# Original content that has been MODIFIED

<!-- agent-conf:global:end -->

<!-- agent-conf:repo:start -->
<!-- Repository-specific instructions below -->

# Repo content

<!-- agent-conf:repo:end -->
`;
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), agentsMd);
    });

    it("should detect modified AGENTS.md global block", async () => {
      await expect(checkCommand({})).rejects.toThrow("process.exit called");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("have been modified"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should show hash details", async () => {
      await expect(checkCommand({})).rejects.toThrow("process.exit called");

      // Should show both expected and current hashes
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Expected hash:"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Current hash:"));
    });
  });
});
