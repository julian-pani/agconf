/**
 * Plugin compilation: build installable Claude Code / Codex plugins and a
 * marketplace index FROM the canonical skills / agents / MCP servers.
 *
 * Unlike `sync` (which projects canonical content into a *downstream* repo's
 * `.claude/`), compilation is canonical-side and push-based: the artifacts are
 * committed into the canonical repo so consumers can install them directly via
 * `/plugin marketplace add <repo>` (Claude) or `codex plugin marketplace add
 * <repo>` (Codex) — no `sync` required.
 *
 * Design notes:
 * - Output is a PURE projection of source. No managed metadata is injected into
 *   published SKILL.md / agent files — they stay clean for consumers. Freshness
 *   is enforced by recompiling and diffing (see {@link verifyPluginsFresh}),
 *   not by per-file hashes.
 * - Targets get fully separate output subtrees (`<output_dir>/<target>/<name>`)
 *   so the Claude/Codex divergences never collide: Claude carries native
 *   `agents/`; Codex has no subagent plugin slot, so agents are down-converted
 *   to skills. Skills are duplicated per target — acceptable for generated,
 *   committed artifacts and keeps each tree independently valid.
 *
 * NOTE (Codex marketplace path resolution): Codex `local` plugin sources are
 * emitted as repo-root-relative paths (matching Claude's documented behavior).
 * If a future Codex release resolves them relative to the marketplace *file*
 * instead, only {@link marketplaceSourcePath} needs to change.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import fg from "fast-glob";
import type { PluginAuthor, PluginDefinition, PluginsConfig } from "../config/schema.js";
import { createTempDir, removeTempDir } from "../utils/fs.js";
import { type Agent, discoverAgents, validateAgentFrontmatter } from "./agents.js";
import { validateSkillFrontmatter } from "./managed-content.js";
import { discoverMcpServers, type McpServer, validateMcpServer } from "./mcp.js";
import type { ResolvedSource } from "./source.js";

// =============================================================================
// Targets
// =============================================================================

export const PLUGIN_TARGETS = ["claude", "codex"] as const;
export type PluginTarget = (typeof PLUGIN_TARGETS)[number];

interface PluginTargetSpec {
  /** Directory holding the per-plugin manifest (e.g. ".claude-plugin"). */
  manifestDir: string;
  /** Marketplace index path relative to the repo root. */
  marketplacePath: string;
  /** Output subdirectory under `output_dir` (e.g. "claude"). */
  outputSubdir: string;
  /** Whether the target natively bundles agents; Codex down-converts to skills. */
  supportsAgents: boolean;
  /** Top-level wrapper key for the aggregated `.mcp.json`. */
  mcpWrapperKey: string;
}

const PLUGIN_TARGET_SPECS: Record<PluginTarget, PluginTargetSpec> = {
  claude: {
    manifestDir: ".claude-plugin",
    marketplacePath: ".claude-plugin/marketplace.json",
    outputSubdir: "claude",
    supportsAgents: true,
    mcpWrapperKey: "mcpServers",
  },
  codex: {
    manifestDir: ".codex-plugin",
    marketplacePath: path.join(".agents", "plugins", "marketplace.json"),
    outputSubdir: "codex",
    supportsAgents: false,
    mcpWrapperKey: "mcp_servers",
  },
};

/** All file/directory roots compilation owns under the canonical repo. */
const MARKETPLACE_PATHS = Object.values(PLUGIN_TARGET_SPECS).map((s) => s.marketplacePath);

function isPluginTarget(value: string): value is PluginTarget {
  return (PLUGIN_TARGETS as readonly string[]).includes(value);
}

/**
 * Resolve which targets to compile plugins for: `plugins.targets` if set,
 * otherwise the canonical config's top-level `targets`. Unknown targets are
 * dropped with a warning (only Claude/Codex support plugins).
 */
export function resolvePluginTargets(
  config: PluginsConfig,
  canonicalTargets: string[],
): { targets: PluginTarget[]; warnings: string[] } {
  const requested = config.targets ?? canonicalTargets;
  const targets: PluginTarget[] = [];
  const warnings: string[] = [];
  for (const t of requested) {
    if (isPluginTarget(t)) {
      if (!targets.includes(t)) targets.push(t);
    } else {
      warnings.push(`Target "${t}" does not support plugins; skipping.`);
    }
  }
  return { targets, warnings };
}

