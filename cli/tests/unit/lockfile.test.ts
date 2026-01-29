import { describe, expect, it } from "vitest";
import { hashContent } from "../../src/core/lockfile.js";
import { LockfileSchema } from "../../src/schemas/lockfile.js";

describe("lockfile", () => {
  describe("LockfileSchema", () => {
    it("should validate a valid GitHub source lockfile", () => {
      const lockfile = {
        version: "1" as const,
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
          skills: ["conventional-commits", "git-conventions"],
        },
        cli_version: "1.0.0",
      };

      const result = LockfileSchema.safeParse(lockfile);
      expect(result.success).toBe(true);
    });

    it("should validate a valid local source lockfile", () => {
      const lockfile = {
        version: "1" as const,
        synced_at: "2026-01-27T15:30:00.000Z",
        source: {
          type: "local" as const,
          path: "/path/to/agent-conf",
          commit_sha: "abc1234567890",
        },
        content: {
          agents_md: {
            global_block_hash: "sha256:abc123def456",
            merged: false,
          },
          skills: [],
        },
        cli_version: "1.0.0",
      };

      const result = LockfileSchema.safeParse(lockfile);
      expect(result.success).toBe(true);
    });

    it("should allow local source without commit_sha", () => {
      const lockfile = {
        version: "1" as const,
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
        cli_version: "1.0.0",
      };

      const result = LockfileSchema.safeParse(lockfile);
      expect(result.success).toBe(true);
    });

    it("should reject invalid version", () => {
      const lockfile = {
        version: "2",
        synced_at: "2026-01-27T15:30:00.000Z",
        source: {
          type: "github",
          repository: "org/agent-conf",
          commit_sha: "abc1234567890",
          ref: "master",
        },
        content: {
          agents_md: {
            global_block_hash: "sha256:abc123def456",
            merged: true,
          },
          skills: [],
        },
        cli_version: "1.0.0",
      };

      const result = LockfileSchema.safeParse(lockfile);
      expect(result.success).toBe(false);
    });

    it("should reject invalid datetime", () => {
      const lockfile = {
        version: "1",
        synced_at: "not-a-date",
        source: {
          type: "github",
          repository: "org/agent-conf",
          commit_sha: "abc1234567890",
          ref: "master",
        },
        content: {
          agents_md: {
            global_block_hash: "sha256:abc123def456",
            merged: true,
          },
          skills: [],
        },
        cli_version: "1.0.0",
      };

      const result = LockfileSchema.safeParse(lockfile);
      expect(result.success).toBe(false);
    });
  });

  describe("hashContent", () => {
    it("should produce consistent hashes", () => {
      const content = "Hello, World!";
      const hash1 = hashContent(content);
      const hash2 = hashContent(content);

      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different content", () => {
      const hash1 = hashContent("Hello");
      const hash2 = hashContent("World");

      expect(hash1).not.toBe(hash2);
    });

    it("should produce sha256 prefixed hashes", () => {
      const hash = hashContent("test");
      expect(hash).toMatch(/^sha256:[a-f0-9]{12}$/);
    });
  });
});
