import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractWorkflowRef,
  formatWorkflowRef,
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
  updateWorkflowRef,
} from "../../src/core/workflows.js";

const SOURCE_REPO = "org/agent-conf";
const DEFAULT_CONFIG = getWorkflowConfig(SOURCE_REPO);
const WORKFLOW_FILES = getWorkflowFiles(DEFAULT_CONFIG);

describe("workflows", () => {
  describe("extractWorkflowRef", () => {
    it("extracts version ref from workflow content", () => {
      const content = `
name: agent-conf Sync
jobs:
  sync:
    uses: org/agent-conf/.github/workflows/sync-reusable.yml@v1.2.3
`;
      expect(extractWorkflowRef(content, "sync-reusable.yml", SOURCE_REPO)).toBe("v1.2.3");
    });

    it("extracts branch ref from workflow content", () => {
      const content = `
name: agent-conf Sync
jobs:
  sync:
    uses: org/agent-conf/.github/workflows/sync-reusable.yml@master
`;
      expect(extractWorkflowRef(content, "sync-reusable.yml", SOURCE_REPO)).toBe("master");
    });

    it("returns undefined for non-matching workflow", () => {
      const content = `
name: agent-conf Sync
jobs:
  sync:
    uses: org/agent-conf/.github/workflows/sync-reusable.yml@v1.2.3
`;
      expect(extractWorkflowRef(content, "check-reusable.yml", SOURCE_REPO)).toBeUndefined();
    });

    it("returns undefined for content without workflow ref", () => {
      const content = `name: Some other workflow`;
      expect(extractWorkflowRef(content, "sync-reusable.yml", SOURCE_REPO)).toBeUndefined();
    });

    it("handles prerelease versions", () => {
      const content = `
    uses: org/agent-conf/.github/workflows/check-reusable.yml@v1.0.0-alpha
`;
      expect(extractWorkflowRef(content, "check-reusable.yml", SOURCE_REPO)).toBe("v1.0.0-alpha");
    });
  });

  describe("updateWorkflowRef", () => {
    it("updates version ref in workflow content", () => {
      const content = `
name: agent-conf Sync
jobs:
  sync:
    uses: org/agent-conf/.github/workflows/sync-reusable.yml@v1.0.0
`;
      const updated = updateWorkflowRef(content, "sync-reusable.yml", "v2.0.0", SOURCE_REPO);
      expect(updated).toContain("@v2.0.0");
      expect(updated).not.toContain("@v1.0.0");
    });

    it("updates branch ref to version ref", () => {
      const content = `
    uses: org/agent-conf/.github/workflows/sync-reusable.yml@master
`;
      const updated = updateWorkflowRef(content, "sync-reusable.yml", "v1.5.0", SOURCE_REPO);
      expect(updated).toContain("@v1.5.0");
      expect(updated).not.toContain("@master");
    });

    it("leaves non-matching workflows unchanged", () => {
      const content = `
    uses: org/agent-conf/.github/workflows/sync-reusable.yml@v1.0.0
`;
      const updated = updateWorkflowRef(content, "check-reusable.yml", "v2.0.0", SOURCE_REPO);
      expect(updated).toContain("@v1.0.0");
    });

    it("updates multiple occurrences", () => {
      const content = `
    uses: org/agent-conf/.github/workflows/sync-reusable.yml@v1.0.0
    uses: org/agent-conf/.github/workflows/sync-reusable.yml@v1.0.0
`;
      const updated = updateWorkflowRef(content, "sync-reusable.yml", "v2.0.0", SOURCE_REPO);
      const matches = updated.match(/@v2\.0\.0/g);
      expect(matches).toHaveLength(2);
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
      expect(content).toContain("Managed by agent-conf CLI");
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
      expect(content).toContain("agent_conf-release");
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
      expect(content).toContain("Managed by agent-conf CLI");
    });

    it("includes pull_request trigger", () => {
      const content = generateCheckWorkflow("v1.0.0", DEFAULT_CONFIG);
      expect(content).toContain("pull_request:");
    });

    it("includes push trigger", () => {
      const content = generateCheckWorkflow("v1.0.0", DEFAULT_CONFIG);
      expect(content).toContain("push:");
    });

    it("watches skills directories", () => {
      const content = generateCheckWorkflow("v1.0.0", DEFAULT_CONFIG);
      expect(content).toContain(".claude/skills/**");
      expect(content).toContain(".codex/skills/**");
      expect(content).toContain("AGENTS.md");
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
      expect(() => generateWorkflow(unknownWorkflow, "v1.0.0", DEFAULT_CONFIG)).toThrow("Unknown workflow");
    });
  });

  describe("formatWorkflowRef", () => {
    it("formats version with v prefix", () => {
      expect(formatWorkflowRef("1.2.3", true)).toBe("v1.2.3");
    });

    it("preserves existing v prefix for version", () => {
      expect(formatWorkflowRef("v1.2.3", true)).toBe("v1.2.3");
    });

    it("returns branch name as-is", () => {
      expect(formatWorkflowRef("master", false)).toBe("master");
      expect(formatWorkflowRef("develop", false)).toBe("develop");
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
      tempDir = await fs.mkdtemp(path.join("/tmp", "agent-conf-test-"));
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
        const content = `# Managed by agent-conf
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
  });
});
