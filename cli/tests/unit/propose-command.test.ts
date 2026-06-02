import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proposeCommand } from "../../src/commands/propose.js";
import { addManagedMetadata } from "../../src/core/managed-content.js";
import * as proposeCore from "../../src/core/propose.js";

/**
 * Command-level orchestration tests for `propose --new`. Covers the non-apply
 * paths (dry-run auto-select, nothing-to-propose) without driving interactive
 * prompts or pushing to a remote.
 */
describe("proposeCommand --new", () => {
  let tempDir: string;
  let downstreamDir: string;
  let canonicalDir: string;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-propose-cmd-"));
    downstreamDir = path.join(tempDir, "down");
    canonicalDir = path.join(tempDir, "canon");
    await fs.mkdir(downstreamDir, { recursive: true });
    await fs.mkdir(canonicalDir, { recursive: true });
    execSync("git init", { cwd: canonicalDir, stdio: "ignore" });
    execSync("git config user.email t@t.com", { cwd: canonicalDir, stdio: "ignore" });
    execSync("git config user.name T", { cwd: canonicalDir, stdio: "ignore" });
    execSync("git commit -m init --allow-empty", { cwd: canonicalDir, stdio: "ignore" });

    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    mockExit.mockRestore();
    logSpy.mockRestore();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function writeLockfile(skills: string[] = []): Promise<void> {
    const lockfile = {
      version: "1.0.0",
      synced_at: new Date().toISOString(),
      source: { type: "local" as const, path: canonicalDir },
      content: {
        agents_md: { global_block_hash: "sha256:abc", merged: true },
        skills,
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

  async function writeNewSkill(name: string): Promise<void> {
    const dir = path.join(downstreamDir, ".claude", "skills", name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "SKILL.md"),
      `---\nname: ${name}\ndescription: A new local skill.\n---\n\n# ${name}\n`,
      "utf-8",
    );
  }

  const output = () => logSpy.mock.calls.map((c) => c.join(" ")).join("\n");

  it("auto-selects a path-filtered new skill and reports it in dry-run (no apply, no exit)", async () => {
    await writeNewSkill("fresh");
    await writeLockfile();

    await expect(
      proposeCommand({ cwd: downstreamDir, new: ".claude/skills/fresh", dryRun: true }),
    ).resolves.toBeUndefined();

    expect(mockExit).not.toHaveBeenCalled();
    expect(output()).toContain("skills/fresh/SKILL.md");
  });

  it("reports nothing to propose when there is no new content", async () => {
    await writeLockfile();

    await expect(
      proposeCommand({ cwd: downstreamDir, new: true, dryRun: true }),
    ).resolves.toBeUndefined();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("selects all candidates in --yes mode and applies them", async () => {
    await writeNewSkill("one");
    await writeNewSkill("two");
    await writeLockfile();

    const applySpy = vi
      .spyOn(proposeCore, "applyProposedChanges")
      .mockResolvedValue({ cloneDir: canonicalDir, branch: "propose/x", pushed: true });

    await expect(
      proposeCommand({ cwd: downstreamDir, new: true, yes: true, title: "Add skills" }),
    ).resolves.toBeUndefined();

    expect(mockExit).not.toHaveBeenCalled();
    // --yes select-all: both skills' changes are forwarded to apply.
    const result = applySpy.mock.calls[0]?.[0];
    const canonicalPaths = result?.changes.map((c) => c.canonicalPath).sort();
    expect(canonicalPaths).toEqual(["skills/one/SKILL.md", "skills/two/SKILL.md"]);

    applySpy.mockRestore();
  });
});

/**
 * Command-level tests for the *managed* propose path and the shared `runApply`
 * flow. `applyProposedChanges` is mocked so no real git push / `gh` runs.
 */
describe("proposeCommand (managed changes + apply flow)", () => {
  let tempDir: string;
  let downstreamDir: string;
  let canonicalDir: string;
  let mockExit: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  const SKILL_BODY = `---
name: my-skill
description: A managed skill.
---

# My Skill

ORIGINAL body.
`;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-propose-managed-"));
    downstreamDir = path.join(tempDir, "down");
    canonicalDir = path.join(tempDir, "canon");
    await fs.mkdir(downstreamDir, { recursive: true });
    await fs.mkdir(canonicalDir, { recursive: true });

    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    // @clack/prompts (intro/outro/log.*) writes to process.stdout, not
    // console.log, so capture both streams to assert on the apply outcomes.
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const output = () =>
    [
      ...logSpy.mock.calls.map((c) => c.join(" ")),
      ...stdoutSpy.mock.calls.map((c) => String(c[0])),
    ].join("\n");

  function initCanonicalGitRepo(): void {
    execSync("git init", { cwd: canonicalDir, stdio: "ignore" });
    execSync("git config user.email t@t.com", { cwd: canonicalDir, stdio: "ignore" });
    execSync("git config user.name Test", { cwd: canonicalDir, stdio: "ignore" });
    execSync("git add -A && git commit -m init", { cwd: canonicalDir, stdio: "ignore" });
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
   * Canonical holds the original skill; downstream holds the same skill with
   * managed metadata baked in but the body locally edited, so its stored hash
   * no longer matches and it is detected as a modified managed file.
   */
  async function setupModifiedManagedSkill(): Promise<void> {
    await fs.mkdir(path.join(canonicalDir, "skills", "my-skill"), { recursive: true });
    await fs.writeFile(
      path.join(canonicalDir, "skills", "my-skill", "SKILL.md"),
      SKILL_BODY,
      "utf-8",
    );
    initCanonicalGitRepo();

    const downstreamSkillDir = path.join(downstreamDir, ".claude", "skills", "my-skill");
    await fs.mkdir(downstreamSkillDir, { recursive: true });
    const tampered = addManagedMetadata(SKILL_BODY).replace("ORIGINAL body.", "TAMPERED body.");
    await fs.writeFile(path.join(downstreamSkillDir, "SKILL.md"), tampered, "utf-8");

    await writeLockfile();
  }

  it("reports a modified managed file in dry-run without applying or exiting", async () => {
    await setupModifiedManagedSkill();
    const applySpy = vi.spyOn(proposeCore, "applyProposedChanges");

    await expect(proposeCommand({ cwd: downstreamDir, dryRun: true })).resolves.toBeUndefined();

    expect(mockExit).not.toHaveBeenCalled();
    expect(applySpy).not.toHaveBeenCalled();
    expect(output()).toContain("skills/my-skill/SKILL.md");
  });

  it("exits when applying without a title (--yes, no title provided)", async () => {
    await setupModifiedManagedSkill();
    const applySpy = vi.spyOn(proposeCore, "applyProposedChanges");

    // --yes suppresses the interactive title prompt, leaving the title unset,
    // which is a hard error in runApply.
    await expect(proposeCommand({ cwd: downstreamDir, yes: true })).rejects.toThrow(
      "process.exit called",
    );

    expect(mockExit).toHaveBeenCalledWith(1);
    expect(applySpy).not.toHaveBeenCalled();
    expect(output()).toContain("Title is required");
  });

  it("exits when applyProposedChanges throws", async () => {
    await setupModifiedManagedSkill();
    const applySpy = vi
      .spyOn(proposeCore, "applyProposedChanges")
      .mockRejectedValue(new Error("git push exploded"));

    await expect(
      proposeCommand({ cwd: downstreamDir, yes: true, title: "My change" }),
    ).rejects.toThrow("process.exit called");

    expect(applySpy).toHaveBeenCalledOnce();
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(output()).toContain("Failed to apply changes");
  });

  it("reports a created PR on a successful apply (no exit)", async () => {
    await setupModifiedManagedSkill();
    const applySpy = vi.spyOn(proposeCore, "applyProposedChanges").mockResolvedValue({
      cloneDir: canonicalDir,
      branch: "propose/my-change",
      pushed: true,
      prUrl: "https://github.com/acme/canon/pull/7",
    });

    await expect(
      proposeCommand({ cwd: downstreamDir, yes: true, title: "My change", message: "why" }),
    ).resolves.toBeUndefined();

    expect(mockExit).not.toHaveBeenCalled();
    expect(applySpy).toHaveBeenCalledOnce();
    // Title/message are forwarded to apply.
    expect(applySpy.mock.calls[0]?.[1]).toEqual({ title: "My change", message: "why" });
    expect(output()).toContain("https://github.com/acme/canon/pull/7");
  });

  it("reports manual push commands when push fails (pushed=false)", async () => {
    await setupModifiedManagedSkill();
    vi.spyOn(proposeCore, "applyProposedChanges").mockResolvedValue({
      cloneDir: canonicalDir,
      branch: "propose/my-change",
      pushed: false,
      manualCommands: "git push -u origin propose/my-change",
    });

    await expect(
      proposeCommand({ cwd: downstreamDir, yes: true, title: "My change" }),
    ).resolves.toBeUndefined();

    expect(mockExit).not.toHaveBeenCalled();
    expect(output()).toContain("git push -u origin propose/my-change");
  });

  it("reports a local-source branch (no PR) on a successful apply", async () => {
    await setupModifiedManagedSkill();
    vi.spyOn(proposeCore, "applyProposedChanges").mockResolvedValue({
      cloneDir: "/tmp/agconf-clone",
      branch: "propose/my-change",
      pushed: true,
    });

    await expect(
      proposeCommand({ cwd: downstreamDir, yes: true, title: "My change" }),
    ).resolves.toBeUndefined();

    expect(mockExit).not.toHaveBeenCalled();
    expect(output()).toContain("/tmp/agconf-clone");
  });
});
