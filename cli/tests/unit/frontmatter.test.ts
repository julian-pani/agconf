import { describe, expect, it } from "vitest";
import { parseFrontmatter, serializeFrontmatter } from "../../src/core/frontmatter.js";

// =============================================================================
// Test Data
// =============================================================================

const SIMPLE_FRONTMATTER = `---
name: my-skill
description: A simple skill
---

# My Skill

Body content here.
`;

const FRONTMATTER_WITH_QUOTED_VALUES = `---
name: "my-skill"
description: "A skill with: special chars"
---

# Skill

Content.
`;

const FRONTMATTER_WITH_BOOLEANS = `---
enabled: true
disabled: false
name: test
---

Body.
`;

const FRONTMATTER_WITH_NUMBERS = `---
version: 42
name: test
---

Body.
`;

const FRONTMATTER_WITH_EMPTY_VALUES = `---
name: test
description:
---

Body.
`;

const CONTENT_WITHOUT_FRONTMATTER = `# Just a Heading

Some content without any frontmatter.
`;

const FRONTMATTER_WITH_SPECIAL_CHARS = `---
name: "value: with colon"
tag: "has # hash"
ref: "has @ at sign"
---

Body.
`;

const FRONTMATTER_WITH_NESTED = `---
name: test
metadata:
  author: Platform Team
  version: 1
---

# Content

Body here.
`;

const FRONTMATTER_WITH_ARRAY = `---
name: test
tools:
  - Read
  - Write
  - Bash
---

# Content

Body.
`;

const FRONTMATTER_WITH_INLINE_ARRAY = `---
name: test
tools: ["Read", "Write", "Bash"]
---

# Content

Body.
`;

const CODE_BLOCK_WITH_DASHES = `# My Document

Here is a code block:

\`\`\`yaml
---
name: not-frontmatter
description: this is inside a code block
---
\`\`\`

More content.
`;

const WINDOWS_LINE_ENDINGS =
  "---\r\nname: test\r\ndescription: windows style\r\n---\r\n\r\nBody.\r\n";

// =============================================================================
// Helper: build markdown with frontmatter (mirrors the removed
// buildMarkdownWithFrontmatter utility for roundtrip tests)
// =============================================================================

function buildMarkdown(frontmatter: Record<string, unknown>, body: string): string {
  const yamlContent = serializeFrontmatter(frontmatter);
  return `---\n${yamlContent}\n---\n${body}`;
}

// =============================================================================
// parseFrontmatter tests
// =============================================================================

