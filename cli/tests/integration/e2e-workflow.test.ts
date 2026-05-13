import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stringify as yamlStringify } from "yaml";
import { checkCommand } from "../../src/commands/check.js";
import { initCommand } from "../../src/commands/init.js";
import { syncCommand } from "../../src/commands/sync.js";
import { getMarkers } from "../../src/core/markers.js";

// ─── Shared test infrastructure ────────────────────────────────────────────

const originalCwd = process.cwd;

/**
 * Create a canonical repo directory with all content types.
 */
async function setupCanonicalRepo(
  dir: string,
  options: {
    globalContent?: string;
    skills?: Record<string, string>;
    rules?: Record<string, string>;
    agents?: Record<string, string>;
    targets?: string[];
    markerPrefix?: string;
  } = {},
): Promise<void> {
  const {
    globalContent = "# Global Engineering Standards\n\nThese are the company standards.",
    skills = {
      "code-review": `---\nname: code-review\ndescription: Code review skill\n---\n\n# Code Review\n\nReview code for quality.\n`,
    },
    rules,
    agents,
    targets,
    markerPrefix,
  } = options;

  // Instructions
  await fs.mkdir(path.join(dir, "instructions"), { recursive: true });
  await fs.writeFile(path.join(dir, "instructions", "AGENTS.md"), globalContent, "utf-8");

  // Skills
  await fs.mkdir(path.join(dir, "skills"), { recursive: true });
  for (const [name, content] of Object.entries(skills)) {
    await fs.mkdir(path.join(dir, "skills", name), { recursive: true });
    await fs.writeFile(path.join(dir, "skills", name, "SKILL.md"), content, "utf-8");
  }

  // Rules (optional)
  if (rules) {
    for (const [relPath, content] of Object.entries(rules)) {
      const fullPath = path.join(dir, "rules", relPath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf-8");
    }
  }

  // Agents (optional)
  if (agents) {
    for (const [relPath, content] of Object.entries(agents)) {
      const fullPath = path.join(dir, "agents", relPath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf-8");
    }
  }

  // agconf.yaml
  const config: Record<string, unknown> = {
    version: "1.0.0",
    meta: { name: "e2e-test-canonical" },
  };
  if (rules) {
    config.content = { ...((config.content as Record<string, unknown>) ?? {}), rules_dir: "rules" };
  }
  if (agents) {
    config.content = {
      ...((config.content as Record<string, unknown>) ?? {}),
      agents_dir: "agents",
    };
  }
  if (targets) {
    config.targets = targets;
  }
  if (markerPrefix) {
    config.markers = { prefix: markerPrefix };
  }
  await fs.writeFile(path.join(dir, "agconf.yaml"), yamlStringify(config), "utf-8");
}

/**
 * Initialize a temp directory as a git repo so that resolveTargetDirectory()
 * (which calls getGitRoot()) works correctly.
 */
function initGitRepo(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "ignore" });
  execSync("git config user.email 'test@test.com'", { cwd: dir, stdio: "ignore" });
  execSync("git config user.name 'Test'", { cwd: dir, stdio: "ignore" });
}

/**
 * Run initCommand pointed at a local canonical repo.
 * Returns the exit code (0 = success, 1 = failure, null = no process.exit called).
 */
async function runInit(
  targetDir: string,
  canonicalDir: string,
  options: { targets?: string[] } = {},
): Promise<{ exitCode: number | null }> {
  const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as () => never);

  process.cwd = () => targetDir;

  let exitCode: number | null = null;
  try {
    await initCommand({
      local: canonicalDir,
      yes: true,
      target: options.targets,
    });
  } catch (e: unknown) {
    const match = (e as Error).message.match(/process\.exit\((\d+)\)/);
    exitCode = match ? Number(match[1]) : null;
  } finally {
    process.cwd = originalCwd;
    mockExit.mockRestore();
  }
  return { exitCode };
}

/**
 * Run syncCommand pointed at a local canonical repo.
 */
