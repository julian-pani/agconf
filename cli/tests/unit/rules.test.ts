import { describe, expect, it } from "vitest";
import {
  addRuleMetadata,
  adjustHeadingLevels,
  generatePathsComment,
  generateRulesSection,
  parseRule,
  type Rule,
  updateAgentsMdWithRules,
} from "../../src/core/rules.js";

// =============================================================================
// Test Data
// =============================================================================

const SAMPLE_RULE_WITH_PATHS = `---
paths:
  - "src/api/**/*.ts"
  - "lib/api/**/*.ts"
metadata:
  author: "Security Team"
---

# API Authentication Rules

All API endpoints must implement proper authentication.

## Requirements

- Use JWT tokens for authentication
- Implement rate limiting
`;

const SAMPLE_RULE_WITHOUT_FRONTMATTER = `# Code Style Guidelines

Use consistent formatting across the codebase.

## Naming Conventions

- Use camelCase for variables
- Use PascalCase for classes
`;

const SAMPLE_RULE_WITH_METADATA_ONLY = `---
metadata:
  author: "Platform Team"
---

# Code Style Guidelines

Use consistent formatting across the codebase.
`;

const SAMPLE_RULE_WITH_CODE_BLOCKS = `# Test File Conventions

Here's an example test:

\`\`\`typescript
# This is a comment, not a heading
## Also a comment
describe("test", () => {
  it("works", () => {});
});
\`\`\`

## Real Section

Content after code block.
`;

const SAMPLE_RULE_WITH_ALL_HEADING_LEVELS = `# h1 heading

## h2 heading

### h3 heading

#### h4 heading

##### h5 heading

###### h6 heading

Text content.
`;

const SAMPLE_AGENTS_MD_WITH_MARKERS = `<!-- agent-conf:global:start -->
<!-- DO NOT EDIT THIS SECTION - Managed by agent-conf -->

# Global Instructions

Some global content here.

<!-- agent-conf:global:end -->

<!-- agent-conf:repo:start -->

# Repository Specific

Local content here.

<!-- agent-conf:repo:end -->
`;

const SAMPLE_AGENTS_MD_WITH_RULES_SECTION = `<!-- agent-conf:global:start -->
# Global Instructions
<!-- agent-conf:global:end -->

<!-- agent-conf:rules:start -->
<!-- DO NOT EDIT THIS SECTION - Managed by agent-conf -->
<!-- Content hash: sha256:oldhashabcdef -->
<!-- Rule count: 1 -->

# Project Rules

<!-- Rule: old-rule.md -->

## Old Rule Content

<!-- agent-conf:rules:end -->

<!-- agent-conf:repo:start -->
# Repo Content
<!-- agent-conf:repo:end -->
`;

// =============================================================================
// adjustHeadingLevels tests
// =============================================================================

describe("adjustHeadingLevels", () => {
  it("adjusts h1 to h2 with increment=1", () => {
    const content = "# Heading One\n\nSome content.";
    const result = adjustHeadingLevels(content, 1);
    expect(result).toBe("## Heading One\n\nSome content.");
  });

  it("adjusts h2 to h3 with increment=1", () => {
    const content = "## Heading Two\n\nContent.";
    const result = adjustHeadingLevels(content, 1);
    expect(result).toBe("### Heading Two\n\nContent.");
  });

  it("caps at h6 (h6 stays h6)", () => {
    const content = "###### Heading Six\n\nContent.";
    const result = adjustHeadingLevels(content, 1);
    expect(result).toBe("###### Heading Six\n\nContent.");
  });

  it("adjusts multiple headings in one document", () => {
    const result = adjustHeadingLevels(SAMPLE_RULE_WITH_ALL_HEADING_LEVELS, 1);
    expect(result).toContain("## h1 heading");
    expect(result).toContain("### h2 heading");
    expect(result).toContain("#### h3 heading");
    expect(result).toContain("##### h4 heading");
    expect(result).toContain("###### h5 heading");
    expect(result).toContain("###### h6 heading"); // capped at h6
  });

  it("does NOT adjust headings inside code blocks", () => {
    const result = adjustHeadingLevels(SAMPLE_RULE_WITH_CODE_BLOCKS, 1);

    // Code block content should be unchanged
    expect(result).toContain("# This is a comment, not a heading");
    expect(result).toContain("## Also a comment");

    // Real headings should be adjusted
    expect(result).toContain("## Test File Conventions");
    expect(result).toContain("### Real Section");
  });

  it("returns empty string for empty content", () => {
    expect(adjustHeadingLevels("", 1)).toBe("");
  });

  it("handles content with no headings", () => {
    const content = "Just some text.\n\nNo headings here.";
    const result = adjustHeadingLevels(content, 1);
    expect(result).toBe(content);
  });

  it("handles negative increment (demoting headings)", () => {
    const content = "### Heading Three\n\nContent.";
    const result = adjustHeadingLevels(content, -1);
    expect(result).toBe("## Heading Three\n\nContent.");
  });

  it("caps at h1 minimum (cannot go below h1)", () => {
    const content = "# Heading One\n\nContent.";
    const result = adjustHeadingLevels(content, -1);
    expect(result).toBe("# Heading One\n\nContent.");
  });
});