describe("parseFrontmatter", () => {
  it("parses basic frontmatter with simple key-value pairs", () => {
    const result = parseFrontmatter(SIMPLE_FRONTMATTER);

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter?.name).toBe("my-skill");
    expect(result.frontmatter?.description).toBe("A simple skill");
    expect(result.body).toContain("# My Skill");
    expect(result.body).toContain("Body content here.");
    expect(result.body).not.toContain("---");
    expect(result.raw).toContain("name: my-skill");
  });

  it("parses frontmatter with quoted string values", () => {
    const result = parseFrontmatter(FRONTMATTER_WITH_QUOTED_VALUES);

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter?.name).toBe("my-skill");
    expect(result.frontmatter?.description).toBe("A skill with: special chars");
  });

  it("parses frontmatter with boolean values (treated as strings)", () => {
    const result = parseFrontmatter(FRONTMATTER_WITH_BOOLEANS);

    expect(result.frontmatter).not.toBeNull();
    // The simple YAML parser treats booleans as strings
    expect(result.frontmatter?.enabled).toBe("true");
    expect(result.frontmatter?.disabled).toBe("false");
    expect(result.frontmatter?.name).toBe("test");
  });

  it("parses frontmatter with numeric values (treated as strings)", () => {
    const result = parseFrontmatter(FRONTMATTER_WITH_NUMBERS);

    expect(result.frontmatter).not.toBeNull();
    // The simple YAML parser treats numbers as strings
    expect(result.frontmatter?.version).toBe("42");
    expect(result.frontmatter?.name).toBe("test");
  });

  it("handles frontmatter with empty value (no value after colon)", () => {
    const result = parseFrontmatter(FRONTMATTER_WITH_EMPTY_VALUES);

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter?.name).toBe("test");
    // An empty value with no next line starting with "  - " is treated as
    // an empty object by the YAML parser's lookahead logic
    expect(result.frontmatter?.description).toEqual({});
  });

  it("returns null frontmatter for content without frontmatter", () => {
    const result = parseFrontmatter(CONTENT_WITHOUT_FRONTMATTER);

    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(CONTENT_WITHOUT_FRONTMATTER);
    expect(result.raw).toBe("");
  });

  it("returns null frontmatter for empty frontmatter delimiters (---\\n---)", () => {
    // The regex /^---\r?\n([\s\S]*?)\r?\n---/ requires at least one character
    // captured between the delimiters (because the \n before the closing --- is
    // outside the capture group). With ---\n--- the captured group [1] is empty
    // string which is falsy, so parseFrontmatter returns null.
    const emptyFm = "---\n---\n\nBody after empty frontmatter.\n";
    const result = parseFrontmatter(emptyFm);

    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(emptyFm);
  });

  it("parses frontmatter with special YAML characters in quoted values", () => {
    const result = parseFrontmatter(FRONTMATTER_WITH_SPECIAL_CHARS);

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter?.name).toBe("value: with colon");
    expect(result.frontmatter?.tag).toBe("has # hash");
    expect(result.frontmatter?.ref).toBe("has @ at sign");
  });

  it("parses frontmatter with nested objects", () => {
    const result = parseFrontmatter(FRONTMATTER_WITH_NESTED);

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter?.name).toBe("test");
    expect(result.frontmatter?.metadata).toEqual({
      author: "Platform Team",
      version: "1",
    });
    expect(result.body).toContain("# Content");
  });

  it("parses frontmatter with block arrays", () => {
    const result = parseFrontmatter(FRONTMATTER_WITH_ARRAY);

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter?.name).toBe("test");
    expect(result.frontmatter?.tools).toEqual(["Read", "Write", "Bash"]);
  });

  it("parses frontmatter with inline JSON arrays", () => {
    const result = parseFrontmatter(FRONTMATTER_WITH_INLINE_ARRAY);

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter?.name).toBe("test");
    expect(result.frontmatter?.tools).toEqual(["Read", "Write", "Bash"]);
  });

  it("does NOT treat --- inside code blocks as frontmatter delimiter", () => {
    // The frontmatter regex anchors to ^ so it only matches at the start of the
    // file. Code blocks with --- in the middle are never matched.
    const result = parseFrontmatter(CODE_BLOCK_WITH_DASHES);

    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(CODE_BLOCK_WITH_DASHES);
  });

  it("handles Windows-style line endings (CRLF) - last key is parsed", () => {
    // KNOWN LIMITATION: The YAML parser splits on \n, leaving \r on
    // intermediate lines. The key-value regex /^(\w+):\s*(.*)$/ fails to
    // match lines ending with \r because $ does not consume \r. Only the
    // last YAML line (where the FRONTMATTER_REGEX already stripped the
    // trailing \r\n before ---) is parsed correctly. This documents the
    // current behavior.
    const result = parseFrontmatter(WINDOWS_LINE_ENDINGS);

    expect(result.frontmatter).not.toBeNull();
    // Only the last key-value line (no trailing \r) is parsed
    expect(result.frontmatter?.description).toBe("windows style");
    // Intermediate lines with \r are silently dropped
    expect(result.frontmatter?.name).toBeUndefined();
    // The raw YAML string is still captured correctly
    expect(result.raw).toContain("name: test");
  });

  it("handles CRLF when only one key-value line exists", () => {
    // With a single key-value line, the FRONTMATTER_REGEX strips the \r
    // before the closing ---, so the line is parsed correctly.
    const content = "---\r\nname: single-key\r\n---\r\n\r\nBody.\r\n";
    const result = parseFrontmatter(content);

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter?.name).toBe("single-key");
  });

  it("returns the raw YAML string between delimiters", () => {
    const result = parseFrontmatter(SIMPLE_FRONTMATTER);

    expect(result.raw).toBe("name: my-skill\ndescription: A simple skill");
  });

  it("handles content that is only frontmatter with no body", () => {
    const content = "---\nname: test\n---\n";
    const result = parseFrontmatter(content);

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter?.name).toBe("test");
    expect(result.body).toBe("");
  });

  it("handles whitespace in values (leading and trailing)", () => {
    const content = "---\nname:   padded value   \n---\n\nBody.";
    const result = parseFrontmatter(content);

    expect(result.frontmatter).not.toBeNull();
    // The parser does .trim() on values
    expect(result.frontmatter?.name).toBe("padded value");
  });

  it("handles multiline body content correctly", () => {
    const content = `---
title: doc
---

First paragraph.

Second paragraph.

- List item 1
- List item 2
`;
    const result = parseFrontmatter(content);

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter?.title).toBe("doc");
    expect(result.body).toContain("First paragraph.");
    expect(result.body).toContain("Second paragraph.");
    expect(result.body).toContain("- List item 1");
  });

  it("handles content with only --- at the start but no closing ---", () => {
    const content = "---\nname: test\nno closing delimiter";
    const result = parseFrontmatter(content);

    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(content);
  });

  it("handles multiple frontmatter keys with same-line values", () => {
    const content = "---\na: 1\nb: 2\nc: 3\nd: 4\n---\n\nBody.";
    const result = parseFrontmatter(content);

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter?.a).toBe("1");
    expect(result.frontmatter?.b).toBe("2");
    expect(result.frontmatter?.c).toBe("3");
    expect(result.frontmatter?.d).toBe("4");
  });

  it("handles empty string content", () => {
    const result = parseFrontmatter("");

    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe("");
    expect(result.raw).toBe("");
  });

  it("preserves body leading newline after frontmatter", () => {
    const content = "---\nname: test\n---\n\n# Title\n";
    const result = parseFrontmatter(content);

    expect(result.body).toBe("\n# Title\n");
  });

  it("handles invalid inline array gracefully", () => {
    const content = "---\nitems: [unclosed bracket\n---\n\nBody.";
    const result = parseFrontmatter(content);

    expect(result.frontmatter).not.toBeNull();
    // JSON.parse fails so the value is treated as a plain string
    expect(result.frontmatter?.items).toBe("[unclosed bracket");
  });

  it("parses frontmatter with quoted array items", () => {
    const content = "---\npaths:\n  - \"src/**/*.ts\"\n  - 'lib/**/*.js'\n---\n\nBody.";
    const result = parseFrontmatter(content);

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter?.paths).toEqual(["src/**/*.ts", "lib/**/*.js"]);
  });

  it("parses frontmatter with multiple top-level keys of mixed types", () => {
    const content =
      "---\nname: test\ntools:\n  - Read\n  - Write\nmetadata:\n  author: Me\ndescription: A thing\n---\n\nBody.";
    const result = parseFrontmatter(content);

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter?.name).toBe("test");
    expect(result.frontmatter?.tools).toEqual(["Read", "Write"]);
    expect(result.frontmatter?.metadata).toEqual({ author: "Me" });
    expect(result.frontmatter?.description).toBe("A thing");
  });
});

