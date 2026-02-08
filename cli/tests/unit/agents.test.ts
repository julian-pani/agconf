import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addAgentMetadata, parseAgent, validateAgentFrontmatter } from "../../src/core/agents.js";
import { computeContentHash, hasManualChanges, isManaged } from "../../src/core/managed-content.js";
import { deleteOrphanedAgents, findOrphanedAgents, syncAgents } from "../../src/core/sync.js";

// =============================================================================
// Test Data
// =============================================================================

const SAMPLE_AGENT_WITH_TOOLS = `---
name: code-reviewer
description: Reviews code for quality and security issues
tools:
  - read
  - grep
  - glob
model: claude-3-opus
metadata:
  author: Platform Team
---

# Code Reviewer Agent

This agent reviews code for potential issues.

## Capabilities

- Security vulnerability detection
- Code style checking
`;

const SAMPLE_AGENT_MINIMAL = `---
name: simple-agent
description: A simple agent with minimal config
---

# Simple Agent

Does basic tasks.
`;

const SAMPLE_AGENT_WITHOUT_FRONTMATTER = `# No Frontmatter Agent

This agent has no YAML frontmatter.
`;

const SAMPLE_AGENT_MISSING_NAME = `---
description: Missing the required name field
---

# Missing Name

Content here.
`;

const SAMPLE_AGENT_MISSING_DESCRIPTION = `---
name: missing-description
---

# Missing Description

Content here.
`;

// =============================================================================
// parseAgent tests
// =============================================================================

describe("parseAgent", () => {
  it("parses agent with full frontmatter", () => {
    const agent = parseAgent(SAMPLE_AGENT_WITH_TOOLS, "code-reviewer.md");

    expect(agent.relativePath).toBe("code-reviewer.md");
    expect(agent.rawContent).toBe(SAMPLE_AGENT_WITH_TOOLS);
    expect(agent.frontmatter).not.toBeNull();
    expect(agent.frontmatter?.name).toBe("code-reviewer");
    expect(agent.frontmatter?.description).toBe("Reviews code for quality and security issues");
    expect(agent.frontmatter?.tools).toEqual(["read", "grep", "glob"]);
    expect(agent.frontmatter?.model).toBe("claude-3-opus");
    expect(agent.frontmatter?.metadata).toEqual({ author: "Platform Team" });
    expect(agent.body).toContain("# Code Reviewer Agent");
    expect(agent.body).not.toContain("---");
  });

  it("parses agent with minimal frontmatter", () => {
    const agent = parseAgent(SAMPLE_AGENT_MINIMAL, "simple-agent.md");

    expect(agent.relativePath).toBe("simple-agent.md");
    expect(agent.frontmatter).not.toBeNull();
    expect(agent.frontmatter?.name).toBe("simple-agent");
    expect(agent.frontmatter?.description).toBe("A simple agent with minimal config");
    expect(agent.frontmatter?.tools).toBeUndefined();
    expect(agent.body).toContain("# Simple Agent");
  });

  it("parses agent without frontmatter", () => {
    const agent = parseAgent(SAMPLE_AGENT_WITHOUT_FRONTMATTER, "no-frontmatter.md");

    expect(agent.relativePath).toBe("no-frontmatter.md");
    expect(agent.frontmatter).toBeNull();
    expect(agent.body).toBe(SAMPLE_AGENT_WITHOUT_FRONTMATTER);
  });

  it("preserves the raw content exactly", () => {
    const agent = parseAgent(SAMPLE_AGENT_WITH_TOOLS, "test.md");
    expect(agent.rawContent).toBe(SAMPLE_AGENT_WITH_TOOLS);
  });
});

// =============================================================================
// validateAgentFrontmatter tests
// =============================================================================

