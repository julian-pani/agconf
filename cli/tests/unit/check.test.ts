import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringify as stringifyYaml } from "yaml";
import { checkCommand } from "../../src/commands/check.js";
import { compileCommand } from "../../src/commands/compile.js";
import { addManagedMetadata } from "../../src/core/managed-content.js";

describe("check command", () => {
  let tempDir: string;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // Create a temporary directory
    tempDir = path.join(process.cwd(), `.test-check-${Date.now()}`);
    await fs.mkdir(path.join(tempDir, ".agconf"), { recursive: true });
    await fs.mkdir(path.join(tempDir, ".claude", "skills", "test-skill"), { recursive: true });

    // Mock process.exit
    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);

    // Mock console.log
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    // Restore mocks
    mockExit.mockRestore();
    consoleLogSpy.mockRestore();

    // Clean up
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("when not synced", () => {
    it("should exit cleanly with message when no lockfile exists", async () => {
      await checkCommand({ cwd: tempDir });

      // Should show "not synced" message
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Not synced"));

      // Should NOT call process.exit (exits cleanly)
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should exit silently in quiet mode when no lockfile exists", async () => {
      await checkCommand({ quiet: true, cwd: tempDir });

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
        version: "1.0.0",
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
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );

      // Create managed AGENTS.md with markers and matching hash
      const globalContent = "# Global Standards\n\nSome content";
      // Compute the hash the same way the code does
      const { createHash } = await import("node:crypto");
      const hash = createHash("sha256").update(globalContent.trim()).digest("hex");
      const contentHash = `sha256:${hash.slice(0, 12)}`;

      const agentsMd = `<!-- agconf:global:start -->
<!-- DO NOT EDIT THIS SECTION - Managed by agconf -->
<!-- Content hash: ${contentHash} -->

${globalContent}

<!-- agconf:global:end -->

<!-- agconf:repo:start -->
<!-- Repository-specific instructions below -->

# Repo content

<!-- agconf:repo:end -->
`;
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), agentsMd);

      // Create a skill file without managed metadata (not managed, but that's ok)
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
      await checkCommand({ cwd: tempDir });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("All managed files are unchanged"),
      );
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should exit with code 0 in quiet mode", async () => {
      await checkCommand({ quiet: true, cwd: tempDir });

      expect(mockExit).not.toHaveBeenCalled();
    });
  });

  describe("when skills are delivered by plugin (delivery: plugin)", () => {
    beforeEach(async () => {
      // No skills on disk and none tracked — they ship via an installed plugin.
      await fs.rm(path.join(tempDir, ".claude", "skills"), { recursive: true, force: true });

      const globalContent = "# Global Standards\n\nSome content";
      const { createHash } = await import("node:crypto");
      const hash = createHash("sha256").update(globalContent.trim()).digest("hex");
      const contentHash = `sha256:${hash.slice(0, 12)}`;

      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local", path: "/some/path", ref: "abc123" },
        content: {
          agents_md: { global_block_hash: contentHash, merged: true },
          skills: [],
          targets: ["claude"],
        },
        cli_version: "1.0.0",
      };
      await fs.writeFile(
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );

      const agentsMd = `<!-- agconf:global:start -->
<!-- DO NOT EDIT THIS SECTION - Managed by agconf -->
<!-- Content hash: ${contentHash} -->

${globalContent}

<!-- agconf:global:end -->

<!-- agconf:repo:start -->
<!-- Repository-specific instructions below -->

# Repo content

<!-- agconf:repo:end -->
`;
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), agentsMd);
    });

    it("passes with no 'missing' or 'ghost' skills when none are synced", async () => {
      await checkCommand({ cwd: tempDir });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("All managed files are unchanged"),
      );
      expect(mockExit).not.toHaveBeenCalled();
    });
  });

  describe("when synced with modified skill file", () => {
    beforeEach(async () => {
      // Create a lockfile
      const lockfile = {
        version: "1.0.0",
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
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );

      // Create AGENTS.md without agconf markers
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), "# AGENTS.md\n\nSome content");

      // Create a managed skill file with a hash that won't match
      const skillContent = `---
name: test-skill
description: A test skill
metadata:
  agconf_managed: "true"
  agconf_content_hash: "sha256:originalHash"
---

# Test Skill - MODIFIED
`;
      await fs.writeFile(
        path.join(tempDir, ".claude", "skills", "test-skill", "SKILL.md"),
        skillContent,
      );
    });

    it("should detect modified skill file", async () => {
      await expect(checkCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("have been modified"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should show propose hint when modifications detected", async () => {
      await expect(checkCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("agconf propose"));
    });

    it("should exit with code 1 in quiet mode", async () => {
      await expect(checkCommand({ quiet: true, cwd: tempDir })).rejects.toThrow(
        "process.exit called",
      );

      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe("when synced with modified AGENTS.md global block", () => {
    beforeEach(async () => {
      // Create a lockfile
      const lockfile = {
        version: "1.0.0",
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
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );

      // Create AGENTS.md with modified global block (hash won't match)
      const agentsMd = `<!-- agconf:global:start -->
<!-- DO NOT EDIT THIS SECTION - Managed by agconf -->
<!-- Source: local:/some/path@abc123 -->
<!-- Last synced: 2024-01-01T00:00:00.000Z -->
<!-- Content hash: sha256:originalHash -->

# Original content that has been MODIFIED

<!-- agconf:global:end -->

<!-- agconf:repo:start -->
<!-- Repository-specific instructions below -->

# Repo content

<!-- agconf:repo:end -->
`;
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), agentsMd);
    });

    it("should detect modified AGENTS.md global block", async () => {
      await expect(checkCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("have been modified"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should show hash details", async () => {
      await expect(checkCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");

      // Should show both expected and current hashes
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Expected hash:"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Current hash:"));
    });
  });

  describe("with custom marker prefix", () => {
    const CUSTOM_PREFIX = "fbagents";

    beforeEach(async () => {
      // Create a lockfile with custom marker prefix
      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local", path: "/some/path", ref: "abc123" },
        content: {
          agents_md: { global_block_hash: "sha256:abc123def456", merged: true },
          skills: ["test-skill"],
          targets: ["claude"],
          marker_prefix: CUSTOM_PREFIX,
        },
        cli_version: "1.0.0",
      };
      await fs.writeFile(
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );
    });

    it("should detect modified AGENTS.md with custom prefix markers", async () => {
      // Create AGENTS.md with custom prefix and modified content
      const agentsMd = `<!-- ${CUSTOM_PREFIX}:global:start -->
<!-- DO NOT EDIT THIS SECTION - Managed by agconf -->
<!-- Content hash: sha256:originalHash -->

# Original content that has been MODIFIED

<!-- ${CUSTOM_PREFIX}:global:end -->

<!-- ${CUSTOM_PREFIX}:repo:start -->
<!-- Repository-specific instructions below -->

# Repo content

<!-- ${CUSTOM_PREFIX}:repo:end -->
`;
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), agentsMd);

      // Create unmanaged skill file
      await fs.writeFile(
        path.join(tempDir, ".claude", "skills", "test-skill", "SKILL.md"),
        `---
name: test-skill
description: A test skill
---

# Test Skill
`,
      );

      await expect(checkCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("have been modified"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should detect modified skill with custom prefix metadata", async () => {
      // Create unmanaged AGENTS.md
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), "# AGENTS.md\n\nSome content");

      // Create skill with custom prefix metadata that's been modified
      const skillContent = `---
name: test-skill
description: A test skill
metadata:
  ${CUSTOM_PREFIX.replace(/-/g, "_")}_managed: "true"
  ${CUSTOM_PREFIX.replace(/-/g, "_")}_content_hash: "sha256:originalHash"
---

# Test Skill - MODIFIED
`;
      await fs.writeFile(
        path.join(tempDir, ".claude", "skills", "test-skill", "SKILL.md"),
        skillContent,
      );

      await expect(checkCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("have been modified"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should fail when no managed files found with custom prefix", async () => {
      // Create AGENTS.md with DEFAULT prefix markers (not custom)
      const agentsMd = `<!-- agconf:global:start -->
<!-- DO NOT EDIT THIS SECTION - Managed by agconf -->
<!-- Content hash: sha256:originalHash -->

# Original content

<!-- agconf:global:end -->

<!-- agconf:repo:start -->
<!-- Repository-specific instructions below -->

# Repo content

<!-- agconf:repo:end -->
`;
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), agentsMd);

      // Create skill with default prefix (should not be detected as managed with custom prefix)
      const skillContent = `---
name: test-skill
description: A test skill
metadata:
  agconf_managed: "true"
  agconf_content_hash: "sha256:originalHash"
---

# Test Skill
`;
      await fs.writeFile(
        path.join(tempDir, ".claude", "skills", "test-skill", "SKILL.md"),
        skillContent,
      );

      // Should fail because no files are managed with the custom prefix
      await expect(checkCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("No managed files found"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe("when synced but no managed files found", () => {
    beforeEach(async () => {
      // Create a lockfile (indicates repo was synced)
      const lockfile = {
        version: "1.0.0",
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
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );

      // Create AGENTS.md WITHOUT markers (not managed)
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), "# AGENTS.md\n\nSome content");

      // Create skill WITHOUT managed metadata
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

    it("should fail with error when no managed files found", async () => {
      await expect(checkCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("No managed files found"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should exit with code 1 in quiet mode", async () => {
      await expect(checkCommand({ quiet: true, cwd: tempDir })).rejects.toThrow(
        "process.exit called",
      );

      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe("codex rules section in AGENTS.md", () => {
    it("should detect modified rules section in AGENTS.md for codex target", async () => {
      // For Codex target, rules are concatenated into AGENTS.md between
      // <!-- agconf:rules:start --> and <!-- agconf:rules:end --> markers
      // The check command should detect if this section has been manually modified

      const { createHash } = await import("node:crypto");

      // Create lockfile with codex target and rules
      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local", path: "/some/path", ref: "abc123" },
        content: {
          agents_md: { global_block_hash: "sha256:abc123def456", merged: true },
          skills: [],
          rules: { files: ["security/auth.md"], content_hash: "sha256:originalHash" },
          targets: ["codex"],
        },
        cli_version: "1.0.0",
      };
      await fs.writeFile(
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );

      // Create AGENTS.md with rules section that has been MODIFIED
      // The stored hash won't match the actual content
      const globalContent = "# Global Standards";
      const globalHash = createHash("sha256").update(globalContent.trim()).digest("hex");

      const agentsMd = `<!-- agconf:global:start -->
<!-- DO NOT EDIT THIS SECTION - Managed by agconf -->
<!-- Content hash: sha256:${globalHash.slice(0, 12)} -->

${globalContent}

<!-- agconf:global:end -->

<!-- agconf:rules:start -->
<!-- DO NOT EDIT THIS SECTION - Managed by agconf
<!-- Content hash: sha256:originalRulesHash -->
<!-- Rule count: 1 -->

# Project Rules

<!-- Rule: security/auth.md -->
## Authentication - THIS HAS BEEN MODIFIED BY USER

Always validate tokens.

<!-- agconf:rules:end -->

<!-- agconf:repo:start -->
<!-- Repository-specific instructions below -->

# Repo content

<!-- agconf:repo:end -->
`;
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), agentsMd);

      // Check should fail because the rules section hash doesn't match
      await expect(checkCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("have been modified"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("rules section"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should pass check when rules section is unchanged", async () => {
      const { createHash } = await import("node:crypto");

      // Create lockfile with codex target
      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local", path: "/some/path", ref: "abc123" },
        content: {
          agents_md: { global_block_hash: "sha256:abc123def456", merged: true },
          skills: [],
          rules: { files: ["security/auth.md"], content_hash: "sha256:abc123" },
          targets: ["codex"],
        },
        cli_version: "1.0.0",
      };
      await fs.writeFile(
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );

      // Create the rules section content (what gets hashed)
      const rulesContent = `# Project Rules

<!-- Rule: security/auth.md -->
## Authentication

Always validate tokens.`;

      // Compute hash of the rules content
      const rulesHash = createHash("sha256").update(rulesContent.trim()).digest("hex");

      // Create AGENTS.md with properly matching hash
      const globalContent = "# Global Standards";
      const globalHash = createHash("sha256").update(globalContent.trim()).digest("hex");

      const agentsMd = `<!-- agconf:global:start -->
<!-- DO NOT EDIT THIS SECTION - Managed by agconf -->
<!-- Content hash: sha256:${globalHash.slice(0, 12)} -->

${globalContent}

<!-- agconf:global:end -->

<!-- agconf:rules:start -->
<!-- DO NOT EDIT THIS SECTION - Managed by agconf
<!-- Content hash: sha256:${rulesHash.slice(0, 12)} -->
<!-- Rule count: 1 -->

${rulesContent}

<!-- agconf:rules:end -->

<!-- agconf:repo:start -->
<!-- Repository-specific instructions below -->

# Repo content

<!-- agconf:repo:end -->
`;
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), agentsMd);

      // Check should pass
      await checkCommand({ cwd: tempDir });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("All managed files are unchanged"),
      );
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should pass check immediately after sync generates rules section", async () => {
      // This test reproduces the bug where check fails immediately after sync
      // for the rules section in AGENTS.md (Codex target)
      const { generateRulesSection, parseRule } = await import("../../src/core/rules.js");
      const { createHash } = await import("node:crypto");

      // Simulate what sync does: parse rules and generate the section
      const ruleContent = `---
paths:
  - "src/api/**/*.ts"
---

# Authentication

Always validate tokens.
`;
      const rule = parseRule(ruleContent, "security/auth.md");
      const rulesSection = generateRulesSection([rule], "agconf");

      // Create lockfile with codex target
      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local", path: "/some/path", ref: "abc123" },
        content: {
          agents_md: { global_block_hash: "sha256:abc123def456", merged: true },
          skills: [],
          rules: { files: ["security/auth.md"], content_hash: "sha256:abc123" },
          targets: ["codex"],
        },
        cli_version: "1.0.0",
      };
      await fs.writeFile(
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );

      // Create AGENTS.md with the generated rules section (exactly as sync would)
      const globalContent = "# Global Standards";
      const globalHash = createHash("sha256").update(globalContent.trim()).digest("hex");

      const agentsMd = `<!-- agconf:global:start -->
<!-- DO NOT EDIT THIS SECTION - Managed by agconf -->
<!-- Content hash: sha256:${globalHash.slice(0, 12)} -->

${globalContent}

<!-- agconf:global:end -->

${rulesSection}

<!-- agconf:repo:start -->
<!-- Repository-specific instructions below -->

# Repo content

<!-- agconf:repo:end -->
`;
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), agentsMd);

      // Check should pass - we just synced, nothing was modified
      await checkCommand({ cwd: tempDir });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("All managed files are unchanged"),
      );
      expect(mockExit).not.toHaveBeenCalled();
    });
  });

  describe("agents checking", () => {
    beforeEach(async () => {
      // Create agents directory
      await fs.mkdir(path.join(tempDir, ".claude", "agents"), { recursive: true });
    });

    it("should pass check immediately after sync for agent files", async () => {
      // Import the functions used during sync
      const { addAgentMetadata, parseAgent } = await import("../../src/core/agents.js");
      const { createHash } = await import("node:crypto");

      // Simulate what the canonical repo has - an agent file
      const sourceContent = `---
name: code-reviewer
description: Reviews code for quality issues
tools:
  - read
  - grep
---

# Code Reviewer Agent

This agent reviews code for potential issues.
`;

      // Parse and add metadata like sync does
      const agent = parseAgent(sourceContent, "code-reviewer.md");
      const fileContent = addAgentMetadata(agent, "agconf");

      // Create lockfile with agents
      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local", path: "/some/path", ref: "abc123" },
        content: {
          agents_md: { global_block_hash: "sha256:abc123def456", merged: true },
          skills: [],
          agents: { files: ["code-reviewer.md"], content_hash: "sha256:abc123" },
          targets: ["claude"],
        },
        cli_version: "1.0.0",
      };
      await fs.writeFile(
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );

      // Write the file exactly as sync would
      await fs.writeFile(path.join(tempDir, ".claude", "agents", "code-reviewer.md"), fileContent);

      // Create managed AGENTS.md to satisfy check requirements
      const globalContent = "# Global Standards";
      const globalHash = createHash("sha256").update(globalContent.trim()).digest("hex");
      const agentsMd = `<!-- agconf:global:start -->
<!-- DO NOT EDIT THIS SECTION - Managed by agconf -->
<!-- Content hash: sha256:${globalHash.slice(0, 12)} -->

${globalContent}

<!-- agconf:global:end -->
`;
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), agentsMd);

      // Check should pass - the file hasn't been modified
      await checkCommand({ cwd: tempDir });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("All managed files are unchanged"),
      );
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should detect unmodified agent files", async () => {
      // Import the functions used during sync to ensure hash consistency
      const { addAgentMetadata, parseAgent } = await import("../../src/core/agents.js");
      const { createHash } = await import("node:crypto");

      // Create the original source content (without managed metadata)
      const sourceContent = `---
name: test-agent
description: A test agent
---

# Test Agent

Some agent content
`;

      // Parse and add metadata like sync does - this ensures hash consistency
      const agent = parseAgent(sourceContent, "test-agent.md");
      const fileContent = addAgentMetadata(agent, "agconf");

      // Create a lockfile with agents
      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local", path: "/some/path", ref: "abc123" },
        content: {
          agents_md: { global_block_hash: "sha256:abc123def456", merged: true },
          skills: [],
          agents: { files: ["test-agent.md"], content_hash: "sha256:abc123" },
          targets: ["claude"],
        },
        cli_version: "1.0.0",
      };
      await fs.writeFile(
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );

      // Write the file exactly as sync would (with properly computed hash)
      await fs.writeFile(path.join(tempDir, ".claude", "agents", "test-agent.md"), fileContent);

      // Create AGENTS.md (required for check to pass)
      const globalContent = "# Global Standards";
      const globalHash = createHash("sha256").update(globalContent.trim()).digest("hex");
      const agentsMd = `<!-- agconf:global:start -->
<!-- DO NOT EDIT THIS SECTION - Managed by agconf -->
<!-- Content hash: sha256:${globalHash.slice(0, 12)} -->

${globalContent}

<!-- agconf:global:end -->
`;
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), agentsMd);

      await checkCommand({ cwd: tempDir });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("All managed files are unchanged"),
      );
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should detect modified agent files", async () => {
      // Create a lockfile with agents
      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local", path: "/some/path", ref: "abc123" },
        content: {
          agents_md: { global_block_hash: "sha256:abc123def456", merged: true },
          skills: [],
          agents: { files: ["test-agent.md"], content_hash: "sha256:abc123" },
          targets: ["claude"],
        },
        cli_version: "1.0.0",
      };
      await fs.writeFile(
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );

      // Create managed agent file with a hash that won't match (content was modified)
      const agentContent = `---
name: test-agent
description: A test agent
metadata:
  agconf_managed: "true"
  agconf_content_hash: "sha256:originalHash"
---

# Test Agent - MODIFIED

This content has been changed!
`;
      await fs.writeFile(path.join(tempDir, ".claude", "agents", "test-agent.md"), agentContent);

      // Create AGENTS.md without markers (not managed)
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), "# AGENTS.md\n\nSome content");

      await expect(checkCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("have been modified"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should ignore non-managed agent files", async () => {
      // Create a lockfile
      const lockfile = {
        version: "1.0.0",
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
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );

      // Create non-managed agent file (no metadata)
      const agentContent = `---
name: local-agent
description: A local agent
---

# Local Agent

This is a repo-specific agent, not managed by agconf.
`;
      await fs.writeFile(path.join(tempDir, ".claude", "agents", "local-agent.md"), agentContent);

      // Create managed AGENTS.md
      const { createHash } = await import("node:crypto");
      const globalContent = "# Global Standards";
      const globalHash = createHash("sha256").update(globalContent.trim()).digest("hex");
      const agentsMd = `<!-- agconf:global:start -->
<!-- DO NOT EDIT THIS SECTION - Managed by agconf -->
<!-- Content hash: sha256:${globalHash.slice(0, 12)} -->

${globalContent}

<!-- agconf:global:end -->
`;
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), agentsMd);

      await checkCommand({ cwd: tempDir });

      // Should pass because the only managed file (AGENTS.md) is unchanged
      // The non-managed agent should be ignored
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("All managed files are unchanged"),
      );
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should show agent path in output for modified agent files", async () => {
      // Create a lockfile with agents
      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local", path: "/some/path", ref: "abc123" },
        content: {
          agents_md: { global_block_hash: "sha256:abc123def456", merged: true },
          skills: [],
          agents: { files: ["code-reviewer.md"], content_hash: "sha256:abc123" },
          targets: ["claude"],
        },
        cli_version: "1.0.0",
      };
      await fs.writeFile(
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );

      // Create managed agent file with hash that won't match
      const agentContent = `---
name: code-reviewer
description: Reviews code
metadata:
  agconf_managed: "true"
  agconf_content_hash: "sha256:originalHash"
---

# Code Reviewer - MODIFIED
`;
      await fs.writeFile(path.join(tempDir, ".claude", "agents", "code-reviewer.md"), agentContent);

      // Create AGENTS.md without markers
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), "# AGENTS.md\n\nSome content");

      await expect(checkCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");

      // Should show the agent path
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(".claude/agents/code-reviewer.md"),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("agent:"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should include agents in checkAllManagedFiles with skills and rules", async () => {
      // Create rules directory too
      await fs.mkdir(path.join(tempDir, ".claude", "rules"), { recursive: true });

      // Create a lockfile with skills, rules, and agents
      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local", path: "/some/path", ref: "abc123" },
        content: {
          agents_md: { global_block_hash: "sha256:abc123def456", merged: true },
          skills: ["test-skill"],
          rules: { files: ["test-rule.md"], content_hash: "sha256:abc123" },
          agents: { files: ["test-agent.md"], content_hash: "sha256:abc123" },
          targets: ["claude"],
        },
        cli_version: "1.0.0",
      };
      await fs.writeFile(
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );

      // Create managed skill with hash that won't match
      const skillContent = `---
name: test-skill
description: A test skill
metadata:
  agconf_managed: "true"
  agconf_content_hash: "sha256:originalHash"
---

# Test Skill - MODIFIED
`;
      await fs.writeFile(
        path.join(tempDir, ".claude", "skills", "test-skill", "SKILL.md"),
        skillContent,
      );

      // Create managed rule with hash that won't match
      const ruleContent = `---
metadata:
  agconf_managed: "true"
  agconf_content_hash: "sha256:originalHash"
  agconf_source_path: "test-rule.md"
---

# Test Rule - MODIFIED
`;
      await fs.writeFile(path.join(tempDir, ".claude", "rules", "test-rule.md"), ruleContent);

      // Create managed agent with hash that won't match
      const agentContent = `---
name: test-agent
description: A test agent
metadata:
  agconf_managed: "true"
  agconf_content_hash: "sha256:originalHash"
---

# Test Agent - MODIFIED
`;
      await fs.writeFile(path.join(tempDir, ".claude", "agents", "test-agent.md"), agentContent);

      // Create AGENTS.md without markers
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), "# AGENTS.md\n\nSome content");

      await expect(checkCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");

      // Should report all three as modified
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("3 managed file(s) have been modified"),
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe("codex agents checking (.codex/agents/*.toml)", () => {
    // Write a downstream lockfile listing the given canonical agent identities
    // for the Codex target.
    const writeCodexLockfile = async (agentFiles: string[]) => {
      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local", path: "/some/path", ref: "abc123" },
        content: {
          agents_md: { global_block_hash: "sha256:abc123def456", merged: true },
          skills: [],
          agents: { files: agentFiles, content_hash: "sha256:abc123" },
          targets: ["codex"],
        },
        cli_version: "1.0.0",
      };
      await fs.writeFile(
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );
    };

    // Emit a managed `.codex/agents/<name>.toml` exactly as sync would.
    const writeCodexAgent = async (identity: string) => {
      const { buildCodexAgentToml, parseAgent } = await import("../../src/core/agents.js");
      const agent = parseAgent(
        `---\nname: ${identity.replace(/\.md$/, "")}\ndescription: A codex agent\n---\n\n# Body\n`,
        identity,
      );
      const dir = path.join(tempDir, ".codex", "agents");
      await fs.mkdir(dir, { recursive: true });
      const tomlPath = path.join(dir, identity.replace(/\.md$/, ".toml"));
      await fs.writeFile(tomlPath, buildCodexAgentToml(agent, "agconf"));
      return tomlPath;
    };

    it("passes check immediately after sync for a Codex agent", async () => {
      await writeCodexLockfile(["code-reviewer.md"]);
      await writeCodexAgent("code-reviewer.md");

      await checkCommand({ cwd: tempDir });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("All managed files are unchanged"),
      );
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("detects a manually-edited Codex agent TOML", async () => {
      await writeCodexLockfile(["code-reviewer.md"]);
      const tomlPath = await writeCodexAgent("code-reviewer.md");
      const original = await fs.readFile(tomlPath, "utf-8");
      await fs.writeFile(tomlPath, original.replace("# Body", "# Body (tampered)"));

      await expect(checkCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("have been modified"));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("codex agent:"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("ignores an unmanaged .toml file", async () => {
      await writeCodexLockfile(["code-reviewer.md"]);
      await writeCodexAgent("code-reviewer.md");
      // A hand-authored TOML with no agconf metadata must not be flagged.
      await fs.writeFile(
        path.join(tempDir, ".codex", "agents", "notes.toml"),
        'name = "notes"\ndescription = "hand-written"\n',
      );

      await checkCommand({ cwd: tempDir });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("All managed files are unchanged"),
      );
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("flags an orphaned (ghost) Codex agent absent from the lockfile", async () => {
      await writeCodexLockfile([]); // lockfile tracks no agents
      await writeCodexAgent("code-reviewer.md"); // but a managed one remains on disk

      await expect(checkCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("orphaned managed file"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("flags a Codex agent tracked in the lockfile but missing on disk", async () => {
      await writeCodexLockfile(["present.md", "gone.md"]);
      await writeCodexAgent("present.md"); // only one of the two exists

      await expect(checkCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("missing on disk"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    // Write a managed AGENTS.md global block so `check` has at least one managed
    // file and doesn't short-circuit on "no managed files found".
    const writeManagedAgentsMd = async () => {
      const { createHash } = await import("node:crypto");
      const globalContent = "# Global Standards";
      const hash = createHash("sha256").update(globalContent.trim()).digest("hex").slice(0, 12);
      const md = `<!-- agconf:global:start -->
<!-- DO NOT EDIT THIS SECTION - Managed by agconf -->
<!-- Content hash: sha256:${hash} -->

${globalContent}

<!-- agconf:global:end -->
`;
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), md);
    };

    it("does NOT report missing Codex agents before the repo is re-synced (no TOML yet)", async () => {
      // A repo synced by an older CLI: the lockfile tracks agents, but no
      // `.codex/agents/*.toml` exists yet (only a plain `agconf sync` creates them).
      // `check` must not false-positive on upgrade.
      await writeCodexLockfile(["code-reviewer.md"]);
      await writeManagedAgentsMd();

      await checkCommand({ cwd: tempDir });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("All managed files are unchanged"),
      );
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("accepts a Codex skill still at the legacy .codex/skills location", async () => {
      // Pre-migration codex-only repo: skill lives at the legacy `.codex/skills`
      // path, not yet relocated to `.agents/skills`. `check` must not report it missing.
      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local", path: "/some/path", ref: "abc123" },
        content: {
          agents_md: { global_block_hash: "sha256:abc123def456", merged: true },
          skills: ["legacy-skill"],
          targets: ["codex"],
        },
        cli_version: "1.0.0",
      };
      await fs.writeFile(
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );
      await writeManagedAgentsMd();

      const skillDir = path.join(tempDir, ".codex", "skills", "legacy-skill");
      await fs.mkdir(skillDir, { recursive: true });
      const skillContent = `---\nname: legacy-skill\ndescription: A legacy skill\n---\n\n# Legacy Skill\n`;
      await fs.writeFile(path.join(skillDir, "SKILL.md"), addManagedMetadata(skillContent));

      await checkCommand({ cwd: tempDir });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("All managed files are unchanged"),
      );
      expect(mockExit).not.toHaveBeenCalled();
    });
  });

  describe("rules checking", () => {
    beforeEach(async () => {
      // Create rules directory
      await fs.mkdir(path.join(tempDir, ".claude", "rules", "security"), { recursive: true });
    });

    it("should pass check immediately after sync for rule files with frontmatter", async () => {
      // This test reproduces the bug where check fails immediately after sync
      // The rule file has frontmatter (like paths) which gets preserved
      // The hash computed during sync vs check must match

      // Import the functions used during sync
      const { addRuleMetadata, parseRule } = await import("../../src/core/rules.js");

      // Simulate what the canonical repo has - a rule with paths frontmatter
      const sourceContent = `---
paths:
  - "src/api/**/*.ts"
  - "lib/api/**/*.ts"
---

# Authentication Rules

Always validate tokens before processing requests.
`;

      // Parse and add metadata like sync does
      const rule = parseRule(sourceContent, "security/authentication-and-authorization.md");
      const fileContent = addRuleMetadata(rule, "agent_conf");

      // Create lockfile
      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local", path: "/some/path", ref: "abc123" },
        content: {
          agents_md: { global_block_hash: "sha256:abc123def456", merged: true },
          skills: [],
          rules: {
            files: ["security/authentication-and-authorization.md"],
            content_hash: "sha256:abc123",
          },
          targets: ["claude"],
        },
        cli_version: "1.0.0",
      };
      await fs.writeFile(
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );

      // Write the file exactly as sync would
      await fs.writeFile(
        path.join(tempDir, ".claude", "rules", "security", "authentication-and-authorization.md"),
        fileContent,
      );

      // Create managed AGENTS.md to satisfy check requirements
      const { createHash } = await import("node:crypto");
      const globalContent = "# Global Standards";
      const globalHash = createHash("sha256").update(globalContent.trim()).digest("hex");
      const agentsMd = `<!-- agconf:global:start -->
<!-- DO NOT EDIT THIS SECTION - Managed by agconf -->
<!-- Content hash: sha256:${globalHash.slice(0, 12)} -->

${globalContent}

<!-- agconf:global:end -->
`;
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), agentsMd);

      // Check should pass - the file hasn't been modified
      await checkCommand({ cwd: tempDir });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("All managed files are unchanged"),
      );
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should detect unmodified rule files", async () => {
      // Create a lockfile
      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local", path: "/some/path", ref: "abc123" },
        content: {
          agents_md: { global_block_hash: "sha256:abc123def456", merged: true },
          skills: [],
          rules: { files: ["test-rule.md"], content_hash: "sha256:abc123" },
          targets: ["claude"],
        },
        cli_version: "1.0.0",
      };
      await fs.writeFile(
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );

      // Create managed rule file with correct hash
      // Hash is computed on the file with managed metadata stripped
      // When only managed metadata exists, the stripped content is just the body
      // (no empty frontmatter delimiters - this ensures content that originally
      // had no frontmatter hashes the same after adding/stripping managed metadata)
      const ruleBody = "\n# Test Rule\n\nSome rule content\n";
      const strippedContent = ruleBody; // Just the body, no frontmatter wrapper
      const { createHash } = await import("node:crypto");
      const hash = createHash("sha256").update(strippedContent).digest("hex");
      const contentHash = `sha256:${hash.slice(0, 12)}`;

      const ruleContent = `---
metadata:
  agconf_managed: "true"
  agconf_content_hash: "${contentHash}"
  agconf_source_path: "test-rule.md"
---

# Test Rule

Some rule content
`;
      await fs.writeFile(path.join(tempDir, ".claude", "rules", "test-rule.md"), ruleContent);

      // Create AGENTS.md (required for check to pass)
      const globalContent = "# Global Standards";
      const globalHash = createHash("sha256").update(globalContent.trim()).digest("hex");
      const agentsMd = `<!-- agconf:global:start -->
<!-- DO NOT EDIT THIS SECTION - Managed by agconf -->
<!-- Content hash: sha256:${globalHash.slice(0, 12)} -->

${globalContent}

<!-- agconf:global:end -->
`;
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), agentsMd);

      await checkCommand({ cwd: tempDir });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("All managed files are unchanged"),
      );
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should detect modified rule files", async () => {
      // Create a lockfile
      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local", path: "/some/path", ref: "abc123" },
        content: {
          agents_md: { global_block_hash: "sha256:abc123def456", merged: true },
          skills: [],
          rules: { files: ["test-rule.md"], content_hash: "sha256:abc123" },
          targets: ["claude"],
        },
        cli_version: "1.0.0",
      };
      await fs.writeFile(
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );

      // Create managed rule file with a hash that won't match (content was modified)
      const ruleContent = `---
metadata:
  agconf_managed: "true"
  agconf_content_hash: "sha256:originalHash"
  agconf_source_path: "test-rule.md"
---

# Test Rule - MODIFIED

This content has been changed!
`;
      await fs.writeFile(path.join(tempDir, ".claude", "rules", "test-rule.md"), ruleContent);

      // Create AGENTS.md without markers (not managed)
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), "# AGENTS.md\n\nSome content");

      await expect(checkCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("have been modified"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should ignore non-managed rule files", async () => {
      // Create a lockfile
      const lockfile = {
        version: "1.0.0",
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
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );

      // Create non-managed rule file (no metadata)
      const ruleContent = `---
paths:
  - "src/**/*.ts"
---

# Local Rule

This is a repo-specific rule, not managed by agconf.
`;
      await fs.writeFile(path.join(tempDir, ".claude", "rules", "local-rule.md"), ruleContent);

      // Create managed AGENTS.md
      const { createHash } = await import("node:crypto");
      const globalContent = "# Global Standards";
      const globalHash = createHash("sha256").update(globalContent.trim()).digest("hex");
      const agentsMd = `<!-- agconf:global:start -->
<!-- DO NOT EDIT THIS SECTION - Managed by agconf -->
<!-- Content hash: sha256:${globalHash.slice(0, 12)} -->

${globalContent}

<!-- agconf:global:end -->
`;
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), agentsMd);

      await checkCommand({ cwd: tempDir });

      // Should pass because the only managed file (AGENTS.md) is unchanged
      // The non-managed rule should be ignored
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("All managed files are unchanged"),
      );
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("should check rules in subdirectories", async () => {
      // Create a lockfile
      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local", path: "/some/path", ref: "abc123" },
        content: {
          agents_md: { global_block_hash: "sha256:abc123def456", merged: true },
          skills: [],
          rules: { files: ["security/auth.md"], content_hash: "sha256:abc123" },
          targets: ["claude"],
        },
        cli_version: "1.0.0",
      };
      await fs.writeFile(
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );

      // Create managed rule in subdirectory with hash that won't match
      const ruleContent = `---
metadata:
  agconf_managed: "true"
  agconf_content_hash: "sha256:originalHash"
  agconf_source_path: "security/auth.md"
---

# Authentication Rules - MODIFIED

Modified content
`;
      await fs.writeFile(
        path.join(tempDir, ".claude", "rules", "security", "auth.md"),
        ruleContent,
      );

      // Create AGENTS.md without markers
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), "# AGENTS.md\n\nSome content");

      await expect(checkCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("have been modified"));
      // Verify the path includes the subdirectory
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(".claude/rules/security/auth.md"),
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("should include rules in checkAllManagedFiles", async () => {
      // Create a lockfile
      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local", path: "/some/path", ref: "abc123" },
        content: {
          agents_md: { global_block_hash: "sha256:abc123def456", merged: true },
          skills: ["test-skill"],
          rules: { files: ["test-rule.md"], content_hash: "sha256:abc123" },
          targets: ["claude"],
        },
        cli_version: "1.0.0",
      };
      await fs.writeFile(
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );

      // Create managed skill with hash that won't match
      const skillContent = `---
name: test-skill
description: A test skill
metadata:
  agconf_managed: "true"
  agconf_content_hash: "sha256:originalHash"
---

# Test Skill - MODIFIED
`;
      await fs.writeFile(
        path.join(tempDir, ".claude", "skills", "test-skill", "SKILL.md"),
        skillContent,
      );

      // Create managed rule with hash that won't match
      const ruleContent = `---
metadata:
  agconf_managed: "true"
  agconf_content_hash: "sha256:originalHash"
  agconf_source_path: "test-rule.md"
---

# Test Rule - MODIFIED
`;
      await fs.writeFile(path.join(tempDir, ".claude", "rules", "test-rule.md"), ruleContent);

      // Create AGENTS.md without markers
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), "# AGENTS.md\n\nSome content");

      await expect(checkCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");

      // Should report both the skill and the rule as modified
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("2 managed file(s) have been modified"),
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe("orphaned (ghost) and missing managed files", () => {
    // A valid managed AGENTS.md keeps at least one managed file present, so the
    // "No managed files found" early-exit never masks ghost/missing reporting.
    const writeManagedAgentsMd = async (): Promise<void> => {
      const { createHash } = await import("node:crypto");
      const globalContent = "# Global Standards";
      const globalHash = createHash("sha256").update(globalContent.trim()).digest("hex");
      const agentsMd = `<!-- agconf:global:start -->
<!-- DO NOT EDIT THIS SECTION - Managed by agconf -->
<!-- Content hash: sha256:${globalHash.slice(0, 12)} -->

${globalContent}

<!-- agconf:global:end -->
`;
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), agentsMd);
    };

    const writeLockfile = async (content: Record<string, unknown>): Promise<void> => {
      const lockfile = {
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        source: { type: "local", path: "/some/path", ref: "abc123" },
        content: {
          agents_md: { global_block_hash: "sha256:abc123def456", merged: true },
          targets: ["claude"],
          skills: [],
          ...content,
        },
        cli_version: "1.0.0",
      };
      await fs.writeFile(
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );
    };

    it("fails when a managed rule remains on disk but is not in the lockfile", async () => {
      const { addRuleMetadata, parseRule } = await import("../../src/core/rules.js");
      await writeManagedAgentsMd();
      await writeLockfile({ rules: { files: [], content_hash: "sha256:abc123" } });

      const rule = parseRule(`---\npaths:\n  - "src/**"\n---\n\n# Orphan Rule\n`, "orphan.md");
      await fs.mkdir(path.join(tempDir, ".claude", "rules"), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, ".claude", "rules", "orphan.md"),
        addRuleMetadata(rule, "agconf"),
      );

      await expect(checkCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("no longer in canonical"));
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(path.join(".claude", "rules", "orphan.md")),
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("fails when a managed agent remains on disk but is not in the lockfile", async () => {
      const { addAgentMetadata, parseAgent } = await import("../../src/core/agents.js");
      await writeManagedAgentsMd();
      await writeLockfile({ agents: { files: [], content_hash: "sha256:abc123" } });

      const agent = parseAgent(
        `---\nname: ghost\ndescription: Ghost agent\n---\n\n# Ghost\n`,
        "ghost.md",
      );
      await fs.mkdir(path.join(tempDir, ".claude", "agents"), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, ".claude", "agents", "ghost.md"),
        addAgentMetadata(agent, "agconf"),
      );

      await expect(checkCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("no longer in canonical"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("fails when a managed skill remains on disk but is not in the lockfile", async () => {
      const { addManagedMetadata } = await import("../../src/core/managed-content.js");
      await writeManagedAgentsMd();
      await writeLockfile({ skills: [] });

      const skillDir = path.join(tempDir, ".claude", "skills", "ghost-skill");
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, "SKILL.md"),
        addManagedMetadata(
          `---\nname: ghost-skill\ndescription: Ghost skill\n---\n\n# Ghost Skill\n`,
        ),
      );

      await expect(checkCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("no longer in canonical"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("fails when a lockfile-tracked rule is missing from disk", async () => {
      await writeManagedAgentsMd();
      await writeLockfile({ rules: { files: ["gone.md"], content_hash: "sha256:abc123" } });

      await expect(checkCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("missing on disk"));
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(path.join(".claude", "rules", "gone.md")),
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("fails when a lockfile-tracked agent is missing from disk", async () => {
      await writeManagedAgentsMd();
      await writeLockfile({ agents: { files: ["gone.md"], content_hash: "sha256:abc123" } });

      await expect(checkCommand({ cwd: tempDir })).rejects.toThrow("process.exit called");

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("missing on disk"));
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("ignores an unmanaged rule file that is not in the lockfile", async () => {
      await writeManagedAgentsMd();
      await writeLockfile({ rules: { files: [], content_hash: "sha256:abc123" } });

      // User-authored, unmanaged rule must never be flagged as a ghost.
      await fs.mkdir(path.join(tempDir, ".claude", "rules"), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, ".claude", "rules", "user-authored.md"),
        "# My own rule\n\nNot managed by agconf.\n",
      );

      await checkCommand({ cwd: tempDir });

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("All managed files are unchanged"),
      );
      expect(mockExit).not.toHaveBeenCalled();
    });

    it("exits 1 in quiet mode when a ghost file remains on disk", async () => {
      const { addAgentMetadata, parseAgent } = await import("../../src/core/agents.js");
      await writeManagedAgentsMd();
      await writeLockfile({ agents: { files: [], content_hash: "sha256:abc123" } });

      const agent = parseAgent(
        `---\nname: ghost\ndescription: Ghost agent\n---\n\n# Ghost\n`,
        "ghost.md",
      );
      await fs.mkdir(path.join(tempDir, ".claude", "agents"), { recursive: true });
      await fs.writeFile(
        path.join(tempDir, ".claude", "agents", "ghost.md"),
        addAgentMetadata(agent, "agconf"),
      );

      await expect(checkCommand({ quiet: true, cwd: tempDir })).rejects.toThrow(
        "process.exit called",
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe("--hook mode (pre-commit branch-aware verdict)", () => {
    async function initGitOnBranch(branch: string): Promise<void> {
      const git = simpleGit(tempDir);
      await git.init();
      await git.addConfig("user.email", "test@example.com", false, "local");
      await git.addConfig("user.name", "Test", false, "local");
      // A commit is required so `git rev-parse --abbrev-ref HEAD` resolves.
      await git.raw(["commit", "--allow-empty", "-m", "init"]);
      await git.raw(["checkout", "-B", branch]);
    }

    async function writeSyncedRepoWithModifiedSkill(): Promise<void> {
      const lockfile = {
        version: "1.0.0",
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
        path.join(tempDir, ".agconf", "lockfile.json"),
        JSON.stringify(lockfile, null, 2),
      );
      await fs.writeFile(path.join(tempDir, "AGENTS.md"), "# AGENTS.md\n\nSome content");
      const skillContent = `---
name: test-skill
description: A test skill
metadata:
  agconf_managed: "true"
  agconf_content_hash: "sha256:originalHash"
---

# Test Skill - MODIFIED
`;
      await fs.writeFile(
        path.join(tempDir, ".claude", "skills", "test-skill", "SKILL.md"),
        skillContent,
      );
    }

    it("blocks the commit (exit 1) when managed files are modified on main", async () => {
      await initGitOnBranch("main");
      await writeSyncedRepoWithModifiedSkill();

      await expect(checkCommand({ hook: true, cwd: tempDir })).rejects.toThrow(
        "process.exit called",
      );
      expect(mockExit).toHaveBeenCalledWith(1);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Cannot commit"));
    });

    it("blocks the commit (exit 1) on master too", async () => {
      await initGitOnBranch("master");
      await writeSyncedRepoWithModifiedSkill();

      await expect(checkCommand({ hook: true, cwd: tempDir })).rejects.toThrow(
        "process.exit called",
      );
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it("warns but allows the commit (exit 0) on a feature branch", async () => {
      await initGitOnBranch("feature/thing");
      await writeSyncedRepoWithModifiedSkill();

      await checkCommand({ hook: true, cwd: tempDir });

      expect(mockExit).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("allowed on feature branches"),
      );
      // The detailed report still prints so the user sees what changed.
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("have been modified"));
    });

    it("is a silent no-op (exit 0) when the repo is not synced", async () => {
      // No lockfile in tempDir (outer beforeEach only created the .agconf dir).
      await checkCommand({ hook: true, cwd: tempDir });

      expect(mockExit).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });
  });
});

// =============================================================================
// Canonical-repo plugin freshness (context-aware check)
// =============================================================================

describe("check command (canonical plugins)", () => {
  let dir: string;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  async function setupCanonical(): Promise<void> {
    await fs.mkdir(path.join(dir, "instructions"), { recursive: true });
    await fs.writeFile(path.join(dir, "instructions", "AGENTS.md"), "# Standards\n");
    const skillDir = path.join(dir, "skills", "alpha");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: alpha\ndescription: The alpha skill\n---\n\n# alpha\n",
    );
    await fs.writeFile(
      path.join(dir, "agconf.yaml"),
      stringifyYaml({
        version: "1.0.0",
        meta: { name: "acme" },
        content: { instructions: "instructions/AGENTS.md", skills_dir: "skills" },
        targets: ["claude", "codex"],
        plugins: { version: "1.0.0", marketplace: { name: "acme-tools", owner: { name: "Acme" } } },
      }),
    );
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-check-plugins-"));
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
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("passes when compiled artifacts are up to date", async () => {
    await setupCanonical();
    await compileCommand({ cwd: dir });

    await checkCommand({ cwd: dir });
    expect(mockExit).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("up to date"));
  });

  it("does not report 'Not synced' for a canonical repo without a lockfile", async () => {
    await setupCanonical();
    await compileCommand({ cwd: dir });

    await checkCommand({ cwd: dir });
    expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining("Not synced"));
  });

  it("fails (exit 1) when compiled artifacts are stale", async () => {
    await setupCanonical();
    await compileCommand({ cwd: dir });
    // Tamper with a committed artifact.
    await fs.writeFile(
      path.join(dir, "plugins", "claude", "acme-tools", "skills", "alpha", "SKILL.md"),
      "tampered\n",
    );

    await expect(checkCommand({ cwd: dir })).rejects.toThrow("process.exit called");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("fails (exit 1) when plugins were never compiled", async () => {
    await setupCanonical();
    await expect(checkCommand({ cwd: dir })).rejects.toThrow("process.exit called");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("exits 1 silently in quiet mode when stale", async () => {
    await setupCanonical();
    await expect(checkCommand({ cwd: dir, quiet: true })).rejects.toThrow("process.exit called");
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

// =============================================================================
// Context combinations: canonical-plugins + downstream in one repo, and the
// degrade-gracefully paths (cannot-verify, malformed config next to a lockfile)
// =============================================================================

describe("check command (context combinations)", () => {
  let dir: string;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  /** A repo that is BOTH a canonical-plugins repo (compiled, clean) AND a synced
   * downstream repo (lockfile + one managed skill, clean). */
  async function setupBoth(): Promise<void> {
    // Canonical side
    await fs.mkdir(path.join(dir, "instructions"), { recursive: true });
    await fs.writeFile(path.join(dir, "instructions", "AGENTS.md"), "# Standards\n");
    await fs.mkdir(path.join(dir, "skills", "alpha"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "skills", "alpha", "SKILL.md"),
      "---\nname: alpha\ndescription: The alpha skill\n---\n\n# alpha\n",
    );
    await fs.writeFile(
      path.join(dir, "agconf.yaml"),
      stringifyYaml({
        version: "1.0.0",
        meta: { name: "acme" },
        content: { instructions: "instructions/AGENTS.md", skills_dir: "skills" },
        targets: ["claude"],
        plugins: { version: "1.0.0", marketplace: { name: "acme-tools", owner: { name: "Acme" } } },
      }),
    );
    await compileCommand({ cwd: dir });

    // Downstream side: lockfile + one managed skill (matching hash → clean)
    await fs.mkdir(path.join(dir, ".agconf"), { recursive: true });
    await fs.writeFile(
      path.join(dir, ".agconf", "lockfile.json"),
      JSON.stringify({
        version: "1.0.0",
        synced_at: "2026-01-01T00:00:00.000Z",
        source: { type: "local", path: "/x" },
        content: {
          agents_md: { global_block_hash: "sha256:abc123def456", merged: false },
          skills: ["test-skill"],
          targets: ["claude"],
          marker_prefix: "agconf",
        },
      }),
    );
    await fs.mkdir(path.join(dir, ".claude", "skills", "test-skill"), { recursive: true });
    await fs.writeFile(
      path.join(dir, ".claude", "skills", "test-skill", "SKILL.md"),
      addManagedMetadata(
        "---\nname: test-skill\ndescription: A test skill\n---\n\n# Test Skill\n",
        {
          metadataPrefix: "agconf",
        },
      ),
    );
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-check-ctx-"));
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
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("passes when BOTH the plugin and downstream sides are clean", async () => {
    await setupBoth();
    await checkCommand({ cwd: dir });
    expect(mockExit).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("up to date"));
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("All managed files are unchanged"),
    );
  });

  it("fails (exit 1) when downstream is dirty even though plugins are clean", async () => {
    await setupBoth();
    // Tamper the managed downstream skill (clean plugin side must not mask it).
    await fs.appendFile(
      path.join(dir, ".claude", "skills", "test-skill", "SKILL.md"),
      "\nlocal edit\n",
    );
    await expect(checkCommand({ cwd: dir })).rejects.toThrow("process.exit called");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("fails (exit 1) when plugins are stale even though downstream is clean", async () => {
    await setupBoth();
    // Tamper a committed plugin artifact (clean downstream must not mask it).
    await fs.writeFile(
      path.join(dir, "plugins", "claude", "acme-tools", "skills", "alpha", "SKILL.md"),
      "tampered\n",
    );
    await expect(checkCommand({ cwd: dir })).rejects.toThrow("process.exit called");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("reports 'Cannot verify' (exit 1) when the canonical source is broken", async () => {
    // plugins configured, but skills/ is missing → resolveLocalSource throws
    await fs.mkdir(path.join(dir, "instructions"), { recursive: true });
    await fs.writeFile(path.join(dir, "instructions", "AGENTS.md"), "# S\n");
    await fs.writeFile(
      path.join(dir, "agconf.yaml"),
      stringifyYaml({
        version: "1.0.0",
        meta: { name: "acme" },
        content: { instructions: "instructions/AGENTS.md", skills_dir: "skills" },
        plugins: { version: "1.0.0", marketplace: { name: "acme-tools" } },
      }),
    );
    await expect(checkCommand({ cwd: dir })).rejects.toThrow("process.exit called");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("Cannot verify"));
  });

  it("does not throw when a malformed agconf.yaml sits next to a lockfile", async () => {
    // Downstream repo (lockfile present) with a malformed canonical config.
    await fs.mkdir(path.join(dir, ".agconf"), { recursive: true });
    await fs.writeFile(
      path.join(dir, ".agconf", "lockfile.json"),
      JSON.stringify({
        version: "1.0.0",
        synced_at: "2026-01-01T00:00:00.000Z",
        source: { type: "local", path: "/x" },
        content: {
          agents_md: { global_block_hash: "sha256:abc123def456", merged: false },
          skills: [],
          targets: ["claude"],
        },
      }),
    );
    await fs.writeFile(path.join(dir, "agconf.yaml"), "{{{ not valid yaml");

    // The config-load error must be swallowed; check still runs the downstream
    // path (which exits 1 here for "no managed files"), NOT throw a YAML error.
    await expect(checkCommand({ cwd: dir })).rejects.toThrow("process.exit called");
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