// =============================================================================
// Result types
// =============================================================================

export interface CompiledPlugin {
  name: string;
  target: PluginTarget;
  /** Plugin directory relative to the output root. */
  dir: string;
  /** Skill names bundled (real skills). */
  skills: string[];
  /** Agent names bundled (native for Claude, down-converted to skills for Codex). */
  agents: string[];
  /** MCP server names bundled. */
  mcps: string[];
}

export interface CompileResult {
  plugins: CompiledPlugin[];
  /** Marketplace index files written, relative to the output root. */
  marketplaceFiles: string[];
  /** Every file written, relative to the output root (for freshness diffing). */
  writtenFiles: string[];
  /** Non-fatal issues (validation problems, down-conversions, name collisions). */
  warnings: string[];
}

export interface PluginDrift {
  /** Files compile produced whose on-disk content differs. */
  drifted: string[];
  /** Files compile would write that are absent on disk. */
  missing: string[];
  /** Files under managed roots on disk that compile did NOT produce (stale). */
  extra: string[];
}

// =============================================================================
// Selectors
// =============================================================================

/** Compile a selector (exact name or `*` glob) into an anchored RegExp.
 * Only `*` is a wildcard; every other regex metacharacter (incl. `?`) is
 * escaped to a literal so selectors behave as advertised. */