describe("validateAgentFrontmatter", () => {
  it("returns null for valid agent with all required fields", () => {
    const error = validateAgentFrontmatter(SAMPLE_AGENT_WITH_TOOLS, "code-reviewer.md");
    expect(error).toBeNull();
  });

  it("returns null for minimal valid agent", () => {
    const error = validateAgentFrontmatter(SAMPLE_AGENT_MINIMAL, "simple-agent.md");
    expect(error).toBeNull();
  });

  it("returns error when frontmatter is missing", () => {
    const error = validateAgentFrontmatter(SAMPLE_AGENT_WITHOUT_FRONTMATTER, "no-frontmatter.md");

    expect(error).not.toBeNull();
    expect(error?.agentPath).toBe("no-frontmatter.md");
    expect(error?.errors).toContain("Missing frontmatter (must have --- delimiters)");
  });

  it("returns error when name is missing", () => {
    const error = validateAgentFrontmatter(SAMPLE_AGENT_MISSING_NAME, "missing-name.md");

    expect(error).not.toBeNull();
    expect(error?.errors).toContain("Missing required field: name");
  });

  it("returns error when description is missing", () => {
    const error = validateAgentFrontmatter(SAMPLE_AGENT_MISSING_DESCRIPTION, "missing-desc.md");

    expect(error).not.toBeNull();
    expect(error?.errors).toContain("Missing required field: description");
  });

  it("returns multiple errors when both name and description are missing", () => {
    const content = `---
tools:
  - read
---

# Agent
`;
    const error = validateAgentFrontmatter(content, "test.md");

    expect(error).not.toBeNull();
    expect(error?.errors).toContain("Missing required field: name");
    expect(error?.errors).toContain("Missing required field: description");
  });
});

// =============================================================================
// addAgentMetadata tests
// =============================================================================

describe("addAgentMetadata", () => {
  it("adds metadata to agent without existing metadata", () => {
    const agent = parseAgent(SAMPLE_AGENT_MINIMAL, "simple-agent.md");
    const result = addAgentMetadata(agent, "agconf");

    // Should have frontmatter with metadata
    expect(result).toContain("---");
    expect(result).toContain('agconf_managed: "true"');
    expect(result).toContain("agconf_content_hash: ");

    // Should NOT have source_path (agents are flat files)
    expect(result).not.toContain("agconf_source_path");

    // Body should be preserved
    expect(result).toContain("# Simple Agent");
  });

  it("preserves existing frontmatter fields", () => {
    const agent = parseAgent(SAMPLE_AGENT_WITH_TOOLS, "code-reviewer.md");
    const result = addAgentMetadata(agent, "agconf");

    // Existing fields should be preserved
    expect(result).toContain("name: code-reviewer");
    expect(result).toContain("description: Reviews code for quality and security issues");
    expect(result).toContain("model: claude-3-opus");

    // Tools array should be preserved
    expect(result).toContain("tools:");
    expect(result).toContain("read");
    expect(result).toContain("grep");
    expect(result).toContain("glob");

    // New metadata should be added
    expect(result).toContain('agconf_managed: "true"');
    expect(result).toContain("agconf_content_hash: ");
  });

  it("preserves existing metadata fields", () => {
    const agent = parseAgent(SAMPLE_AGENT_WITH_TOOLS, "code-reviewer.md");
    const result = addAgentMetadata(agent, "agconf");

    // Should preserve author in metadata
    expect(result).toContain("author:");
    expect(result).toContain("Platform Team");
  });

  it("uses correct prefix for metadata keys", () => {
    const agent = parseAgent(SAMPLE_AGENT_MINIMAL, "test.md");

    const resultDefault = addAgentMetadata(agent, "agconf");
    expect(resultDefault).toContain("agconf_managed:");

    const resultCustom = addAgentMetadata(agent, "custom_prefix");
    expect(resultCustom).toContain("custom_prefix_managed:");
    expect(resultCustom).not.toContain("agconf_managed:");
  });

  it("generates consistent hash for same content", () => {
    const agent = parseAgent(SAMPLE_AGENT_MINIMAL, "test.md");

    const result1 = addAgentMetadata(agent, "agconf");
    const result2 = addAgentMetadata(agent, "agconf");

    // Extract hashes
    const hashMatch1 = result1.match(/agconf_content_hash: "?(sha256:[a-f0-9]+)"?/);
    const hashMatch2 = result2.match(/agconf_content_hash: "?(sha256:[a-f0-9]+)"?/);

    expect(hashMatch1?.[1]).toBe(hashMatch2?.[1]);
  });

  it("produces hash that matches check command verification (sync-check consistency)", () => {
    // This test ensures that the hash stored during sync matches what the check
    // command will compute when verifying the file.

    const rawContent = `---
name: test-agent
description: A test agent for verification
---

# Test Agent

Content here.`;

    const agent = parseAgent(rawContent, "test-agent.md");

    // Step 1: Sync - get the content that would be written to disk
    const syncedContent = addAgentMetadata(agent, "agconf");

    // Extract the stored hash from the synced content
    const hashMatch = syncedContent.match(/agconf_content_hash: "?(sha256:[a-f0-9]+)"?/);
    expect(hashMatch).not.toBeNull();
    const storedHash = hashMatch![1];

    // Step 2: Check - simulate what check command does
    const checkHash = computeContentHash(syncedContent, { metadataPrefix: "agconf" });

    // These MUST match
    expect(checkHash).toBe(storedHash);
  });

  it("does not include source_path (unlike rules)", () => {
    // Agents use flat files, so we don't need source_path
    const agent = parseAgent(SAMPLE_AGENT_MINIMAL, "simple-agent.md");
    const result = addAgentMetadata(agent, "agconf");

    expect(result).not.toContain("source_path");
  });
});

