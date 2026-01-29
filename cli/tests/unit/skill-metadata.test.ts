import { describe, expect, it } from "vitest";
import {
  addManagedMetadata,
  computeContentHash,
  hasManualChanges,
  isManaged,
  parseFrontmatter,
  stripManagedMetadata,
} from "../../src/core/skill-metadata.js";

const SAMPLE_SKILL = `---
name: test-skill
description: A test skill for unit testing.
---

# Test Skill

This is the skill content.
`;

const SAMPLE_SKILL_WITH_METADATA = `---
name: test-skill
description: A test skill for unit testing.
metadata:
  author: test-author
  version: "1.0"
---

# Test Skill

This is the skill content.
`;

describe("skill-metadata", () => {
  describe("parseFrontmatter", () => {
    it("parses simple frontmatter", () => {
      const { frontmatter, body } = parseFrontmatter(SAMPLE_SKILL);

      expect(frontmatter.name).toBe("test-skill");
      expect(frontmatter.description).toBe("A test skill for unit testing.");
      expect(body.trim()).toBe("# Test Skill\n\nThis is the skill content.");
    });

    it("parses frontmatter with nested metadata", () => {
      const { frontmatter } = parseFrontmatter(SAMPLE_SKILL_WITH_METADATA);

      expect(frontmatter.name).toBe("test-skill");
      expect(frontmatter.metadata).toEqual({
        author: "test-author",
        version: "1.0",
      });
    });

    it("handles content without frontmatter", () => {
      const content = "# Just content\n\nNo frontmatter here.";
      const { frontmatter, body } = parseFrontmatter(content);

      expect(Object.keys(frontmatter)).toHaveLength(0);
      expect(body).toBe(content);
    });
  });

  describe("addManagedMetadata", () => {
    it("adds metadata to skill without existing metadata", () => {
      const result = addManagedMetadata(SAMPLE_SKILL);

      expect(result).toContain('agent_conf_managed: "true"');
      expect(result).toContain('agent_conf_content_hash: "sha256:');
      // Should NOT contain source or synced_at (those are in lockfile only)
      expect(result).not.toContain("agent_conf_source");
      expect(result).not.toContain("agent_conf_synced_at");
      // Original content should be preserved
      expect(result).toContain("name: test-skill");
      expect(result).toContain("# Test Skill");
    });

    it("adds metadata to skill with existing metadata", () => {
      const result = addManagedMetadata(SAMPLE_SKILL_WITH_METADATA);

      // Should preserve existing metadata
      expect(result).toContain("author: test-author");
      expect(result).toContain("version: 1.0");
      // Should add agent-conf metadata
      expect(result).toContain('agent_conf_managed: "true"');
      expect(result).toContain('agent_conf_content_hash: "sha256:');
    });

    it("produces consistent output for same input", () => {
      const result1 = addManagedMetadata(SAMPLE_SKILL);
      const result2 = addManagedMetadata(SAMPLE_SKILL);

      // Multiple calls should produce identical output (no timestamps)
      expect(result1).toBe(result2);
    });
  });

  describe("stripManagedMetadata", () => {
    it("removes agent-conf fields from metadata", () => {
      const withMetadata = addManagedMetadata(SAMPLE_SKILL_WITH_METADATA);
      const stripped = stripManagedMetadata(withMetadata);

      expect(stripped).not.toContain("agent_conf_managed");
      expect(stripped).not.toContain("agent_conf_content_hash");
      // Should preserve non-agent-conf metadata
      expect(stripped).toContain("author: test-author");
    });

    it("removes metadata key entirely if only agent-conf fields", () => {
      const withMetadata = addManagedMetadata(SAMPLE_SKILL);
      const stripped = stripManagedMetadata(withMetadata);

      // metadata key should be removed since it only contained agent-conf fields
      expect(stripped).not.toContain("metadata:");
    });
  });

  describe("computeContentHash", () => {
    it("returns consistent hash for same content", () => {
      const hash1 = computeContentHash(SAMPLE_SKILL);
      const hash2 = computeContentHash(SAMPLE_SKILL);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^sha256:[a-f0-9]{12}$/);
    });

    it("returns different hash for different content", () => {
      const hash1 = computeContentHash(SAMPLE_SKILL);
      const hash2 = computeContentHash(SAMPLE_SKILL_WITH_METADATA);

      expect(hash1).not.toBe(hash2);
    });

    it("ignores agent-conf metadata when computing hash", () => {
      const withMetadata = addManagedMetadata(SAMPLE_SKILL);

      const hashOriginal = computeContentHash(SAMPLE_SKILL);
      const hashWithMetadata = computeContentHash(withMetadata);

      // Hashes should be the same - agent-conf metadata is stripped before hashing
      expect(hashOriginal).toBe(hashWithMetadata);
    });
  });

  describe("hasManualChanges", () => {
    it("returns false for unmodified synced file", () => {
      const synced = addManagedMetadata(SAMPLE_SKILL);

      expect(hasManualChanges(synced)).toBe(false);
    });

    it("returns true when content has been modified", () => {
      const synced = addManagedMetadata(SAMPLE_SKILL);

      // Simulate manual modification
      const modified = synced.replace("This is the skill content.", "This has been modified.");

      expect(hasManualChanges(modified)).toBe(true);
    });

    it("returns false for non-managed files", () => {
      expect(hasManualChanges(SAMPLE_SKILL)).toBe(false);
    });
  });

  describe("isManaged", () => {
    it("returns true for managed files", () => {
      const synced = addManagedMetadata(SAMPLE_SKILL);

      expect(isManaged(synced)).toBe(true);
    });

    it("returns false for non-managed files", () => {
      expect(isManaged(SAMPLE_SKILL)).toBe(false);
      expect(isManaged(SAMPLE_SKILL_WITH_METADATA)).toBe(false);
    });
  });
});
