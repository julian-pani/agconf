import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GLOBAL_END_MARKER,
  GLOBAL_START_MARKER,
  REPO_END_MARKER,
  REPO_START_MARKER,
} from "../../src/core/markers.js";
import { ensureClaudeMd, mergeAgentsMd } from "../../src/core/merge.js";
import type { Source } from "../../src/schemas/lockfile.js";

describe("merge", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-conf-test-"));
    await fs.mkdir(path.join(tempDir, ".claude"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const testSource: Source = {
    type: "local",
    path: "/path/to/agent-conf",
    commit_sha: "abc1234",
  };

  describe("mergeAgentsMd", () => {
    it("should create new file when none exists", async () => {
      const result = await mergeAgentsMd(tempDir, "# Global Standards", testSource);

      expect(result.merged).toBe(false);
      expect(result.preservedRepoContent).toBe(false);
      expect(result.content).toContain(GLOBAL_START_MARKER);
      expect(result.content).toContain(GLOBAL_END_MARKER);
      expect(result.content).toContain(REPO_START_MARKER);
      expect(result.content).toContain(REPO_END_MARKER);
      expect(result.content).toContain("# Global Standards");
    });

    it("should merge existing AGENTS.md content without markers into repo block", async () => {
      // AGENTS.md is now in root
      const agentsMdPath = path.join(tempDir, "AGENTS.md");
      await fs.writeFile(agentsMdPath, "# My Existing Instructions\nDo things.", "utf-8");

      const result = await mergeAgentsMd(tempDir, "# Global Standards", testSource);

      expect(result.merged).toBe(true);
      expect(result.preservedRepoContent).toBe(true);
      expect(result.content).toContain("# Global Standards");
      expect(result.content).toContain("# My Existing Instructions");

      // Verify existing content is in repo block
      const repoStartIdx = result.content.indexOf(REPO_START_MARKER);
      const existingIdx = result.content.indexOf("# My Existing Instructions");
      expect(existingIdx).toBeGreaterThan(repoStartIdx);
    });

    it("should update global block and preserve repo block when markers exist", async () => {
      const existingContent = `${GLOBAL_START_MARKER}
Old global content
${GLOBAL_END_MARKER}

${REPO_START_MARKER}
# My Repo Specific
Keep this content
${REPO_END_MARKER}
`;
      // AGENTS.md is now in root
      const agentsMdPath = path.join(tempDir, "AGENTS.md");
      await fs.writeFile(agentsMdPath, existingContent, "utf-8");

      const result = await mergeAgentsMd(tempDir, "# New Global Standards", testSource);

      expect(result.merged).toBe(true);
      expect(result.preservedRepoContent).toBe(true);
      expect(result.content).toContain("# New Global Standards");
      expect(result.content).not.toContain("Old global content");
      expect(result.content).toContain("Keep this content");
    });

    it("should override when override option is true", async () => {
      // AGENTS.md is now in root
      const agentsMdPath = path.join(tempDir, "AGENTS.md");
      await fs.writeFile(agentsMdPath, "# Existing content to be removed", "utf-8");

      const result = await mergeAgentsMd(tempDir, "# Global Standards", testSource, {
        override: true,
      });

      expect(result.merged).toBe(false);
      expect(result.preservedRepoContent).toBe(false);
      expect(result.content).toContain("# Global Standards");
      expect(result.content).not.toContain("Existing content to be removed");
    });

    it("should merge root CLAUDE.md content into repo block", async () => {
      const rootClaudeMdPath = path.join(tempDir, "CLAUDE.md");
      await fs.writeFile(rootClaudeMdPath, "# Root CLAUDE content\nSome instructions", "utf-8");

      const result = await mergeAgentsMd(tempDir, "# Global Standards", testSource);

      expect(result.merged).toBe(true);
      expect(result.preservedRepoContent).toBe(true);
      expect(result.claudeMdLocation).toBe("root");
      expect(result.content).toContain("# Root CLAUDE content");
    });

    it("should merge .claude/CLAUDE.md content into repo block", async () => {
      const dotClaudeClaudeMdPath = path.join(tempDir, ".claude", "CLAUDE.md");
      await fs.writeFile(dotClaudeClaudeMdPath, "# Dot claude content\nMore instructions", "utf-8");

      const result = await mergeAgentsMd(tempDir, "# Global Standards", testSource);

      expect(result.merged).toBe(true);
      expect(result.preservedRepoContent).toBe(true);
      expect(result.claudeMdLocation).toBe("dotclaude");
      expect(result.content).toContain("# Dot claude content");
    });

    it("should prefer root CLAUDE.md over .claude/CLAUDE.md", async () => {
      const rootClaudeMdPath = path.join(tempDir, "CLAUDE.md");
      const dotClaudeClaudeMdPath = path.join(tempDir, ".claude", "CLAUDE.md");
      await fs.writeFile(rootClaudeMdPath, "# Root content", "utf-8");
      await fs.writeFile(dotClaudeClaudeMdPath, "# Dot claude content", "utf-8");

      const result = await mergeAgentsMd(tempDir, "# Global Standards", testSource);

      expect(result.claudeMdLocation).toBe("root");
      expect(result.content).toContain("# Root content");
      expect(result.content).not.toContain("# Dot claude content");
    });

    it("should strip @AGENTS.md references from CLAUDE.md content", async () => {
      const rootClaudeMdPath = path.join(tempDir, "CLAUDE.md");
      await fs.writeFile(rootClaudeMdPath, "@AGENTS.md\n\n# My content", "utf-8");

      const result = await mergeAgentsMd(tempDir, "# Global Standards", testSource);

      expect(result.content).toContain("# My content");
      // Should not have duplicate @AGENTS.md in repo block
      const repoBlockMatch = result.content.match(
        /<!-- agent-conf:repo:start -->[\s\S]*<!-- agent-conf:repo:end -->/,
      );
      expect(repoBlockMatch?.[0]).not.toContain("@AGENTS.md");
    });
  });

  describe("ensureClaudeMd", () => {
    it("should create CLAUDE.md in .claude/ with reference when none exists", async () => {
      const result = await ensureClaudeMd(tempDir, null);

      expect(result.created).toBe(true);
      expect(result.updated).toBe(false);
      expect(result.location).toBe("dotclaude");

      const claudeMdPath = path.join(tempDir, ".claude", "CLAUDE.md");
      const content = await fs.readFile(claudeMdPath, "utf-8");
      expect(content).toBe("@../AGENTS.md\n");
    });

    it("should update root CLAUDE.md with correct reference", async () => {
      const rootClaudeMdPath = path.join(tempDir, "CLAUDE.md");
      await fs.writeFile(rootClaudeMdPath, "# My CLAUDE.md\nSome content", "utf-8");

      const result = await ensureClaudeMd(tempDir, "root");

      expect(result.created).toBe(false);
      expect(result.updated).toBe(true);
      expect(result.location).toBe("root");
      expect(result.contentMerged).toBe(true);

      const content = await fs.readFile(rootClaudeMdPath, "utf-8");
      expect(content).toBe("@AGENTS.md\n");
    });

    it("should update .claude/CLAUDE.md with correct reference", async () => {
      const dotClaudeMdPath = path.join(tempDir, ".claude", "CLAUDE.md");
      await fs.writeFile(dotClaudeMdPath, "# My CLAUDE.md\nSome content", "utf-8");

      const result = await ensureClaudeMd(tempDir, "dotclaude");

      expect(result.created).toBe(false);
      expect(result.updated).toBe(true);
      expect(result.location).toBe("dotclaude");
      expect(result.contentMerged).toBe(true);

      const content = await fs.readFile(dotClaudeMdPath, "utf-8");
      expect(content).toBe("@../AGENTS.md\n");
    });

    it("should not modify root CLAUDE.md if reference already exists", async () => {
      const rootClaudeMdPath = path.join(tempDir, "CLAUDE.md");
      await fs.writeFile(rootClaudeMdPath, "@AGENTS.md\n\nSome content", "utf-8");

      const result = await ensureClaudeMd(tempDir, "root");

      expect(result.created).toBe(false);
      expect(result.updated).toBe(false);

      const content = await fs.readFile(rootClaudeMdPath, "utf-8");
      expect(content).toBe("@AGENTS.md\n\nSome content");
    });
  });
});