// =============================================================================
// syncAgents tests
// =============================================================================

describe("syncAgents", () => {
  let tempDir: string;
  let sourceAgentsDir: string;
  let targetDir: string;

  beforeEach(async () => {
    tempDir = path.join(process.cwd(), `.test-agents-${Date.now()}`);
    sourceAgentsDir = path.join(tempDir, "canonical", "agents");
    targetDir = path.join(tempDir, "downstream");

    await fs.mkdir(sourceAgentsDir, { recursive: true });
    await fs.mkdir(path.join(targetDir, ".claude", "agents"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("syncs agents to .claude/agents directory", async () => {
    // Create source agents
    await fs.writeFile(path.join(sourceAgentsDir, "code-reviewer.md"), SAMPLE_AGENT_MINIMAL);
    await fs.writeFile(path.join(sourceAgentsDir, "test-writer.md"), SAMPLE_AGENT_WITH_TOOLS);

    const result = await syncAgents({
      sourceAgentsPath: sourceAgentsDir,
      targetDir,
      metadataPrefix: "agconf",
    });

    expect(result.agents.length).toBe(2);
    expect(result.syncedFiles).toContain("code-reviewer.md");
    expect(result.syncedFiles).toContain("test-writer.md");
    expect(result.contentHash).toMatch(/^sha256:[a-f0-9]{12}$/);

    // Check files were written to target
    const targetAgents = await fs.readdir(path.join(targetDir, ".claude", "agents"));
    expect(targetAgents).toContain("code-reviewer.md");
    expect(targetAgents).toContain("test-writer.md");

    // Check files have metadata
    const syncedContent = await fs.readFile(
      path.join(targetDir, ".claude", "agents", "code-reviewer.md"),
      "utf-8",
    );
    expect(syncedContent).toContain("agconf_managed:");
    expect(syncedContent).toContain("agconf_content_hash:");
  });

  it("returns empty result when agents directory does not exist", async () => {
    await fs.rm(sourceAgentsDir, { recursive: true, force: true });

    const result = await syncAgents({
      sourceAgentsPath: sourceAgentsDir,
      targetDir,
      metadataPrefix: "agconf",
    });

    expect(result.agents.length).toBe(0);
    expect(result.syncedFiles.length).toBe(0);
    expect(result.contentHash).toBe("");
  });

  it("returns validation errors for invalid agents", async () => {
    // Create an agent with missing required fields
    await fs.writeFile(path.join(sourceAgentsDir, "invalid.md"), SAMPLE_AGENT_WITHOUT_FRONTMATTER);

    const result = await syncAgents({
      sourceAgentsPath: sourceAgentsDir,
      targetDir,
      metadataPrefix: "agconf",
    });

    expect(result.validationErrors.length).toBe(1);
    expect(result.validationErrors[0].agentPath).toBe("invalid.md");
  });

  it("tracks modified files", async () => {
    // Create source agent
    await fs.writeFile(path.join(sourceAgentsDir, "agent.md"), SAMPLE_AGENT_MINIMAL);

    // First sync - should report as modified (new file)
    const result1 = await syncAgents({
      sourceAgentsPath: sourceAgentsDir,
      targetDir,
      metadataPrefix: "agconf",
    });
    expect(result1.modifiedFiles).toContain("agent.md");

    // Second sync with same content - should NOT report as modified
    const result2 = await syncAgents({
      sourceAgentsPath: sourceAgentsDir,
      targetDir,
      metadataPrefix: "agconf",
    });
    expect(result2.modifiedFiles).not.toContain("agent.md");
  });
});

// =============================================================================
// findOrphanedAgents tests
// =============================================================================

describe("findOrphanedAgents", () => {
  it("finds agents that were removed from canonical", () => {
    const previous = ["agent1.md", "agent2.md", "agent3.md"];
    const current = ["agent1.md", "agent3.md"];

    const orphaned = findOrphanedAgents(previous, current);

    expect(orphaned).toEqual(["agent2.md"]);
  });

  it("returns empty array when no agents removed", () => {
    const previous = ["agent1.md", "agent2.md"];
    const current = ["agent1.md", "agent2.md", "agent3.md"];

    const orphaned = findOrphanedAgents(previous, current);

    expect(orphaned).toEqual([]);
  });

  it("returns all previous agents when current is empty", () => {
    const previous = ["agent1.md", "agent2.md"];
    const current: string[] = [];

    const orphaned = findOrphanedAgents(previous, current);

    expect(orphaned).toEqual(["agent1.md", "agent2.md"]);
  });
});

// =============================================================================
// deleteOrphanedAgents tests
// =============================================================================

describe("deleteOrphanedAgents", () => {
  let tempDir: string;
  let targetDir: string;
  let agentsDir: string;

  beforeEach(async () => {
    tempDir = path.join(process.cwd(), `.test-delete-agents-${Date.now()}`);
    targetDir = path.join(tempDir, "downstream");
    agentsDir = path.join(targetDir, ".claude", "agents");
    await fs.mkdir(agentsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("deletes managed orphaned agents", async () => {
    // Create a managed agent file
    const agent = parseAgent(SAMPLE_AGENT_MINIMAL, "orphan.md");
    const managedContent = addAgentMetadata(agent, "agconf");
    await fs.writeFile(path.join(agentsDir, "orphan.md"), managedContent);

    const result = await deleteOrphanedAgents(
      targetDir,
      ["orphan.md"],
      ["orphan.md"], // was in previous lockfile
      { metadataPrefix: "agconf" },
    );

    expect(result.deleted).toContain("orphan.md");
    expect(result.skipped).not.toContain("orphan.md");

    // File should be deleted
    const exists = await fs
      .access(path.join(agentsDir, "orphan.md"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it("skips non-managed agents", async () => {
    // Create an agent without managed metadata
    await fs.writeFile(path.join(agentsDir, "manual.md"), SAMPLE_AGENT_MINIMAL);

    const result = await deleteOrphanedAgents(
      targetDir,
      ["manual.md"],
      [], // not in previous lockfile
      { metadataPrefix: "agconf" },
    );

    expect(result.deleted).not.toContain("manual.md");
    expect(result.skipped).toContain("manual.md");

    // File should still exist
    const exists = await fs
      .access(path.join(agentsDir, "manual.md"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  it("handles non-existent files gracefully", async () => {
    const result = await deleteOrphanedAgents(targetDir, ["non-existent.md"], [], {
      metadataPrefix: "agconf",
    });

    expect(result.deleted).not.toContain("non-existent.md");
    expect(result.skipped).not.toContain("non-existent.md");
  });
});

// =============================================================================
// Check integration tests
// =============================================================================

describe("agent check integration", () => {
  let tempDir: string;
  let agentsDir: string;

  beforeEach(async () => {
    tempDir = path.join(process.cwd(), `.test-agent-check-${Date.now()}`);
    agentsDir = path.join(tempDir, ".claude", "agents");
    await fs.mkdir(agentsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("detects managed agent file", async () => {
    const agent = parseAgent(SAMPLE_AGENT_MINIMAL, "test.md");
    const managedContent = addAgentMetadata(agent, "agconf");
    await fs.writeFile(path.join(agentsDir, "test.md"), managedContent);

    // Read the file and check if it's managed
    const content = await fs.readFile(path.join(agentsDir, "test.md"), "utf-8");
    const managed = isManaged(content, { metadataPrefix: "agconf" });

    expect(managed).toBe(true);
  });

  it("detects no changes immediately after sync", async () => {
    const agent = parseAgent(SAMPLE_AGENT_MINIMAL, "test.md");
    const managedContent = addAgentMetadata(agent, "agconf");
    await fs.writeFile(path.join(agentsDir, "test.md"), managedContent);

    // Read the file and check if it has changes
    const content = await fs.readFile(path.join(agentsDir, "test.md"), "utf-8");
    const hasChanges = hasManualChanges(content, { metadataPrefix: "agconf" });

    expect(hasChanges).toBe(false);
  });

  it("detects changes when file is modified", async () => {
    const agent = parseAgent(SAMPLE_AGENT_MINIMAL, "test.md");
    const managedContent = addAgentMetadata(agent, "agconf");
    await fs.writeFile(path.join(agentsDir, "test.md"), managedContent);

    // Modify the file
    const modifiedContent = managedContent.replace("Does basic tasks.", "Does modified tasks.");
    await fs.writeFile(path.join(agentsDir, "test.md"), modifiedContent);

    // Read the file and check if it has changes
    const content = await fs.readFile(path.join(agentsDir, "test.md"), "utf-8");
    const hasChanges = hasManualChanges(content, { metadataPrefix: "agconf" });

    expect(hasChanges).toBe(true);
  });
});
