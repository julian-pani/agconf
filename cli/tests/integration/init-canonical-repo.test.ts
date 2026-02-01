import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { getGitOrganization, getGitProjectName, isGitRoot } from "../../src/utils/git.js";

// Import the internal functions we want to test
// Since initCanonicalRepoCommand uses prompts, we'll test the file generation logic directly
// by creating a helper that mimics what the command does

interface ScaffoldOptions {
  name: string;
  organization?: string;
  targetDir: string;
  markerPrefix: string;
  includeExamples: boolean;
}

async function scaffoldCanonicalRepo(options: ScaffoldOptions): Promise<void> {
  const { name, organization, targetDir, markerPrefix, includeExamples } = options;

  // Create directories
  const instructionsDir = path.join(targetDir, "instructions");
  const skillsDir = path.join(targetDir, "skills");
  const workflowsDir = path.join(targetDir, ".github", "workflows");

  await fs.mkdir(instructionsDir, { recursive: true });
  await fs.mkdir(skillsDir, { recursive: true });
  await fs.mkdir(workflowsDir, { recursive: true });

  // Generate config
  const config: Record<string, unknown> = {
    version: "1",
    meta: { name },
    content: {
      instructions: "instructions/AGENTS.md",
      skills_dir: "skills",
    },
    targets: ["claude"],
    markers: { prefix: markerPrefix },
    merge: { preserve_repo_content: true },
  };

  if (organization) {
    (config.meta as Record<string, unknown>).organization = organization;
  }

  // Write config file
  const { stringify: stringifyYaml } = await import("yaml");
  await fs.writeFile(
    path.join(targetDir, "agent-conf.yaml"),
    stringifyYaml(config, { lineWidth: 0 }),
    "utf-8",
  );

  // Write AGENTS.md
  const orgName = organization ?? "Your Organization";
  const agentsMd = `# ${orgName} Engineering Standards for AI Agents

This document defines company-wide engineering standards that all AI coding agents must follow.

## Purpose

These standards ensure consistency, maintainability, and operational excellence across all engineering projects.
`;
  await fs.writeFile(path.join(instructionsDir, "AGENTS.md"), agentsMd, "utf-8");

  // Write example skill if requested
  if (includeExamples) {
    const exampleSkillDir = path.join(skillsDir, "example-skill");
    const referencesDir = path.join(exampleSkillDir, "references");
    await fs.mkdir(referencesDir, { recursive: true });

    const skillMd = `---
name: example-skill
description: An example skill demonstrating the skill format
---

# Example Skill

This is an example skill that demonstrates the skill format.
`;
    await fs.writeFile(path.join(exampleSkillDir, "SKILL.md"), skillMd, "utf-8");
    await fs.writeFile(path.join(referencesDir, ".gitkeep"), "", "utf-8");
  }

  // Write workflow files
  await fs.writeFile(
    path.join(workflowsDir, "sync-reusable.yml"),
    `name: Sync Reusable\non:\n  workflow_call:\n`,
    "utf-8",
  );
  await fs.writeFile(
    path.join(workflowsDir, "check-reusable.yml"),
    `name: Check Reusable\non:\n  workflow_call:\n`,
    "utf-8",
  );
}