async function runSync(
  targetDir: string,
  canonicalDir: string,
  options: { targets?: string[] } = {},
): Promise<{ exitCode: number | null }> {
  const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as () => never);

  process.cwd = () => targetDir;

  let exitCode: number | null = null;
  try {
    await syncCommand({
      local: canonicalDir,
      yes: true,
      target: options.targets,
    });
  } catch (e: unknown) {
    const match = (e as Error).message.match(/process\.exit\((\d+)\)/);
    exitCode = match ? Number(match[1]) : null;
  } finally {
    process.cwd = originalCwd;
    mockExit.mockRestore();
  }
  return { exitCode };
}

/**
 * Run checkCommand in the given target directory.
 * Returns the exit code (null means clean exit / exit 0).
 */
async function runCheck(targetDir: string): Promise<{ exitCode: number | null }> {
  const mockExit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as () => never);

  process.cwd = () => targetDir;

  let exitCode: number | null = null;
  try {
    await checkCommand({});
  } catch (e: unknown) {
    const match = (e as Error).message.match(/process\.exit\((\d+)\)/);
    exitCode = match ? Number(match[1]) : null;
  } finally {
    process.cwd = originalCwd;
    mockExit.mockRestore();
  }
  return { exitCode };
}

// ─── Test suites ────────────────────────────────────────────────────────────

