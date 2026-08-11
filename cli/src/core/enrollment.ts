/**
 * EXPERIMENTAL (Claude-only): plugin enrollment.
 *
 * Instead of syncing skills/agents into a downstream repo's `.claude/`, a repo
 * can *enroll* in a compiled marketplace by committing an
 * `extraKnownMarketplaces` + `enabledPlugins` block to `.claude/settings.json`.
 * When a collaborator trusts the repo, Claude Code prompts them to install the
 * declared plugins. This is the push/plugin analogue of `sync`, scoped per repo
 * and pinned by the marketplace `ref`.
 *
 * Codex has no project-scoped plugin enablement, so enrollment is Claude-only;
 * Codex consumers keep using `sync`.
 *
 * This module is pure/deterministic (plan → merge → verify) plus thin JSON I/O,
 * so `enroll` and `check` share the same logic.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import fg from "fast-glob";
import type { EnrollmentConfig } from "../config/schema.js";

/** The `extraKnownMarketplaces` entry value + the `enabledPlugins` ids to write. */
export interface EnrollmentPlan {
  marketplace: string;
  /** Value for `extraKnownMarketplaces[marketplace]`. */
  marketplaceEntry: { source: Record<string, string> };
  /** `<plugin>@<marketplace>` identifiers for `enabledPlugins`. */
  enabledPlugins: string[];
}

/** Build the deterministic enrollment plan from downstream config. */
export function buildEnrollmentPlan(config: EnrollmentConfig): EnrollmentPlan {
  const source: Record<string, string> = {
    source: "github",
    repo: config.source.repository,
  };
  if (config.source.ref) source.ref = config.source.ref;

  return {
    marketplace: config.marketplace,
    marketplaceEntry: { source },
    enabledPlugins: config.plugins.map((p) => `${p}@${config.marketplace}`),
  };
}

/**
 * Merge an enrollment plan into an existing `.claude/settings.json` object,
 * preserving every other key. `extraKnownMarketplaces` gains/updates only our
 * marketplace entry; `enabledPlugins` is a de-duped union (existing order kept,
 * new ids appended) so re-running enroll is idempotent.
 */
export function mergeEnrollment(
  existing: Record<string, unknown>,
  plan: EnrollmentPlan,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...existing };

  const priorMarketplaces =
    existing.extraKnownMarketplaces && typeof existing.extraKnownMarketplaces === "object"
      ? (existing.extraKnownMarketplaces as Record<string, unknown>)
      : {};
  result.extraKnownMarketplaces = {
    ...priorMarketplaces,
    [plan.marketplace]: plan.marketplaceEntry,
  };

  const priorPlugins = Array.isArray(existing.enabledPlugins)
    ? (existing.enabledPlugins as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  const merged = [...priorPlugins];
  for (const id of plan.enabledPlugins) {
    if (!merged.includes(id)) merged.push(id);
  }
  result.enabledPlugins = merged;

  return result;
}

/**
 * Verify a settings object satisfies an enrollment plan: the marketplace is
 * registered with the expected github source (repo + ref) and every enabled
 * plugin id is present. Returns human-readable problems (empty = OK).
 */
