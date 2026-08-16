import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isManaged } from "../../src/core/managed-content.js";
import {
  applyProposedChanges,
  DivergentCopiesError,
  detectProposedChanges,
} from "../../src/core/propose.js";
import { resolveLocalSource } from "../../src/core/source.js";
import { sync, UnmanagedOverwriteError } from "../../src/core/sync.js";

/**
 * The "round-trip gap": a skill authored locally and shipped upstream via
 * `propose --new` stays UNMANAGED in the proposing repo until the canonical PR
 * merges AND the repo runs `sync`. These tests pin down what `sync` actually
 * does when it meets a pre-existing unmanaged copy at a skill path — there is
 * no managed-guard on sync's write path, so it overwrites unconditionally.
 */
describe("propose --new round-trip (adoption via sync)", () => {
  const SKILL_BODY = `---
name: my-skill
description: A locally authored skill.
---

# My Skill

Body.
`;

  let downstreamDir: string;
  let canonicalDir: string;

  beforeEach(async () => {
    downstreamDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-rt-down-"));
    canonicalDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-rt-canon-"));

    // Canonical, post-merge: global instructions + the proposed skill.
    await fs.mkdir(path.join(canonicalDir, "instructions"), { recursive: true });
    await fs.writeFile(
      path.join(canonicalDir, "instructions", "AGENTS.md"),
      "# Global Standards\n",
      "utf-8",
    );
    await fs.mkdir(path.join(canonicalDir, "skills", "my-skill", "references"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(canonicalDir, "skills", "my-skill", "SKILL.md"),
      SKILL_BODY,
      "utf-8",
    );
    await fs.writeFile(
      path.join(canonicalDir, "skills", "my-skill", "references", "helper.py"),
      "print('helper')\n",
      "utf-8",
    );
  });

  afterEach(async () => {
    await fs.rm(downstreamDir, { recursive: true, force: true });
    await fs.rm(canonicalDir, { recursive: true, force: true });
  });

  async function writeLocalUnmanagedSkill(skillMd: string): Promise<void> {
    const refs = path.join(downstreamDir, ".claude", "skills", "my-skill", "references");
    await fs.mkdir(refs, { recursive: true });
    await fs.writeFile(
      path.join(downstreamDir, ".claude", "skills", "my-skill", "SKILL.md"),
      skillMd,
      "utf-8",
    );
    await fs.writeFile(path.join(refs, "helper.py"), "print('helper')\n", "utf-8");
  }

  it("adopts a previously-proposed skill: the unmanaged local copy becomes managed after sync", async () => {
    // The proposing repo still holds the unmanaged copy it authored & shipped.
    await writeLocalUnmanagedSkill(SKILL_BODY);
    const localPath = path.join(downstreamDir, ".claude", "skills", "my-skill", "SKILL.md");
    expect(isManaged(await fs.readFile(localPath, "utf-8"))).toBe(false);

    const resolvedSource = await resolveLocalSource({ path: canonicalDir });
    await sync(downstreamDir, resolvedSource, { override: false, targets: ["claude"] });

    const after = await fs.readFile(localPath, "utf-8");
    // Round trip closes cleanly: the local copy is now tracked, body intact.
    expect(isManaged(after)).toBe(true);
    expect(after).toContain("# My Skill");
    expect(after).toContain("Body.");
  });

  it("refuses to overwrite local divergence — the edit is protected", async () => {
    // The repo edited its copy after proposing; canonical still has the original.
    const diverged = SKILL_BODY.replace("Body.", "LOCAL EDIT not yet upstream.");
    await writeLocalUnmanagedSkill(diverged);

    const resolvedSource = await resolveLocalSource({ path: canonicalDir });
    await expect(
      sync(downstreamDir, resolvedSource, { override: false, targets: ["claude"] }),
    ).rejects.toBeInstanceOf(UnmanagedOverwriteError);

    const localPath = path.join(downstreamDir, ".claude", "skills", "my-skill", "SKILL.md");
    const after = await fs.readFile(localPath, "utf-8");
    // The local edit survives — nothing was overwritten.
    expect(after).toBe(diverged);
    expect(isManaged(after)).toBe(false);
  });

  it("overwrites local divergence when --override is passed", async () => {
    const diverged = SKILL_BODY.replace("Body.", "LOCAL EDIT not yet upstream.");
    await writeLocalUnmanagedSkill(diverged);

    const resolvedSource = await resolveLocalSource({ path: canonicalDir });
    await sync(downstreamDir, resolvedSource, { override: true, targets: ["claude"] });

    const localPath = path.join(downstreamDir, ".claude", "skills", "my-skill", "SKILL.md");
    const after = await fs.readFile(localPath, "utf-8");
    expect(isManaged(after)).toBe(true);
    expect(after).not.toContain("LOCAL EDIT");
  });

  /**
   * End-to-end multi-harness round trip: real `sync` to claude + codex, edit the
   * downstream copies, then `propose` all the way through
   * `applyProposedChanges`.
   *
   * The unit tests assert what detection *returns*; these assert what actually
   * lands in the canonical commit, which is where a duplicate canonical path did
   * its damage — the apply loop wrote both copies to the same path in sequence.
   */
  describe("synced to claude + codex", () => {
    const SKILL_DIRS = [".claude/skills", ".agents/skills"] as const;

    /** Sync the canonical skill into both targets, then hand back the source. */
    async function syncBothTargets() {
      execSync("git init", { cwd: canonicalDir, stdio: "ignore" });
      execSync("git config user.email t@t.com", { cwd: canonicalDir, stdio: "ignore" });
      execSync("git config user.name T", { cwd: canonicalDir, stdio: "ignore" });
      execSync("git add -A && git commit -m init", { cwd: canonicalDir, stdio: "ignore" });

      const resolvedSource = await resolveLocalSource({ path: canonicalDir });
      await sync(downstreamDir, resolvedSource, {
        override: false,
        targets: ["claude", "codex"],
      });
      return resolvedSource;
    }

    const copyPath = (skillsDir: string, relPath: string) =>
      path.join(downstreamDir, ...skillsDir.split("/"), "my-skill", ...relPath.split("/"));

    /** Rewrite one target's copy, preserving its managed frontmatter. */
    async function editCopy(skillsDir: string, relPath: string, from: string, to: string) {
      const full = copyPath(skillsDir, relPath);
      const current = await fs.readFile(full, "utf-8");
      await fs.writeFile(full, current.replace(from, to), "utf-8");
    }

    it("writes the canonical file once when both copies carry the same edit", async () => {
      await syncBothTargets();
      for (const skillsDir of SKILL_DIRS) {
        await editCopy(skillsDir, "SKILL.md", "Body.", "Body, improved in both copies.");
      }

      const detected = await detectProposedChanges({ cwd: downstreamDir });
      // One entry, so the PR body lists the path once rather than twice.
      expect(detected.changes.map((c) => c.canonicalPath)).toEqual(["skills/my-skill/SKILL.md"]);

      const applied = await applyProposedChanges(detected, { title: "Improve my-skill" });
      const committed = await fs.readFile(
        path.join(applied.cloneDir, "skills", "my-skill", "SKILL.md"),
        "utf-8",
      );
      expect(committed).toContain("Body, improved in both copies.");
      // Managed metadata must never round-trip back into canonical.
      expect(isManaged(committed)).toBe(false);
      await fs.rm(path.dirname(applied.cloneDir), { recursive: true, force: true });
    });

    it("carries an edit made only in the codex copy through to canonical", async () => {
      // Before the asset scan walked every target, an edit confined to the
      // non-first target's copy was silently dropped and never reached canonical.
      await syncBothTargets();
      await editCopy(".agents/skills", "references/helper.py", "helper", "helper CODEX-ONLY");

      const detected = await detectProposedChanges({ cwd: downstreamDir });
      expect(detected.changes.map((c) => c.canonicalPath)).toEqual([
        "skills/my-skill/references/helper.py",
      ]);

      const applied = await applyProposedChanges(detected, { title: "Fix helper" });
      const committed = await fs.readFile(
        path.join(applied.cloneDir, "skills", "my-skill", "references", "helper.py"),
        "utf-8",
      );
      expect(committed).toBe("print('helper CODEX-ONLY')\n");
      await fs.rm(path.dirname(applied.cloneDir), { recursive: true, force: true });
    });

    it("refuses the whole propose when the two copies were edited differently", async () => {
      // The original data loss: both copies map to one canonical path, so the
      // apply loop wrote claude's edit and then overwrote it with codex's.
      await syncBothTargets();
      await editCopy(".claude/skills", "SKILL.md", "Body.", "Body, the CLAUDE edit.");
      await editCopy(".agents/skills", "SKILL.md", "Body.", "Body, the CODEX edit.");

      await expect(detectProposedChanges({ cwd: downstreamDir })).rejects.toBeInstanceOf(
        DivergentCopiesError,
      );

      // Canonical is untouched — nothing was committed on either side.
      const canonicalSkill = await fs.readFile(
        path.join(canonicalDir, "skills", "my-skill", "SKILL.md"),
        "utf-8",
      );
      expect(canonicalSkill).toBe(SKILL_BODY);
    });

    it("ships the selected copy when --files resolves a divergence", async () => {
      await syncBothTargets();
      await editCopy(".claude/skills", "SKILL.md", "Body.", "Body, the CLAUDE edit.");
      await editCopy(".agents/skills", "SKILL.md", "Body.", "Body, the CODEX edit.");

      const detected = await detectProposedChanges({
        cwd: downstreamDir,
        files: ["^\\.claude/"],
      });
      const applied = await applyProposedChanges(detected, { title: "Take the claude edit" });

      const committed = await fs.readFile(
        path.join(applied.cloneDir, "skills", "my-skill", "SKILL.md"),
        "utf-8",
      );
      expect(committed).toContain("Body, the CLAUDE edit.");
      expect(committed).not.toContain("CODEX");
      await fs.rm(path.dirname(applied.cloneDir), { recursive: true, force: true });
    });
  });
});
