import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatSourceString, resolveLocalSource } from "../../src/core/source.js";
import type { Source } from "../../src/schemas/lockfile.js";

// =============================================================================
// Test Data
// =============================================================================

const VALID_AGCONF_YAML = `version: "1.0.0"
meta:
  name: "test-canonical"
  organization: "Test Org"
  description: "Test canonical repo"
content:
  instructions: "instructions/AGENTS.md"
  skills_dir: "skills"
targets:
  - claude
markers:
  prefix: "agconf"
merge:
  preserve_repo_content: true
`;

const VALID_AGCONF_YAML_WITH_RULES = `version: "1.0.0"
meta:
  name: "test-canonical-rules"
content:
  instructions: "instructions/AGENTS.md"
  skills_dir: "skills"
  rules_dir: "rules"
targets:
  - claude
`;

const VALID_AGCONF_YAML_WITH_AGENTS = `version: "1.0.0"
meta:
  name: "test-canonical-agents"
content:
  instructions: "instructions/AGENTS.md"
  skills_dir: "skills"
  agents_dir: "agents"
targets:
  - claude
`;

const VALID_AGCONF_YAML_CUSTOM_PREFIX = `version: "1.0.0"
meta:
  name: "custom-prefix-test"
content:
  instructions: "instructions/AGENTS.md"
  skills_dir: "skills"
markers:
  prefix: "my-org"
`;

const INVALID_AGCONF_YAML_MISSING_META = `version: "1.0.0"
content:
  instructions: "instructions/AGENTS.md"
  skills_dir: "skills"
`;

const MALFORMED_YAML = `
version: 1.0.0
  meta
    name: broken
  bad indentation
`;

const SAMPLE_AGENTS_MD = `# Global Instructions

These are the shared instructions for all repositories.

## Coding Standards

- Follow TypeScript best practices
- Write tests for all new features
`;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a minimal valid canonical repo directory structure.
 * Creates the required instructions/AGENTS.md and skills/ directory,
 * and optionally an agconf.yaml config file.
 */
async function createCanonicalRepo(
  baseDir: string,
  options: {
    agconfYaml?: string;
    agentsMd?: string;
    createSkillsDir?: boolean;
    createInstructions?: boolean;
    rulesDir?: string;
    agentsDir?: string;
  } = {},
): Promise<void> {
  const {
    agconfYaml,
    agentsMd = SAMPLE_AGENTS_MD,
    createSkillsDir = true,
    createInstructions = true,
    rulesDir,
    agentsDir,
  } = options;

  await fs.mkdir(baseDir, { recursive: true });

  if (agconfYaml) {
    await fs.writeFile(path.join(baseDir, "agconf.yaml"), agconfYaml);
  }

  if (createInstructions) {
    await fs.mkdir(path.join(baseDir, "instructions"), { recursive: true });
    await fs.writeFile(path.join(baseDir, "instructions", "AGENTS.md"), agentsMd);
  }

  if (createSkillsDir) {
    await fs.mkdir(path.join(baseDir, "skills"), { recursive: true });
  }

  if (rulesDir) {
    await fs.mkdir(path.join(baseDir, rulesDir), { recursive: true });
  }

  if (agentsDir) {
    await fs.mkdir(path.join(baseDir, agentsDir), { recursive: true });
  }
}

// =============================================================================
// formatSourceString tests
// =============================================================================

