import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type EnrollmentConfig, PluginsConfigSchema } from "../../src/config/schema.js";
import {
  buildEnrollmentPlan,
  mergeEnrollment,
  overlapWarnings,
  readClaudeSettings,
  readCompiledPluginContents,
  verifyEnrollment,
  writeClaudeSettings,
} from "../../src/core/enrollment.js";
import { compilePlugins } from "../../src/core/plugins.js";
import type { ResolvedSource } from "../../src/core/source.js";

const CONFIG: EnrollmentConfig = {
  marketplace: "acme-tools",
  source: { repository: "acme/standards", ref: "v2.3.0" },
  plugins: ["base", "frontend"],
};

describe("buildEnrollmentPlan", () => {
  it("builds the marketplace entry and namespaced plugin ids", () => {
    const plan = buildEnrollmentPlan(CONFIG);
    expect(plan.marketplace).toBe("acme-tools");
    expect(plan.marketplaceEntry).toEqual({
      source: { source: "github", repo: "acme/standards", ref: "v2.3.0" },
    });
    expect(plan.enabledPlugins).toEqual(["base@acme-tools", "frontend@acme-tools"]);
  });

  it("omits ref when not pinned", () => {
    const plan = buildEnrollmentPlan({ ...CONFIG, source: { repository: "acme/standards" } });
    expect(plan.marketplaceEntry.source).toEqual({ source: "github", repo: "acme/standards" });
  });
});

describe("mergeEnrollment", () => {
  it("adds the block to empty settings", () => {
    const merged = mergeEnrollment({}, buildEnrollmentPlan(CONFIG));
    expect(merged.extraKnownMarketplaces).toEqual({
      "acme-tools": { source: { source: "github", repo: "acme/standards", ref: "v2.3.0" } },
    });
    expect(merged.enabledPlugins).toEqual(["base@acme-tools", "frontend@acme-tools"]);
  });

  it("preserves unrelated keys and other marketplaces", () => {
    const existing = {
      model: "claude-sonnet-5",
      extraKnownMarketplaces: { other: { source: { source: "github", repo: "x/y" } } },
      enabledPlugins: ["keep@other"],
    };
    const merged = mergeEnrollment(existing, buildEnrollmentPlan(CONFIG));
    expect(merged.model).toBe("claude-sonnet-5");
    expect((merged.extraKnownMarketplaces as Record<string, unknown>).other).toBeDefined();
    expect(merged.enabledPlugins).toEqual(["keep@other", "base@acme-tools", "frontend@acme-tools"]);
  });

  it("is idempotent (no duplicate plugin ids on re-run)", () => {
    const plan = buildEnrollmentPlan(CONFIG);
    const once = mergeEnrollment({}, plan);
    const twice = mergeEnrollment(once, plan);
    expect(twice.enabledPlugins).toEqual(["base@acme-tools", "frontend@acme-tools"]);
  });
});

describe("verifyEnrollment", () => {
  const plan = buildEnrollmentPlan(CONFIG);

  it("returns no problems when settings satisfy the plan", () => {
    const settings = mergeEnrollment({}, plan);
    expect(verifyEnrollment(settings, plan)).toEqual([]);
  });

  it("flags a missing marketplace", () => {
    const problems = verifyEnrollment({ enabledPlugins: plan.enabledPlugins }, plan);
    expect(problems.join("\n")).toMatch(/not registered/);
  });

  it("flags a drifted ref", () => {
    const settings = mergeEnrollment(
      {},
      buildEnrollmentPlan({ ...CONFIG, source: { repository: "acme/standards", ref: "v1.0.0" } }),
    );
    const problems = verifyEnrollment(settings, plan);
    expect(problems.join("\n")).toMatch(/ref is "v1.0.0", expected "v2.3.0"/);
  });

  it("flags a missing enabled plugin", () => {
    const settings = mergeEnrollment({}, plan);
    (settings.enabledPlugins as string[]).splice(1, 1); // drop frontend@acme-tools
    const problems = verifyEnrollment(settings, plan);
    expect(problems.join("\n")).toMatch(/plugin "frontend@acme-tools" is not in enabledPlugins/);
  });
});

