import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proposeCommand } from "../../src/commands/propose.js";

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

  async function writeLockfile(): Promise<void> {
    const lockfile = {
      version: "1.0.0",
      synced_at: new Date().toISOString(),
      source: { type: "local" as const, path: canonicalDir },
      content: {
        agents_md: { global_block_hash: "sha256:abc", merged: true },
        skills: [],
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
});
