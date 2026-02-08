import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowConfig as WorkflowConfigSchema } from "../../src/config/schema.js";
import {
  extractWorkflowRef,
  generateCheckWorkflow,
  generateSyncWorkflow,
  generateWorkflow,
  getCurrentWorkflowVersion,
  getWorkflowConfig,
  getWorkflowFiles,
  getWorkflowPath,
  getWorkflowStatus,
  getWorkflowsDir,
  syncWorkflows,
  toWorkflowSettings,
  updateWorkflowRef,
  type WorkflowSettings,
} from "../../src/core/workflows.js";

const SOURCE_REPO = "org/agconf";
const DEFAULT_CONFIG = getWorkflowConfig(SOURCE_REPO);
const WORKFLOW_FILES = getWorkflowFiles(DEFAULT_CONFIG);

describe("workflows", () => {
  describe("extractWorkflowRef", () => {
    it("extracts version ref from workflow content", () => {
      const content = `
name: agconf Sync
jobs:
  sync:
    uses: org/agconf/.github/workflows/sync-reusable.yml@v1.2.3
`;
      expect(extractWorkflowRef(content, "sync-reusable.yml", SOURCE_REPO)).toBe("v1.2.3");
    });

    it("extracts branch ref from workflow content", () => {
      const content = `
name: agconf Sync
jobs:
  sync:
    uses: org/agconf/.github/workflows/sync-reusable.yml@master
`;
      expect(extractWorkflowRef(content, "sync-reusable.yml", SOURCE_REPO)).toBe("master");
    });

    it("returns undefined for non-matching workflow", () => {
      const content = `
name: agconf Sync
jobs:
  sync:
    uses: org/agconf/.github/workflows/sync-reusable.yml@v1.2.3
`;
      expect(extractWorkflowRef(content, "check-reusable.yml", SOURCE_REPO)).toBeUndefined();
    });

    it("returns undefined for content without workflow ref", () => {
      const content = `name: Some other workflow`;
      expect(extractWorkflowRef(content, "sync-reusable.yml", SOURCE_REPO)).toBeUndefined();
    });

    it("handles prerelease versions", () => {
      const content = `
    uses: org/agconf/.github/workflows/check-reusable.yml@v1.0.0-alpha
`;
      expect(extractWorkflowRef(content, "check-reusable.yml", SOURCE_REPO)).toBe("v1.0.0-alpha");
    });
  });

  describe("updateWorkflowRef", () => {
    it("updates version ref in workflow content", () => {
      const content = `
name: agconf Sync
jobs:
  sync:
    uses: org/agconf/.github/workflows/sync-reusable.yml@v1.0.0
`;
      const updated = updateWorkflowRef(content, "sync-reusable.yml", "v2.0.0", SOURCE_REPO);
      expect(updated).toContain("@v2.0.0");
      expect(updated).not.toContain("@v1.0.0");
    });

    it("updates branch ref to version ref", () => {
      const content = `
    uses: org/agconf/.github/workflows/sync-reusable.yml@master
`;
      const updated = updateWorkflowRef(content, "sync-reusable.yml", "v1.5.0", SOURCE_REPO);
      expect(updated).toContain("@v1.5.0");
      expect(updated).not.toContain("@master");
    });

    it("leaves non-matching workflows unchanged", () => {
      const content = `
    uses: org/agconf/.github/workflows/sync-reusable.yml@v1.0.0
`;
      const updated = updateWorkflowRef(content, "check-reusable.yml", "v2.0.0", SOURCE_REPO);
      expect(updated).toContain("@v1.0.0");
    });

    it("updates multiple occurrences", () => {
      const content = `
    uses: org/agconf/.github/workflows/sync-reusable.yml@v1.0.0
    uses: org/agconf/.github/workflows/sync-reusable.yml@v1.0.0
`;
      const updated = updateWorkflowRef(content, "sync-reusable.yml", "v2.0.0", SOURCE_REPO);
      const matches = updated.match(/@v2\.0\.0/g);
      expect(matches).toHaveLength(2);
    });
  });

  describe("getWorkflowConfig", () => {
    it("uses default secretName when no config provided", () => {
      const config = getWorkflowConfig(SOURCE_REPO);
      expect(config.secretName).toBe("AGCONF_TOKEN");
    });

    it("derives secretName from markerPrefix", () => {
      const config = getWorkflowConfig(SOURCE_REPO, { markerPrefix: "fbagents" });
      expect(config.secretName).toBe("FBAGENTS_TOKEN");
    });

    it("converts markerPrefix dashes to underscores in secretName", () => {
      const config = getWorkflowConfig(SOURCE_REPO, { markerPrefix: "my-custom-prefix" });
      expect(config.secretName).toBe("MY_CUSTOM_PREFIX_TOKEN");
    });

    it("uses markerPrefix for secretName independent of name", () => {
      // Even if 'name' is provided, secretName should use markerPrefix
      const config = getWorkflowConfig(SOURCE_REPO, {
        name: "acme-standards",
        markerPrefix: "acme",
      });
      expect(config.secretName).toBe("ACME_TOKEN");
    });

    it("derives workflowPrefix from markerPrefix", () => {
      const config = getWorkflowConfig(SOURCE_REPO, { markerPrefix: "fbagents" });
      expect(config.workflowPrefix).toBe("fbagents");
    });

    it("uses markerPrefix for workflowPrefix independent of name", () => {
      const config = getWorkflowConfig(SOURCE_REPO, {
        name: "acme-standards",
        markerPrefix: "acme",
      });
      expect(config.workflowPrefix).toBe("acme");
    });
  });

  describe("getWorkflowFiles", () => {
    it("uses workflowPrefix for filenames", () => {
      const config = getWorkflowConfig(SOURCE_REPO, { markerPrefix: "fbagents" });
      const files = getWorkflowFiles(config);
      expect(files[0].filename).toBe("fbagents-sync.yml");
      expect(files[1].filename).toBe("fbagents-check.yml");
    });
  });

  describe("generateSyncWorkflow", () => {
    it("generates workflow with correct version ref", () => {
      const content = generateSyncWorkflow("v1.2.3", DEFAULT_CONFIG);
      expect(content).toContain("@v1.2.3");
      expect(content).toContain("sync-reusable.yml@v1.2.3");
    });

    it("includes managed by comment", () => {
      const content = generateSyncWorkflow("v1.0.0", DEFAULT_CONFIG);
      expect(content).toContain("Managed by agconf CLI");
    });

    it("includes schedule trigger", () => {
      const content = generateSyncWorkflow("v1.0.0", DEFAULT_CONFIG);
      expect(content).toContain("schedule:");
      expect(content).toContain("cron:");
    });

    it("includes workflow_dispatch trigger", () => {
      const content = generateSyncWorkflow("v1.0.0", DEFAULT_CONFIG);
      expect(content).toContain("workflow_dispatch:");
    });

    it("includes repository_dispatch trigger", () => {
      const content = generateSyncWorkflow("v1.0.0", DEFAULT_CONFIG);
      expect(content).toContain("repository_dispatch:");
      expect(content).toContain("agconf-release");
    });

    it("uses custom secret name from markerPrefix", () => {
      const customConfig = getWorkflowConfig(SOURCE_REPO, { markerPrefix: "fbagents" });
      const content = generateSyncWorkflow("v1.0.0", customConfig);
      expect(content).toContain("secrets.FBAGENTS_TOKEN");
      expect(content).not.toContain("secrets.AGCONF_TOKEN");
    });

    it("uses markerPrefix for workflow name and identifiers", () => {
      const customConfig = getWorkflowConfig(SOURCE_REPO, { markerPrefix: "fbagents" });
      const content = generateSyncWorkflow("v1.0.0", customConfig);
      expect(content).toContain("name: fbagents Sync");
      expect(content).toContain("group: fbagents-sync");
      expect(content).toContain("types: [fbagents-release]");
      expect(content).not.toContain("name: agconf Sync");
    });

    describe("with WorkflowSettings", () => {
      it("includes commit_strategy when provided", () => {
        const settings: WorkflowSettings = { commit_strategy: "direct" };
        const content = generateSyncWorkflow("v1.0.0", DEFAULT_CONFIG, settings);
        expect(content).toContain("commit_strategy: 'direct'");
      });

      it("includes pr_branch_prefix when provided", () => {
        const settings: WorkflowSettings = { pr_branch_prefix: "agconf/update" };
        const content = generateSyncWorkflow("v1.0.0", DEFAULT_CONFIG, settings);
        expect(content).toContain("pr_branch_prefix: 'agconf/update'");
      });

      it("includes pr_title when provided", () => {
        const settings: WorkflowSettings = { pr_title: "chore(agconf): sync standards" };
        const content = generateSyncWorkflow("v1.0.0", DEFAULT_CONFIG, settings);
        expect(content).toContain("pr_title: 'chore(agconf): sync standards'");
      });

      it("includes commit_message when provided", () => {
        const settings: WorkflowSettings = { commit_message: "chore: sync engineering standards" };
        const content = generateSyncWorkflow("v1.0.0", DEFAULT_CONFIG, settings);
        expect(content).toContain("commit_message: 'chore: sync engineering standards'");
      });

      it("includes static reviewers when provided", () => {
        const settings: WorkflowSettings = { reviewers: "alice,bob" };
        const content = generateSyncWorkflow("v1.0.0", DEFAULT_CONFIG, settings);
        expect(content).toContain("reviewers: 'alice,bob'");
        // Should not use vars when static reviewers are provided
        expect(content).not.toContain("vars.AGCONF_REVIEWERS");
      });

      it("uses vars for reviewers when not provided in settings", () => {
        const settings: WorkflowSettings = { commit_strategy: "pr" };
        const content = generateSyncWorkflow("v1.0.0", DEFAULT_CONFIG, settings);
        expect(content).toContain("vars.AGCONF_REVIEWERS");
      });

      it("includes all settings together", () => {
        const settings: WorkflowSettings = {
          commit_strategy: "direct",
          pr_branch_prefix: "sync/update",
          pr_title: "Update standards",
          commit_message: "chore: sync",
          reviewers: "admin",
        };
        const content = generateSyncWorkflow("v1.0.0", DEFAULT_CONFIG, settings);
        expect(content).toContain("commit_strategy: 'direct'");
        expect(content).toContain("pr_branch_prefix: 'sync/update'");
        expect(content).toContain("pr_title: 'Update standards'");
        expect(content).toContain("commit_message: 'chore: sync'");
        expect(content).toContain("reviewers: 'admin'");
      });

      it("generates default workflow when settings is undefined", () => {
        const content = generateSyncWorkflow("v1.0.0", DEFAULT_CONFIG, undefined);
        expect(content).toContain("vars.AGCONF_REVIEWERS");
        expect(content).not.toContain("commit_strategy:");
        expect(content).not.toContain("pr_branch_prefix:");
        expect(content).not.toContain("pr_title:");
        expect(content).not.toContain("commit_message:");
      });

      it("generates default workflow when settings is empty object", () => {
        const settings: WorkflowSettings = {};
        const content = generateSyncWorkflow("v1.0.0", DEFAULT_CONFIG, settings);
        expect(content).toContain("vars.AGCONF_REVIEWERS");
        expect(content).not.toContain("commit_strategy:");
        expect(content).not.toContain("pr_branch_prefix:");
      });
    });
  });

  describe("generateCheckWorkflow", () => {
    it("generates workflow with correct version ref", () => {
      const content = generateCheckWorkflow("v1.2.3", DEFAULT_CONFIG);
      expect(content).toContain("@v1.2.3");
      expect(content).toContain("check-reusable.yml@v1.2.3");
    });

    it("includes managed by comment", () => {
      const content = generateCheckWorkflow("v1.0.0", DEFAULT_CONFIG);
      expect(content).toContain("Managed by agconf CLI");
    });

    it("includes pull_request trigger", () => {
      const content = generateCheckWorkflow("v1.0.0", DEFAULT_CONFIG);
      expect(content).toContain("pull_request:");
    });

    it("includes push trigger", () => {
      const content = generateCheckWorkflow("v1.0.0", DEFAULT_CONFIG);
      expect(content).toContain("push:");
    });

    it("watches .claude and .codex directories", () => {
      const content = generateCheckWorkflow("v1.0.0", DEFAULT_CONFIG);
      expect(content).toContain(".claude/**");
      expect(content).toContain(".codex/**");
      expect(content).toContain("AGENTS.md");
    });

    it("uses markerPrefix for workflow name", () => {
      const customConfig = getWorkflowConfig(SOURCE_REPO, { markerPrefix: "fbagents" });
      const content = generateCheckWorkflow("v1.0.0", customConfig);
      expect(content).toContain("name: fbagents Check");
      expect(content).not.toContain("name: agconf Check");
    });
  });

  describe("generateWorkflow", () => {
    it("generates sync workflow for sync type", () => {
      const workflow = WORKFLOW_FILES.find((w) => w.name === "sync")!;
      const content = generateWorkflow(workflow, "v1.0.0", DEFAULT_CONFIG);
      expect(content).toContain("sync-reusable.yml@v1.0.0");
    });

    it("generates check workflow for check type", () => {
      const workflow = WORKFLOW_FILES.find((w) => w.name === "check")!;
      const content = generateWorkflow(workflow, "v1.0.0", DEFAULT_CONFIG);
      expect(content).toContain("check-reusable.yml@v1.0.0");
    });

    it("throws for unknown workflow type", () => {
      const unknownWorkflow = {
        name: "unknown",
        filename: "test.yml",
        reusableWorkflow: "test.yml",
      };
      expect(() => generateWorkflow(unknownWorkflow, "v1.0.0", DEFAULT_CONFIG)).toThrow(
        "Unknown workflow",
      );
    });
  });

  describe("getWorkflowsDir", () => {
    it("returns correct path", () => {
      expect(getWorkflowsDir("/repo")).toBe("/repo/.github/workflows");
    });
  });

  describe("getWorkflowPath", () => {
    it("returns correct path", () => {
      expect(getWorkflowPath("/repo", "test.yml")).toBe("/repo/.github/workflows/test.yml");
    });
  });

  describe("file operations", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(path.join("/tmp", "agconf-test-"));
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    describe("getWorkflowStatus", () => {
      it("returns exists: false for missing file", async () => {
        const workflow = WORKFLOW_FILES[0];
        const status = await getWorkflowStatus(tempDir, workflow, DEFAULT_CONFIG);
        expect(status.exists).toBe(false);
        expect(status.isManaged).toBe(false);
        expect(status.currentRef).toBeUndefined();
      });

      it("returns correct status for existing managed file", async () => {
        const workflow = WORKFLOW_FILES[0];
        const workflowsDir = path.join(tempDir, ".github/workflows");
        await fs.mkdir(workflowsDir, { recursive: true });
        const content = generateSyncWorkflow("v1.2.3", DEFAULT_CONFIG);
        await fs.writeFile(path.join(workflowsDir, workflow.filename), content);

        const status = await getWorkflowStatus(tempDir, workflow, DEFAULT_CONFIG);
        expect(status.exists).toBe(true);
        expect(status.isManaged).toBe(true);
        expect(status.currentRef).toBe("v1.2.3");
      });

      it("detects managed files by comment", async () => {
        const workflow = WORKFLOW_FILES[0];
        const workflowsDir = path.join(tempDir, ".github/workflows");
        await fs.mkdir(workflowsDir, { recursive: true });
        const content = `# Managed by agconf
name: Test
jobs: {}`;
        await fs.writeFile(path.join(workflowsDir, workflow.filename), content);

        const status = await getWorkflowStatus(tempDir, workflow, DEFAULT_CONFIG);
        expect(status.isManaged).toBe(true);
      });
    });

    describe("syncWorkflows", () => {
      it("creates workflow files when they don't exist", async () => {
        const result = await syncWorkflows(tempDir, "v1.0.0", SOURCE_REPO);

        expect(result.created).toHaveLength(2);
        expect(result.updated).toHaveLength(0);
        expect(result.unchanged).toHaveLength(0);

        // Verify files were created
        for (const workflow of WORKFLOW_FILES) {
          const filePath = getWorkflowPath(tempDir, workflow.filename);
          const content = await fs.readFile(filePath, "utf-8");
          expect(content).toContain("@v1.0.0");
        }
      });

      it("updates workflow files when version differs", async () => {
        // First sync at v1.0.0
        await syncWorkflows(tempDir, "v1.0.0", SOURCE_REPO);

        // Second sync at v2.0.0
        const result = await syncWorkflows(tempDir, "v2.0.0", SOURCE_REPO);

        expect(result.created).toHaveLength(0);
        expect(result.updated).toHaveLength(2);
        expect(result.unchanged).toHaveLength(0);

        // Verify files were updated
        for (const workflow of WORKFLOW_FILES) {
          const filePath = getWorkflowPath(tempDir, workflow.filename);
          const content = await fs.readFile(filePath, "utf-8");
          expect(content).toContain("@v2.0.0");
          expect(content).not.toContain("@v1.0.0");
        }
      });

      it("leaves workflow files unchanged when version matches", async () => {
        // First sync
        await syncWorkflows(tempDir, "v1.0.0", SOURCE_REPO);

        // Second sync at same version
        const result = await syncWorkflows(tempDir, "v1.0.0", SOURCE_REPO);

        expect(result.created).toHaveLength(0);
        expect(result.updated).toHaveLength(0);
        expect(result.unchanged).toHaveLength(2);
      });
    });

    describe("getCurrentWorkflowVersion", () => {
      it("returns undefined when no workflows exist", async () => {
        const version = await getCurrentWorkflowVersion(tempDir, SOURCE_REPO);
        expect(version).toBeUndefined();
      });

      it("returns version when all workflows have same version", async () => {
        await syncWorkflows(tempDir, "v1.5.0", SOURCE_REPO);

        const version = await getCurrentWorkflowVersion(tempDir, SOURCE_REPO);
        expect(version).toBe("v1.5.0");
      });

      it("returns undefined when workflows have mixed versions", async () => {
        // Create workflows with different versions
        const workflowsDir = path.join(tempDir, ".github/workflows");
        await fs.mkdir(workflowsDir, { recursive: true });

        const syncWorkflow = WORKFLOW_FILES.find((w) => w.name === "sync")!;
        const checkWorkflow = WORKFLOW_FILES.find((w) => w.name === "check")!;

        await fs.writeFile(
          path.join(workflowsDir, syncWorkflow.filename),
          generateSyncWorkflow("v1.0.0", DEFAULT_CONFIG),
        );
        await fs.writeFile(
          path.join(workflowsDir, checkWorkflow.filename),
          generateCheckWorkflow("v2.0.0", DEFAULT_CONFIG),
        );

        const version = await getCurrentWorkflowVersion(tempDir, SOURCE_REPO);
        expect(version).toBeUndefined();
      });
    });

    describe("syncWorkflows with settings", () => {
      it("applies workflow settings when creating workflows", async () => {
        const settings: WorkflowSettings = {
          commit_strategy: "direct",
          commit_message: "chore: sync",
        };
        await syncWorkflows(tempDir, "v1.0.0", SOURCE_REPO, {
          workflowSettings: settings,
        });

        const syncWorkflowPath = path.join(tempDir, ".github/workflows/agconf-sync.yml");
        const content = await fs.readFile(syncWorkflowPath, "utf-8");
        expect(content).toContain("commit_strategy: 'direct'");
        expect(content).toContain("commit_message: 'chore: sync'");
      });

      it("applies workflow settings when updating workflows", async () => {
        // First sync without settings
        await syncWorkflows(tempDir, "v1.0.0", SOURCE_REPO);

        // Second sync with settings - should update
        const settings: WorkflowSettings = { commit_strategy: "direct" };
        const result = await syncWorkflows(tempDir, "v1.0.0", SOURCE_REPO, {
          workflowSettings: settings,
        });

        // sync workflow should be updated (settings changed), check workflow unchanged
        expect(result.updated).toContain("agconf-sync.yml");
        expect(result.unchanged).toContain("agconf-check.yml");

        const syncWorkflowPath = path.join(tempDir, ".github/workflows/agconf-sync.yml");
        const content = await fs.readFile(syncWorkflowPath, "utf-8");
        expect(content).toContain("commit_strategy: 'direct'");
      });

      it("supports both resolvedConfig and workflowSettings", async () => {
        const settings: WorkflowSettings = { commit_strategy: "direct" };
        await syncWorkflows(tempDir, "v1.0.0", SOURCE_REPO, {
          resolvedConfig: { markerPrefix: "custom" },
          workflowSettings: settings,
        });

        // Should use custom prefix for filenames
        const syncWorkflowPath = path.join(tempDir, ".github/workflows/custom-sync.yml");
        const content = await fs.readFile(syncWorkflowPath, "utf-8");
        expect(content).toContain("commit_strategy: 'direct'");
        expect(content).toContain("name: custom Sync");
      });

      it("maintains backward compatibility with old signature", async () => {
        // Old signature: syncWorkflows(repoRoot, ref, sourceRepo, resolvedConfig)
        await syncWorkflows(tempDir, "v1.0.0", SOURCE_REPO, {
          markerPrefix: "legacy",
        });

        const syncWorkflowPath = path.join(tempDir, ".github/workflows/legacy-sync.yml");
        const content = await fs.readFile(syncWorkflowPath, "utf-8");
        expect(content).toContain("name: legacy Sync");
      });
    });
  });

  describe("toWorkflowSettings", () => {
    it("returns undefined when config is undefined", () => {
      expect(toWorkflowSettings(undefined)).toBeUndefined();
    });

    it("converts full config to settings", () => {
      const config: WorkflowConfigSchema = {
        commit_strategy: "direct",
        pr_branch_prefix: "agconf/sync",
        pr_title: "Sync standards",
        commit_message: "chore: sync",
        reviewers: "alice,bob",
      };
      const settings = toWorkflowSettings(config);
      expect(settings).toEqual({
        commit_strategy: "direct",
        pr_branch_prefix: "agconf/sync",
        pr_title: "Sync standards",
        commit_message: "chore: sync",
        reviewers: "alice,bob",
      });
    });

    it("only includes defined properties", () => {
      const config: WorkflowConfigSchema = {
        commit_strategy: "pr",
      };
      const settings = toWorkflowSettings(config);
      expect(settings).toEqual({ commit_strategy: "pr" });
      expect(settings).not.toHaveProperty("pr_branch_prefix");
      expect(settings).not.toHaveProperty("pr_title");
      expect(settings).not.toHaveProperty("commit_message");
      expect(settings).not.toHaveProperty("reviewers");
    });

    it("handles default commit_strategy value", () => {
      const config: WorkflowConfigSchema = {
        commit_strategy: "pr", // default value from schema
      };
      const settings = toWorkflowSettings(config);
      expect(settings?.commit_strategy).toBe("pr");
    });
  });
});
