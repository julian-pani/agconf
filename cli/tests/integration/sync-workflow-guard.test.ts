/**
 * The sync workflow's path guard is shipped as shell inside `sync-reusable.yml`
 * rather than as a call into the agconf CLI, so that a reader can audit what a
 * sync may write without trusting (or knowing) agconf. That puts the enforcing
 * code outside TypeScript, where nothing else in this suite would cover it.
 *
 * These tests close that gap: they generate the real workflow, pull the guard's
 * script straight out of the YAML, and run it against a git repo in each state
 * it is meant to catch. They also pin its allowlist to `BASE_ALLOWED_PATHS`, so
 * the shell copy and the `agconf verify-paths` copy cannot drift apart.
 *
 * Assertions read `stdout` alone, never `stdout + stderr`. The guard writes its
 * whole report to stdout, so a combined assertion passes when the script is
 * broken badly enough to make *bash* mention the path in an error — which is
 * exactly how a live command-substitution bug once survived nine of them.
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { simpleGit } from "simple-git";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { canonicalInitCommand } from "../../src/commands/canonical.js";
import { BASE_ALLOWED_PATHS, matchesAllowedPath } from "../../src/core/verify-paths.js";
import { getManagedWorkflowFilenames } from "../../src/core/workflows.js";

const execFileAsync = promisify(execFile);

const GUARD_STEP_NAME = "Verify sync only changed allowed paths";

interface WorkflowStep {
  name: string;
  run?: string;
  shell?: string;
  env?: Record<string, string>;
  if?: string;
}

/** Scaffold a canonical repo and return its parsed sync-reusable.yml steps. */
async function generateSyncWorkflowSteps(markerPrefix: string): Promise<WorkflowStep[]> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-guard-canonical-"));
  await canonicalInitCommand({
    name: "my-standards",
    org: "acme",
    dir,
    markerPrefix,
    includeExamples: false,
    yes: true,
  });
  const content = await fs.readFile(
    path.join(dir, ".github", "workflows", "sync-reusable.yml"),
    "utf-8",
  );
  await fs.rm(dir, { recursive: true, force: true });
  return parseYaml(content).jobs.sync.steps;
}

function findGuardStep(steps: WorkflowStep[]): WorkflowStep {
  const step = steps.find((s) => s.name === GUARD_STEP_NAME);
  if (!step) throw new Error(`No "${GUARD_STEP_NAME}" step in the generated workflow`);
  return step;
}

/** The `ALLOWED_PATHS=( ... )` literal, as the shell would see it. */
function parseAllowedPathsLiteral(script: string): string[] {
  const match = script.match(/ALLOWED_PATHS=\(\n([\s\S]*?)\n\s*\)/);
  if (!match?.[1]) throw new Error("No ALLOWED_PATHS array literal in the guard script");
  return match[1]
    .split("\n")
    .map((line) => line.trim().replace(/^"|"$/g, ""))
    .filter((line) => line.length > 0);
}