// =============================================================================
// serializeFrontmatter tests
// =============================================================================

describe("serializeFrontmatter", () => {
  it("serializes basic metadata with simple string values", () => {
    const result = serializeFrontmatter({
      name: "test",
      description: "A simple description",
    });

    expect(result).toBe("name: test\ndescription: A simple description");
  });

  it("quotes values that contain colons", () => {
    const result = serializeFrontmatter({
      hash: "sha256:abc123",
    });

    expect(result).toBe('hash: "sha256:abc123"');
  });

  it("quotes values that contain hash characters", () => {
    const result = serializeFrontmatter({
      comment: "has # hash",
    });

    expect(result).toBe('comment: "has # hash"');
  });

  it("quotes values that contain @ signs", () => {
    const result = serializeFrontmatter({
      ref: "@../AGENTS.md",
    });

    expect(result).toBe('ref: "@../AGENTS.md"');
  });

  it("quotes string values that look like booleans", () => {
    const result = serializeFrontmatter({
      managed: "true",
      disabled: "false",
    });

    expect(result).toBe('managed: "true"\ndisabled: "false"');
  });

  it("quotes string values that look like numbers", () => {
    const result = serializeFrontmatter({
      version: "42",
    });

    expect(result).toBe('version: "42"');
  });

  it("does not quote regular string values", () => {
    const result = serializeFrontmatter({
      name: "my-skill",
    });

    expect(result).toBe("name: my-skill");
  });

  it("serializes array values with block style and quoted items", () => {
    const result = serializeFrontmatter({
      tools: ["Read", "Write", "Bash"],
    });

    expect(result).toBe('tools:\n  - "Read"\n  - "Write"\n  - "Bash"');
  });

  it("serializes nested objects with proper indentation", () => {
    const result = serializeFrontmatter({
      metadata: { author: "Platform Team" },
    });

    expect(result).toBe("metadata:\n  author: Platform Team");
  });

  it("quotes nested object values that need quoting", () => {
    const result = serializeFrontmatter({
      metadata: { hash: "sha256:abc123" },
    });

    expect(result).toBe('metadata:\n  hash: "sha256:abc123"');
  });

  it("skips null and undefined values entirely", () => {
    const result = serializeFrontmatter({
      name: "test",
      removed: null,
      also_removed: undefined,
      kept: "value",
    });

    expect(result).toBe("name: test\nkept: value");
    expect(result).not.toContain("removed");
    expect(result).not.toContain("also_removed");
  });

  it("returns empty string for empty metadata object", () => {
    const result = serializeFrontmatter({});

    expect(result).toBe("");
  });

  it("converts boolean true/false to quoted strings", () => {
    const result = serializeFrontmatter({
      enabled: true,
      disabled: false,
    });

    // Boolean true -> String("true") -> needs quoting
    // Boolean false -> String("false") -> needs quoting
    expect(result).toBe('enabled: "true"\ndisabled: "false"');
  });

  it("converts numeric values to quoted strings", () => {
    const result = serializeFrontmatter({
      count: 42,
    });

    // Number 42 -> String("42") -> needs quoting (all-digits)
    expect(result).toBe('count: "42"');
  });

  it("handles empty string values (unquoted)", () => {
    const result = serializeFrontmatter({
      name: "",
    });

    // Empty string: needsQuoting("") returns false
    expect(result).toBe("name: ");
  });

  it("preserves insertion order of keys", () => {
    const result = serializeFrontmatter({
      zebra: "last",
      alpha: "first",
      middle: "middle",
    });

    const lines = result.split("\n");
    expect(lines[0]).toBe("zebra: last");
    expect(lines[1]).toBe("alpha: first");
    expect(lines[2]).toBe("middle: middle");
  });

  it("serializes an empty array as just the key header", () => {
    const result = serializeFrontmatter({
      items: [],
    });

    expect(result).toBe("items:");
  });

  it("serializes an empty nested object as just the key header", () => {
    const result = serializeFrontmatter({
      metadata: {},
    });

    expect(result).toBe("metadata:");
  });

  it("handles nested object values that are numeric strings", () => {
    const result = serializeFrontmatter({
      metadata: { version: "1" },
    });

    // "1" is all-digits -> needs quoting in nested values
    expect(result).toBe('metadata:\n  version: "1"');
  });

  it("handles nested object values that are boolean strings", () => {
    const result = serializeFrontmatter({
      metadata: { active: "true" },
    });

    expect(result).toBe('metadata:\n  active: "true"');
  });

  it("handles multiple nested objects", () => {
    const result = serializeFrontmatter({
      name: "test",
      metadata: { author: "Me" },
      config: { env: "prod" },
    });

    expect(result).toBe("name: test\nmetadata:\n  author: Me\nconfig:\n  env: prod");
  });
});