describe("formatSourceString", () => {
  it("formats a local source with path only (no commit SHA)", () => {
    const source: Source = {
      type: "local",
      path: "/home/user/my-canonical-repo",
    };

    const result = formatSourceString(source);

    expect(result).toBe("local:/home/user/my-canonical-repo");
  });

  it("formats a local source with path and commit SHA", () => {
    const source: Source = {
      type: "local",
      path: "/home/user/my-canonical-repo",
      commit_sha: "abcdef1234567890abcdef1234567890abcdef12",
    };

    const result = formatSourceString(source);

    // Should show first 7 chars of SHA
    expect(result).toBe("local:/home/user/my-canonical-repo@abcdef1");
  });

  it("formats a GitHub source with repository and commit SHA", () => {
    const source: Source = {
      type: "github",
      repository: "acme/agent-standards",
      commit_sha: "deadbeef12345678deadbeef12345678deadbeef",
      ref: "main",
    };

    const result = formatSourceString(source);

    // Should show first 7 chars of SHA
    expect(result).toBe("github:acme/agent-standards@deadbee");
  });

  it("formats a GitHub source with short commit SHA", () => {
    const source: Source = {
      type: "github",
      repository: "org/repo",
      commit_sha: "abc1234",
      ref: "v1.0.0",
    };

    const result = formatSourceString(source);

    expect(result).toBe("github:org/repo@abc1234");
  });

  it("always includes SHA for GitHub source (not the ref)", () => {
    const source: Source = {
      type: "github",
      repository: "org/repo",
      commit_sha: "fedcba9876543210fedcba9876543210fedcba98",
      ref: "release/v2.0",
    };

    const result = formatSourceString(source);

    // The format uses commit_sha, not ref
    expect(result).toBe("github:org/repo@fedcba9");
    expect(result).not.toContain("release/v2.0");
  });

  it("handles local source with empty string commit SHA", () => {
    const source: Source = {
      type: "local",
      path: "/some/path",
      commit_sha: "",
    };

    const result = formatSourceString(source);

    // Empty commit_sha is falsy, so it should be omitted
    expect(result).toBe("local:/some/path");
  });
});

// =============================================================================
// resolveLocalSource tests
// =============================================================================

