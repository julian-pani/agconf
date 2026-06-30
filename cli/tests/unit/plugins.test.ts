import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { PluginsConfigSchema } from "../../src/config/schema.js";
import {
  compilePlugins,
  compilePluginsToDir,
  resolvePluginTargets,
  verifyPluginsFresh,
} from "../../src/core/plugins.js";
import type { ResolvedSource } from "../../src/core/source.js";

// =============================================================================
// Helpers
// =============================================================================

function makeSource(base: string): ResolvedSource {
  return {
    source: { type: "local", path: base },
    basePath: base,
    agentsMdPath: path.join(base, "instructions", "AGENTS.md"),
    skillsPath: path.join(base, "skills"),
    rulesPath: null,
    agentsPath: path.join(base, "agents"),
    mcpsPath: path.join(base, "mcps"),
    markerPrefix: "agconf",
  };
}

async function writeSkill(base: string, name: string, withAsset = false): Promise<void> {
  const dir = path.join(base, "skills", name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: The ${name} skill\n---\n\n# ${name}\n\nDo the thing.\n`,
  );
  if (withAsset) {
    await fs.mkdir(path.join(dir, "references"), { recursive: true });
    await fs.writeFile(path.join(dir, "references", "notes.md"), "asset content\n");
  }
}

async function writeAgent(base: string, name: string): Promise<void> {
  const dir = path.join(base, "agents");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${name}.md`),
    `---\nname: ${name}\ndescription: The ${name} agent\nmodel: sonnet\n---\n\n# ${name}\n\nSystem prompt here.\n`,
  );
}

async function writeMcp(base: string, name: string, config: object): Promise<void> {
  const dir = path.join(base, "mcps");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify(config, null, 2));
}

function config(overrides: Record<string, unknown> = {}) {
  return PluginsConfigSchema.parse({
    marketplace: { name: "acme-tools", owner: { name: "Acme Corp", email: "dev@acme.com" } },
    ...overrides,
  });
}

async function readJson(base: string, rel: string): Promise<Record<string, unknown>> {
  const content = await fs.readFile(path.join(base, rel), "utf-8");
  return JSON.parse(content);
}

async function exists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

// =============================================================================
// resolvePluginTargets
// =============================================================================

describe("resolvePluginTargets", () => {
  it("defaults to the canonical targets", () => {
    const { targets, warnings } = resolvePluginTargets(config(), ["claude", "codex"]);
    expect(targets).toEqual(["claude", "codex"]);
    expect(warnings).toEqual([]);
  });

  it("honors plugins.targets override", () => {
    const { targets } = resolvePluginTargets(config({ targets: ["codex"] }), ["claude"]);
    expect(targets).toEqual(["codex"]);
  });

  it("drops unknown targets with a warning", () => {
    const { targets, warnings } = resolvePluginTargets(config(), ["claude", "gemini"]);
    expect(targets).toEqual(["claude"]);
    expect(warnings[0]).toMatch(/gemini/);
  });

  it("dedupes targets", () => {
    const { targets } = resolvePluginTargets(config({ targets: ["claude", "claude"] }), []);
    expect(targets).toEqual(["claude"]);
  });
});

// =============================================================================
// compile
// =============================================================================