function selectorToRegExp(selector: string): RegExp {
  const escaped = selector.replace(/[.+^${}()|[\]\\?]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Apply selector semantics: `undefined` -> all items; otherwise keep items
 * whose name matches any selector (empty array -> none).
 */
function selectByName<T>(
  items: T[],
  nameOf: (item: T) => string,
  selectors: string[] | undefined,
): T[] {
  if (selectors === undefined) return items;
  const regexes = selectors.map(selectorToRegExp);
  return items.filter((item) => regexes.some((re) => re.test(nameOf(item))));
}

// =============================================================================
// Canonical content discovery
// =============================================================================

interface CanonicalContent {
  /** Skill directory names (e.g. "react-patterns"). */
  skills: string[];
  agents: Agent[];
  mcps: McpServer[];
}

async function discoverSkillNames(skillsPath: string): Promise<string[]> {
  try {
    const dirs = await fg("*/", { cwd: skillsPath, onlyDirectories: true, deep: 1 });
    return dirs.map((d) => d.replace(/\/$/, "")).sort();
  } catch {
    return [];
  }
}

async function discoverContent(source: ResolvedSource): Promise<CanonicalContent> {
  const skills = await discoverSkillNames(source.skillsPath);
  const agents = source.agentsPath ? await discoverAgents(source.agentsPath) : [];
  const mcps = source.mcpsPath ? await discoverMcpServers(source.mcpsPath) : [];
  return { skills, agents, mcps };
}

/** The display name of an agent (frontmatter `name`, else filename stem). */
function agentName(agent: Agent): string {
  const fmName = agent.frontmatter?.name;
  if (typeof fmName === "string" && fmName.trim()) return fmName.trim();
  return path.basename(agent.relativePath).replace(/\.md$/i, "");
}

/** Sanitize a name into a kebab-case skill directory name. */
function toSkillDirName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "agent";
}

// =============================================================================
// Manifest + marketplace generation
// =============================================================================

/** Deterministic JSON: 2-space indent, trailing newline, caller-controlled key order. */
function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function claudePluginManifest(
  def: PluginDefinition,
  version: string,
  hasMcp: boolean,
): Record<string, unknown> {
  // Claude auto-discovers root skills/ and agents/, so we only declare extras.
  const manifest: Record<string, unknown> = { name: def.name, version };
  if (def.description) manifest.description = def.description;
  if (def.keywords && def.keywords.length > 0) manifest.keywords = def.keywords;
  if (hasMcp) manifest.mcpServers = "./.mcp.json";
  return manifest;
}

function codexPluginManifest(
  def: PluginDefinition,
  version: string,
  hasSkills: boolean,
  hasMcp: boolean,
): Record<string, unknown> {
  // Codex requires explicit component pointers.
  const manifest: Record<string, unknown> = { name: def.name, version };
  if (def.description) manifest.description = def.description;
  if (def.keywords && def.keywords.length > 0) manifest.keywords = def.keywords;
  if (hasSkills) manifest.skills = "./skills/";
  if (hasMcp) manifest.mcpServers = "./.mcp.json";
  return manifest;
}

/** Repo-root-relative source path for a plugin dir (POSIX separators for manifests). */
function marketplaceSourcePath(
  outputDir: string,
  outputSubdir: string,
  pluginName: string,
): string {
  const rel = path.posix.join(outputDir.split(path.sep).join("/"), outputSubdir, pluginName);
  return `./${rel}`;
}

interface MarketplaceEntryInput {
  def: PluginDefinition;
  version: string;
  sourcePath: string;
}

function claudeMarketplace(
  config: PluginsConfig,
  entries: MarketplaceEntryInput[],
): Record<string, unknown> {
  const { marketplace } = config;
  const owner = marketplace.owner ? buildAuthor(marketplace.owner) : { name: marketplace.name };
  const result: Record<string, unknown> = { name: marketplace.name, owner };
  if (marketplace.description) result.description = marketplace.description;
  result.plugins = entries.map(({ def, version, sourcePath }) => {
    const entry: Record<string, unknown> = { name: def.name, source: sourcePath };
    if (def.description) entry.description = def.description;
    entry.version = version;
    if (def.category) entry.category = def.category;
    if (def.keywords && def.keywords.length > 0) entry.keywords = def.keywords;
    return entry;
  });
  return result;
}

function codexMarketplace(
  config: PluginsConfig,
  entries: MarketplaceEntryInput[],
): Record<string, unknown> {
  const { marketplace } = config;
  const result: Record<string, unknown> = {
    name: marketplace.name,
    interface: { displayName: marketplace.display_name ?? marketplace.name },
  };
  if (marketplace.description) result.description = marketplace.description;
  result.plugins = entries.map(({ def, version, sourcePath }) => {
    const entry: Record<string, unknown> = {
      name: def.name,
      source: { source: "local", path: sourcePath },
    };
    if (def.description) entry.description = def.description;
    entry.version = version;
    if (def.category) entry.category = def.category;
    entry.policy = { installation: "AVAILABLE", authentication: "ON_INSTALL" };
    return entry;
  });
  return result;
}

function buildAuthor(author: PluginAuthor): Record<string, string> {
  const result: Record<string, string> = { name: author.name };
  if (author.email) result.email = author.email;
  if (author.url) result.url = author.url;
  return result;
}

// =============================================================================
// File writing helpers
// =============================================================================

async function writeFileRecording(
  outRoot: string,
  relPath: string,
  content: string,
  written: string[],
): Promise<void> {
  const fullPath = path.join(outRoot, relPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");
  written.push(relPath);
}

/** Recursively copy a source directory into `<outRoot>/<destRel>`, recording each file. */
async function copyDirRecording(
  srcDir: string,
  outRoot: string,
  destRel: string,
  written: string[],
): Promise<void> {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  await fs.mkdir(path.join(outRoot, destRel), { recursive: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const childRel = path.join(destRel, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecording(srcPath, outRoot, childRel, written);
    } else {
      const fullDest = path.join(outRoot, childRel);
      await fs.copyFile(srcPath, fullDest);
      written.push(childRel);
    }
  }
}

// =============================================================================
// Compilation
// =============================================================================

/** Resolve plugin definitions: explicit list, or a synthesized "everything" plugin. */
function resolveDefinitions(config: PluginsConfig): PluginDefinition[] {
  if (config.definitions && config.definitions.length > 0) {
    return config.definitions;
  }
  const def: PluginDefinition = { name: config.marketplace.name };
  if (config.marketplace.description) def.description = config.marketplace.description;
  return [def];
}

/** Reject duplicate plugin names — they would overwrite each other's output dir
 * and produce conflicting marketplace entries. */
function assertUniqueDefinitionNames(definitions: PluginDefinition[]): void {
  const seen = new Set<string>();
  for (const def of definitions) {
    if (seen.has(def.name)) {
      throw new Error(`Duplicate plugin definition name "${def.name}" in plugins.definitions`);
    }
    seen.add(def.name);
  }
}

/**
 * Compile plugins for the given targets into `outRoot`. Pure projection — does
 * not clean pre-existing files (callers that need a clean tree should clear the
 * managed roots first; {@link compilePlugins} does this for real builds).
 */
export async function compilePluginsToDir(
  outRoot: string,
  source: ResolvedSource,
  config: PluginsConfig,
  targets: PluginTarget[],
): Promise<CompileResult> {
  const written: string[] = [];
  const warnings: string[] = [];
  const marketplaceFiles: string[] = [];
  const compiled: CompiledPlugin[] = [];

  const content = await discoverContent(source);
  const definitions = resolveDefinitions(config);
  assertUniqueDefinitionNames(definitions);
  const version = config.version ?? "0.0.0";

  // Validate canonical content once; surface issues as warnings (compile is
  // best-effort, the freshness check / CI is the gate).
  for (const agent of content.agents) {
    const err = validateAgentFrontmatter(agent.rawContent, agent.relativePath);
    if (err) warnings.push(`agent ${err.agentPath}: ${err.errors.join(", ")}`);
  }
  for (const server of content.mcps) {
    const err = validateMcpServer(rebuildMcpFile(server), server.relativePath);
    if (err) warnings.push(`mcp ${err.mcpPath}: ${err.errors.join(", ")}`);
  }

  for (const target of targets) {
    const spec = PLUGIN_TARGET_SPECS[target];
    const entries: MarketplaceEntryInput[] = [];

    for (const def of definitions) {
      const selectedSkills = selectByName(content.skills, (s) => s, def.skills);
      const selectedAgents = selectByName(content.agents, agentName, def.agents);
      const selectedMcps = selectByName(content.mcps, (m) => m.name, def.mcps);

      if (selectedSkills.length === 0 && selectedAgents.length === 0 && selectedMcps.length === 0) {
        warnings.push(`plugin "${def.name}" (${target}) selects no content; skipping.`);
        continue;
      }

      const pluginVersion = def.version ?? version;
      const pluginRel = path.join(config.output_dir, spec.outputSubdir, def.name);

      // Skills (verbatim copy, no metadata injection).
      const skillDirNames = new Set<string>();
      for (const skillName of selectedSkills) {
        const srcSkillDir = path.join(source.skillsPath, skillName);
        const skillMd = path.join(srcSkillDir, "SKILL.md");
        try {
          const skillContent = await fs.readFile(skillMd, "utf-8");
          const err = validateSkillFrontmatter(skillContent, skillName, skillMd);
          if (err) warnings.push(`skill ${skillName}: ${err.errors.join(", ")}`);
        } catch {
          warnings.push(`skill ${skillName}: missing SKILL.md; skipping.`);
          continue;
        }
        await copyDirRecording(
          srcSkillDir,
          outRoot,
          path.join(pluginRel, "skills", skillName),
          written,
        );
        skillDirNames.add(skillName);
      }

      // Agents: native for Claude, down-converted to skills for Codex.
      const agentNames: string[] = [];
      for (const agent of selectedAgents) {
        const name = agentName(agent);
        agentNames.push(name);
        if (spec.supportsAgents) {
          await writeFileRecording(
            outRoot,
            path.join(pluginRel, "agents", agent.relativePath),
            agent.rawContent,
            written,
          );
        } else {
          const dirName = toSkillDirName(name);
          if (skillDirNames.has(dirName)) {
            warnings.push(
              `plugin "${def.name}" (${target}): agent "${name}" collides with skill "${dirName}"; skipping agent.`,
            );
            continue;
          }
          skillDirNames.add(dirName);
          await writeFileRecording(
            outRoot,
            path.join(pluginRel, "skills", dirName, "SKILL.md"),
            agentToSkillMd(agent, name),
            written,
          );
        }
      }

      // MCP servers aggregated into a target-appropriate .mcp.json.
      if (selectedMcps.length > 0) {
        const servers: Record<string, unknown> = {};
        for (const server of [...selectedMcps].sort((a, b) => a.name.localeCompare(b.name))) {
          servers[server.name] = server.config;
        }
        await writeFileRecording(
          outRoot,
          path.join(pluginRel, ".mcp.json"),
          stableJson({ [spec.mcpWrapperKey]: servers }),
          written,
        );
      }

      // Plugin manifest.
      const hasMcp = selectedMcps.length > 0;
      const hasSkills = skillDirNames.size > 0;
      const manifest = spec.supportsAgents
        ? claudePluginManifest(def, pluginVersion, hasMcp)
        : codexPluginManifest(def, pluginVersion, hasSkills, hasMcp);
      await writeFileRecording(
        outRoot,
        path.join(pluginRel, spec.manifestDir, "plugin.json"),
        stableJson(manifest),
        written,
      );

      entries.push({
        def,
        version: pluginVersion,
        sourcePath: marketplaceSourcePath(config.output_dir, spec.outputSubdir, def.name),
      });
      compiled.push({
        name: def.name,
        target,
        dir: pluginRel,
        skills: selectedSkills,
        agents: agentNames,
        mcps: selectedMcps.map((m) => m.name),
      });
    }

    // Marketplace index for this target (always emitted when plugins configured).
    const marketplace = spec.supportsAgents
      ? claudeMarketplace(config, entries)
      : codexMarketplace(config, entries);
    await writeFileRecording(outRoot, spec.marketplacePath, stableJson(marketplace), written);
    marketplaceFiles.push(spec.marketplacePath);
  }

  written.sort();
  return {
    plugins: compiled,
    marketplaceFiles,
    writtenFiles: written,
    warnings: [...new Set(warnings)],
  };
}

/**
 * Emit a YAML scalar that is always valid: a bare token when safe, otherwise a
 * JSON-encoded (correctly-escaped) double-quoted scalar. JSON string syntax is a
 * subset of YAML's flow double-quoted scalar, so this round-trips through any
 * compliant YAML parser (which is what consumes the published SKILL.md).
 */
function yamlScalar(value: string): string {
  // Bare only for simple, unambiguous tokens; quote everything else.
  if (/^[A-Za-z0-9][\w .,/()-]*$/.test(value) && !/^\s|\s$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

/** Down-convert an agent to a Codex skill (name + description frontmatter, agent body). */
function agentToSkillMd(agent: Agent, name: string): string {
  const description =
    typeof agent.frontmatter?.description === "string" ? agent.frontmatter.description : "";
  const body = agent.body.startsWith("\n") ? agent.body.slice(1) : agent.body;
  return `---\nname: ${yamlScalar(name)}\ndescription: ${yamlScalar(description)}\n---\n\n${body}`;
}

/** Reconstruct the raw on-disk JSON for an MCP server (for validation messages). */
function rebuildMcpFile(server: McpServer): string {
  return JSON.stringify({ name: server.name, ...server.config });
}

// =============================================================================
// Real compile (writes into the canonical repo, cleaning stale artifacts first)
// =============================================================================

/** True when `child` is `parent` or lies inside it (resolved paths). */
function isInsideOrEqual(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Throw unless `output_dir` is a dedicated directory strictly inside the repo:
 * - never the repo root
 * - never escaping the repo (e.g. `..`, absolute paths) — `cleanManagedRoots`
 *   does a recursive delete on it, so an escaping path would `rm -rf` outside
 *   the repo
 * - never overlapping a source dir in EITHER direction (output inside a source
 *   dir, or a source dir inside output)
 */
function assertSafeOutputDir(
  config: PluginsConfig,
  source: ResolvedSource,
  targetDir: string,
): void {
  const repo = path.resolve(targetDir);
  const out = path.resolve(targetDir, config.output_dir);
  const rel = path.relative(repo, out);

  if (rel === "") {
    throw new Error(`plugins.output_dir must not be the repo root`);
  }
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`plugins.output_dir "${config.output_dir}" must stay inside the repository`);
  }

  // Content directories we read from / would clobber: forbid overlap either way.
  const contentDirs = [source.skillsPath, source.rulesPath, source.agentsPath, source.mcpsPath];
  for (const d of contentDirs) {
    if (!d) continue;
    const resolved = path.resolve(d);
    if (isInsideOrEqual(out, resolved) || isInsideOrEqual(resolved, out)) {
      throw new Error(
        `plugins.output_dir "${config.output_dir}" overlaps source content; choose a dedicated directory`,
      );
    }
  }
  // The global instructions file must not sit inside the output dir (it would be
  // wiped by the pre-compile clean). Its parent need not be a dedicated dir.
  if (isInsideOrEqual(path.resolve(source.agentsMdPath), out)) {
    throw new Error(
      `plugins.output_dir "${config.output_dir}" overlaps source content; choose a dedicated directory`,
    );
  }
}

/** Remove all managed output roots so a real compile leaves no stale files. */
async function cleanManagedRoots(targetDir: string, outputDir: string): Promise<void> {
  await fs.rm(path.join(targetDir, outputDir), { recursive: true, force: true });
  for (const mp of MARKETPLACE_PATHS) {
    await fs.rm(path.join(targetDir, mp), { force: true });
  }
  // Prune now-empty marketplace parent dirs (.claude-plugin, .agents/plugins, .agents).
  for (const dir of [".claude-plugin", path.join(".agents", "plugins"), ".agents"]) {
    await fs.rmdir(path.join(targetDir, dir)).catch(() => {});
  }
}

/**
 * Compile plugins for real into the canonical repo at `targetDir`, replacing
 * any previously-compiled artifacts. Returns the {@link CompileResult}.
 */
export async function compilePlugins(
  targetDir: string,
  source: ResolvedSource,
  config: PluginsConfig,
  targets: PluginTarget[],
): Promise<CompileResult> {
  assertSafeOutputDir(config, source, targetDir);
  await cleanManagedRoots(targetDir, config.output_dir);
  return compilePluginsToDir(targetDir, source, config, targets);
}

// =============================================================================
// Freshness verification (recompile to temp + diff against committed artifacts)
// =============================================================================

/**
 * Verify that the committed artifacts under `targetDir` match what compilation
 * would produce now. Recompiles to a temp dir and diffs the trees:
 * - `missing`: a file compile would write that is absent on disk
 * - `drifted`: a file whose on-disk bytes differ from freshly compiled
 * - `extra`: a file under a managed root on disk that compile did NOT produce
 */
export async function verifyPluginsFresh(
  targetDir: string,
  source: ResolvedSource,
  config: PluginsConfig,
  targets: PluginTarget[],
): Promise<PluginDrift> {
  assertSafeOutputDir(config, source, targetDir);

  const tempRoot = await createTempDir("agconf-compile-");
  try {
    const result = await compilePluginsToDir(tempRoot, source, config, targets);
    const writtenSet = new Set(result.writtenFiles);

    const drifted: string[] = [];
    const missing: string[] = [];

    for (const rel of result.writtenFiles) {
      const fresh = await fs.readFile(path.join(tempRoot, rel));
      let onDisk: Buffer;
      try {
        onDisk = await fs.readFile(path.join(targetDir, rel));
      } catch {
        missing.push(rel);
        continue;
      }
      if (!fresh.equals(onDisk)) drifted.push(rel);
    }

    // Extra: any file under a managed root on disk that compile did not write.
    const onDiskManaged = await listManagedFiles(targetDir, config.output_dir);
    const extra = onDiskManaged.filter((rel) => !writtenSet.has(rel));

    drifted.sort();
    missing.sort();
    extra.sort();
    return { drifted, missing, extra };
  } finally {
    await removeTempDir(tempRoot);
  }
}

/** Enumerate every file under the managed roots (output_dir + marketplace files). */
async function listManagedFiles(targetDir: string, outputDir: string): Promise<string[]> {
  const files: string[] = [];

  const outFiles = await fg("**/*", {
    cwd: path.join(targetDir, outputDir),
    onlyFiles: true,
    dot: true,
  }).catch(() => [] as string[]);
  for (const f of outFiles) {
    files.push(path.join(outputDir, f.split("/").join(path.sep)));
  }

  for (const mp of MARKETPLACE_PATHS) {
    try {
      await fs.access(path.join(targetDir, mp));
      files.push(mp);
    } catch {
      // Not present — nothing to flag.
    }
  }

  return files;
}