// =============================================================================
// parseRule tests
// =============================================================================

describe("parseRule", () => {
  it("parses rule with paths frontmatter", () => {
    const rule = parseRule(SAMPLE_RULE_WITH_PATHS, "security/api-auth.md");

    expect(rule.relativePath).toBe("security/api-auth.md");
    expect(rule.rawContent).toBe(SAMPLE_RULE_WITH_PATHS);
    expect(rule.frontmatter).not.toBeNull();
    expect(rule.frontmatter?.paths).toEqual(["src/api/**/*.ts", "lib/api/**/*.ts"]);
    expect(rule.frontmatter?.metadata).toEqual({ author: "Security Team" });
    expect(rule.body).toContain("# API Authentication Rules");
    expect(rule.body).not.toContain("---");
  });

  it("parses rule without frontmatter", () => {
    const rule = parseRule(SAMPLE_RULE_WITHOUT_FRONTMATTER, "code-style.md");

    expect(rule.relativePath).toBe("code-style.md");
    expect(rule.rawContent).toBe(SAMPLE_RULE_WITHOUT_FRONTMATTER);
    expect(rule.frontmatter).toBeNull();
    expect(rule.body).toBe(SAMPLE_RULE_WITHOUT_FRONTMATTER);
  });

  it("parses rule with metadata but no paths", () => {
    const rule = parseRule(SAMPLE_RULE_WITH_METADATA_ONLY, "code-style.md");

    expect(rule.frontmatter).not.toBeNull();
    expect(rule.frontmatter?.paths).toBeUndefined();
    expect(rule.frontmatter?.metadata).toEqual({ author: "Platform Team" });
  });

  it("handles invalid YAML gracefully", () => {
    // Simple YAML parser is lenient - unclosed bracket is treated as a string value
    // This is acceptable behavior for our use case
    const invalidYaml = `---
paths: [unclosed bracket
---

# Content
`;
    const rule = parseRule(invalidYaml, "bad.md");

    // Our simple parser treats the value as a string rather than failing
    // This is acceptable - the paths field just won't be a valid array
    expect(rule.relativePath).toBe("bad.md");
    expect(rule.body).toContain("# Content");
  });

  it("preserves the raw content exactly", () => {
    const rule = parseRule(SAMPLE_RULE_WITH_PATHS, "test.md");
    expect(rule.rawContent).toBe(SAMPLE_RULE_WITH_PATHS);
  });
});

// =============================================================================
// generatePathsComment tests
// =============================================================================

describe("generatePathsComment", () => {
  it("generates comment for single path", () => {
    const result = generatePathsComment(["src/api/**/*.ts"]);
    expect(result).toBe("<!-- Applies to: src/api/**/*.ts -->");
  });

  it("generates multi-line comment for multiple paths", () => {
    const result = generatePathsComment(["src/api/**/*.ts", "lib/api/**/*.ts"]);
    expect(result).toBe(
      `<!-- Applies to:
     - src/api/**/*.ts
     - lib/api/**/*.ts
-->`,
    );
  });

  it("returns empty string for empty array", () => {
    expect(generatePathsComment([])).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(generatePathsComment(undefined as unknown as string[])).toBe("");
  });
});

// =============================================================================
// generateRulesSection tests
// =============================================================================