describe("compilePlugins (single synthesized plugin)", () => {
  let base: string;

  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-plugins-"));
    await writeSkill(base, "react-patterns", true);
    await writeSkill(base, "api-auth");
    await writeAgent(base, "ui-reviewer");
    await writeMcp(base, "figma", { command: "figma-mcp", args: ["--stdio"] });
  });

  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  it("produces per-target trees and both marketplace files", async () => {
    const result = await compilePlugins(base, makeSource(base), config(), ["claude", "codex"]);

    expect(await exists(path.join(base, ".claude-plugin", "marketplace.json"))).toBe(true);
    expect(await exists(path.join(base, ".agents", "plugins", "marketplace.json"))).toBe(true);
    expect(await exists(path.join(base, "plugins", "claude", "acme-tools"))).toBe(true);
    expect(await exists(path.join(base, "plugins", "codex", "acme-tools"))).toBe(true);
    expect(result.plugins).toHaveLength(2); // one per target
  });

  it("copies skills verbatim including assets, with no injected metadata", async () => {
    await compilePlugins(base, makeSource(base), config(), ["claude"]);

    const skillMd = await fs.readFile(
      path.join(base, "plugins", "claude", "acme-tools", "skills", "react-patterns", "SKILL.md"),
      "utf-8",
    );
    expect(skillMd).toContain("name: react-patterns");
    expect(skillMd).not.toContain("agconf_managed");
    expect(skillMd).not.toContain("agconf_content_hash");

    // Sibling asset copied
    expect(
      await exists(
        path.join(
          base,
          "plugins",
          "claude",
          "acme-tools",
          "skills",
          "react-patterns",
          "references",
          "notes.md",
        ),
      ),
    ).toBe(true);
  });

  it("Claude bundles agents natively; Codex down-converts them to skills", async () => {
    await compilePlugins(base, makeSource(base), config(), ["claude", "codex"]);

    // Claude: native agent file
    expect(
      await exists(path.join(base, "plugins", "claude", "acme-tools", "agents", "ui-reviewer.md")),
    ).toBe(true);
    // Claude has no agent-derived skill
    expect(
      await exists(
        path.join(base, "plugins", "claude", "acme-tools", "skills", "ui-reviewer", "SKILL.md"),
      ),
    ).toBe(false);

    // Codex: no agents dir, agent became a skill
    expect(await exists(path.join(base, "plugins", "codex", "acme-tools", "agents"))).toBe(false);
    const codexAgentSkill = await fs.readFile(
      path.join(base, "plugins", "codex", "acme-tools", "skills", "ui-reviewer", "SKILL.md"),
      "utf-8",
    );
    expect(codexAgentSkill).toContain("name: ui-reviewer");
    expect(codexAgentSkill).toContain("description: The ui-reviewer agent");
    expect(codexAgentSkill).toContain("System prompt here.");
  });

  it("aggregates MCP servers with the target-appropriate wrapper key", async () => {
    await compilePlugins(base, makeSource(base), config(), ["claude", "codex"]);

    const claudeMcp = await readJson(base, "plugins/claude/acme-tools/.mcp.json");
    expect(claudeMcp).toHaveProperty("mcpServers");
    expect((claudeMcp.mcpServers as Record<string, unknown>).figma).toEqual({
      command: "figma-mcp",
      args: ["--stdio"],
    });

    const codexMcp = await readJson(base, "plugins/codex/acme-tools/.mcp.json");
    expect(codexMcp).toHaveProperty("mcp_servers");
  });

  it("writes a Claude plugin.json with mcpServers pointer", async () => {
    await compilePlugins(base, makeSource(base), config({ version: "1.2.0" }), ["claude"]);
    const manifest = await readJson(base, "plugins/claude/acme-tools/.claude-plugin/plugin.json");
    expect(manifest.name).toBe("acme-tools");
    expect(manifest.version).toBe("1.2.0");
    expect(manifest.mcpServers).toBe("./.mcp.json");
  });

  it("writes a Codex plugin.json with explicit skills + mcpServers pointers", async () => {
    await compilePlugins(base, makeSource(base), config({ version: "1.2.0" }), ["codex"]);
    const manifest = await readJson(base, "plugins/codex/acme-tools/.codex-plugin/plugin.json");
    expect(manifest.name).toBe("acme-tools");
    expect(manifest.skills).toBe("./skills/");
    expect(manifest.mcpServers).toBe("./.mcp.json");
  });

  it("writes a Claude marketplace with owner and string source", async () => {
    await compilePlugins(base, makeSource(base), config(), ["claude"]);
    const mkt = await readJson(base, ".claude-plugin/marketplace.json");
    expect(mkt.name).toBe("acme-tools");
    expect(mkt.owner).toEqual({ name: "Acme Corp", email: "dev@acme.com" });
    const plugins = mkt.plugins as Array<Record<string, unknown>>;
    expect(plugins[0]?.source).toBe("./plugins/claude/acme-tools");
  });

  it("writes a Codex marketplace with interface, object source and policy", async () => {
    await compilePlugins(base, makeSource(base), config(), ["codex"]);
    const mkt = await readJson(base, path.join(".agents", "plugins", "marketplace.json"));
    expect(mkt.interface).toEqual({ displayName: "acme-tools" });
    const plugins = mkt.plugins as Array<Record<string, unknown>>;
    expect(plugins[0]?.source).toEqual({ source: "local", path: "./plugins/codex/acme-tools" });
    expect(plugins[0]?.policy).toEqual({
      installation: "AVAILABLE",
      authentication: "ON_INSTALL",
    });
  });
});

