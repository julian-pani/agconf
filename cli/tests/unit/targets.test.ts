import { describe, expect, it } from "vitest";
import {
  getTargetConfig,
  isValidTarget,
  parseTargets,
  SUPPORTED_TARGETS,
  TARGET_CONFIGS,
} from "../../src/core/targets.js";

// =============================================================================
// isValidTarget tests
// =============================================================================

describe("isValidTarget", () => {
  it("returns true for 'claude'", () => {
    expect(isValidTarget("claude")).toBe(true);
  });

  it("returns true for 'codex'", () => {
    expect(isValidTarget("codex")).toBe(true);
  });

  it("returns true for all entries in SUPPORTED_TARGETS", () => {
    for (const target of SUPPORTED_TARGETS) {
      expect(isValidTarget(target)).toBe(true);
    }
  });

  it("returns false for an empty string", () => {
    expect(isValidTarget("")).toBe(false);
  });

  it("returns false for a random string", () => {
    expect(isValidTarget("foobar")).toBe(false);
  });

  it("returns false for 'github-copilot'", () => {
    expect(isValidTarget("github-copilot")).toBe(false);
  });

  it("is case-sensitive - 'Claude' is not valid", () => {
    expect(isValidTarget("Claude")).toBe(false);
  });

  it("is case-sensitive - 'CLAUDE' is not valid", () => {
    expect(isValidTarget("CLAUDE")).toBe(false);
  });

  it("is case-sensitive - 'Codex' is not valid", () => {
    expect(isValidTarget("Codex")).toBe(false);
  });

  it("returns false for a number coerced to string", () => {
    expect(isValidTarget("123")).toBe(false);
  });

  it("returns false for special characters", () => {
    expect(isValidTarget("@#$%")).toBe(false);
  });

  it("returns false for a string with leading whitespace", () => {
    expect(isValidTarget(" claude")).toBe(false);
  });

  it("returns false for a string with trailing whitespace", () => {
    expect(isValidTarget("claude ")).toBe(false);
  });
});

// =============================================================================
// parseTargets tests
// =============================================================================

describe("parseTargets", () => {
  it("parses a single valid target", () => {
    expect(parseTargets(["claude"])).toEqual(["claude"]);
  });

  it("parses a single 'codex' target", () => {
    expect(parseTargets(["codex"])).toEqual(["codex"]);
  });

  it("parses multiple valid targets", () => {
    const result = parseTargets(["claude", "codex"]);
    expect(result).toContain("claude");
    expect(result).toContain("codex");
    expect(result).toHaveLength(2);
  });

  it("throws for an invalid target", () => {
    expect(() => parseTargets(["invalid"])).toThrow(/Invalid target "invalid"/);
  });

  it("includes supported targets in error message", () => {
    expect(() => parseTargets(["invalid"])).toThrow(/Supported targets:/);
  });

  it("returns default ['claude'] for an empty array", () => {
    expect(parseTargets([])).toEqual(["claude"]);
  });

  it("deduplicates targets", () => {
    const result = parseTargets(["claude", "claude"]);
    expect(result).toEqual(["claude"]);
  });

  it("deduplicates across array entries and comma-separated values", () => {
    const result = parseTargets(["claude", "claude,codex"]);
    expect(result).toEqual(["claude", "codex"]);
  });

  it("throws for mixed valid and invalid targets", () => {
    expect(() => parseTargets(["claude", "invalid"])).toThrow(/Invalid target "invalid"/);
  });

  it("supports comma-separated targets in a single string", () => {
    const result = parseTargets(["claude,codex"]);
    expect(result).toContain("claude");
    expect(result).toContain("codex");
    expect(result).toHaveLength(2);
  });

  it("trims whitespace around comma-separated values", () => {
    const result = parseTargets(["claude , codex"]);
    expect(result).toContain("claude");
    expect(result).toContain("codex");
    expect(result).toHaveLength(2);
  });

  it("lowercases input before validation", () => {
    const result = parseTargets(["Claude"]);
    expect(result).toEqual(["claude"]);
  });

  it("lowercases comma-separated input", () => {
    const result = parseTargets(["Claude,CODEX"]);
    expect(result).toContain("claude");
    expect(result).toContain("codex");
    expect(result).toHaveLength(2);
  });

  it("throws for comma-separated string with one invalid entry", () => {
    expect(() => parseTargets(["claude,invalid"])).toThrow(/Invalid target "invalid"/);
  });

  it("deduplicates within comma-separated values", () => {
    const result = parseTargets(["claude,claude"]);
    expect(result).toEqual(["claude"]);
  });

  it("preserves order of first occurrence", () => {
    const result = parseTargets(["codex", "claude"]);
    expect(result).toEqual(["codex", "claude"]);
  });

  it("handles multiple array entries each with comma-separated values", () => {
    const result = parseTargets(["claude,codex", "codex,claude"]);
    expect(result).toEqual(["claude", "codex"]);
  });
});

// =============================================================================
// getTargetConfig tests
// =============================================================================

describe("getTargetConfig", () => {
  it("returns config for 'claude'", () => {
    const config = getTargetConfig("claude");
    expect(config).toEqual({
      dir: ".claude",
      instructionsFile: "CLAUDE.md",
    });
  });

  it("returns config for 'codex'", () => {
    const config = getTargetConfig("codex");
    expect(config).toEqual({
      dir: ".codex",
      instructionsFile: null,
    });
  });

  it("claude config has a non-null instructionsFile", () => {
    const config = getTargetConfig("claude");
    expect(config.instructionsFile).toBe("CLAUDE.md");
  });

  it("codex config has null instructionsFile", () => {
    const config = getTargetConfig("codex");
    expect(config.instructionsFile).toBeNull();
  });

  it("returns config with expected TargetConfig shape", () => {
    for (const target of SUPPORTED_TARGETS) {
      const config = getTargetConfig(target);
      expect(config).toHaveProperty("dir");
      expect(config).toHaveProperty("instructionsFile");
      expect(typeof config.dir).toBe("string");
      expect(config.dir.length).toBeGreaterThan(0);
    }
  });

  it("config dir starts with a dot for all targets", () => {
    for (const target of SUPPORTED_TARGETS) {
      const config = getTargetConfig(target);
      expect(config.dir).toMatch(/^\./);
    }
  });
});

// =============================================================================
// SUPPORTED_TARGETS constant tests
// =============================================================================

describe("SUPPORTED_TARGETS", () => {
  it("includes 'claude'", () => {
    expect(SUPPORTED_TARGETS).toContain("claude");
  });

  it("includes 'codex'", () => {
    expect(SUPPORTED_TARGETS).toContain("codex");
  });

  it("has at least 2 entries", () => {
    expect(SUPPORTED_TARGETS.length).toBeGreaterThanOrEqual(2);
  });

  it("is a readonly array", () => {
    // Verify it is an array (readonly arrays are still arrays at runtime)
    expect(Array.isArray(SUPPORTED_TARGETS)).toBe(true);
  });
});

// =============================================================================
// TARGET_CONFIGS constant tests
// =============================================================================

describe("TARGET_CONFIGS", () => {
  it("has an entry for every supported target", () => {
    for (const target of SUPPORTED_TARGETS) {
      expect(TARGET_CONFIGS[target]).toBeDefined();
    }
  });

  it("each config has the expected structure", () => {
    for (const target of SUPPORTED_TARGETS) {
      const config = TARGET_CONFIGS[target];
      expect(typeof config.dir).toBe("string");
      expect(config.instructionsFile === null || typeof config.instructionsFile === "string").toBe(
        true,
      );
    }
  });
});