// =============================================================================
// Roundtrip tests (parse -> serialize -> rebuild -> re-parse)
// =============================================================================

describe("roundtrip: parse -> serialize -> re-parse", () => {
  it("preserves simple key-value data through roundtrip", () => {
    const original = "---\nname: test-skill\ndescription: Does things\n---\n\n# Title\n\nBody.\n";

    const parsed1 = parseFrontmatter(original);
    expect(parsed1.frontmatter).not.toBeNull();

    const rebuilt = buildMarkdown(parsed1.frontmatter as Record<string, unknown>, parsed1.body);
    const parsed2 = parseFrontmatter(rebuilt);

    expect(parsed2.frontmatter?.name).toBe(parsed1.frontmatter?.name);
    expect(parsed2.frontmatter?.description).toBe(parsed1.frontmatter?.description);
    expect(parsed2.body).toBe(parsed1.body);
  });

  it("preserves nested metadata through roundtrip", () => {
    const original = "---\nname: test\nmetadata:\n  author: Team\n  org: Acme\n---\n\nBody.\n";

    const parsed1 = parseFrontmatter(original);
    const rebuilt = buildMarkdown(parsed1.frontmatter as Record<string, unknown>, parsed1.body);
    const parsed2 = parseFrontmatter(rebuilt);

    expect(parsed2.frontmatter?.name).toBe("test");
    expect(parsed2.frontmatter?.metadata).toEqual({ author: "Team", org: "Acme" });
  });

  it("preserves arrays through roundtrip", () => {
    const original = "---\nname: test\ntools:\n  - Read\n  - Write\n---\n\nBody.\n";

    const parsed1 = parseFrontmatter(original);
    expect(parsed1.frontmatter?.tools).toEqual(["Read", "Write"]);

    const rebuilt = buildMarkdown(parsed1.frontmatter as Record<string, unknown>, parsed1.body);
    const parsed2 = parseFrontmatter(rebuilt);

    expect(parsed2.frontmatter?.tools).toEqual(["Read", "Write"]);
  });

  it("preserves values that need quoting through roundtrip", () => {
    const original = '---\nhash: "sha256:abcdef"\nmanaged: "true"\n---\n\nBody.\n';

    const parsed1 = parseFrontmatter(original);
    expect(parsed1.frontmatter?.hash).toBe("sha256:abcdef");
    expect(parsed1.frontmatter?.managed).toBe("true");

    const rebuilt = buildMarkdown(parsed1.frontmatter as Record<string, unknown>, parsed1.body);
    const parsed2 = parseFrontmatter(rebuilt);

    expect(parsed2.frontmatter?.hash).toBe("sha256:abcdef");
    expect(parsed2.frontmatter?.managed).toBe("true");
  });

  it("preserves body exactly through roundtrip", () => {
    const body = "\n# Heading\n\nFirst paragraph.\n\n## Subheading\n\n- item 1\n- item 2\n";
    const original = `---\ntitle: doc\n---\n${body}`;

    const parsed = parseFrontmatter(original);
    const rebuilt = buildMarkdown(parsed.frontmatter as Record<string, unknown>, parsed.body);
    const reParsed = parseFrontmatter(rebuilt);

    expect(reParsed.body).toBe(body);
  });

  it("serialized then parsed frontmatter matches original parsed frontmatter", () => {
    const fm = { name: "skill", version: "2", managed: "true", ref: "@file" };
    const yaml = serializeFrontmatter(fm);
    const content = `---\n${yaml}\n---\n\nBody.\n`;

    const parsed = parseFrontmatter(content);
    expect(parsed.frontmatter).not.toBeNull();
    expect(parsed.frontmatter?.name).toBe("skill");
    expect(parsed.frontmatter?.version).toBe("2");
    expect(parsed.frontmatter?.managed).toBe("true");
    expect(parsed.frontmatter?.ref).toBe("@file");
  });
});