// =============================================================================
// Multi-plugin definitions + selectors
// =============================================================================

describe("compilePlugins (multi-plugin definitions)", () => {
  let base: string;

  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-plugins-multi-"));
    await writeSkill(base, "react-patterns");
    await writeSkill(base, "react-forms");
    await writeSkill(base, "api-auth");
    await writeAgent(base, "ui-reviewer");
  });

  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  it("selects skills by glob and omitted categories include all", async () => {
    const cfg = config({
      definitions: [
        { name: "frontend", skills: ["react-*"], agents: ["ui-reviewer"] },
        { name: "backend", skills: ["api-auth"] },
      ],
    });
    const result = await compilePlugins(base, makeSource(base), cfg, ["claude"]);

    const frontend = result.plugins.find((p) => p.name === "frontend");
    expect(frontend?.skills.sort()).toEqual(["react-forms", "react-patterns"]);
    expect(frontend?.agents).toEqual(["ui-reviewer"]);

    const backend = result.plugins.find((p) => p.name === "backend");
    expect(backend?.skills).toEqual(["api-auth"]);
    // omitted agents on backend means "all", but selector restricts via name; here it's all
    expect(
      await exists(path.join(base, "plugins", "claude", "frontend", "skills", "api-auth")),
    ).toBe(false);
  });

  it("treats an empty selector array as 'none'", async () => {
    const cfg = config({
      definitions: [{ name: "skills-only", skills: ["api-auth"], agents: [] }],
    });
    const result = await compilePlugins(base, makeSource(base), cfg, ["claude"]);
    expect(result.plugins[0]?.agents).toEqual([]);
    expect(await exists(path.join(base, "plugins", "claude", "skills-only", "agents"))).toBe(false);
  });

  it("skips a plugin that selects no content, with a warning", async () => {
    const cfg = config({
      definitions: [{ name: "empty", skills: ["does-not-exist"], agents: [], mcps: [] }],
    });
    const result = await compilePlugins(base, makeSource(base), cfg, ["claude"]);
    expect(result.plugins).toHaveLength(0);
    expect(result.warnings.join("\n")).toMatch(/selects no content/);
    const mkt = await readJson(base, ".claude-plugin/marketplace.json");
    expect(mkt.plugins).toEqual([]);
  });

  it("per-plugin version overrides the global plugins.version", async () => {
    const cfg = config({
      version: "1.0.0",
      definitions: [
        { name: "frontend", skills: ["react-patterns"], version: "2.5.0" },
        { name: "backend", skills: ["api-auth"] },
      ],
    });
    await compilePlugins(base, makeSource(base), cfg, ["claude"]);
    const fe = await readJson(base, "plugins/claude/frontend/.claude-plugin/plugin.json");
    const be = await readJson(base, "plugins/claude/backend/.claude-plugin/plugin.json");
    expect(fe.version).toBe("2.5.0");
    expect(be.version).toBe("1.0.0");
  });
});

// =============================================================================
// Stale cleanup + safety
// =============================================================================

describe("compilePlugins cleanup + safety", () => {
  let base: string;

  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-plugins-clean-"));
    await writeSkill(base, "alpha");
  });

  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  it("removes stale artifacts from a previous compile", async () => {
    // Stale leftover under the output dir
    const staleDir = path.join(base, "plugins", "claude", "old-plugin");
    await fs.mkdir(staleDir, { recursive: true });
    await fs.writeFile(path.join(staleDir, "stale.txt"), "old");

    await compilePlugins(base, makeSource(base), config(), ["claude"]);
    expect(await exists(staleDir)).toBe(false);
  });

  it("throws when output_dir would clobber the skills directory", async () => {
    const cfg = config({ output_dir: "skills" });
    await expect(compilePlugins(base, makeSource(base), cfg, ["claude"])).rejects.toThrow(
      /overlaps source content/,
    );
  });

  it("throws when output_dir is the repo root", async () => {
    const cfg = config({ output_dir: "." });
    await expect(compilePlugins(base, makeSource(base), cfg, ["claude"])).rejects.toThrow(
      /repo root/,
    );
  });
});

// =============================================================================
// verifyPluginsFresh
// =============================================================================

