import { describe, expect, it } from "vitest";
import {
  CanonicalPathsSchema,
  DEFAULT_CONFIG,
  getRulesMarkers,
  ResolvedConfigSchema,
} from "../../src/config/schema.js";
import { ContentSchema, LockfileSchema, RulesContentSchema } from "../../src/schemas/lockfile.js";

describe("rules-schema", () => {
  describe("CanonicalPathsSchema", () => {
    it("should validate without rules_dir (optional)", () => {
      const config = {
        instructions: "instructions/AGENTS.md",
        skills_dir: "skills",
      };

      const result = CanonicalPathsSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("should validate with rules_dir", () => {
      const config = {
        instructions: "instructions/AGENTS.md",
        skills_dir: "skills",
        rules_dir: "rules",
      };

      const result = CanonicalPathsSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.rules_dir).toBe("rules");
      }
    });

    it("should default rules_dir to undefined (not a string default)", () => {
      const config = {};

      const result = CanonicalPathsSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.rules_dir).toBeUndefined();
      }
    });

    it("should accept nested rules directory paths", () => {
      const config = {
        rules_dir: "content/rules/global",
      };

      const result = CanonicalPathsSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.rules_dir).toBe("content/rules/global");
      }
    });
  });

  describe("ResolvedConfigSchema", () => {
    it("should validate without rulesDir (optional)", () => {
      const config = {
        name: "test-config",
        instructionsPath: "instructions/AGENTS.md",
        skillsDir: "skills",
        markerPrefix: "agent-conf",
        targets: ["claude"],
        preserveRepoContent: true,
      };

      const result = ResolvedConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it("should validate with rulesDir", () => {
      const config = {
        name: "test-config",
        instructionsPath: "instructions/AGENTS.md",
        skillsDir: "skills",
        rulesDir: "rules",
        markerPrefix: "agent-conf",
        targets: ["claude"],
        preserveRepoContent: true,
      };

      const result = ResolvedConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.rulesDir).toBe("rules");
      }
    });
  });

  describe("DEFAULT_CONFIG", () => {
    it("should not have a rulesDir set (undefined by default)", () => {
      expect(DEFAULT_CONFIG.rulesDir).toBeUndefined();
    });
  });

  describe("getRulesMarkers", () => {
    it("should generate correct markers with default prefix", () => {
      const markers = getRulesMarkers("agent-conf");

      expect(markers.rulesStart).toBe("<!-- agent-conf:rules:start -->");
      expect(markers.rulesEnd).toBe("<!-- agent-conf:rules:end -->");
    });

    it("should generate correct markers with custom prefix", () => {
      const markers = getRulesMarkers("acme-standards");

      expect(markers.rulesStart).toBe("<!-- acme-standards:rules:start -->");
      expect(markers.rulesEnd).toBe("<!-- acme-standards:rules:end -->");
    });

    it("should handle prefix with special characters", () => {
      const markers = getRulesMarkers("my_custom-prefix");

      expect(markers.rulesStart).toBe("<!-- my_custom-prefix:rules:start -->");
      expect(markers.rulesEnd).toBe("<!-- my_custom-prefix:rules:end -->");
    });
  });

  describe("RulesContentSchema", () => {
    it("should validate with files array and content_hash", () => {
      const rulesContent = {
        files: ["code-style.md", "security/api-auth.md"],
        content_hash: "sha256:abc123def456",
      };

      const result = RulesContentSchema.safeParse(rulesContent);
      expect(result.success).toBe(true);
    });

    it("should validate with empty files array", () => {
      const rulesContent = {
        files: [],
        content_hash: "sha256:abc123def456",
      };

      const result = RulesContentSchema.safeParse(rulesContent);
      expect(result.success).toBe(true);
    });

    it("should require files array", () => {
      const rulesContent = {
        content_hash: "sha256:abc123def456",
      };

      const result = RulesContentSchema.safeParse(rulesContent);
      expect(result.success).toBe(false);
    });

    it("should require content_hash", () => {
      const rulesContent = {
        files: ["code-style.md"],
      };

      const result = RulesContentSchema.safeParse(rulesContent);
      expect(result.success).toBe(false);
    });
  });

  describe("ContentSchema with rules", () => {
    it("should validate lockfile content without rules (backward compat)", () => {
      const content = {
        agents_md: {
          global_block_hash: "sha256:abc123def456",
          merged: true,
        },
        skills: ["conventional-commits"],
      };

      const result = ContentSchema.safeParse(content);
      expect(result.success).toBe(true);
    });

    it("should validate lockfile content with rules", () => {
      const content = {
        agents_md: {
          global_block_hash: "sha256:abc123def456",
          merged: true,
        },
        skills: ["conventional-commits"],
        rules: {
          files: ["code-style.md", "security/api-auth.md"],
          content_hash: "sha256:rules123hash",
        },
      };

      const result = ContentSchema.safeParse(content);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.rules).toBeDefined();
        expect(result.data.rules?.files).toEqual(["code-style.md", "security/api-auth.md"]);
        expect(result.data.rules?.content_hash).toBe("sha256:rules123hash");
      }
    });

    it("should allow rules to be undefined for optional backward compat", () => {
      const content = {
        agents_md: {
          global_block_hash: "sha256:abc123def456",
          merged: false,
        },
        skills: [],
      };

      const result = ContentSchema.safeParse(content);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.rules).toBeUndefined();
      }
    });
  });

  describe("LockfileSchema with rules", () => {
    it("should validate full lockfile with rules", () => {
      const lockfile = {
        version: "1.0.0",
        synced_at: "2026-01-27T15:30:00.000Z",
        source: {
          type: "github" as const,
          repository: "org/agent-conf",
          commit_sha: "abc1234567890",
          ref: "master",
        },
        content: {
          agents_md: {
            global_block_hash: "sha256:abc123def456",
            merged: true,
          },
          skills: ["conventional-commits"],
          rules: {
            files: ["code-style.md", "security/api-auth.md", "testing/coverage.md"],
            content_hash: "sha256:rulesContentHash",
          },
        },
        cli_version: "1.0.0",
      };

      const result = LockfileSchema.safeParse(lockfile);
      expect(result.success).toBe(true);
    });

    it("should validate lockfile without rules for backward compatibility", () => {
      const lockfile = {
        version: "1.0.0",
        synced_at: "2026-01-27T15:30:00.000Z",
        source: {
          type: "local" as const,
          path: "/path/to/agent-conf",
        },
        content: {
          agents_md: {
            global_block_hash: "sha256:abc123def456",
            merged: false,
          },
          skills: [],
        },
      };

      const result = LockfileSchema.safeParse(lockfile);
      expect(result.success).toBe(true);
    });
  });
});
