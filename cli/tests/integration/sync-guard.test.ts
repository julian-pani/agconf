import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addManagedMetadata,
  checkAllManagedFiles,
  isManaged,
} from "../../src/core/managed-content.js";
import { resolveLocalSource } from "../../src/core/source.js";
import { sync, UnmanagedOverwriteError } from "../../src/core/sync.js";

/**
 * `sync` must not silently overwrite a pre-existing UNMANAGED file at a managed
 * path. Identical content is adopted; divergent content aborts the whole sync
 * unless `override` is passed. Managed files keep the normal canonical-owns-it
 * behavior.
 */
describe("sync overwrite guard", () => {
  let downstreamDir: string;
  let canonicalDir: string;

  const skillBody = (name: string, body = "Body.") => `---
name: ${name}
description: A skill from canonical.
---

# ${name}

${body}
`;

  beforeEach(async () => {
    downstreamDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-guard-down-"));
    canonicalDir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-guard-canon-"));
    await fs.mkdir(path.join(canonicalDir, "instructions"), { recursive: true });
    await fs.writeFile(path.join(canonicalDir, "instructions", "AGENTS.md"), "# Global\n", "utf-8");
  });

  afterEach(async () => {
    await fs.rm(downstreamDir, { recursive: true, force: true });
    await fs.rm(canonicalDir, { recursive: true, force: true });
  });

  async function writeCanonicalSkill(name: string, body?: string): Promise<void> {
    const dir = path.join(canonicalDir, "skills", name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "SKILL.md"), skillBody(name, body), "utf-8");
  }

  async function writeLocalSkillMd(name: string, content: string): Promise<string> {
    const dir = path.join(downstreamDir, ".claude", "skills", name);
    await fs.mkdir(dir, { recursive: true });
    const p = path.join(dir, "SKILL.md");
    await fs.writeFile(p, content, "utf-8");
    return p;
  }

  async function writeCanonicalConfig(opts: { rules?: boolean; agents?: boolean }): Promise<void> {
    const lines = ['version: "1.0.0"', "meta:", "  name: test-standards", "content:"];
    if (opts.rules) lines.push("  rules_dir: rules");
    if (opts.agents) lines.push("  agents_dir: agents");
    await fs.writeFile(path.join(canonicalDir, "agconf.yaml"), `${lines.join("\n")}\n`, "utf-8");
  }

  const exists = (p: string) =>
    fs
      .access(p)
      .then(() => true)
      .catch(() => false);

  const syncLocal = async (override = false) => {
    const resolvedSource = await resolveLocalSource({ path: canonicalDir });
    return sync(downstreamDir, resolvedSource, { override, targets: ["claude"] });
  };

  // --- Skills -------------------------------------------------------------

  it("adopts an identical unmanaged skill (round trip closes)", async () => {
    await writeCanonicalSkill("adopt-me");
    const localMd = await writeLocalSkillMd("adopt-me", skillBody("adopt-me"));
    expect(isManaged(await fs.readFile(localMd, "utf-8"))).toBe(false);

    const result = await syncLocal();

    expect(result.adopted).toContain(".claude/skills/adopt-me");
    expect(isManaged(await fs.readFile(localMd, "utf-8"))).toBe(true);
  });

  it("aborts on a divergent unmanaged skill, writing nothing", async () => {
    await writeCanonicalSkill("conflict");
    const diverged = skillBody("conflict", "LOCAL EDIT not upstream.");
    const localMd = await writeLocalSkillMd("conflict", diverged);

    await expect(syncLocal()).rejects.toBeInstanceOf(UnmanagedOverwriteError);

    // Local file untouched, and the sync is atomic — AGENTS.md was never written.
    expect(await fs.readFile(localMd, "utf-8")).toBe(diverged);
    expect(isManaged(await fs.readFile(localMd, "utf-8"))).toBe(false);
    expect(await exists(path.join(downstreamDir, "AGENTS.md"))).toBe(false);
  });

  it("overwrites a divergent unmanaged skill when override is set", async () => {
    await writeCanonicalSkill("conflict");
    const localMd = await writeLocalSkillMd("conflict", skillBody("conflict", "LOCAL EDIT."));

    const result = await syncLocal(true);

    const after = await fs.readFile(localMd, "utf-8");
    expect(isManaged(after)).toBe(true);
    expect(after).not.toContain("LOCAL EDIT");
    expect(result.adopted).not.toContain(".claude/skills/conflict");
  });

  it("does not guard managed files (canonical owns them)", async () => {
    await writeCanonicalSkill("managed");
    // Locally managed but body diverges — sync overwrites without a conflict.
    const localMd = await writeLocalSkillMd(
      "managed",
      addManagedMetadata(skillBody("managed", "stale managed body")),
    );

    await expect(syncLocal()).resolves.toBeTruthy();

    const after = await fs.readFile(localMd, "utf-8");
    expect(after).toContain("Body.");
    expect(after).not.toContain("stale managed body");
  });

  it("treats a divergent asset (SKILL.md identical) as a conflict", async () => {
    // Canonical skill with an asset.
    const cdir = path.join(canonicalDir, "skills", "with-asset");
    await fs.mkdir(path.join(cdir, "references"), { recursive: true });
    await fs.writeFile(path.join(cdir, "SKILL.md"), skillBody("with-asset"), "utf-8");
    await fs.writeFile(path.join(cdir, "references", "a.md"), "# canonical asset", "utf-8");

    // Local: identical SKILL.md but a tampered asset.
    const ldir = path.join(downstreamDir, ".claude", "skills", "with-asset");
    await fs.mkdir(path.join(ldir, "references"), { recursive: true });
    await fs.writeFile(path.join(ldir, "SKILL.md"), skillBody("with-asset"), "utf-8");
    await fs.writeFile(path.join(ldir, "references", "a.md"), "# LOCAL asset edit", "utf-8");

    await expect(syncLocal()).rejects.toBeInstanceOf(UnmanagedOverwriteError);
  });

  it("aborts the whole sync on one conflict (sibling new skill not written)", async () => {
    await writeCanonicalSkill("conflict");
    await writeCanonicalSkill("brand-new"); // absent downstream — would be created
    await writeLocalSkillMd("conflict", skillBody("conflict", "LOCAL EDIT."));

    await expect(syncLocal()).rejects.toBeInstanceOf(UnmanagedOverwriteError);

    // The unrelated new skill must not have been written (atomicity).
    expect(
      await exists(path.join(downstreamDir, ".claude", "skills", "brand-new", "SKILL.md")),
    ).toBe(false);
  });

  it("reports conflicts with downstream paths and types", async () => {
    await writeCanonicalSkill("conflict");
    await writeLocalSkillMd("conflict", skillBody("conflict", "LOCAL EDIT."));

    await syncLocal().then(
      () => expect.fail("expected sync to throw"),
      (err) => {
        expect(err).toBeInstanceOf(UnmanagedOverwriteError);
        expect((err as UnmanagedOverwriteError).conflicts).toEqual([
          { type: "skill", path: ".claude/skills/conflict" },
        ]);
      },
    );
  });

  it("does not false-adopt when divergence is in parser-unfaithful frontmatter", async () => {
    // `custom-key` is a non-word key the hand-rolled YAML parser drops. If the
    // comparator naively compared metadata-stripped output, both would strip to
    // the same string and the local edit would be silently overwritten. The
    // faithfulness gate must classify this as a CONFLICT instead.
    const canonical = `---
name: tricky
description: A skill.
custom-key: UPSTREAM
---

# Tricky

Body.
`;
    const local = canonical.replace("UPSTREAM", "LOCAL ONLY");

    const cdir = path.join(canonicalDir, "skills", "tricky");
    await fs.mkdir(cdir, { recursive: true });
    await fs.writeFile(path.join(cdir, "SKILL.md"), canonical, "utf-8");
    const localMd = await writeLocalSkillMd("tricky", local);

    await expect(syncLocal()).rejects.toBeInstanceOf(UnmanagedOverwriteError);
    // The local-only value survives — nothing was overwritten.
    expect(await fs.readFile(localMd, "utf-8")).toBe(local);
  });

  it("passes `check` after adopting an unmanaged skill", async () => {
    await writeCanonicalSkill("adopt-me");
    await writeLocalSkillMd("adopt-me", skillBody("adopt-me"));

    await syncLocal();

    const checked = await checkAllManagedFiles(downstreamDir, ["claude"]);
    const skill = checked.find((f) => f.type === "skill" && f.skillName === "adopt-me");
    expect(skill?.isManaged).toBe(true);
    expect(skill?.hasChanges).toBe(false);
  });

  // --- Rules --------------------------------------------------------------

  it("adopts an identical rule and conflicts on a divergent one", async () => {
    await writeCanonicalSkill("base"); // keep a baseline skill
    await writeCanonicalConfig({ rules: true });
    await fs.mkdir(path.join(canonicalDir, "rules", "security"), { recursive: true });
    await fs.writeFile(
      path.join(canonicalDir, "rules", "security", "auth.md"),
      "# Auth\n\nRule body.\n",
      "utf-8",
    );

    // Identical local rule → adopted.
    const ruleDir = path.join(downstreamDir, ".claude", "rules", "security");
    await fs.mkdir(ruleDir, { recursive: true });
    await fs.writeFile(path.join(ruleDir, "auth.md"), "# Auth\n\nRule body.\n", "utf-8");

    const result = await syncLocal();
    expect(result.adopted).toContain(".claude/rules/security/auth.md");
    expect(isManaged(await fs.readFile(path.join(ruleDir, "auth.md"), "utf-8"))).toBe(true);

    // `check` sees the adopted rule as managed & unmodified.
    const checkedRule = (await checkAllManagedFiles(downstreamDir, ["claude"])).find(
      (f) => f.type === "rule" && f.path.endsWith("auth.md"),
    );
    expect(checkedRule?.isManaged).toBe(true);
    expect(checkedRule?.hasChanges).toBe(false);

    // Now diverge it and re-sync → conflict.
    await fs.writeFile(
      path.join(canonicalDir, "rules", "security", "auth.md"),
      "# Auth\n\nUPDATED upstream.\n",
      "utf-8",
    );
    await fs.writeFile(path.join(ruleDir, "auth.md"), "# Auth\n\nLOCAL divergent.\n", "utf-8");
    await expect(syncLocal()).rejects.toBeInstanceOf(UnmanagedOverwriteError);
  });

  // --- Agents -------------------------------------------------------------

  it("adopts an identical agent and conflicts on a divergent one", async () => {
    await writeCanonicalSkill("base");
    await writeCanonicalConfig({ agents: true });
    const agentBody = `---
name: reviewer
description: Reviews code.
---

# Reviewer
`;
    await fs.mkdir(path.join(canonicalDir, "agents"), { recursive: true });
    await fs.writeFile(path.join(canonicalDir, "agents", "reviewer.md"), agentBody, "utf-8");

    const localAgents = path.join(downstreamDir, ".claude", "agents");
    await fs.mkdir(localAgents, { recursive: true });
    await fs.writeFile(path.join(localAgents, "reviewer.md"), agentBody, "utf-8");

    const result = await syncLocal();
    expect(result.adopted).toContain(".claude/agents/reviewer.md");
    expect(isManaged(await fs.readFile(path.join(localAgents, "reviewer.md"), "utf-8"))).toBe(true);

    // `check` sees the adopted agent as managed & unmodified.
    const checkedAgent = (await checkAllManagedFiles(downstreamDir, ["claude"])).find(
      (f) => f.type === "agent" && f.path.endsWith("reviewer.md"),
    );
    expect(checkedAgent?.isManaged).toBe(true);
    expect(checkedAgent?.hasChanges).toBe(false);

    await fs.writeFile(
      path.join(localAgents, "reviewer.md"),
      agentBody.replace("# Reviewer", "# Reviewer (local edit)"),
      "utf-8",
    );
    await expect(syncLocal()).rejects.toBeInstanceOf(UnmanagedOverwriteError);
  });
});