describe("verifyPluginsFresh", () => {
  let base: string;

  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-plugins-verify-"));
    await writeSkill(base, "alpha");
    await writeAgent(base, "reviewer");
    await writeMcp(base, "docs", { url: "https://example.com/mcp" });
  });

  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  it("reports no drift immediately after compile", async () => {
    await compilePlugins(base, makeSource(base), config(), ["claude", "codex"]);
    const drift = await verifyPluginsFresh(base, makeSource(base), config(), ["claude", "codex"]);
    expect(drift).toEqual({ drifted: [], missing: [], extra: [] });
  });

  it("detects a drifted (hand-edited) committed file", async () => {
    await compilePlugins(base, makeSource(base), config(), ["claude"]);
    const manifestRel = "plugins/claude/acme-tools/.claude-plugin/plugin.json";
    await fs.writeFile(path.join(base, manifestRel), '{"name":"tampered"}\n');

    const drift = await verifyPluginsFresh(base, makeSource(base), config(), ["claude"]);
    expect(drift.drifted).toContain(manifestRel);
  });

  it("detects a missing committed file", async () => {
    await compilePlugins(base, makeSource(base), config(), ["claude"]);
    const skillRel = "plugins/claude/acme-tools/skills/alpha/SKILL.md";
    await fs.rm(path.join(base, skillRel));

    const drift = await verifyPluginsFresh(base, makeSource(base), config(), ["claude"]);
    expect(drift.missing).toContain(skillRel);
  });

  it("detects an extra (stale) committed file under a managed root", async () => {
    await compilePlugins(base, makeSource(base), config(), ["claude"]);
    const extraRel = path.join("plugins", "claude", "acme-tools", "skills", "ghost", "SKILL.md");
    await fs.mkdir(path.dirname(path.join(base, extraRel)), { recursive: true });
    await fs.writeFile(path.join(base, extraRel), "ghost\n");

    const drift = await verifyPluginsFresh(base, makeSource(base), config(), ["claude"]);
    expect(drift.extra).toContain(extraRel);
  });

  it("flags artifacts of a target that is no longer compiled as extra", async () => {
    // Compile both, then verify against claude-only: codex tree + marketplace are stale.
    await compilePlugins(base, makeSource(base), config(), ["claude", "codex"]);
    const drift = await verifyPluginsFresh(base, makeSource(base), config(), ["claude"]);
    expect(drift.extra).toContain(path.join(".agents", "plugins", "marketplace.json"));
    expect(drift.extra.some((f) => f.startsWith(path.join("plugins", "codex")))).toBe(true);
  });

  it("detects drift when a source skill changes after compile", async () => {
    await compilePlugins(base, makeSource(base), config(), ["claude"]);
    // Edit the canonical source skill — committed artifact is now stale.
    await fs.writeFile(
      path.join(base, "skills", "alpha", "SKILL.md"),
      `---\nname: alpha\ndescription: CHANGED\n---\n\n# alpha\n`,
    );
    const drift = await verifyPluginsFresh(base, makeSource(base), config(), ["claude"]);
    expect(drift.drifted).toContain("plugins/claude/acme-tools/skills/alpha/SKILL.md");
  });
});

// =============================================================================
// compilePluginsToDir determinism
// =============================================================================

