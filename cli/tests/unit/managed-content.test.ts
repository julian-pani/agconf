import { describe, expect, it } from "vitest";
import {
  addManagedMetadata,
  computeContentHash,
  hasManualChanges,
  isManaged,
  parseFrontmatter,
  stripManagedMetadata,
} from "../../src/core/managed-content.js";

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

describe("managed-content", () => {
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

      expect(result).toContain('agconf_managed: "true"');
      expect(result).toContain('agconf_content_hash: "sha256:');
      // Should NOT contain source or synced_at (those are in lockfile only)
      expect(result).not.toContain("agconf_source");
      expect(result).not.toContain("agconf_synced_at");
      // Original content should be preserved
      expect(result).toContain("name: test-skill");
      expect(result).toContain("# Test Skill");
    });

    it("adds metadata to skill with existing metadata", () => {
      const result = addManagedMetadata(SAMPLE_SKILL_WITH_METADATA);

      // Should preserve existing metadata
      expect(result).toContain("author: test-author");
      expect(result).toContain("version: 1.0");
      // Should add agconf metadata
      expect(result).toContain('agconf_managed: "true"');
      expect(result).toContain('agconf_content_hash: "sha256:');
    });

    it("produces consistent output for same input", () => {
      const result1 = addManagedMetadata(SAMPLE_SKILL);
      const result2 = addManagedMetadata(SAMPLE_SKILL);

      // Multiple calls should produce identical output (no timestamps)
      expect(result1).toBe(result2);
    });
  });

  describe("stripManagedMetadata", () => {
    it("removes agconf fields from metadata", () => {
      const withMetadata = addManagedMetadata(SAMPLE_SKILL_WITH_METADATA);
      const stripped = stripManagedMetadata(withMetadata);

      expect(stripped).not.toContain("agconf_managed");
      expect(stripped).not.toContain("agconf_content_hash");
      // Should preserve non-agconf metadata
      expect(stripped).toContain("author: test-author");
    });

    it("removes metadata key entirely if only agconf fields", () => {
      const withMetadata = addManagedMetadata(SAMPLE_SKILL);
      const stripped = stripManagedMetadata(withMetadata);

      // metadata key should be removed since it only contained agconf fields
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

    it("ignores agconf metadata when computing hash", () => {
      const withMetadata = addManagedMetadata(SAMPLE_SKILL);

      const hashOriginal = computeContentHash(SAMPLE_SKILL);
      const hashWithMetadata = computeContentHash(withMetadata);

      // Hashes should be the same - agconf metadata is stripped before hashing
      expect(hashOriginal).toBe(hashWithMetadata);
    });

    it("produces same hash for content with no frontmatter after adding/stripping metadata", () => {
      // BUG TEST: When original content has NO frontmatter, after sync the file has
      // frontmatter with only managed metadata. When stripped for hashing, we should
      // NOT add empty frontmatter delimiters (---\n\n---\n).
      //
      // This is the bug that causes sync+check hash mismatch:
      // - During sync: hash of "# Content" (no frontmatter)
      // - During check: hash of "---\n\n---\n# Content" (empty frontmatter block)
      const contentWithNoFrontmatter = `# Documentation Standards

This is the content without any frontmatter.

## Section

More content here.
`;

      // Simulate what happens during sync: add managed metadata
      const withMetadata = addManagedMetadata(contentWithNoFrontmatter);

      // The synced file should have frontmatter with managed metadata
      expect(withMetadata).toContain("---");
      expect(withMetadata).toContain("agconf_managed");

      // Hash of original (no frontmatter) should match hash of synced file
      // (after stripping managed metadata)
      const hashOriginal = computeContentHash(contentWithNoFrontmatter);
      const hashWithMetadata = computeContentHash(withMetadata);

      // These MUST be equal - this is the bug fix test
      expect(hashWithMetadata).toBe(hashOriginal);
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

  describe("custom metadata prefix", () => {
    const CUSTOM_PREFIX = "fbagents";

    describe("addManagedMetadata with custom prefix", () => {
      it("uses custom prefix for metadata keys", () => {
        const result = addManagedMetadata(SAMPLE_SKILL, { metadataPrefix: CUSTOM_PREFIX });

        // Should use custom prefix (with underscores)
        expect(result).toContain('fbagents_managed: "true"');
        expect(result).toContain('fbagents_content_hash: "sha256:');
        // Should NOT use default prefix
        expect(result).not.toContain("agconf_managed");
        expect(result).not.toContain("agconf_content_hash");
      });

      it("preserves existing metadata when using custom prefix", () => {
        const result = addManagedMetadata(SAMPLE_SKILL_WITH_METADATA, {
          metadataPrefix: CUSTOM_PREFIX,
        });

        expect(result).toContain("author: test-author");
        expect(result).toContain('fbagents_managed: "true"');
      });
    });

    describe("isManaged with custom prefix", () => {
      it("detects files managed with custom prefix", () => {
        const synced = addManagedMetadata(SAMPLE_SKILL, { metadataPrefix: CUSTOM_PREFIX });

        expect(isManaged(synced, { metadataPrefix: CUSTOM_PREFIX })).toBe(true);
      });

      it("does not detect default-prefix files when using custom prefix", () => {
        const synced = addManagedMetadata(SAMPLE_SKILL);

        expect(isManaged(synced, { metadataPrefix: CUSTOM_PREFIX })).toBe(false);
      });

      it("does not detect custom-prefix files when using default prefix", () => {
        const synced = addManagedMetadata(SAMPLE_SKILL, { metadataPrefix: CUSTOM_PREFIX });

        expect(isManaged(synced)).toBe(false);
      });
    });

    describe("hasManualChanges with custom prefix", () => {
      it("detects changes in files with custom prefix", () => {
        const synced = addManagedMetadata(SAMPLE_SKILL, { metadataPrefix: CUSTOM_PREFIX });

        expect(hasManualChanges(synced, { metadataPrefix: CUSTOM_PREFIX })).toBe(false);

        const modified = synced.replace("This is the skill content.", "Modified content.");
        expect(hasManualChanges(modified, { metadataPrefix: CUSTOM_PREFIX })).toBe(true);
      });
    });

    describe("stripManagedMetadata with custom prefix", () => {
      it("strips custom prefix metadata keys", () => {
        const withMetadata = addManagedMetadata(SAMPLE_SKILL_WITH_METADATA, {
          metadataPrefix: CUSTOM_PREFIX,
        });
        const stripped = stripManagedMetadata(withMetadata, { metadataPrefix: CUSTOM_PREFIX });

        expect(stripped).not.toContain("fbagents_managed");
        expect(stripped).not.toContain("fbagents_content_hash");
        expect(stripped).toContain("author: test-author");
      });

      it("does not strip default prefix metadata when using custom prefix", () => {
        const withDefaultMetadata = addManagedMetadata(SAMPLE_SKILL);
        const stripped = stripManagedMetadata(withDefaultMetadata, {
          metadataPrefix: CUSTOM_PREFIX,
        });

        // Default prefix metadata should still be present since we're stripping custom prefix
        expect(stripped).toContain("agconf_managed");
      });
    });

    describe("computeContentHash with custom prefix", () => {
      it("ignores custom prefix metadata when computing hash", () => {
        const withMetadata = addManagedMetadata(SAMPLE_SKILL, { metadataPrefix: CUSTOM_PREFIX });

        const hashOriginal = computeContentHash(SAMPLE_SKILL, { metadataPrefix: CUSTOM_PREFIX });
        const hashWithMetadata = computeContentHash(withMetadata, {
          metadataPrefix: CUSTOM_PREFIX,
        });

        expect(hashOriginal).toBe(hashWithMetadata);
      });
    });
  });
});