describe("sync workflow path guard", () => {
  let guardScript: string;
  let steps: WorkflowStep[];

  beforeAll(async () => {
    steps = await generateSyncWorkflowSteps("agconf");
    const step = findGuardStep(steps);
    if (!step.run) throw new Error("Guard step has no run script");
    guardScript = step.run;
  });

  describe("workflow wiring", () => {
    it("runs unconditionally, before either commit strategy", () => {
      const guardIndex = steps.findIndex((s) => s.name === GUARD_STEP_NAME);
      // A conditional guard would skip exactly when a strategy input is unset,
      // and a guard after the commit would be no guard at all.
      expect(steps[guardIndex]?.if).toBeUndefined();
      expect(steps.findIndex((s) => s.name === "Create or update PR branch")).toBeGreaterThan(
        guardIndex,
      );
      expect(steps.findIndex((s) => s.name === "Commit directly to branch")).toBeGreaterThan(
        guardIndex,
      );
    });

    it("declares bash, which the script's arrays and NUL-delimited reads need", () => {
      expect(findGuardStep(steps).shell).toBe("bash");
    });

    it("takes no workflow inputs, so nothing outside the repo can widen it", () => {
      const step = findGuardStep(steps);
      // An `inputs.` expression inside `run:` would be a shell-injection vector,
      // and an input at all would be a contract the caller workflow must match.
      expect(step.run).not.toContain("${{");
      expect(step.env).toBeUndefined();
    });

    it("emits no backticks, which inside a double-quoted shell string execute", () => {
      // Markdown decoration in an `echo "..."` is command substitution: this
      // once ran the violating path, and `agconf sync`, from the failure handler.
      expect(guardScript).not.toContain("`");
    });
  });

  describe("allowlist", () => {
    it("matches the list agconf verify-paths enforces locally", () => {
      const expected = [
        ...BASE_ALLOWED_PATHS,
        ...getManagedWorkflowFilenames("agconf").map((f) => `.github/workflows/${f}`),
      ];
      expect(parseAllowedPathsLiteral(guardScript)).toEqual(expected);
    });

    it("names the workflow files after the canonical repo's marker prefix", async () => {
      const customSteps = await generateSyncWorkflowSteps("acme");
      const allowed = parseAllowedPathsLiteral(findGuardStep(customSteps).run ?? "");

      expect(allowed).toContain(".github/workflows/acme-sync.yml");
      expect(allowed).not.toContain(".github/workflows/agconf-sync.yml");
    });
  });

  describe("enforcement", () => {
    let repoDir: string;
    let scriptPath: string;

    /** Run the guard exactly as GitHub would: `bash -eo pipefail <script>`. */
    async function runGuard(
      extraEnv: Record<string, string> = {},
    ): Promise<{ code: number; stdout: string; stderr: string }> {
      try {
        const { stdout, stderr } = await execFileAsync("bash", ["-eo", "pipefail", scriptPath], {
          cwd: repoDir,
          env: { ...process.env, ...extraEnv },
        });
        return { code: 0, stdout, stderr };
      } catch (error) {
        const e = error as { code?: number; stdout?: string; stderr?: string };
        return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
      }
    }

    async function write(relPath: string, content = "x"): Promise<void> {
      const full = path.join(repoDir, relPath);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, "utf-8");
    }

    beforeEach(async () => {
      repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-guard-repo-"));
      scriptPath = path.join(repoDir, "..", `guard-${path.basename(repoDir)}.sh`);
      await fs.writeFile(scriptPath, guardScript, "utf-8");

      const git = simpleGit(repoDir);
      await git.init();
      await git.addConfig("user.email", "test@example.com");
      await git.addConfig("user.name", "Test");

      // A baseline commit, so later edits and deletions register as changes.
      await write("src/index.ts", "original");
      await write("AGENTS.md", "original");
      await write(".github/workflows/ci.yml", "original");
      await git.add("-A");
      await git.commit("baseline");
    });

    afterEach(async () => {
      await fs.rm(repoDir, { recursive: true, force: true });
      await fs.rm(scriptPath, { force: true });
    });

    it("passes on a clean worktree", async () => {
      const result = await runGuard();
      expect(result.code).toBe(0);
    });

    it("passes when a sync only touches agconf-owned paths", async () => {
      await write("AGENTS.md", "synced");
      await write(".claude/skills/foo/SKILL.md");
      await write(".codex/agents/foo.toml");
      await write(".agconf/lockfile.json", "{}");
      await write(".pre-commit-config.yaml", "repos: []");

      const result = await runGuard();
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Verified");
    });

    it("passes a path containing a space, which porcelain would otherwise quote", async () => {
      // Without NUL-delimited reads this arrives as '".claude/skills/my skill/..."',
      // matches nothing, and permanently breaks the sync of any repo whose
      // canonical content has a space in a skill or rule name.
      await write(".claude/skills/my skill/SKILL.md");
      await write(".claude/rules/café.md");

      const result = await runGuard();
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Verified");
    });

    it("refuses to pass when git status cannot be read", async () => {
      // The guard's one guarantee is failing closed. Read through a pipeline or
      // a process substitution, a git failure yields an empty loop and a green
      // step — a silent no-op exactly when something is already wrong.
      const binDir = path.join(repoDir, "..", `stub-${path.basename(repoDir)}`);
      await fs.mkdir(binDir, { recursive: true });
      await fs.writeFile(path.join(binDir, "git"), "#!/bin/sh\nexit 128\n", "utf-8");
      await fs.chmod(path.join(binDir, "git"), 0o755);

      try {
        const result = await runGuard({ PATH: `${binDir}:${process.env.PATH}` });
        expect(result.code).toBe(1);
        expect(result.stdout).toContain("Could not read git status");
      } finally {
        await fs.rm(binDir, { recursive: true, force: true });
      }
    });

    it("fails when a tracked file outside the allowlist is modified", async () => {
      await write("src/index.ts", "rewritten");

      const result = await runGuard();
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("src/index.ts");
      expect(result.stderr).toBe("");
    });

    it("reports the change kind, so an edit is distinguishable from a deletion", async () => {
      await fs.rm(path.join(repoDir, "src/index.ts"));

      const result = await runGuard();
      expect(result.code).toBe(1);
      // Porcelain's status characters, carried through to the report.
      expect(result.stdout).toMatch(/ D src\/index\.ts/);
      expect(result.stderr).toBe("");
    });

    it("fails on an untracked file outside the allowlist", async () => {
      await write("src/sneaky.ts");

      const result = await runGuard();
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("src/sneaky.ts");
      expect(result.stderr).toBe("");
    });

    it("allows agconf's own workflow files but not the repo's other CI", async () => {
      await write(".github/workflows/agconf-sync.yml", "synced");
      expect((await runGuard()).code).toBe(0);

      await write(".github/workflows/ci.yml", "rewritten");
      const denied = await runGuard();
      expect(denied.code).toBe(1);
      expect(denied.stdout).toContain(".github/workflows/ci.yml");
    });

    it("catches a file moved out of an allowed directory", async () => {
      const git = simpleGit(repoDir);
      await write(".claude/skills/foo/SKILL.md");
      await git.add("-A");
      await git.commit("add skill");

      await git.mv(".claude/skills/foo/SKILL.md", "src/SKILL.md");

      const result = await runGuard();
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("src/SKILL.md");
    });

    it("does not treat a name that merely starts with an allowed one as inside it", async () => {
      await write(".claudex/evil.md");

      const result = await runGuard();
      expect(result.code).toBe(1);
      expect(result.stdout).toContain(".claudex/evil.md");
    });

    it("lists the allowed paths and says what a violation means", async () => {
      await write("src/index.ts", "rewritten");

      const result = await runGuard();
      expect(result.stdout).toContain(".claude/**");
      // Phrasing is free to change; the reassurance that the repo is untouched
      // is the part a reader needs.
      expect(result.stdout).toMatch(/nothing was committed/i);
    });

    it("writes the failure to the job summary, not only the step log", async () => {
      await write("src/index.ts", "rewritten");
      const summaryPath = path.join(repoDir, "..", `summary-${path.basename(repoDir)}.md`);

      try {
        const result = await runGuard({ GITHUB_STEP_SUMMARY: summaryPath });
        expect(result.code).toBe(1);

        const summary = await fs.readFile(summaryPath, "utf-8");
        expect(summary).toContain("src/index.ts");
        expect(summary).toContain(".claude/**");
      } finally {
        await fs.rm(summaryPath, { force: true });
      }
    });

    describe("matcher parity with agconf verify-paths", () => {
      // The allowlist test pins the two copies' data. This pins their behavior,
      // which is where every divergence found so far actually lived.
      const CASES: Array<[file: string, allowed: boolean]> = [
        [".claude/skills/foo/SKILL.md", true],
        [".claude/settings.json", true],
        ["AGENTS.md", true],
        [".claudex/evil.md", false],
        ["AGENTS.md.bak", false],
        ["claude/foo.md", false],
        ["src/index.ts", false],
        [".github/workflows/agconf-sync.yml", true],
        [".github/workflows/ci.yml", false],
      ];

      it.each(CASES)("shell and TypeScript agree on %s", async (file, allowed) => {
        await write(file);
        const shellAllowed = (await runGuard()).code === 0;

        const patterns = [
          ...BASE_ALLOWED_PATHS,
          ...getManagedWorkflowFilenames("agconf").map((f) => `.github/workflows/${f}`),
        ];
        const tsAllowed = patterns.some((pattern) => matchesAllowedPath(file, pattern));

        expect(shellAllowed).toBe(allowed);
        expect(tsAllowed).toBe(allowed);
      });
    });
  });
});