describe("compilePluginsToDir determinism", () => {
  let base: string;

  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-plugins-det-"));
    await writeSkill(base, "alpha");
    await writeSkill(base, "beta");
  });

  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  it("produces byte-identical output across two runs", async () => {
    const out1 = await fs.mkdtemp(path.join(os.tmpdir(), "out1-"));
    const out2 = await fs.mkdtemp(path.join(os.tmpdir(), "out2-"));
    try {
      const r1 = await compilePluginsToDir(out1, makeSource(base), config(), ["claude", "codex"]);
      const r2 = await compilePluginsToDir(out2, makeSource(base), config(), ["claude", "codex"]);
      expect(r1.writtenFiles).toEqual(r2.writtenFiles);
      for (const rel of r1.writtenFiles) {
        const a = await fs.readFile(path.join(out1, rel), "utf-8");
        const b = await fs.readFile(path.join(out2, rel), "utf-8");
        expect(a).toBe(b);
      }
    } finally {
      await fs.rm(out1, { recursive: true, force: true });
      await fs.rm(out2, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// Review remediation: safety guards, selector escaping, YAML escaping,
// MCP fidelity, collisions, validation warnings
// =============================================================================

describe("compile — safety & correctness", () => {
  let base: string;

  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-plugins-safety-"));
  });

  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  it("rejects an output_dir that escapes the repository", async () => {
    await writeSkill(base, "alpha");
    await expect(
      compilePlugins(base, makeSource(base), config({ output_dir: "../escape" }), ["claude"]),
    ).rejects.toThrow(/inside the repository/);
  });

  it("rejects an output_dir nested inside a source directory", async () => {
    await writeSkill(base, "alpha");
    await expect(
      compilePlugins(base, makeSource(base), config({ output_dir: "skills/generated" }), [
        "claude",
      ]),
    ).rejects.toThrow(/overlaps source content/);
  });

  it("rejects duplicate plugin definition names", async () => {
    await writeSkill(base, "alpha");
    await writeSkill(base, "beta");
    const cfg = config({
      definitions: [
        { name: "dup", skills: ["alpha"] },
        { name: "dup", skills: ["beta"] },
      ],
    });
    await expect(compilePlugins(base, makeSource(base), cfg, ["claude"])).rejects.toThrow(
      /Duplicate plugin definition name "dup"/,
    );
  });

  it("treats `?` in a selector as a literal, not a regex quantifier", async () => {
    await writeSkill(base, "alph");
    // `alpha?` as a regex quantifier would match "alph"; as a literal it does not.
    const cfg = config({ definitions: [{ name: "p", skills: ["alpha?"], agents: [], mcps: [] }] });
    const result = await compilePlugins(base, makeSource(base), cfg, ["claude"]);
    expect(result.plugins).toHaveLength(0);
    expect(result.warnings.join("\n")).toMatch(/selects no content/);
  });
});

describe("compile — Codex agent→skill YAML escaping", () => {
  let base: string;

  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-plugins-yaml-"));
    await writeSkill(base, "alpha");
  });

  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  it("produces valid YAML when a description has embedded quotes and a colon", async () => {
    // Embedded quote + colon: the colon forced quoting in the old serializer,
    // which then emitted `"Fixes "bug": now"` — invalid YAML. yamlScalar escapes it.
    const tricky = 'Fixes "bug": now';
    await fs.mkdir(path.join(base, "agents"), { recursive: true });
    await fs.writeFile(
      path.join(base, "agents", "reviewer.md"),
      `---\nname: reviewer\ndescription: ${tricky}\n---\n\nSystem prompt.\n`,
    );

    await compilePlugins(base, makeSource(base), config(), ["codex"]);

    const skillMd = await fs.readFile(
      path.join(base, "plugins", "codex", "acme-tools", "skills", "reviewer", "SKILL.md"),
      "utf-8",
    );
    // Frontmatter must parse as valid YAML and round-trip the description exactly.
    const fmText = skillMd.split("---")[1];
    const fm = parseYaml(fmText) as { name: string; description: string };
    expect(fm.name).toBe("reviewer");
    expect(fm.description).toBe(tricky);
  });

  it("kebab-cases an agent name into the Codex skill directory", async () => {
    await fs.mkdir(path.join(base, "agents"), { recursive: true });
    await fs.writeFile(
      path.join(base, "agents", "uirev.md"),
      "---\nname: UI Reviewer\ndescription: Reviews UI\n---\n\nPrompt.\n",
    );

    await compilePlugins(base, makeSource(base), config(), ["codex"]);

    const skillMd = await fs.readFile(
      path.join(base, "plugins", "codex", "acme-tools", "skills", "ui-reviewer", "SKILL.md"),
      "utf-8",
    );
    expect(skillMd).toContain("name: UI Reviewer");
  });

  it("warns and skips when a down-converted agent name collides with a skill", async () => {
    await writeSkill(base, "shared");
    await fs.mkdir(path.join(base, "agents"), { recursive: true });
    await fs.writeFile(
      path.join(base, "agents", "shared.md"),
      "---\nname: shared\ndescription: Agent named like a skill\n---\n\nAgent body.\n",
    );

    const result = await compilePlugins(base, makeSource(base), config(), ["codex"]);
    expect(result.warnings.join("\n")).toMatch(/collides with skill/);
    // The real skill survives (not overwritten by the agent body).
    const skillMd = await fs.readFile(
      path.join(base, "plugins", "codex", "acme-tools", "skills", "shared", "SKILL.md"),
      "utf-8",
    );
    expect(skillMd).toContain("The shared skill");
    expect(skillMd).not.toContain("Agent body.");
  });
});