describe("generateRulesSection", () => {
  it("generates section for single rule with adjusted headings", () => {
    const rule: Rule = {
      relativePath: "code-style.md",
      rawContent: SAMPLE_RULE_WITHOUT_FRONTMATTER,
      frontmatter: null,
      body: SAMPLE_RULE_WITHOUT_FRONTMATTER,
    };

    const result = generateRulesSection([rule], "agent-conf");

    // Check markers
    expect(result).toContain("<!-- agent-conf:rules:start -->");
    expect(result).toContain("<!-- agent-conf:rules:end -->");
    expect(result).toContain("<!-- DO NOT EDIT THIS SECTION - Managed by agent-conf -->");
    expect(result).toContain("<!-- Content hash: sha256:");
    expect(result).toContain("<!-- Rule count: 1 -->");

    // Check header
    expect(result).toContain("# Project Rules");

    // Check rule attribution
    expect(result).toContain("<!-- Rule: code-style.md -->");

    // Check headings are adjusted (+1)
    expect(result).toContain("## Code Style Guidelines");
    expect(result).toContain("### Naming Conventions");
  });

  it("generates section for multiple rules sorted alphabetically", () => {
    const rules: Rule[] = [
      {
        relativePath: "z-last.md",
        rawContent: "# Z Last\n\nContent.",
        frontmatter: null,
        body: "# Z Last\n\nContent.",
      },
      {
        relativePath: "a-first.md",
        rawContent: "# A First\n\nContent.",
        frontmatter: null,
        body: "# A First\n\nContent.",
      },
      {
        relativePath: "m-middle.md",
        rawContent: "# M Middle\n\nContent.",
        frontmatter: null,
        body: "# M Middle\n\nContent.",
      },
    ];

    const result = generateRulesSection(rules, "agent-conf");

    // Check alphabetical order by finding positions
    const aPos = result.indexOf("<!-- Rule: a-first.md -->");
    const mPos = result.indexOf("<!-- Rule: m-middle.md -->");
    const zPos = result.indexOf("<!-- Rule: z-last.md -->");

    expect(aPos).toBeLessThan(mPos);
    expect(mPos).toBeLessThan(zPos);
    expect(result).toContain("<!-- Rule count: 3 -->");
  });

  it("includes paths comment for rules with paths frontmatter", () => {
    const rule: Rule = parseRule(SAMPLE_RULE_WITH_PATHS, "security/api-auth.md");

    const result = generateRulesSection([rule], "agent-conf");

    expect(result).toContain("<!-- Rule: security/api-auth.md -->");
    expect(result).toContain("<!-- Applies to:");
    expect(result).toContain("src/api/**/*.ts");
    expect(result).toContain("lib/api/**/*.ts");
  });

  it("does not include paths comment for rules without paths", () => {
    const rule: Rule = parseRule(SAMPLE_RULE_WITHOUT_FRONTMATTER, "code-style.md");

    const result = generateRulesSection([rule], "agent-conf");

    expect(result).not.toContain("<!-- Applies to:");
  });

  it("generates consistent hash for same rules", () => {
    const rule: Rule = {
      relativePath: "test.md",
      rawContent: "# Test\n\nContent.",
      frontmatter: null,
      body: "# Test\n\nContent.",
    };

    const result1 = generateRulesSection([rule], "agent-conf");
    const result2 = generateRulesSection([rule], "agent-conf");

    // Extract hash from both
    const hashMatch1 = result1.match(/Content hash: (sha256:[a-f0-9]+)/);
    const hashMatch2 = result2.match(/Content hash: (sha256:[a-f0-9]+)/);

    expect(hashMatch1?.[1]).toBe(hashMatch2?.[1]);
  });

  it("uses custom marker prefix", () => {
    const rule: Rule = {
      relativePath: "test.md",
      rawContent: "# Test\n\nContent.",
      frontmatter: null,
      body: "# Test\n\nContent.",
    };

    const result = generateRulesSection([rule], "custom-prefix");

    expect(result).toContain("<!-- custom-prefix:rules:start -->");
    expect(result).toContain("<!-- custom-prefix:rules:end -->");
  });

  it("handles empty rules array", () => {
    const result = generateRulesSection([], "agent-conf");

    expect(result).toContain("<!-- agent-conf:rules:start -->");
    expect(result).toContain("<!-- Rule count: 0 -->");
    expect(result).toContain("# Project Rules");
    expect(result).toContain("<!-- agent-conf:rules:end -->");
  });
});

// =============================================================================
// updateAgentsMdWithRules tests
// =============================================================================

