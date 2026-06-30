import { describe, expect, it } from "vitest";
import {
  CanonicalPathsSchema,
  CanonicalRepoConfigSchema,
  PluginDefinitionSchema,
  PluginsConfigSchema,
} from "../../src/config/schema.js";

describe("plugins-schema", () => {
  describe("CanonicalPathsSchema mcp_servers_dir", () => {
    it("is optional and defaults to undefined", () => {
      const result = CanonicalPathsSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.mcp_servers_dir).toBeUndefined();
    });

    it("accepts an mcp_servers_dir", () => {
      const result = CanonicalPathsSchema.safeParse({ mcp_servers_dir: "mcps" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.mcp_servers_dir).toBe("mcps");
    });
  });

  describe("PluginsConfigSchema", () => {
    it("requires a marketplace name", () => {
      expect(PluginsConfigSchema.safeParse({}).success).toBe(false);
      expect(PluginsConfigSchema.safeParse({ marketplace: {} }).success).toBe(false);
    });

    it("defaults output_dir to 'plugins'", () => {
      const result = PluginsConfigSchema.safeParse({ marketplace: { name: "acme-tools" } });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.output_dir).toBe("plugins");
        expect(result.data.definitions).toBeUndefined();
      }
    });

    it("accepts owner, display_name, version and definitions", () => {
      const result = PluginsConfigSchema.safeParse({
        version: "1.2.0",
        marketplace: {
          name: "acme-tools",
          owner: { name: "Acme Corp", email: "dev@acme.com" },
          display_name: "Acme Tools",
        },
        targets: ["claude", "codex"],
        definitions: [
          { name: "frontend", skills: ["react-*"], agents: ["ui-reviewer"], mcps: ["figma"] },
        ],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBe("1.2.0");
        expect(result.data.marketplace.owner?.name).toBe("Acme Corp");
        expect(result.data.targets).toEqual(["claude", "codex"]);
        expect(result.data.definitions?.[0]?.skills).toEqual(["react-*"]);
      }
    });

    it("rejects a non-semver version", () => {
      const result = PluginsConfigSchema.safeParse({
        version: "v1",
        marketplace: { name: "x" },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("PluginDefinitionSchema selector semantics", () => {
    it("distinguishes omitted (undefined) from empty array", () => {
      const omitted = PluginDefinitionSchema.parse({ name: "p" });
      expect(omitted.skills).toBeUndefined();

      const empty = PluginDefinitionSchema.parse({ name: "p", skills: [] });
      expect(empty.skills).toEqual([]);
    });
  });

  describe("CanonicalRepoConfigSchema integration", () => {
    it("parses a config without a plugins block (backward compatible)", () => {
      const result = CanonicalRepoConfigSchema.safeParse({
        version: "1.0.0",
        meta: { name: "acme" },
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.plugins).toBeUndefined();
    });

    it("parses a config with a plugins block", () => {
      const result = CanonicalRepoConfigSchema.safeParse({
        version: "1.0.0",
        meta: { name: "acme" },
        plugins: { marketplace: { name: "acme-tools" } },
      });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.plugins?.marketplace.name).toBe("acme-tools");
    });
  });
});