describe("init-canonical-repo integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-conf-canonical-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should create basic directory structure", async () => {
    await scaffoldCanonicalRepo({
      name: "test-standards",
      targetDir: tempDir,
      markerPrefix: "agent-conf",
      includeExamples: false,
    });

    // Verify directories exist
    const instructionsDir = path.join(tempDir, "instructions");
    const skillsDir = path.join(tempDir, "skills");
    const workflowsDir = path.join(tempDir, ".github", "workflows");

    const [instructionsExists, skillsExists, workflowsExists] = await Promise.all([
      fs.stat(instructionsDir).then((s) => s.isDirectory()),
      fs.stat(skillsDir).then((s) => s.isDirectory()),
      fs.stat(workflowsDir).then((s) => s.isDirectory()),
    ]);

    expect(instructionsExists).toBe(true);
    expect(skillsExists).toBe(true);
    expect(workflowsExists).toBe(true);
  });

  it("should create valid agent-conf.yaml", async () => {
    await scaffoldCanonicalRepo({
      name: "acme-standards",
      organization: "ACME Corp",
      targetDir: tempDir,
      markerPrefix: "acme",
      includeExamples: false,
    });

    const configPath = path.join(tempDir, "agent-conf.yaml");
    const configContent = await fs.readFile(configPath, "utf-8");
    const config = parseYaml(configContent);

    expect(config.version).toBe("1");
    expect(config.meta.name).toBe("acme-standards");
    expect(config.meta.organization).toBe("ACME Corp");
    expect(config.content.instructions).toBe("instructions/AGENTS.md");
    expect(config.content.skills_dir).toBe("skills");
    expect(config.targets).toEqual(["claude"]);
    expect(config.markers.prefix).toBe("acme");
    expect(config.merge.preserve_repo_content).toBe(true);
  });

  it("should create AGENTS.md with organization name", async () => {
    await scaffoldCanonicalRepo({
      name: "test-standards",
      organization: "Test Organization",
      targetDir: tempDir,
      markerPrefix: "agent-conf",
      includeExamples: false,
    });

    const agentsMdPath = path.join(tempDir, "instructions", "AGENTS.md");
    const agentsMd = await fs.readFile(agentsMdPath, "utf-8");

    expect(agentsMd).toContain("# Test Organization Engineering Standards");
    expect(agentsMd).toContain("Purpose");
  });

  it("should create AGENTS.md with default organization when not provided", async () => {
    await scaffoldCanonicalRepo({
      name: "test-standards",
      targetDir: tempDir,
      markerPrefix: "agent-conf",
      includeExamples: false,
    });

    const agentsMdPath = path.join(tempDir, "instructions", "AGENTS.md");
    const agentsMd = await fs.readFile(agentsMdPath, "utf-8");

    expect(agentsMd).toContain("# Your Organization Engineering Standards");
  });

  it("should include example skill when requested", async () => {
    await scaffoldCanonicalRepo({
      name: "test-standards",
      targetDir: tempDir,
      markerPrefix: "agent-conf",
      includeExamples: true,
    });

    const skillMdPath = path.join(tempDir, "skills", "example-skill", "SKILL.md");
    const gitkeepPath = path.join(tempDir, "skills", "example-skill", "references", ".gitkeep");

    const [skillExists, gitkeepExists] = await Promise.all([
      fs
        .access(skillMdPath)
        .then(() => true)
        .catch(() => false),
      fs
        .access(gitkeepPath)
        .then(() => true)
        .catch(() => false),
    ]);

    expect(skillExists).toBe(true);
    expect(gitkeepExists).toBe(true);

    const skillMd = await fs.readFile(skillMdPath, "utf-8");
    expect(skillMd).toContain("name: example-skill");
    expect(skillMd).toContain("description:");
  });

  it("should not include example skill when not requested", async () => {
    await scaffoldCanonicalRepo({
      name: "test-standards",
      targetDir: tempDir,
      markerPrefix: "agent-conf",
      includeExamples: false,
    });

    const exampleSkillDir = path.join(tempDir, "skills", "example-skill");
    const exampleExists = await fs
      .access(exampleSkillDir)
      .then(() => true)
      .catch(() => false);

    expect(exampleExists).toBe(false);
  });

  it("should create workflow files", async () => {
    await scaffoldCanonicalRepo({
      name: "test-standards",
      targetDir: tempDir,
      markerPrefix: "agent-conf",
      includeExamples: false,
    });

    const syncWorkflowPath = path.join(tempDir, ".github", "workflows", "sync-reusable.yml");
    const checkWorkflowPath = path.join(tempDir, ".github", "workflows", "check-reusable.yml");

    const [syncExists, checkExists] = await Promise.all([
      fs
        .access(syncWorkflowPath)
        .then(() => true)
        .catch(() => false),
      fs
        .access(checkWorkflowPath)
        .then(() => true)
        .catch(() => false),
    ]);

    expect(syncExists).toBe(true);
    expect(checkExists).toBe(true);
  });

  it("should use custom marker prefix", async () => {
    await scaffoldCanonicalRepo({
      name: "custom-standards",
      targetDir: tempDir,
      markerPrefix: "custom-prefix",
      includeExamples: false,
    });

    const configPath = path.join(tempDir, "agent-conf.yaml");
    const configContent = await fs.readFile(configPath, "utf-8");
    const config = parseYaml(configContent);

    expect(config.markers.prefix).toBe("custom-prefix");
  });

  it("should handle nested target directory creation", async () => {
    const nestedDir = path.join(tempDir, "deep", "nested", "dir");

    await scaffoldCanonicalRepo({
      name: "nested-repo",
      targetDir: nestedDir,
      markerPrefix: "agent-conf",
      includeExamples: true,
    });

    const configPath = path.join(nestedDir, "agent-conf.yaml");
    const configExists = await fs
      .access(configPath)
      .then(() => true)
      .catch(() => false);

    expect(configExists).toBe(true);
  });
});

