import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { simpleGit } from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { canonicalInitCommand } from "../../src/commands/canonical.js";
import { CURRENT_CONFIG_VERSION } from "../../src/config/schema.js";
import { getGitOrganization, getGitProjectName, isGitRoot } from "../../src/utils/git.js";

describe("canonical init", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-conf-canonical-init-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should create basic directory structure", async () => {
    await canonicalInitCommand({
      name: "test-standards",
      dir: tempDir,
      markerPrefix: "agent-conf",
      includeExamples: false,
      yes: true,
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

  it("should create valid agent-conf.yaml with semver version", async () => {
    await canonicalInitCommand({
      name: "acme-standards",
      org: "ACME Corp",
      dir: tempDir,
      markerPrefix: "acme",
      includeExamples: false,
      yes: true,
    });

    const configPath = path.join(tempDir, "agent-conf.yaml");
    const configContent = await fs.readFile(configPath, "utf-8");
    const config = parseYaml(configContent);

    expect(config.version).toBe(CURRENT_CONFIG_VERSION);
    expect(config.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(config.meta.name).toBe("acme-standards");
    expect(config.meta.organization).toBe("ACME Corp");
    expect(config.content.instructions).toBe("instructions/AGENTS.md");
    expect(config.content.skills_dir).toBe("skills");
    expect(config.targets).toEqual(["claude"]);
    expect(config.markers.prefix).toBe("acme");
    expect(config.merge.preserve_repo_content).toBe(true);
  });

  it("should create AGENTS.md with organization name", async () => {
    await canonicalInitCommand({
      name: "test-standards",
      org: "Test Organization",
      dir: tempDir,
      markerPrefix: "agent-conf",
      includeExamples: false,
      yes: true,
    });

    const agentsMdPath = path.join(tempDir, "instructions", "AGENTS.md");
    const agentsMd = await fs.readFile(agentsMdPath, "utf-8");

    expect(agentsMd).toContain("# Test Organization Engineering Standards");
    expect(agentsMd).toContain("Purpose");
  });

  it("should create AGENTS.md with fallback organization when not provided and not in git", async () => {
    // Create a new directory outside of any git repo to avoid picking up git config
    const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-conf-isolated-"));

    try {
      await canonicalInitCommand({
        name: "test-standards",
        dir: isolatedDir,
        markerPrefix: "agent-conf",
        includeExamples: false,
        yes: true,
      });

      const agentsMdPath = path.join(isolatedDir, "instructions", "AGENTS.md");
      const agentsMd = await fs.readFile(agentsMdPath, "utf-8");

      // Should use "Your Organization" as fallback when no git org is detected
      // Note: if running in a git repo context, it may pick up the git user.name
      expect(agentsMd).toMatch(/# .+ Engineering Standards/);
    } finally {
      await fs.rm(isolatedDir, { recursive: true, force: true });
    }
  });

  it("should include example skill when requested", async () => {
    await canonicalInitCommand({
      name: "test-standards",
      dir: tempDir,
      markerPrefix: "agent-conf",
      includeExamples: true,
      yes: true,
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
    await canonicalInitCommand({
      name: "test-standards",
      dir: tempDir,
      markerPrefix: "agent-conf",
      includeExamples: false,
      yes: true,
    });

    const exampleSkillDir = path.join(tempDir, "skills", "example-skill");
    const exampleExists = await fs
      .access(exampleSkillDir)
      .then(() => true)
      .catch(() => false);

    expect(exampleExists).toBe(false);
  });

  it("should create workflow files", async () => {
    await canonicalInitCommand({
      name: "test-standards",
      dir: tempDir,
      markerPrefix: "agent-conf",
      includeExamples: false,
      yes: true,
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
    await canonicalInitCommand({
      name: "custom-standards",
      dir: tempDir,
      markerPrefix: "custom-prefix",
      includeExamples: false,
      yes: true,
    });

    const configPath = path.join(tempDir, "agent-conf.yaml");
    const configContent = await fs.readFile(configPath, "utf-8");
    const config = parseYaml(configContent);

    expect(config.markers.prefix).toBe("custom-prefix");
  });

  it("should handle nested target directory creation", async () => {
    const nestedDir = path.join(tempDir, "deep", "nested", "dir");

    await canonicalInitCommand({
      name: "nested-repo",
      dir: nestedDir,
      markerPrefix: "agent-conf",
      includeExamples: true,
      yes: true,
    });

    const configPath = path.join(nestedDir, "agent-conf.yaml");
    const configExists = await fs
      .access(configPath)
      .then(() => true)
      .catch(() => false);

    expect(configExists).toBe(true);
  });
});

describe("canonical init - workflow generation", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-conf-workflow-gen-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should generate workflow files with unpinned CLI version", async () => {
    await canonicalInitCommand({
      name: "test-standards",
      dir: tempDir,
      markerPrefix: "agent-conf",
      includeExamples: false,
      yes: true,
    });

    // Check sync workflow uses unpinned version
    const syncWorkflowPath = path.join(tempDir, ".github", "workflows", "sync-reusable.yml");
    const syncWorkflow = await fs.readFile(syncWorkflowPath, "utf-8");
    expect(syncWorkflow).toContain("npm install -g agconf\n");
    expect(syncWorkflow).not.toContain("npm install -g agconf@");

    // Check check workflow uses unpinned version
    const checkWorkflowPath = path.join(tempDir, ".github", "workflows", "check-reusable.yml");
    const checkWorkflow = await fs.readFile(checkWorkflowPath, "utf-8");
    expect(checkWorkflow).toContain("npm install -g agconf\n");
    expect(checkWorkflow).not.toContain("npm install -g agconf@");
  });

  it("should include repo full name with organization in workflow comments", async () => {
    await canonicalInitCommand({
      name: "my-standards",
      org: "acme-corp",
      dir: tempDir,
      markerPrefix: "agent-conf",
      includeExamples: false,
      yes: true,
    });

    const syncWorkflowPath = path.join(tempDir, ".github", "workflows", "sync-reusable.yml");
    const syncWorkflow = await fs.readFile(syncWorkflowPath, "utf-8");

    expect(syncWorkflow).toContain("acme-corp/my-standards/.github/workflows/sync-reusable.yml");
  });

  it("should handle repo name without organization in workflow comments", async () => {
    await canonicalInitCommand({
      name: "my-standards",
      dir: tempDir,
      markerPrefix: "agent-conf",
      includeExamples: false,
      yes: true,
    });

    const syncWorkflowPath = path.join(tempDir, ".github", "workflows", "sync-reusable.yml");
    const syncWorkflow = await fs.readFile(syncWorkflowPath, "utf-8");

    expect(syncWorkflow).toContain("my-standards/.github/workflows/sync-reusable.yml");
  });

  it("should use custom marker prefix in workflow content", async () => {
    await canonicalInitCommand({
      name: "test-standards",
      dir: tempDir,
      markerPrefix: "custom-prefix",
      includeExamples: false,
      yes: true,
    });

    const syncWorkflowPath = path.join(tempDir, ".github", "workflows", "sync-reusable.yml");
    const syncWorkflow = await fs.readFile(syncWorkflowPath, "utf-8");

    expect(syncWorkflow).toContain("# custom-prefix Auto-Sync Workflow");
    expect(syncWorkflow).toContain("custom-prefix/sync");
    expect(syncWorkflow).toContain("chore(custom-prefix):");
  });
});

describe("canonical init - smart defaults", () => {
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

describe("canonical init - workflow content validation", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-conf-workflow-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should generate valid YAML in sync workflow", async () => {
    await canonicalInitCommand({
      name: "test-standards",
      org: "test-org",
      dir: tempDir,
      markerPrefix: "agent-conf",
      includeExamples: false,
      yes: true,
    });

    const syncWorkflowPath = path.join(tempDir, ".github", "workflows", "sync-reusable.yml");
    const syncWorkflow = await fs.readFile(syncWorkflowPath, "utf-8");

    // Should parse as valid YAML
    const parsed = parseYaml(syncWorkflow);
    expect(parsed.name).toBe("Sync Reusable");
    expect(parsed.on.workflow_call).toBeDefined();
    expect(parsed.jobs.sync).toBeDefined();
  });

  it("should generate valid YAML in check workflow", async () => {
    await canonicalInitCommand({
      name: "test-standards",
      org: "test-org",
      dir: tempDir,
      markerPrefix: "agent-conf",
      includeExamples: false,
      yes: true,
    });

    const checkWorkflowPath = path.join(tempDir, ".github", "workflows", "check-reusable.yml");
    const checkWorkflow = await fs.readFile(checkWorkflowPath, "utf-8");

    // Should parse as valid YAML
    const parsed = parseYaml(checkWorkflow);
    expect(parsed.name).toBe("Check Reusable");
    expect(parsed.on.workflow_call).toBeDefined();
    expect(parsed.jobs.check).toBeDefined();
  });

  it("should include all required workflow steps", async () => {
    await canonicalInitCommand({
      name: "test-standards",
      dir: tempDir,
      markerPrefix: "agent-conf",
      includeExamples: false,
      yes: true,
    });

    const syncWorkflowPath = path.join(tempDir, ".github", "workflows", "sync-reusable.yml");
    const syncWorkflow = await fs.readFile(syncWorkflowPath, "utf-8");
    const parsed = parseYaml(syncWorkflow);

    // Verify sync workflow has expected steps
    const steps = parsed.jobs.sync.steps;
    const stepNames = steps.map((s: { name: string }) => s.name);

    expect(stepNames).toContain("Checkout");
    expect(stepNames).toContain("Setup Node.js");
    expect(stepNames).toContain("Install agent-conf CLI");
    expect(stepNames).toContain("Run sync");
    expect(stepNames).toContain("Check for changes");
  });

  it("should include workflow inputs and outputs", async () => {
    await canonicalInitCommand({
      name: "test-standards",
      dir: tempDir,
      markerPrefix: "agent-conf",
      includeExamples: false,
      yes: true,
    });

    const syncWorkflowPath = path.join(tempDir, ".github", "workflows", "sync-reusable.yml");
    const syncWorkflow = await fs.readFile(syncWorkflowPath, "utf-8");
    const parsed = parseYaml(syncWorkflow);

    // Verify inputs
    const inputs = parsed.on.workflow_call.inputs;
    expect(inputs.force).toBeDefined();
    expect(inputs.commit_strategy).toBeDefined();
    expect(inputs.pr_branch_prefix).toBeDefined();

    // Verify outputs
    const outputs = parsed.on.workflow_call.outputs;
    expect(outputs.changes_detected).toBeDefined();
    expect(outputs.pr_number).toBeDefined();
    expect(outputs.pr_url).toBeDefined();
  });
});
