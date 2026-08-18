import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The command layer is driven non-interactively here, so every prompt is
// stubbed. `isCancel` is the switch the cancellation tests flip.
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    step: vi.fn(),
  },
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() })),
  text: vi.fn(async () => "A title"),
  multiselect: vi.fn(async () => [0]),
  confirm: vi.fn(),
  select: vi.fn(),
  isCancel: vi.fn(() => false),
}));

import * as prompts from "@clack/prompts";
import { proposeCommand } from "../../src/commands/propose.js";
import { addManagedMetadata } from "../../src/core/managed-content.js";
import * as proposeCore from "../../src/core/propose.js";
import { applyProposedChanges, type ProposeResult } from "../../src/core/propose.js";

/**
 * `agconf propose` clones canonical into TMPDIR. Exactly one outcome is allowed
 * to leave that clone behind — the one where the user is handed manual commands
 * that run inside it. Every other path must remove it, or a few months of
 * proposing fills the developer's temp dir with hundreds of full repo clones.
 *
 * Each test gets its own TMPDIR so the assertions are exact (rather than
 * before/after counts that other test files could race), and so the suite
 * itself stops seeding `agconf-propose-*` dirs on the machine running it.
 */
describe("propose canonical clone lifetime", () => {
  const SKILL_BODY = `---
name: my-skill
description: A managed skill.
---

# My Skill

ORIGINAL body.
`;

  let fixtureRoot: string;
  let cloneRoot: string;
  let downstreamDir: string;
  let canonicalDir: string;
  let originalTmpdir: string | undefined;
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // Created before TMPDIR is redirected, so fixtures never land in the dir
    // whose contents the assertions count.
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-clonelife-"));
    downstreamDir = path.join(fixtureRoot, "down");
    canonicalDir = path.join(fixtureRoot, "canon");
    cloneRoot = path.join(fixtureRoot, "tmp");
    await fs.mkdir(downstreamDir, { recursive: true });
    await fs.mkdir(canonicalDir, { recursive: true });
    await fs.mkdir(cloneRoot, { recursive: true });

    originalTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = cloneRoot;

    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.mocked(prompts.isCancel).mockReturnValue(false);
    if (originalTmpdir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTmpdir;
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  });

  /** Clones left behind in this test's private TMPDIR. */
  async function leftoverClones(): Promise<string[]> {
    const entries = await fs.readdir(cloneRoot);
    return entries.filter((d) => d.startsWith("agconf-propose-")).sort();
  }

  function initCanonicalGitRepo(): void {
    execSync("git init", { cwd: canonicalDir, stdio: "ignore" });
    execSync("git config user.email t@t.com", { cwd: canonicalDir, stdio: "ignore" });
    execSync("git config user.name Test", { cwd: canonicalDir, stdio: "ignore" });
    execSync("git add -A && git commit -m init --allow-empty", {
      cwd: canonicalDir,
      stdio: "ignore",
    });
  }

  async function writeLockfile(): Promise<void> {
    const lockfile = {
      version: "1.0.0",
      synced_at: new Date().toISOString(),
      source: { type: "local" as const, path: canonicalDir },
      content: {
        agents_md: { global_block_hash: "sha256:abc", merged: true },
        skills: ["my-skill"],
        targets: ["claude"],
      },
    };
    await fs.mkdir(path.join(downstreamDir, ".agconf"), { recursive: true });
    await fs.writeFile(
      path.join(downstreamDir, ".agconf", "lockfile.json"),
      JSON.stringify(lockfile, null, 2),
      "utf-8",
    );
  }

  /**
   * Canonical holds the skill; downstream holds a managed copy. `edited: true`
   * tampers with the body so it is detected as a modified managed file — the
   * case that produces something to propose.
   */
  async function setupManagedSkill(edited: boolean): Promise<void> {
    await fs.mkdir(path.join(canonicalDir, "skills", "my-skill"), { recursive: true });
    await fs.writeFile(
      path.join(canonicalDir, "skills", "my-skill", "SKILL.md"),
      SKILL_BODY,
      "utf-8",
    );
    initCanonicalGitRepo();

    const downstreamSkillDir = path.join(downstreamDir, ".claude", "skills", "my-skill");
    await fs.mkdir(downstreamSkillDir, { recursive: true });
    const managed = addManagedMetadata(SKILL_BODY);
    await fs.writeFile(
      path.join(downstreamSkillDir, "SKILL.md"),
      edited ? managed.replace("ORIGINAL body.", "TAMPERED body.") : managed,
      "utf-8",
    );

    await writeLockfile();
  }

  async function writeNewSkill(name: string): Promise<void> {
    const dir = path.join(downstreamDir, ".claude", "skills", name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: A new local skill.\n---\n\n# ${name}\n`,
      "utf-8",
    );
  }

  describe("paths with nothing to retry", () => {
    it("removes the clone after a dry run", async () => {
      await setupManagedSkill(true);

      await proposeCommand({ cwd: downstreamDir, dryRun: true });

      expect(mockExit).not.toHaveBeenCalled();
      expect(await leftoverClones()).toEqual([]);
    });

    it("removes the clone when there is nothing to propose", async () => {
      // Unmodified managed skill: detection still clones (to diff the skill's
      // assets against canonical) but ends with zero changes.
      await setupManagedSkill(false);

      await proposeCommand({ cwd: downstreamDir, dryRun: true });

      expect(mockExit).not.toHaveBeenCalled();
      expect(await leftoverClones()).toEqual([]);
    });

    it("removes the clone when the --new selection is cancelled", async () => {
      await writeNewSkill("fresh");
      await writeLockfile();
      initCanonicalGitRepo();
      vi.mocked(prompts.isCancel).mockReturnValue(true);

      await proposeCommand({ cwd: downstreamDir, new: true });

      expect(mockExit).not.toHaveBeenCalled();
      expect(await leftoverClones()).toEqual([]);
    });

    it("removes the clone when the title prompt is cancelled", async () => {
      await setupManagedSkill(true);
      vi.mocked(prompts.isCancel).mockReturnValue(true);

      await proposeCommand({ cwd: downstreamDir });

      expect(mockExit).not.toHaveBeenCalled();
      expect(await leftoverClones()).toEqual([]);
    });

    it("removes the clone when applying without a title exits", async () => {
      await setupManagedSkill(true);

      // --yes suppresses the title prompt, leaving it unset — a hard error.
      // process.exit skips `finally`, so this path cleans up explicitly.
      await expect(proposeCommand({ cwd: downstreamDir, yes: true })).rejects.toThrow(
        "process.exit called",
      );

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(await leftoverClones()).toEqual([]);
    });

    it("removes the clone once the PR has been created", async () => {
      await setupManagedSkill(true);
      vi.spyOn(proposeCore, "applyProposedChanges").mockImplementation(async (result) => ({
        cloneDir: result.canonicalCloneDir as string,
        branch: "propose/my-change",
        pushed: true,
        prUrl: "https://github.com/acme/canon/pull/7",
      }));

      await proposeCommand({ cwd: downstreamDir, yes: true, title: "My change" });

      expect(mockExit).not.toHaveBeenCalled();
      expect(await leftoverClones()).toEqual([]);
    });

    it("removes the clone when detection aborts on a conflict", async () => {
      await setupManagedSkill(true);
      const sha = execSync("git rev-parse HEAD", { cwd: canonicalDir }).toString().trim();

      // Pin the lockfile to the current commit, then move canonical over the
      // same lines the local copy touched, so reconciliation cannot merge.
      const lockfilePath = path.join(downstreamDir, ".agconf", "lockfile.json");
      const lockfile = JSON.parse(await fs.readFile(lockfilePath, "utf-8"));
      lockfile.source.commit_sha = sha;
      await fs.writeFile(lockfilePath, JSON.stringify(lockfile, null, 2), "utf-8");
      await fs.writeFile(
        path.join(canonicalDir, "skills", "my-skill", "SKILL.md"),
        SKILL_BODY.replace("ORIGINAL body.", "UPSTREAM body."),
        "utf-8",
      );
      execSync("git add -A && git commit -m upstream", { cwd: canonicalDir, stdio: "ignore" });

      await expect(proposeCommand({ cwd: downstreamDir, yes: true, title: "x" })).rejects.toThrow(
        "process.exit called",
      );

      expect(mockExit).toHaveBeenCalledWith(1);
      expect(await leftoverClones()).toEqual([]);
    });
  });

  /**
   * The one case where the clone is deliberate. `manualCommands` starts with
   * `cd <cloneDir>` and the commit exists nowhere else, so removing it would
   * point the user's only route to recovery at a directory that is gone.
   */
  describe("the retained clone", () => {
    /** A real clone of canonical, laid out exactly as propose lays one out. */
    async function prepareClone(breakOrigin: boolean): Promise<string> {
      const tmpBase = await fs.mkdtemp(path.join(cloneRoot, "agconf-propose-"));
      const cloneDir = path.join(tmpBase, "canonical");
      execSync(`git clone ${canonicalDir} ${cloneDir}`, { stdio: "ignore" });
      execSync("git config user.email t@t.com", { cwd: cloneDir, stdio: "ignore" });
      execSync("git config user.name Test", { cwd: cloneDir, stdio: "ignore" });
      if (breakOrigin) {
        execSync(`git remote set-url origin ${path.join(fixtureRoot, "gone")}`, {
          cwd: cloneDir,
          stdio: "ignore",
        });
      }
      return cloneDir;
    }

    function proposeResult(cloneDir: string): ProposeResult {
      return {
        changes: [
          {
            downstreamPath: ".claude/skills/my-skill/SKILL.md",
            canonicalPath: "skills/my-skill/SKILL.md",
            content: SKILL_BODY.replace("ORIGINAL body.", "PROPOSED body."),
            type: "skill",
          },
        ],
        source: { type: "local", path: canonicalDir },
        downstream: {},
        canonicalCloneDir: cloneDir,
      };
    }

    it("survives applyProposedChanges when the push fails", async () => {
      await setupManagedSkill(true);
      const cloneDir = await prepareClone(true);

      const result = await applyProposedChanges(proposeResult(cloneDir), { title: "My change" });

      expect(result.pushed).toBe(false);
      expect(result.manualCommands).toContain(`cd ${cloneDir}`);
      // The whole point: the recovery instructions have to still be valid.
      await expect(fs.access(cloneDir)).resolves.toBeUndefined();
      // And the commit they tell the user to push is really in there.
      const log = execSync("git log -1 --pretty=%s", { cwd: cloneDir }).toString().trim();
      expect(log).toBe("My change");
      expect(await leftoverClones()).toHaveLength(1);
    });

    it("survives the command layer when apply hands back manual commands", async () => {
      await setupManagedSkill(true);
      vi.spyOn(proposeCore, "applyProposedChanges").mockImplementation(async (result) => ({
        cloneDir: result.canonicalCloneDir as string,
        branch: "propose/my-change",
        pushed: false,
        manualCommands: `cd ${result.canonicalCloneDir}\ngit push -u origin propose/my-change`,
      }));

      await proposeCommand({ cwd: downstreamDir, yes: true, title: "My change" });

      expect(mockExit).not.toHaveBeenCalled();
      expect(await leftoverClones()).toHaveLength(1);
    });

    it("survives the command layer when only the PR step failed", async () => {
      await setupManagedSkill(true);
      vi.spyOn(proposeCore, "applyProposedChanges").mockImplementation(async (result) => ({
        cloneDir: result.canonicalCloneDir as string,
        branch: "propose/my-change",
        pushed: true,
        // `gh pr create` still has to run inside the clone.
        manualCommands: "gh pr create --head propose/my-change",
      }));

      await proposeCommand({ cwd: downstreamDir, yes: true, title: "My change" });

      expect(mockExit).not.toHaveBeenCalled();
      expect(await leftoverClones()).toHaveLength(1);
    });

    it("removes the clone when apply throws instead of returning commands", async () => {
      await setupManagedSkill(true);
      // Not a git repo, so the first git call inside apply fails. Nothing was
      // handed back, so there is nothing to retry.
      const tmpBase = await fs.mkdtemp(path.join(cloneRoot, "agconf-propose-"));
      const cloneDir = path.join(tmpBase, "canonical");
      await fs.mkdir(cloneDir, { recursive: true });

      await expect(
        applyProposedChanges(proposeResult(cloneDir), { title: "My change" }),
      ).rejects.toThrow();

      expect(await leftoverClones()).toEqual([]);
    });
  });

  describe("discardCanonicalClone", () => {
    // It deletes the clone's *parent*, so a path of the wrong shape would take
    // an unrelated directory with it.
    it("ignores a path that is not a propose clone", async () => {
      const decoy = path.join(fixtureRoot, "precious");
      await fs.mkdir(path.join(decoy, "canon"), { recursive: true });

      // Wrong leaf name, and a leaf whose parent is not a propose temp dir.
      await proposeCore.discardCanonicalClone(path.join(decoy, "canon"));
      await proposeCore.discardCanonicalClone(path.join(decoy, "canonical"));
      await proposeCore.discardCanonicalClone("");
      await proposeCore.discardCanonicalClone(undefined);

      await expect(fs.access(path.join(decoy, "canon"))).resolves.toBeUndefined();
    });

    it("removes the temp dir the clone lives in", async () => {
      const tmpBase = await fs.mkdtemp(path.join(cloneRoot, "agconf-propose-"));
      await fs.mkdir(path.join(tmpBase, "canonical"), { recursive: true });

      await proposeCore.discardCanonicalClone(path.join(tmpBase, "canonical"));

      expect(await leftoverClones()).toEqual([]);
    });
  });
});