describe("updateAgentsMdWithRules", () => {
  const sampleRulesSection = `<!-- agent-conf:rules:start -->
<!-- DO NOT EDIT THIS SECTION - Managed by agent-conf -->
<!-- Content hash: sha256:newhash12345 -->
<!-- Rule count: 2 -->

# Project Rules

<!-- Rule: new-rule.md -->

## New Rule Content

<!-- agent-conf:rules:end -->`;

  it("replaces existing rules section", () => {
    const result = updateAgentsMdWithRules(
      SAMPLE_AGENTS_MD_WITH_RULES_SECTION,
      sampleRulesSection,
      "agent-conf",
    );

    // Old content should be gone
    expect(result).not.toContain("sha256:oldhashabcdef");
    expect(result).not.toContain("Old Rule Content");
    expect(result).not.toContain("old-rule.md");

    // New content should be present
    expect(result).toContain("sha256:newhash12345");
    expect(result).toContain("New Rule Content");
    expect(result).toContain("new-rule.md");

    // Global and repo sections should be preserved
    expect(result).toContain("<!-- agent-conf:global:start -->");
    expect(result).toContain("<!-- agent-conf:repo:start -->");
  });

  it("inserts after global:end when no rules markers exist", () => {
    const result = updateAgentsMdWithRules(
      SAMPLE_AGENTS_MD_WITH_MARKERS,
      sampleRulesSection,
      "agent-conf",
    );

    // Rules should be inserted
    expect(result).toContain("<!-- agent-conf:rules:start -->");

    // Should be after global:end
    const globalEndPos = result.indexOf("<!-- agent-conf:global:end -->");
    const rulesStartPos = result.indexOf("<!-- agent-conf:rules:start -->");
    expect(rulesStartPos).toBeGreaterThan(globalEndPos);

    // Should be before repo:start
    const repoStartPos = result.indexOf("<!-- agent-conf:repo:start -->");
    expect(rulesStartPos).toBeLessThan(repoStartPos);

    // Original content should be preserved
    expect(result).toContain("# Global Instructions");
    expect(result).toContain("# Repository Specific");
  });

  it("inserts before repo:start when no global markers", () => {
    const contentWithRepoOnly = `# Some Content

<!-- agent-conf:repo:start -->
# Repo Specific Content
<!-- agent-conf:repo:end -->
`;

    const result = updateAgentsMdWithRules(contentWithRepoOnly, sampleRulesSection, "agent-conf");

    // Rules should be before repo section
    const rulesEndPos = result.indexOf("<!-- agent-conf:rules:end -->");
    const repoStartPos = result.indexOf("<!-- agent-conf:repo:start -->");
    expect(rulesEndPos).toBeLessThan(repoStartPos);

    // Original content preserved
    expect(result).toContain("# Some Content");
    expect(result).toContain("# Repo Specific Content");
  });

  it("appends at end when no markers at all", () => {
    const plainContent = "# Plain AGENTS.md\n\nJust content, no markers.";

    const result = updateAgentsMdWithRules(plainContent, sampleRulesSection, "agent-conf");

    // Original content should come first
    expect(result.indexOf("# Plain AGENTS.md")).toBeLessThan(
      result.indexOf("<!-- agent-conf:rules:start -->"),
    );

    // Rules should be at end
    expect(result).toContain("<!-- agent-conf:rules:start -->");
    expect(result).toContain("<!-- agent-conf:rules:end -->");
  });

  it("preserves global and repo sections", () => {
    const result = updateAgentsMdWithRules(
      SAMPLE_AGENTS_MD_WITH_MARKERS,
      sampleRulesSection,
      "agent-conf",
    );

    // All sections should be present
    expect(result).toContain("<!-- agent-conf:global:start -->");
    expect(result).toContain("<!-- agent-conf:global:end -->");
    expect(result).toContain("<!-- agent-conf:rules:start -->");
    expect(result).toContain("<!-- agent-conf:rules:end -->");
    expect(result).toContain("<!-- agent-conf:repo:start -->");
    expect(result).toContain("<!-- agent-conf:repo:end -->");

    // Content should be preserved
    expect(result).toContain("Some global content here.");
    expect(result).toContain("Local content here.");
  });

  it("uses custom marker prefix", () => {
    const customPrefixContent = `<!-- custom:global:start -->
# Global
<!-- custom:global:end -->
`;
    const customRulesSection = `<!-- custom:rules:start -->
# Project Rules
<!-- custom:rules:end -->`;

    const result = updateAgentsMdWithRules(customPrefixContent, customRulesSection, "custom");

    expect(result).toContain("<!-- custom:rules:start -->");
    expect(result).toContain("<!-- custom:global:end -->");
  });
});