describe("init-canonical-repo smart defaults", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-conf-smart-defaults-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should detect git root correctly", async () => {
    // Non-git directory
    expect(await isGitRoot(tempDir)).toBe(false);

    // Initialize git
    const git = simpleGit(tempDir);
    await git.init();

    // Now it should be a git root
    expect(await isGitRoot(tempDir)).toBe(true);

    // Subdirectory should not be git root
    const subDir = path.join(tempDir, "subdir");
    await fs.mkdir(subDir);
    expect(await isGitRoot(subDir)).toBe(false);
  });

  it("should get git project name from git root", async () => {
    const git = simpleGit(tempDir);
    await git.init();

    const projectName = await getGitProjectName(tempDir);
    expect(projectName).toBe(path.basename(tempDir));
  });

  it("should return null for git project name in non-git directory", async () => {
    const projectName = await getGitProjectName(tempDir);
    expect(projectName).toBeNull();
  });

  it("should extract organization from GitHub HTTPS remote", async () => {
    const git = simpleGit(tempDir);
    await git.init();
    await git.addRemote("origin", "https://github.com/my-org/my-repo.git");

    const org = await getGitOrganization(tempDir);
    expect(org).toBe("my-org");
  });

  it("should extract organization from GitHub SSH remote", async () => {
    const git = simpleGit(tempDir);
    await git.init();
    await git.addRemote("origin", "git@github.com:another-org/another-repo.git");

    const org = await getGitOrganization(tempDir);
    expect(org).toBe("another-org");
  });

  it("should fall back to user.name when no GitHub remote", async () => {
    const git = simpleGit(tempDir);
    await git.init();
    await git.addConfig("user.name", "Test User Name", false, "local");

    const org = await getGitOrganization(tempDir);
    expect(org).toBe("Test User Name");
  });

  it("should return undefined for non-git directory organization", async () => {
    const org = await getGitOrganization(tempDir);
    expect(org).toBeUndefined();
  });

  it("should handle non-existent directory gracefully", async () => {
    const nonExistent = "/non/existent/path/12345";

    expect(await isGitRoot(nonExistent)).toBe(false);
    expect(await getGitProjectName(nonExistent)).toBeNull();
    expect(await getGitOrganization(nonExistent)).toBeUndefined();
  });
});

describe("init-canonical-repo workflow content", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-conf-workflow-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // Helper to generate workflow content (mirrors the command's logic)
  function generateSyncWorkflow(repoFullName: string, prefix: string): string {
    return `# ${prefix} Auto-Sync Workflow (Reusable)
# This workflow is called by downstream repositories.
#
# Downstream repos will reference this workflow like:
#   uses: ${repoFullName}/.github/workflows/sync-reusable.yml@v1.0.0
#
# SETUP REQUIRED: Update the CLI installation step below with your installation method.
# See https://github.com/julian-pani/agent-conf/blob/master/cli/docs/CANONICAL_REPOSITORY_SETUP.md for detailed instructions.

name: Sync Reusable
`;
  }

  function generateCheckWorkflow(repoFullName: string, prefix: string): string {
    return `# ${prefix} File Integrity Check (Reusable)
# This workflow is called by downstream repositories.
#
# Downstream repos will reference this workflow like:
#   uses: ${repoFullName}/.github/workflows/check-reusable.yml@v1.0.0
#
# SETUP REQUIRED: Update the CLI installation step below with your installation method.
# See https://github.com/julian-pani/agent-conf/blob/master/cli/docs/CANONICAL_REPOSITORY_SETUP.md for detailed instructions.

name: Check Reusable
`;
  }

  it("should include repo name in sync workflow", () => {
    const content = generateSyncWorkflow("acme-corp/my-standards", "agent-conf");

    expect(content).toContain("acme-corp/my-standards/.github/workflows/sync-reusable.yml@v1.0.0");
    expect(content).toContain("SETUP REQUIRED");
    expect(content).toContain("https://github.com/julian-pani/agent-conf/blob/master/cli/docs/CANONICAL_REPOSITORY_SETUP.md");
  });

  it("should include repo name in check workflow", () => {
    const content = generateCheckWorkflow("acme-corp/my-standards", "agent-conf");

    expect(content).toContain("acme-corp/my-standards/.github/workflows/check-reusable.yml@v1.0.0");
    expect(content).toContain("SETUP REQUIRED");
    expect(content).toContain("https://github.com/julian-pani/agent-conf/blob/master/cli/docs/CANONICAL_REPOSITORY_SETUP.md");
  });

  it("should use custom prefix in workflow header", () => {
    const syncContent = generateSyncWorkflow("org/repo", "custom-prefix");
    const checkContent = generateCheckWorkflow("org/repo", "custom-prefix");

    expect(syncContent).toContain("# custom-prefix Auto-Sync Workflow");
    expect(checkContent).toContain("# custom-prefix File Integrity Check");
  });

  it("should handle repo name without organization", () => {
    const content = generateSyncWorkflow("my-standards", "agent-conf");

    expect(content).toContain("my-standards/.github/workflows/sync-reusable.yml@v1.0.0");
  });
});