describe("settings I/O", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-enroll-io-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns {} when settings.json is absent", async () => {
    expect(await readClaudeSettings(dir)).toEqual({});
  });

  it("round-trips written settings", async () => {
    const settings = mergeEnrollment({ model: "x" }, buildEnrollmentPlan(CONFIG));
    await writeClaudeSettings(dir, settings);
    const read = await readClaudeSettings(dir);
    expect(read).toEqual(settings);
    // Pretty-printed with trailing newline.
    const raw = await fs.readFile(path.join(dir, ".claude", "settings.json"), "utf-8");
    expect(raw.endsWith("}\n")).toBe(true);
  });

  it("throws on a non-object settings.json", async () => {
    await fs.mkdir(path.join(dir, ".claude"), { recursive: true });
    await fs.writeFile(path.join(dir, ".claude", "settings.json"), "[1,2]");
    await expect(readClaudeSettings(dir)).rejects.toThrow(/not a JSON object/);
  });
});

describe("overlap warnings against compiled plugins", () => {
  let base: string;

  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-enroll-overlap-"));
    // Canonical content: a shared skill, a unique skill, and an MCP server.
    for (const name of ["shared", "fe-only", "be-only"]) {
      await fs.mkdir(path.join(base, "skills", name), { recursive: true });
      await fs.writeFile(
        path.join(base, "skills", name, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${name}\n---\n\n# ${name}\n`,
      );
    }
    await fs.mkdir(path.join(base, "mcps"), { recursive: true });
    await fs.writeFile(path.join(base, "mcps", "figma.json"), JSON.stringify({ command: "figma" }));

    // Two plugins that both include `shared` and both include the figma MCP.
    const cfg = PluginsConfigSchema.parse({
      version: "1.0.0",
      marketplace: { name: "acme-tools", owner: { name: "Acme" } },
      definitions: [
        { name: "frontend", skills: ["shared", "fe-only"], mcps: ["figma"] },
        { name: "backend", skills: ["shared", "be-only"], mcps: ["figma"] },
      ],
    });
    const source: ResolvedSource = {
      source: { type: "local", path: base },
      basePath: base,
      agentsMdPath: path.join(base, "instructions", "AGENTS.md"),
      skillsPath: path.join(base, "skills"),
      rulesPath: null,
      agentsPath: null,
      mcpsPath: path.join(base, "mcps"),
      markerPrefix: "agconf",
    };
    await compilePlugins(base, source, cfg, ["claude"]);
  });

  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  it("reads compiled plugin contents and reports missing plugins", async () => {
    const { contents, missing } = await readCompiledPluginContents(base, "plugins", [
      "frontend",
      "backend",
      "ghost",
    ]);
    expect(missing).toEqual(["ghost"]);
    const fe = contents.find((c) => c.name === "frontend");
    expect(fe?.skills).toEqual(["fe-only", "shared"]);
    expect(fe?.mcps).toEqual(["figma"]);
  });

  it("warns on duplicate skills and (severely) on duplicate MCP servers", async () => {
    const { contents } = await readCompiledPluginContents(base, "plugins", ["frontend", "backend"]);
    const warnings = overlapWarnings(contents);
    expect(warnings.some((w) => /skill "shared" is in multiple/.test(w))).toBe(true);
    expect(warnings.some((w) => /MCP server "figma".*likely collide/.test(w))).toBe(true);
    // Unique skills do not warn.
    expect(warnings.some((w) => /fe-only|be-only/.test(w))).toBe(false);
  });

  it("returns no warnings for a single-plugin enrolled set", async () => {
    const { contents } = await readCompiledPluginContents(base, "plugins", ["frontend"]);
    expect(overlapWarnings(contents)).toEqual([]);
  });
});
