import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify as stringifyYaml } from "yaml";
import { loadDownstreamConfig } from "../../src/config/loader.js";
import { DownstreamConfigSchema, WorkflowConfigSchema } from "../../src/config/schema.js";

describe("downstream config", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join("/tmp", "agconf-downstream-config-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("WorkflowConfigSchema", () => {
    it("parses valid config with all fields", () => {
      const config = {
        commit_strategy: "direct",
        pr_branch_prefix: "agconf/sync",
        pr_title: "chore: sync standards",
        commit_message: "chore: sync engineering standards",
        reviewers: "alice,bob",
      };
      const result = WorkflowConfigSchema.parse(config);
      expect(result.commit_strategy).toBe("direct");
      expect(result.pr_branch_prefix).toBe("agconf/sync");
      expect(result.pr_title).toBe("chore: sync standards");
      expect(result.commit_message).toBe("chore: sync engineering standards");
      expect(result.reviewers).toBe("alice,bob");
    });

    it("uses default commit_strategy when not provided", () => {
      const config = {};
      const result = WorkflowConfigSchema.parse(config);
      expect(result.commit_strategy).toBe("pr");
    });

    it("rejects invalid commit_strategy", () => {
      const config = { commit_strategy: "invalid" };
      expect(() => WorkflowConfigSchema.parse(config)).toThrow();
    });

    it("accepts 'pr' commit_strategy", () => {
      const config = { commit_strategy: "pr" };
      const result = WorkflowConfigSchema.parse(config);
      expect(result.commit_strategy).toBe("pr");
    });

    it("accepts 'direct' commit_strategy", () => {
      const config = { commit_strategy: "direct" };
      const result = WorkflowConfigSchema.parse(config);
      expect(result.commit_strategy).toBe("direct");
    });

    it("allows optional fields to be omitted", () => {
      const config = { commit_strategy: "pr" };
      const result = WorkflowConfigSchema.parse(config);
      expect(result.pr_branch_prefix).toBeUndefined();
      expect(result.pr_title).toBeUndefined();
      expect(result.commit_message).toBeUndefined();
      expect(result.reviewers).toBeUndefined();
    });
  });

  describe("DownstreamConfigSchema", () => {
    it("parses config with workflow settings", () => {
      const config = {
        workflow: {
          commit_strategy: "direct",
          commit_message: "chore: sync",
        },
      };
      const result = DownstreamConfigSchema.parse(config);
      expect(result.workflow?.commit_strategy).toBe("direct");
      expect(result.workflow?.commit_message).toBe("chore: sync");
    });

    it("parses config without workflow settings", () => {
      const config = {
        targets: ["claude"],
      };
      const result = DownstreamConfigSchema.parse(config);
      expect(result.workflow).toBeUndefined();
      expect(result.targets).toEqual(["claude"]);
    });

    it("parses empty config", () => {
      const config = {};
      const result = DownstreamConfigSchema.parse(config);
      expect(result.workflow).toBeUndefined();
    });

    it("parses config with all fields", () => {
      const config = {
        sources: [{ repository: "acme/standards", ref: "v1.0.0" }],
        targets: ["claude", "codex"],
        workflow: {
          commit_strategy: "pr",
          pr_title: "Update standards",
          reviewers: "team-leads",
        },
      };
      const result = DownstreamConfigSchema.parse(config);
      expect(result.sources?.[0].repository).toBe("acme/standards");
      expect(result.targets).toEqual(["claude", "codex"]);
      expect(result.workflow?.commit_strategy).toBe("pr");
    });
  });

  describe("loadDownstreamConfig", () => {
    it("returns undefined when config file does not exist", async () => {
      const result = await loadDownstreamConfig(tempDir);
      expect(result).toBeUndefined();
    });

    it("returns undefined when .agconf directory does not exist", async () => {
      const result = await loadDownstreamConfig(tempDir);
      expect(result).toBeUndefined();
    });

    it("loads valid config from .agconf/config.yaml", async () => {
      const agconfDir = path.join(tempDir, ".agconf");
      await fs.mkdir(agconfDir, { recursive: true });

      const config = {
        workflow: {
          commit_strategy: "direct",
          commit_message: "chore: sync standards",
        },
      };
      await fs.writeFile(path.join(agconfDir, "config.yaml"), stringifyYaml(config));

      const result = await loadDownstreamConfig(tempDir);
      expect(result).toBeDefined();
      expect(result?.workflow?.commit_strategy).toBe("direct");
      expect(result?.workflow?.commit_message).toBe("chore: sync standards");
    });

    it("loads config with all workflow settings", async () => {
      const agconfDir = path.join(tempDir, ".agconf");
      await fs.mkdir(agconfDir, { recursive: true });

      const config = {
        workflow: {
          commit_strategy: "pr",
          pr_branch_prefix: "agconf/sync",
          pr_title: "chore(agconf): sync agent configuration",
          commit_message: "chore: sync engineering standards",
          reviewers: "alice,bob,charlie",
        },
      };
      await fs.writeFile(path.join(agconfDir, "config.yaml"), stringifyYaml(config));

      const result = await loadDownstreamConfig(tempDir);
      expect(result?.workflow?.commit_strategy).toBe("pr");
      expect(result?.workflow?.pr_branch_prefix).toBe("agconf/sync");
      expect(result?.workflow?.pr_title).toBe("chore(agconf): sync agent configuration");
      expect(result?.workflow?.commit_message).toBe("chore: sync engineering standards");
      expect(result?.workflow?.reviewers).toBe("alice,bob,charlie");
    });

    it("throws error for invalid YAML", async () => {
      const agconfDir = path.join(tempDir, ".agconf");
      await fs.mkdir(agconfDir, { recursive: true });

      await fs.writeFile(path.join(agconfDir, "config.yaml"), "invalid: yaml: content: [");

      await expect(loadDownstreamConfig(tempDir)).rejects.toThrow();
    });

    it("throws error for invalid schema", async () => {
      const agconfDir = path.join(tempDir, ".agconf");
      await fs.mkdir(agconfDir, { recursive: true });

      const config = {
        workflow: {
          commit_strategy: "invalid_strategy", // Invalid enum value
        },
      };
      await fs.writeFile(path.join(agconfDir, "config.yaml"), stringifyYaml(config));

      await expect(loadDownstreamConfig(tempDir)).rejects.toThrow();
    });

    it("loads config without workflow section", async () => {
      const agconfDir = path.join(tempDir, ".agconf");
      await fs.mkdir(agconfDir, { recursive: true });

      const config = {
        targets: ["claude"],
      };
      await fs.writeFile(path.join(agconfDir, "config.yaml"), stringifyYaml(config));

      const result = await loadDownstreamConfig(tempDir);
      expect(result).toBeDefined();
      expect(result?.workflow).toBeUndefined();
      expect(result?.targets).toEqual(["claude"]);
    });

    it("throws error for empty config file", async () => {
      const agconfDir = path.join(tempDir, ".agconf");
      await fs.mkdir(agconfDir, { recursive: true });

      await fs.writeFile(path.join(agconfDir, "config.yaml"), "");

      // Empty YAML parses to null, which fails schema validation
      await expect(loadDownstreamConfig(tempDir)).rejects.toThrow();
    });

    it("loads config with just empty object", async () => {
      const agconfDir = path.join(tempDir, ".agconf");
      await fs.mkdir(agconfDir, { recursive: true });

      await fs.writeFile(path.join(agconfDir, "config.yaml"), "{}");

      const result = await loadDownstreamConfig(tempDir);
      expect(result).toBeDefined();
      expect(result?.workflow).toBeUndefined();
    });
  });
});
