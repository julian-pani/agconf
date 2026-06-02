import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isManaged } from "../../src/core/managed-content.js";
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
});