describe("resolveLocalSource", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(
      process.cwd(),
      `.test-source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("resolves a valid canonical directory with explicit path", async () => {
    const canonicalDir = path.join(tempDir, "canonical");
    await createCanonicalRepo(canonicalDir, {
      agconfYaml: VALID_AGCONF_YAML,
    });

    const resolved = await resolveLocalSource({ path: canonicalDir });

    expect(resolved.source.type).toBe("local");
    expect(resolved.basePath).toBe(canonicalDir);
    expect(resolved.agentsMdPath).toBe(path.join(canonicalDir, "instructions", "AGENTS.md"));
    expect(resolved.skillsPath).toBe(path.join(canonicalDir, "skills"));
    expect(resolved.markerPrefix).toBe("agconf");
    expect(resolved.rulesPath).toBeNull();
    expect(resolved.agentsPath).toBeNull();
  });

  it("resolves a valid canonical directory with rules_dir configured", async () => {
    const canonicalDir = path.join(tempDir, "canonical-rules");
    await createCanonicalRepo(canonicalDir, {
      agconfYaml: VALID_AGCONF_YAML_WITH_RULES,
      rulesDir: "rules",
    });

    const resolved = await resolveLocalSource({ path: canonicalDir });

    expect(resolved.rulesPath).toBe(path.join(canonicalDir, "rules"));
    expect(resolved.agentsPath).toBeNull();
  });

  it("resolves a valid canonical directory with agents_dir configured", async () => {
    const canonicalDir = path.join(tempDir, "canonical-agents");
    await createCanonicalRepo(canonicalDir, {
      agconfYaml: VALID_AGCONF_YAML_WITH_AGENTS,
      agentsDir: "agents",
    });

    const resolved = await resolveLocalSource({ path: canonicalDir });

    expect(resolved.agentsPath).toBe(path.join(canonicalDir, "agents"));
    expect(resolved.rulesPath).toBeNull();
  });

  it("resolves with custom marker prefix from agconf.yaml", async () => {
    const canonicalDir = path.join(tempDir, "canonical-custom");
    await createCanonicalRepo(canonicalDir, {
      agconfYaml: VALID_AGCONF_YAML_CUSTOM_PREFIX,
    });

    const resolved = await resolveLocalSource({ path: canonicalDir });

    expect(resolved.markerPrefix).toBe("my-org");
  });

  it("defaults marker prefix to 'agconf' when config has no explicit prefix", async () => {
    // A config without explicit markers section - should use default
    const minimalConfig = `version: "1.0.0"
meta:
  name: "minimal"
`;
    const canonicalDir = path.join(tempDir, "canonical-minimal");
    await createCanonicalRepo(canonicalDir, {
      agconfYaml: minimalConfig,
    });

    const resolved = await resolveLocalSource({ path: canonicalDir });

    expect(resolved.markerPrefix).toBe("agconf");
  });

  it("returns local source type with path in source object", async () => {
    const canonicalDir = path.join(tempDir, "canonical-source");
    await createCanonicalRepo(canonicalDir, {
      agconfYaml: VALID_AGCONF_YAML,
    });

    const resolved = await resolveLocalSource({ path: canonicalDir });

    expect(resolved.source.type).toBe("local");
    if (resolved.source.type === "local") {
      expect(resolved.source.path).toBe(canonicalDir);
    }
  });

  it("throws when path does not exist", async () => {
    const nonExistentPath = path.join(tempDir, "does-not-exist");

    await expect(resolveLocalSource({ path: nonExistentPath })).rejects.toThrow(
      /Invalid canonical repository/,
    );
  });

  it("throws when directory is missing instructions/AGENTS.md", async () => {
    const incompleteDir = path.join(tempDir, "incomplete-no-agents");
    await createCanonicalRepo(incompleteDir, {
      agconfYaml: VALID_AGCONF_YAML,
      createInstructions: false,
    });

    await expect(resolveLocalSource({ path: incompleteDir })).rejects.toThrow(
      /missing instructions\/AGENTS.md/,
    );
  });

  it("throws when directory is missing skills/ directory", async () => {
    const incompleteDir = path.join(tempDir, "incomplete-no-skills");
    await createCanonicalRepo(incompleteDir, {
      agconfYaml: VALID_AGCONF_YAML,
      createSkillsDir: false,
    });

    await expect(resolveLocalSource({ path: incompleteDir })).rejects.toThrow(
      /missing skills\/ directory/,
    );
  });

  it("resolves relative path to absolute", async () => {
    const canonicalDir = path.join(tempDir, "canonical-relative");
    await createCanonicalRepo(canonicalDir, {
      agconfYaml: VALID_AGCONF_YAML,
    });

    // Use a relative path (relative to cwd)
    const relativePath = path.relative(process.cwd(), canonicalDir);
    const resolved = await resolveLocalSource({ path: relativePath });

    // basePath should be absolute
    expect(path.isAbsolute(resolved.basePath)).toBe(true);
    expect(resolved.basePath).toBe(canonicalDir);
  });

  it("works without agconf.yaml (falls back to defaults)", async () => {
    const canonicalDir = path.join(tempDir, "canonical-no-config");
    await createCanonicalRepo(canonicalDir, {
      // No agconf.yaml
    });

    const resolved = await resolveLocalSource({ path: canonicalDir });

    // Without config, markerPrefix defaults to "agconf"
    expect(resolved.markerPrefix).toBe("agconf");
    expect(resolved.rulesPath).toBeNull();
    expect(resolved.agentsPath).toBeNull();
  });
});

// =============================================================================
// isCanonicalRepo tests (tested indirectly through findCanonicalRepo)
// =============================================================================

// isCanonicalRepo is not exported, so we test it indirectly through
// resolveLocalSource (which calls findCanonicalRepo, which calls isCanonicalRepo).
// The function checks:
// 1. Directory exists and is a directory
// 2. instructions/AGENTS.md exists
// 3. skills/ directory exists
// 4. Optionally verifies git remote contains "agconf"
//
// We test the structure checks via resolveLocalSource and validateCanonicalRepo.

// =============================================================================
// validateCanonicalRepo tests (tested indirectly through resolveLocalSource)
// =============================================================================

describe("validateCanonicalRepo (via resolveLocalSource)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(
      process.cwd(),
      `.test-validate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("validates a complete canonical repo structure", async () => {
    const canonicalDir = path.join(tempDir, "valid");
    await createCanonicalRepo(canonicalDir, {
      agconfYaml: VALID_AGCONF_YAML,
    });

    // Should not throw
    const resolved = await resolveLocalSource({ path: canonicalDir });
    expect(resolved.basePath).toBe(canonicalDir);
  });

  it("rejects repo missing instructions/AGENTS.md", async () => {
    const dir = path.join(tempDir, "missing-instructions");
    await fs.mkdir(path.join(dir, "skills"), { recursive: true });
    await fs.writeFile(path.join(dir, "agconf.yaml"), VALID_AGCONF_YAML);
    // No instructions/AGENTS.md

    await expect(resolveLocalSource({ path: dir })).rejects.toThrow(
      /missing instructions\/AGENTS.md/,
    );
  });

  it("rejects repo missing skills/ directory", async () => {
    const dir = path.join(tempDir, "missing-skills");
    await fs.mkdir(path.join(dir, "instructions"), { recursive: true });
    await fs.writeFile(path.join(dir, "instructions", "AGENTS.md"), SAMPLE_AGENTS_MD);
    await fs.writeFile(path.join(dir, "agconf.yaml"), VALID_AGCONF_YAML);
    // No skills/

    await expect(resolveLocalSource({ path: dir })).rejects.toThrow(/missing skills\/ directory/);
  });

  it("rejects completely empty directory", async () => {
    const dir = path.join(tempDir, "empty");
    await fs.mkdir(dir, { recursive: true });

    await expect(resolveLocalSource({ path: dir })).rejects.toThrow(/Invalid canonical repository/);
  });
});