export function verifyEnrollment(
  existing: Record<string, unknown>,
  plan: EnrollmentPlan,
): string[] {
  const problems: string[] = [];

  const marketplaces =
    existing.extraKnownMarketplaces && typeof existing.extraKnownMarketplaces === "object"
      ? (existing.extraKnownMarketplaces as Record<string, unknown>)
      : {};
  const entry = marketplaces[plan.marketplace];

  if (!entry || typeof entry !== "object") {
    problems.push(`marketplace "${plan.marketplace}" is not registered in extraKnownMarketplaces`);
  } else {
    const source = (entry as { source?: unknown }).source;
    const expected = plan.marketplaceEntry.source;
    if (!source || typeof source !== "object") {
      problems.push(`marketplace "${plan.marketplace}" has no source`);
    } else {
      const s = source as Record<string, unknown>;
      if (s.repo !== expected.repo) {
        problems.push(
          `marketplace "${plan.marketplace}" repo is "${String(s.repo)}", expected "${expected.repo}"`,
        );
      }
      if ((s.ref ?? undefined) !== (expected.ref ?? undefined)) {
        problems.push(
          `marketplace "${plan.marketplace}" ref is "${String(s.ref)}", expected "${String(expected.ref)}"`,
        );
      }
    }
  }

  const enabled = Array.isArray(existing.enabledPlugins)
    ? (existing.enabledPlugins as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  for (const id of plan.enabledPlugins) {
    if (!enabled.includes(id)) problems.push(`plugin "${id}" is not in enabledPlugins`);
  }

  return problems;
}

// =============================================================================
// Settings file I/O
// =============================================================================

/** Read `<targetDir>/.claude/settings.json`, returning {} if absent. Throws on invalid JSON. */
export async function readClaudeSettings(targetDir: string): Promise<Record<string, unknown>> {
  const settingsPath = path.join(targetDir, ".claude", "settings.json");
  let content: string;
  try {
    content = await fs.readFile(settingsPath, "utf-8");
  } catch {
    return {};
  }
  const parsed = JSON.parse(content);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`.claude/settings.json is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

/** Write `<targetDir>/.claude/settings.json` (pretty JSON, trailing newline). */
export async function writeClaudeSettings(
  targetDir: string,
  settings: Record<string, unknown>,
): Promise<void> {
  const dir = path.join(targetDir, ".claude");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "settings.json"),
    `${JSON.stringify(settings, null, 2)}\n`,
    "utf-8",
  );
}

// =============================================================================
// Overlap warnings (best-effort, when the compiled canonical is available)
// =============================================================================

export interface PluginContents {
  name: string;
  skills: string[];
  agents: string[];
  mcps: string[];
}

/**
 * Read the compiled Claude plugin directories for the given plugin names from a
 * resolved canonical repo. `missing` lists requested names with no compiled dir.
 */
export async function readCompiledPluginContents(
  canonicalDir: string,
  outputDir: string,
  pluginNames: string[],
): Promise<{ contents: PluginContents[]; missing: string[] }> {
  const contents: PluginContents[] = [];
  const missing: string[] = [];

  for (const name of pluginNames) {
    const pluginDir = path.join(canonicalDir, outputDir, "claude", name);
    let exists = true;
    try {
      await fs.access(pluginDir);
    } catch {
      exists = false;
    }
    if (!exists) {
      missing.push(name);
      continue;
    }

    const skills = (
      await fg("*/", { cwd: path.join(pluginDir, "skills"), onlyDirectories: true, deep: 1 }).catch(
        () => [] as string[],
      )
    )
      .map((d) => d.replace(/\/$/, ""))
      .sort();

    const agents = (
      await fg("*.md", { cwd: path.join(pluginDir, "agents"), absolute: false }).catch(
        () => [] as string[],
      )
    )
      .map((f) => f.replace(/\.md$/i, ""))
      .sort();

    let mcps: string[] = [];
    try {
      const raw = await fs.readFile(path.join(pluginDir, ".mcp.json"), "utf-8");
      const parsed = JSON.parse(raw);
      const servers = parsed?.mcpServers;
      if (servers && typeof servers === "object") mcps = Object.keys(servers).sort();
    } catch {
      // No .mcp.json for this plugin.
    }

    contents.push({ name, skills, agents, mcps });
  }

  return { contents, missing };
}

/**
 * Warn when the enrolled set of plugins overlaps: duplicate skills/agents cost
 * context and are ambiguous; duplicate MCP server names risk a hard collision.
 */
export function overlapWarnings(contents: PluginContents[]): string[] {
  const warnings: string[] = [];

  const collect = (pick: (c: PluginContents) => string[]): Map<string, string[]> => {
    const map = new Map<string, string[]>();
    for (const c of contents) {
      for (const item of pick(c)) {
        const owners = map.get(item) ?? [];
        owners.push(c.name);
        map.set(item, owners);
      }
    }
    return map;
  };

  const report = (map: Map<string, string[]>, kind: string, severe: boolean): void => {
    for (const [item, owners] of [...map.entries()].sort()) {
      if (owners.length > 1) {
        const lead = severe ? "MCP server" : kind;
        warnings.push(
          `${lead} "${item}" is in multiple enabled plugins (${owners.join(", ")})${
            severe ? " — server names must be unique; this will likely collide" : ""
          }`,
        );
      }
    }
  };

  report(
    collect((c) => c.skills),
    "skill",
    false,
  );
  report(
    collect((c) => c.agents),
    "agent",
    false,
  );
  report(
    collect((c) => c.mcps),
    "mcp",
    true,
  );

  return warnings;
}