describe("e2e workflow: full sync + check lifecycle", () => {
  let targetDir: string;
  let canonicalDir: string;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    targetDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-e2e-target-"));
    canonicalDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-e2e-source-"));
    initGitRepo(targetDir);

    // Suppress console output from commands
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    consoleLogSpy.mockRestore();
    vi.restoreAllMocks();
    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.rm(canonicalDir, { recursive: true, force: true });
  });

  // ── Test 1: Full lifecycle with Claude target ──────────────────────────

  describe("Claude target: full lifecycle with all content types", () => {
    const SKILL_CONTENT = `---\nname: security-review\ndescription: Security review skill\n---\n\n# Security Review\n\nCheck for vulnerabilities.\n`;
    const RULE_CONTENT = `---\npaths:\n  - "src/api/**/*.ts"\n---\n\n# API Auth Rules\n\nAlways validate tokens.\n`;
    const AGENT_CONTENT = `---\nname: code-reviewer\ndescription: Reviews code quality\n---\n\n# Code Reviewer\n\nThis agent reviews code.\n`;

    it("should sync all content types and pass check", async () => {
      await setupCanonicalRepo(canonicalDir, {
        globalContent: "# Global Standards v1\n\nFirst version.",
        skills: { "security-review": SKILL_CONTENT },
        rules: { "api-auth.md": RULE_CONTENT },
        agents: { "code-reviewer.md": AGENT_CONTENT },
      });

      // Step 1: init to empty downstream
      const initResult = await runInit(targetDir, canonicalDir);
      expect(initResult.exitCode).toBeNull();

      // Verify all content was synced
      const agentsMd = await fs.readFile(path.join(targetDir, "AGENTS.md"), "utf-8");
      expect(agentsMd).toContain("# Global Standards v1");

      const skillExists = await fs
        .access(path.join(targetDir, ".claude", "skills", "security-review", "SKILL.md"))
        .then(() => true)
        .catch(() => false);
      expect(skillExists).toBe(true);

      const ruleExists = await fs
        .access(path.join(targetDir, ".claude", "rules", "api-auth.md"))
        .then(() => true)
        .catch(() => false);
      expect(ruleExists).toBe(true);

      const agentExists = await fs
        .access(path.join(targetDir, ".claude", "agents", "code-reviewer.md"))
        .then(() => true)
        .catch(() => false);
      expect(agentExists).toBe(true);

      const lockfileExists = await fs
        .access(path.join(targetDir, ".agconf", "lockfile.json"))
        .then(() => true)
        .catch(() => false);
      expect(lockfileExists).toBe(true);

      const claudeMd = await fs.readFile(path.join(targetDir, "CLAUDE.md"), "utf-8");
      expect(claudeMd).toContain("@AGENTS.md");

      // Step 2: check passes immediately after sync
      const checkResult1 = await runCheck(targetDir);
      expect(checkResult1.exitCode).toBeNull();
    });

    it("should pass check after re-sync with updated canonical content", async () => {
      await setupCanonicalRepo(canonicalDir, {
        globalContent: "# Global Standards v1\n\nFirst version.",
        skills: { "security-review": SKILL_CONTENT },
        rules: { "api-auth.md": RULE_CONTENT },
        agents: { "code-reviewer.md": AGENT_CONTENT },
      });

      // Initial init
      await runInit(targetDir, canonicalDir);

      // Update canonical content
      await fs.writeFile(
        path.join(canonicalDir, "instructions", "AGENTS.md"),
        "# Global Standards v2\n\nUpdated version.",
        "utf-8",
      );

      // Re-sync
      const syncResult = await runSync(targetDir, canonicalDir);
      expect(syncResult.exitCode).toBeNull();

      // Verify global block was updated
      const agentsMd = await fs.readFile(path.join(targetDir, "AGENTS.md"), "utf-8");
      expect(agentsMd).toContain("# Global Standards v2");
      expect(agentsMd).not.toContain("# Global Standards v1");

      // Check passes after re-sync
      const checkResult = await runCheck(targetDir);
      expect(checkResult.exitCode).toBeNull();
    });

    it("should detect tampered AGENTS.md global block", async () => {
      await setupCanonicalRepo(canonicalDir, {
        globalContent: "# Global Standards\n\nOriginal content.",
        skills: { "security-review": SKILL_CONTENT },
      });

      await runInit(targetDir, canonicalDir);

      // Tamper with global block
      const agentsMdPath = path.join(targetDir, "AGENTS.md");
      let agentsMd = await fs.readFile(agentsMdPath, "utf-8");
      agentsMd = agentsMd.replace("Original content.", "TAMPERED content.");
      await fs.writeFile(agentsMdPath, agentsMd, "utf-8");

      const checkResult = await runCheck(targetDir);
      expect(checkResult.exitCode).toBe(1);
    });

    it("should detect tampered skill file", async () => {
      await setupCanonicalRepo(canonicalDir, {
        skills: { "security-review": SKILL_CONTENT },
      });

      await runInit(targetDir, canonicalDir);

      // Tamper with skill file
      const skillPath = path.join(targetDir, ".claude", "skills", "security-review", "SKILL.md");
      let skill = await fs.readFile(skillPath, "utf-8");
      skill = skill.replace("Check for vulnerabilities.", "TAMPERED skill content.");
      await fs.writeFile(skillPath, skill, "utf-8");

      const checkResult = await runCheck(targetDir);
      expect(checkResult.exitCode).toBe(1);
    });

    // Regression for the bug where propose globbed only "*/SKILL.md" inside a
    // skill directory and silently dropped edits to sibling files.
    // SKILL.md now carries an aggregate assets_hash so `check` catches asset
    // tampering locally; `propose` clones canonical and byte-compares to
    // produce file-level diffs.
    it("check detects tampered non-SKILL.md files inside a managed skill", async () => {
      await setupCanonicalRepo(canonicalDir, {
        skills: { "python-logging": SKILL_CONTENT },
      });
      // Add a sibling asset file the helper doesn't write itself.
      const refsDir = path.join(canonicalDir, "skills", "python-logging", "references");
      await fs.mkdir(refsDir, { recursive: true });
      await fs.writeFile(path.join(refsDir, "template.py"), "print('original')", "utf-8");

      await runInit(targetDir, canonicalDir);

      // Sanity: sync recorded an assets_hash in SKILL.md frontmatter
      const skillMd = await fs.readFile(
        path.join(targetDir, ".claude", "skills", "python-logging", "SKILL.md"),
        "utf-8",
      );
      expect(skillMd).toMatch(/agconf_assets_hash:\s*"?sha256:[a-f0-9]{12}/);

      // Tamper with the synced reference file
      const downstreamPath = path.join(
        targetDir,
        ".claude",
        "skills",
        "python-logging",
        "references",
        "template.py",
      );
      await fs.writeFile(downstreamPath, "print('TAMPERED')", "utf-8");

      const checkResult = await runCheck(targetDir);
      expect(checkResult.exitCode).toBe(1);
    });

    it("propose still ships the actual tampered asset file (canonical diff)", async () => {
      await setupCanonicalRepo(canonicalDir, {
        skills: { "python-logging": SKILL_CONTENT },
      });
      const refsDir = path.join(canonicalDir, "skills", "python-logging", "references");
      await fs.mkdir(refsDir, { recursive: true });
      await fs.writeFile(path.join(refsDir, "template.py"), "print('original')", "utf-8");

      // detectProposedChanges clones canonical, which requires a real git repo.
      execSync("git init", { cwd: canonicalDir, stdio: "ignore" });
      execSync("git config user.email t@t.com", { cwd: canonicalDir, stdio: "ignore" });
      execSync("git config user.name Test", { cwd: canonicalDir, stdio: "ignore" });
      execSync("git add -A && git commit -m init", { cwd: canonicalDir, stdio: "ignore" });

      await runInit(targetDir, canonicalDir);

      const downstreamPath = path.join(
        targetDir,
        ".claude",
        "skills",
        "python-logging",
        "references",
        "template.py",
      );
      await fs.writeFile(downstreamPath, "print('TAMPERED')", "utf-8");

      const { detectProposedChanges } = await import("../../src/core/propose.js");
      const result = await detectProposedChanges({ cwd: targetDir });
      const paths = result.changes.map((c) => c.canonicalPath);
      expect(paths).toContain("skills/python-logging/references/template.py");
    });

    it("should detect tampered rule file", async () => {
      await setupCanonicalRepo(canonicalDir, {
        rules: { "api-auth.md": RULE_CONTENT },
      });

      await runInit(targetDir, canonicalDir);

      // Tamper with rule file
      const rulePath = path.join(targetDir, ".claude", "rules", "api-auth.md");
      let rule = await fs.readFile(rulePath, "utf-8");
      rule = rule.replace("Always validate tokens.", "TAMPERED rule content.");
      await fs.writeFile(rulePath, rule, "utf-8");

      const checkResult = await runCheck(targetDir);
      expect(checkResult.exitCode).toBe(1);
    });

    it("should detect tampered agent file", async () => {
      await setupCanonicalRepo(canonicalDir, {
        agents: { "code-reviewer.md": AGENT_CONTENT },
      });

      await runInit(targetDir, canonicalDir);

      // Tamper with agent file
      const agentPath = path.join(targetDir, ".claude", "agents", "code-reviewer.md");
      let agent = await fs.readFile(agentPath, "utf-8");
      agent = agent.replace("This agent reviews code.", "TAMPERED agent content.");
      await fs.writeFile(agentPath, agent, "utf-8");

      const checkResult = await runCheck(targetDir);
      expect(checkResult.exitCode).toBe(1);
    });
  });

  // ── Test 2: Codex target lifecycle ─────────────────────────────────────

  describe("Codex target: rules concatenated into AGENTS.md", () => {
    const RULE_A = `---\npaths:\n  - "src/**/*.ts"\n---\n\n# TypeScript Rules\n\nUse strict mode.\n`;
    const RULE_B = `# Logging Rules\n\nAlways use structured logging.\n`;

    it("should sync rules into AGENTS.md section and pass check", async () => {
      await setupCanonicalRepo(canonicalDir, {
        globalContent: "# Codex Standards\n\nGlobal rules for Codex.",
        skills: {},
        rules: { "typescript.md": RULE_A, "logging.md": RULE_B },
        targets: ["codex"],
      });

      // Init with codex target
      const initResult = await runInit(targetDir, canonicalDir, { targets: ["codex"] });
      expect(initResult.exitCode).toBeNull();

      // Verify rules section exists in AGENTS.md
      const agentsMd = await fs.readFile(path.join(targetDir, "AGENTS.md"), "utf-8");
      expect(agentsMd).toContain("agconf:rules:start");
      expect(agentsMd).toContain("agconf:rules:end");

      // Check passes
      const checkResult = await runCheck(targetDir);
      expect(checkResult.exitCode).toBeNull();
    });

    it("should detect tampered rules section in AGENTS.md", async () => {
      await setupCanonicalRepo(canonicalDir, {
        rules: { "typescript.md": RULE_A },
        targets: ["codex"],
      });

      await runInit(targetDir, canonicalDir, { targets: ["codex"] });

      // Tamper with rules section
      const agentsMdPath = path.join(targetDir, "AGENTS.md");
      let agentsMd = await fs.readFile(agentsMdPath, "utf-8");
      agentsMd = agentsMd.replace("Use strict mode.", "TAMPERED rules content.");
      await fs.writeFile(agentsMdPath, agentsMd, "utf-8");

      const checkResult = await runCheck(targetDir);
      expect(checkResult.exitCode).toBe(1);
    });
  });

  // ── Test 3: Repo-specific content preservation ─────────────────────────

  describe("repo-specific content preservation across syncs", () => {
    it("should preserve repo content when global block is updated", async () => {
      const markers = getMarkers();

      await setupCanonicalRepo(canonicalDir, {
        globalContent: "# Standards v1\n\nOriginal global.",
      });

      // Initial sync
      await runInit(targetDir, canonicalDir);

      // Add repo-specific content
      const agentsMdPath = path.join(targetDir, "AGENTS.md");
      let agentsMd = await fs.readFile(agentsMdPath, "utf-8");
      agentsMd = agentsMd.replace(
        `${markers.repoStart}\n<!-- Repository-specific instructions below -->`,
        `${markers.repoStart}\n<!-- Repository-specific instructions below -->\n\n# My Custom Repo Rules\n\nDo special things for this repo.`,
      );
      await fs.writeFile(agentsMdPath, agentsMd, "utf-8");

      // Update canonical global content
      await fs.writeFile(
        path.join(canonicalDir, "instructions", "AGENTS.md"),
        "# Standards v2\n\nUpdated global.",
        "utf-8",
      );

      // Re-sync
      const syncResult = await runSync(targetDir, canonicalDir);
      expect(syncResult.exitCode).toBeNull();

      // Verify: global block updated AND repo content preserved
      const updatedAgentsMd = await fs.readFile(agentsMdPath, "utf-8");
      expect(updatedAgentsMd).toContain("# Standards v2");
      expect(updatedAgentsMd).not.toContain("# Standards v1");
      expect(updatedAgentsMd).toContain("# My Custom Repo Rules");

      // Check passes — repo content is not managed, so it doesn't trigger failure
      const checkResult = await runCheck(targetDir);
      expect(checkResult.exitCode).toBeNull();
    });
  });

  // ── Test 4: Skill addition and removal ─────────────────────────────────

  describe("skill addition and removal across syncs", () => {
    it("should add new skills and remove orphaned ones", async () => {
      const SKILL_A = `---\nname: skill-a\ndescription: Skill A\n---\n\n# Skill A\n`;
      const SKILL_B = `---\nname: skill-b\ndescription: Skill B\n---\n\n# Skill B\n`;

      // Start with skill-a
      await setupCanonicalRepo(canonicalDir, {
        skills: { "skill-a": SKILL_A },
      });

      await runInit(targetDir, canonicalDir);

      // Verify skill-a exists
      const skillAPath = path.join(targetDir, ".claude", "skills", "skill-a", "SKILL.md");
      expect(
        await fs
          .access(skillAPath)
          .then(() => true)
          .catch(() => false),
      ).toBe(true);

      // Update canonical: remove skill-a, add skill-b
      await fs.rm(path.join(canonicalDir, "skills", "skill-a"), { recursive: true });
      await fs.mkdir(path.join(canonicalDir, "skills", "skill-b"), { recursive: true });
      await fs.writeFile(
        path.join(canonicalDir, "skills", "skill-b", "SKILL.md"),
        SKILL_B,
        "utf-8",
      );

      // Re-sync (--yes auto-confirms orphan deletion)
      const syncResult = await runSync(targetDir, canonicalDir);
      expect(syncResult.exitCode).toBeNull();

      // Verify skill-b exists
      const skillBPath = path.join(targetDir, ".claude", "skills", "skill-b", "SKILL.md");
      expect(
        await fs
          .access(skillBPath)
          .then(() => true)
          .catch(() => false),
      ).toBe(true);

      // Verify skill-a was removed (orphan cleanup)
      expect(
        await fs
          .access(skillAPath)
          .then(() => true)
          .catch(() => false),
      ).toBe(false);

      // Check passes after the swap
      const checkResult = await runCheck(targetDir);
      expect(checkResult.exitCode).toBeNull();
    });
  });
});