// =============================================================================
// findCanonicalRepo tests (tested indirectly via resolveLocalSource without path)
// =============================================================================

describe("findCanonicalRepo (via resolveLocalSource without explicit path)", () => {
  let tempDir: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = path.join(
      process.cwd(),
      `.test-find-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    cwdSpy?.mockRestore();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("finds canonical repo when cwd is the canonical repo root", async () => {
    const canonicalDir = path.join(tempDir, "canonical");
    await createCanonicalRepo(canonicalDir, {
      agconfYaml: VALID_AGCONF_YAML,
    });

    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(canonicalDir);
    const resolved = await resolveLocalSource({});

    expect(resolved.basePath).toBe(canonicalDir);
  });

  it("finds canonical repo when cwd is a subdirectory of the canonical repo", async () => {
    const canonicalDir = path.join(tempDir, "canonical");
    await createCanonicalRepo(canonicalDir, {
      agconfYaml: VALID_AGCONF_YAML,
    });

    // Create a subdirectory inside the canonical repo
    const subDir = path.join(canonicalDir, "some", "deep", "subdir");
    await fs.mkdir(subDir, { recursive: true });

    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(subDir);
    const resolved = await resolveLocalSource({});

    expect(resolved.basePath).toBe(canonicalDir);
  });

  it("finds sibling 'agconf' directory from a neighboring repo", async () => {
    // Parent directory with two siblings:
    //   parent/
    //     agconf/           <-- canonical (has instructions/AGENTS.md + skills/)
    //     my-project/       <-- cwd
    const parentDir = path.join(tempDir, "parent");
    const canonicalDir = path.join(parentDir, "agconf");
    const projectDir = path.join(parentDir, "my-project");

    await createCanonicalRepo(canonicalDir, {
      agconfYaml: VALID_AGCONF_YAML,
    });
    await fs.mkdir(projectDir, { recursive: true });

    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(projectDir);
    const resolved = await resolveLocalSource({});

    expect(resolved.basePath).toBe(canonicalDir);
  });

  it("throws when no canonical repo is found anywhere up the tree", async () => {
    // Create a directory tree with no canonical repo
    const isolatedDir = path.join(tempDir, "no-canonical", "deep", "dir");
    await fs.mkdir(isolatedDir, { recursive: true });

    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(isolatedDir);

    await expect(resolveLocalSource({})).rejects.toThrow(/Could not find canonical repository/);
  });
});

// =============================================================================
// resolveGithubSource tests
// =============================================================================

// resolveGithubSource requires network access (git clone) which makes it
// unsuitable for unit tests. It would need either:
// - Mocking of simple-git and child_process.exec
// - Integration tests with a real GitHub repo
//
// The function does the following:
// 1. Calls cloneRepository() which tries:
//    a. gh CLI clone
//    b. HTTPS clone with GITHUB_TOKEN
//    c. Plain HTTPS clone
// 2. Gets the latest commit SHA from the cloned repo
// 3. Loads canonical config from the cloned directory
// 4. Returns a ResolvedSource with source.type = "github"
//
// Key behaviors to verify in integration tests:
// - Successful clone sets correct repository, commit_sha, ref in source
// - Canonical config is loaded from the cloned directory
// - rulesPath and agentsPath are set based on config
// - markerPrefix is read from config or defaults to "agconf"
// - Constructed paths use the provided tempDir as base
//
// For now, we verify the function signature and return type by testing
// the closely related resolveLocalSource, which has the same output structure.

describe("resolveGithubSource", () => {
  it.skip("requires network access - tested via integration tests", () => {
    // resolveGithubSource clones a GitHub repository, which needs network.
    // Integration tests should cover:
    // - Clone with gh CLI
    // - Clone with GITHUB_TOKEN
    // - Clone with plain HTTPS
    // - Correct source.type = "github" in returned object
    // - ref is stored in source object
  });
});

// =============================================================================
// ResolvedSource structure tests
// =============================================================================

describe("ResolvedSource structure consistency", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(
      process.cwd(),
      `.test-structure-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("agentsMdPath always points to instructions/AGENTS.md relative to basePath", async () => {
    const canonicalDir = path.join(tempDir, "canonical");
    await createCanonicalRepo(canonicalDir, {
      agconfYaml: VALID_AGCONF_YAML,
    });

    const resolved = await resolveLocalSource({ path: canonicalDir });

    expect(resolved.agentsMdPath).toBe(path.join(resolved.basePath, "instructions", "AGENTS.md"));
  });

  it("skillsPath always points to skills/ relative to basePath", async () => {
    const canonicalDir = path.join(tempDir, "canonical");
    await createCanonicalRepo(canonicalDir, {
      agconfYaml: VALID_AGCONF_YAML,
    });

    const resolved = await resolveLocalSource({ path: canonicalDir });

    expect(resolved.skillsPath).toBe(path.join(resolved.basePath, "skills"));
  });

  it("rulesPath is relative to basePath when configured", async () => {
    const canonicalDir = path.join(tempDir, "canonical");
    await createCanonicalRepo(canonicalDir, {
      agconfYaml: VALID_AGCONF_YAML_WITH_RULES,
      rulesDir: "rules",
    });

    const resolved = await resolveLocalSource({ path: canonicalDir });

    expect(resolved.rulesPath).toBe(path.join(resolved.basePath, "rules"));
  });

  it("agentsPath is relative to basePath when configured", async () => {
    const canonicalDir = path.join(tempDir, "canonical");
    await createCanonicalRepo(canonicalDir, {
      agconfYaml: VALID_AGCONF_YAML_WITH_AGENTS,
      agentsDir: "agents",
    });

    const resolved = await resolveLocalSource({ path: canonicalDir });

    expect(resolved.agentsPath).toBe(path.join(resolved.basePath, "agents"));
  });

  it("commit_sha is optional for local sources (not a git repo)", async () => {
    const canonicalDir = path.join(tempDir, "canonical-no-git");
    await createCanonicalRepo(canonicalDir, {
      agconfYaml: VALID_AGCONF_YAML,
    });

    const resolved = await resolveLocalSource({ path: canonicalDir });

    // In a temp dir that is not a git repo, commit_sha should be undefined
    expect(resolved.source.type).toBe("local");
    if (resolved.source.type === "local") {
      // commit_sha might be undefined or a string (if running inside a git repo)
      // The key point is it doesn't throw
      expect(
        typeof resolved.source.commit_sha === "string" || resolved.source.commit_sha === undefined,
      ).toBe(true);
    }
  });

  it("all paths in resolved source are absolute", async () => {
    const canonicalDir = path.join(tempDir, "canonical");
    await createCanonicalRepo(canonicalDir, {
      agconfYaml: VALID_AGCONF_YAML_WITH_RULES,
      rulesDir: "rules",
    });

    const resolved = await resolveLocalSource({ path: canonicalDir });

    expect(path.isAbsolute(resolved.basePath)).toBe(true);
    expect(path.isAbsolute(resolved.agentsMdPath)).toBe(true);
    expect(path.isAbsolute(resolved.skillsPath)).toBe(true);
    if (resolved.rulesPath) {
      expect(path.isAbsolute(resolved.rulesPath)).toBe(true);
    }
    if (resolved.agentsPath) {
      expect(path.isAbsolute(resolved.agentsPath)).toBe(true);
    }
  });
});

// =============================================================================
// Edge cases and error handling
// =============================================================================

describe("source resolution edge cases", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(
      process.cwd(),
      `.test-edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("handles canonical repo with invalid agconf.yaml gracefully", async () => {
    const canonicalDir = path.join(tempDir, "canonical-bad-config");
    await createCanonicalRepo(canonicalDir, {
      agconfYaml: INVALID_AGCONF_YAML_MISSING_META,
    });

    // loadCanonicalRepoConfig will throw due to invalid config
    // resolveLocalSource should propagate that error
    await expect(resolveLocalSource({ path: canonicalDir })).rejects.toThrow();
  });

  it("handles canonical repo with malformed YAML in agconf.yaml", async () => {
    const canonicalDir = path.join(tempDir, "canonical-malformed");
    await createCanonicalRepo(canonicalDir, {
      agconfYaml: MALFORMED_YAML,
    });

    await expect(resolveLocalSource({ path: canonicalDir })).rejects.toThrow();
  });

  it("handles path with trailing slash", async () => {
    const canonicalDir = path.join(tempDir, "canonical-trailing");
    await createCanonicalRepo(canonicalDir, {
      agconfYaml: VALID_AGCONF_YAML,
    });

    // Path with trailing slash should be resolved correctly
    const resolved = await resolveLocalSource({ path: `${canonicalDir}/` });

    expect(resolved.basePath).toBe(canonicalDir);
  });

  it("handles symlinked canonical directories", async () => {
    const realDir = path.join(tempDir, "real-canonical");
    const symlinkDir = path.join(tempDir, "symlink-canonical");

    await createCanonicalRepo(realDir, {
      agconfYaml: VALID_AGCONF_YAML,
    });

    await fs.symlink(realDir, symlinkDir, "dir");

    // Resolving via symlink should work
    const resolved = await resolveLocalSource({ path: symlinkDir });

    // basePath will be the symlink path (resolved by path.resolve, not realpath)
    expect(resolved.basePath).toBe(symlinkDir);
    expect(resolved.agentsMdPath).toBe(path.join(symlinkDir, "instructions", "AGENTS.md"));
  });

  it("handles concurrent resolution of the same path", async () => {
    const canonicalDir = path.join(tempDir, "canonical-concurrent");
    await createCanonicalRepo(canonicalDir, {
      agconfYaml: VALID_AGCONF_YAML,
    });

    // Resolve the same path concurrently
    const [resolved1, resolved2] = await Promise.all([
      resolveLocalSource({ path: canonicalDir }),
      resolveLocalSource({ path: canonicalDir }),
    ]);

    expect(resolved1.basePath).toBe(resolved2.basePath);
    expect(resolved1.markerPrefix).toBe(resolved2.markerPrefix);
  });
});