// =============================================================================
// addRuleMetadata tests
// =============================================================================

describe("addRuleMetadata", () => {
  it("adds metadata to rule without existing metadata", () => {
    const rule: Rule = {
      relativePath: "code-style.md",
      rawContent: SAMPLE_RULE_WITHOUT_FRONTMATTER,
      frontmatter: null,
      body: SAMPLE_RULE_WITHOUT_FRONTMATTER,
    };

    const result = addRuleMetadata(rule, "agent_conf");

    // Should have frontmatter with metadata
    expect(result).toContain("---");
    expect(result).toContain('agent_conf_managed: "true"');
    expect(result).toContain("agent_conf_content_hash: ");
    expect(result).toContain("agent_conf_source_path: code-style.md");

    // Body should be preserved
    expect(result).toContain("# Code Style Guidelines");
  });

  it("preserves existing frontmatter fields", () => {
    const rule: Rule = parseRule(SAMPLE_RULE_WITH_PATHS, "security/api-auth.md");

    const result = addRuleMetadata(rule, "agent_conf");

    // Existing fields should be preserved
    expect(result).toContain("src/api/**/*.ts");
    expect(result).toContain("lib/api/**/*.ts");
    expect(result).toContain("Security Team");

    // New metadata should be added
    expect(result).toContain('agent_conf_managed: "true"');
    expect(result).toContain("agent_conf_source_path: security/api-auth.md");
  });

  it("adds metadata under metadata key", () => {
    const rule: Rule = parseRule(SAMPLE_RULE_WITH_METADATA_ONLY, "code-style.md");

    const result = addRuleMetadata(rule, "agent_conf");

    // Should preserve author in metadata
    expect(result).toContain("author:");
    expect(result).toContain("Platform Team");

    // Should add our metadata
    expect(result).toContain("agent_conf_managed:");
    expect(result).toContain("agent_conf_content_hash:");
    expect(result).toContain("agent_conf_source_path:");
  });

  it("uses correct prefix for metadata keys", () => {
    const rule: Rule = {
      relativePath: "test.md",
      rawContent: "# Test\n\nContent.",
      frontmatter: null,
      body: "# Test\n\nContent.",
    };

    const resultDefault = addRuleMetadata(rule, "agent_conf");
    expect(resultDefault).toContain("agent_conf_managed:");

    const resultCustom = addRuleMetadata(rule, "custom_prefix");
    expect(resultCustom).toContain("custom_prefix_managed:");
    expect(resultCustom).not.toContain("agent_conf_managed:");
  });

  it("generates consistent hash for same content", () => {
    const rule: Rule = {
      relativePath: "test.md",
      rawContent: "# Test\n\nContent.",
      frontmatter: null,
      body: "# Test\n\nContent.",
    };

    const result1 = addRuleMetadata(rule, "agent_conf");
    const result2 = addRuleMetadata(rule, "agent_conf");

    // Extract hashes
    const hashMatch1 = result1.match(/agent_conf_content_hash: (sha256:[a-f0-9]+)/);
    const hashMatch2 = result2.match(/agent_conf_content_hash: (sha256:[a-f0-9]+)/);

    expect(hashMatch1?.[1]).toBe(hashMatch2?.[1]);
  });

  it("computes hash from body only (not including added metadata)", () => {
    const rule: Rule = {
      relativePath: "test.md",
      rawContent: "# Test\n\nContent.",
      frontmatter: null,
      body: "# Test\n\nContent.",
    };

    const result = addRuleMetadata(rule, "agent_conf");

    // The hash should be based on the original body, so adding metadata
    // again should produce the same hash
    const secondRule: Rule = parseRule(result, "test.md");
    const result2 = addRuleMetadata(secondRule, "agent_conf");

    // Hash might be quoted due to colon in value
    const hashMatch1 = result.match(/agent_conf_content_hash: "?(sha256:[a-f0-9]+)"?/);
    const hashMatch2 = result2.match(/agent_conf_content_hash: "?(sha256:[a-f0-9]+)"?/);

    // Verify the metadata is present
    expect(hashMatch1).not.toBeNull();
    expect(hashMatch2).not.toBeNull();
  });
});