describe("compile — MCP fidelity & validation warnings", () => {
  let base: string;

  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-plugins-mcp-"));
    await writeSkill(base, "alpha");
  });

  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  it("reproduces an HTTP MCP server faithfully under both wrapper keys", async () => {
    await writeMcp(base, "docs", {
      url: "https://example.com/mcp",
      bearer_token_env_var: "DOCS_TOKEN",
    });
    await compilePlugins(base, makeSource(base), config(), ["claude", "codex"]);

    const claude = await readJson(base, "plugins/claude/acme-tools/.mcp.json");
    expect((claude.mcpServers as Record<string, unknown>).docs).toEqual({
      url: "https://example.com/mcp",
      bearer_token_env_var: "DOCS_TOKEN",
    });
    const codex = await readJson(base, "plugins/codex/acme-tools/.mcp.json");
    expect((codex.mcp_servers as Record<string, unknown>).docs).toEqual({
      url: "https://example.com/mcp",
      bearer_token_env_var: "DOCS_TOKEN",
    });
  });

  it("aggregates and sorts multiple MCP servers in one .mcp.json", async () => {
    await writeMcp(base, "zed", { command: "z" });
    await writeMcp(base, "alpha-srv", { command: "a" });
    await compilePlugins(base, makeSource(base), config(), ["claude"]);

    const claude = await readJson(base, "plugins/claude/acme-tools/.mcp.json");
    expect(Object.keys(claude.mcpServers as Record<string, unknown>)).toEqual(["alpha-srv", "zed"]);
  });

  it("surfaces validation warnings for invalid MCP servers without failing", async () => {
    await writeMcp(base, "broken", { description: "no command or url" });
    const result = await compilePlugins(base, makeSource(base), config(), ["claude"]);
    expect(result.warnings.join("\n")).toMatch(/broken\.json/);
    // Compile still completes and emits the skill.
    expect(
      await exists(path.join(base, "plugins", "claude", "acme-tools", "skills", "alpha")),
    ).toBe(true);
  });

  it("surfaces a validation warning for an agent missing a description", async () => {
    await fs.mkdir(path.join(base, "agents"), { recursive: true });
    await fs.writeFile(path.join(base, "agents", "bad.md"), "---\nname: bad\n---\n\nPrompt.\n");
    const result = await compilePlugins(base, makeSource(base), config(), ["claude"]);
    expect(result.warnings.join("\n")).toMatch(/bad\.md/);
  });
});

describe("compile — optional metadata fields in output", () => {
  let base: string;

  beforeEach(async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), "agconf-plugins-meta-"));
    await writeSkill(base, "alpha");
  });

  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  it("propagates category/keywords/description and display_name into manifests + marketplaces", async () => {
    const cfg = PluginsConfigSchema.parse({
      version: "1.0.0",
      marketplace: {
        name: "acme-tools",
        owner: { name: "Acme Corp" },
        display_name: "Acme Tools",
        description: "All the tools",
      },
      definitions: [
        {
          name: "alpha-plugin",
          description: "Alpha things",
          category: "productivity",
          keywords: ["a", "b"],
          skills: ["alpha"],
        },
      ],
    });
    await compilePlugins(base, makeSource(base), cfg, ["claude", "codex"]);

    const claudeManifest = await readJson(
      base,
      "plugins/claude/alpha-plugin/.claude-plugin/plugin.json",
    );
    expect(claudeManifest.description).toBe("Alpha things");
    expect(claudeManifest.keywords).toEqual(["a", "b"]);

    const claudeMkt = await readJson(base, ".claude-plugin/marketplace.json");
    expect(claudeMkt.description).toBe("All the tools");
    const cEntry = (claudeMkt.plugins as Array<Record<string, unknown>>)[0];
    expect(cEntry?.category).toBe("productivity");
    expect(cEntry?.keywords).toEqual(["a", "b"]);

    const codexMkt = await readJson(base, path.join(".agents", "plugins", "marketplace.json"));
    expect(codexMkt.interface).toEqual({ displayName: "Acme Tools" });
    const xEntry = (codexMkt.plugins as Array<Record<string, unknown>>)[0];
    expect(xEntry?.category).toBe("productivity");
  });
});