// =============================================================================
// Edge case / interaction tests
// =============================================================================

describe("edge cases", () => {
  it("content with --- in the body (not at file start) is not treated as frontmatter", () => {
    const content = "Some intro text\n\n---\n\nSeparator above.\n";
    const result = parseFrontmatter(content);

    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(content);
  });

  it("frontmatter followed by --- in the body does not confuse the parser", () => {
    const content = "---\ntitle: test\n---\n\nSome text\n\n---\n\nMore text.\n";
    const result = parseFrontmatter(content);

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter?.title).toBe("test");
    // The body should include everything after the frontmatter block
    expect(result.body).toContain("Some text");
    expect(result.body).toContain("---");
    expect(result.body).toContain("More text.");
  });

  it("serialized empty array can be re-parsed as an object (not array)", () => {
    // When serialized, an empty array produces "items:" with no items below.
    // When re-parsed, the empty key with nothing following is treated as an
    // empty object (since the next line is not "  - ..."). This is a known
    // limitation of the simple YAML parser.
    const yaml = serializeFrontmatter({ items: [] });
    const content = `---\n${yaml}\nname: after\n---\n\nBody.`;
    const parsed = parseFrontmatter(content);

    expect(parsed.frontmatter).not.toBeNull();
    // Empty "items:" followed by "name:" -> items becomes empty object
    expect(parsed.frontmatter?.items).toEqual({});
    expect(parsed.frontmatter?.name).toBe("after");
  });

  it("handles a key whose value has both leading and trailing quotes", () => {
    const content = '---\nname: "fully quoted"\n---\n\nBody.';
    const result = parseFrontmatter(content);

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter?.name).toBe("fully quoted");
  });

  it("handles single-quoted values", () => {
    const content = "---\nname: 'single quoted'\n---\n\nBody.";
    const result = parseFrontmatter(content);

    expect(result.frontmatter).not.toBeNull();
    expect(result.frontmatter?.name).toBe("single quoted");
  });
});
