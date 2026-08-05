import * as fs from "node:fs/promises";
import * as path from "node:path";
import pc from "picocolors";
import { parseDocument } from "yaml";
import { loadCanonicalRepoConfig } from "../config/loader.js";
import type { PluginsConfig } from "../config/schema.js";
import {
  type BumpLevel,
  bumpSemver,
  type CompileResult,
  compilePlugins,
  fingerprintPlugins,
  PLUGIN_STATE_FILE,
  type PluginDrift,
  type PluginTarget,
  readPluginState,
  resolvePluginTargets,
  verifyPluginsFresh,
  writePluginState,
} from "../core/plugins.js";
import { type ResolvedSource, resolveLocalSource } from "../core/source.js";
import { createLogger } from "../utils/logger.js";

export interface CompileCommandOptions {
  /** Verify committed artifacts match source instead of writing (CI freshness gate). */
  check?: boolean | undefined;
  /**
   * Auto-bump the version of each plugin whose content changed since the last
   * bump, then compile. `true`/"auto" => patch; or "patch"/"minor"/"major".
   */
  bump?: string | boolean | undefined;
  /** Override which targets to compile (claude, codex). */
  target?: string[] | undefined;
  /** Override the output directory (defaults to plugins.output_dir). */
  out?: string | undefined;
  /** Minimal output, just exit code. */
  quiet?: boolean | undefined;
  /** Working directory (default: process.cwd()). For testability. */
  cwd?: string | undefined;
}

/** Normalize the `--bump` flag value into a concrete semver level. */
function resolveBumpLevel(bump: string | boolean): BumpLevel {
  const value = bump === true || bump === "auto" ? "patch" : bump;
  if (value !== "patch" && value !== "minor" && value !== "major") {
    throw new Error(`Invalid --bump value "${value}" (expected auto, patch, minor, or major)`);
  }
  return value;
}

/**
 * Compile installable Claude Code / Codex plugins and marketplace indexes from
 * the canonical repository's skills/agents/mcps. Run inside a canonical repo.
 *
 * `--check` recompiles to a temp dir and fails (exit 1) if the committed
 * artifacts are stale — the CI freshness gate. Without it, the artifacts are
 * (re)written into the repo.
 */
export async function compileCommand(options: CompileCommandOptions = {}): Promise<void> {
  const targetDir = options.cwd ?? process.cwd();
  const logger = createLogger(options.quiet);

  // Load canonical config; plugins must be configured.
  const canonicalConfig = await loadCanonicalRepoConfig(targetDir);
  if (!canonicalConfig) {
    logger.error("No agconf.yaml found. Run this inside a canonical repository.");
    process.exit(1);
  }
  if (!canonicalConfig.plugins) {
    logger.error(
      "No `plugins` block in agconf.yaml. Add one to enable plugin compilation (see docs/PLUGINS.md).",
    );
    process.exit(1);
  }

  // Apply CLI overrides to the plugins config.
  let pluginsConfig: PluginsConfig = canonicalConfig.plugins;
  if (options.out) pluginsConfig = { ...pluginsConfig, output_dir: options.out };
  if (options.target && options.target.length > 0) {
    pluginsConfig = { ...pluginsConfig, targets: options.target };
  }

  const { targets, warnings: targetWarnings } = resolvePluginTargets(
    pluginsConfig,
    canonicalConfig.targets,
  );
  for (const w of targetWarnings) logger.warn(w);

  if (targets.length === 0) {
    logger.error("No plugin-capable targets to compile (supported: claude, codex).");
    process.exit(1);
  }

  // Resolve the canonical source (validates instructions/AGENTS.md + skills/).
  let source: ResolvedSource;
  try {
    source = await resolveLocalSource({ path: targetDir });
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (options.check) {
    await runCheck(targetDir, source, pluginsConfig, targets, options.quiet);
    return;
  }

  if (options.bump) {
    let level: BumpLevel;
    try {
      level = resolveBumpLevel(options.bump);
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    await runBump(targetDir, source, pluginsConfig, targets, level, options.quiet);
    return;
  }

  await runCompile(targetDir, source, pluginsConfig, targets, options.quiet);
}

async function runCompile(
  targetDir: string,
  source: ResolvedSource,
  pluginsConfig: PluginsConfig,
  targets: PluginTarget[],
  quiet?: boolean,
): Promise<void> {
  const logger = createLogger(quiet);
  let result: CompileResult;
  try {
    result = await compilePlugins(targetDir, source, pluginsConfig, targets);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (quiet) return;

  console.log();
  console.log(pc.bold("agconf compile"));
  console.log();
  console.log(
    `Compiled ${pc.bold(String(result.plugins.length))} plugin artifact(s) for: ${targets.join(", ")}`,
  );
  console.log();
  for (const plugin of result.plugins) {
    const parts = [
      `${plugin.skills.length} skill(s)`,
      `${plugin.agents.length} agent(s)`,
      `${plugin.mcps.length} mcp(s)`,
    ];
    console.log(`  ${pc.green("+")} ${plugin.dir} ${pc.dim(`(${parts.join(", ")})`)}`);
  }
  console.log();
  console.log(pc.dim(`Marketplaces: ${result.marketplaceFiles.join(", ")}`));

  if (result.warnings.length > 0) {
    console.log();
    for (const w of result.warnings) logger.warn(w);
  }
  console.log();
  console.log(pc.dim("Commit the generated artifacts so they can be installed via git."));
  console.log();
}

async function runBump(
  targetDir: string,
  source: ResolvedSource,
  pluginsConfig: PluginsConfig,
  targets: PluginTarget[],
  level: BumpLevel,
  quiet?: boolean,
): Promise<void> {
  const logger = createLogger(quiet);

  let fingerprints: Record<string, string>;
  try {
    fingerprints = await fingerprintPlugins(source, pluginsConfig, targets);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const previous = await readPluginState(targetDir);

  // First run establishes a baseline (record fingerprints) without bumping.
  if (!previous) {
    await writePluginState(targetDir, { version: 1, fingerprints });
    await runCompile(targetDir, source, pluginsConfig, targets, quiet);
    if (!quiet) {
      console.log(
        pc.dim(`Initialized plugin fingerprint baseline (${PLUGIN_STATE_FILE}); no version bump.`),
      );
      console.log();
    }
    return;
  }

  // Content change = a plugin present at the last bump whose fingerprint differs
  // now. New plugins (absent from the baseline) are recorded, not bumped.
  const changedKeys = Object.keys(fingerprints).filter(
    (key) => key in previous.fingerprints && fingerprints[key] !== previous.fingerprints[key],
  );

  if (changedKeys.length === 0) {
    // Nothing changed — still (re)compile so artifacts stay fresh, but no bump.
    await runCompile(targetDir, source, pluginsConfig, targets, quiet);
    if (!quiet) {
      console.log(pc.dim("No plugin content changes since last bump; no version bump."));
      console.log();
    }
    return;
  }

  // Map changed "<target>/<name>" keys to unique plugin names (the version is
  // per-definition and shared across targets).
  const changedNames = [...new Set(changedKeys.map((key) => key.slice(key.indexOf("/") + 1)))];

  const definitions = pluginsConfig.definitions ?? [];
  const hasDefs = definitions.length > 0;
  const globalVersion = pluginsConfig.version ?? "0.0.0";

  const bumps: Array<{ name: string; from: string; to: string; index: number }> = [];
  for (const name of changedNames) {
    const index = hasDefs ? definitions.findIndex((d) => d.name === name) : -1;
    const from = index >= 0 ? (definitions[index]?.version ?? globalVersion) : globalVersion;
    let to: string;
    try {
      to = bumpSemver(from, level);
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    bumps.push({ name, from, to, index });
  }

  // Persist the new version(s) into agconf.yaml, preserving formatting/comments.
  const agconfPath = path.join(targetDir, "agconf.yaml");
  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(await fs.readFile(agconfPath, "utf-8"));
  } catch (error) {
    logger.error(
      `Failed to read agconf.yaml for bump: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
  for (const bump of bumps) {
    if (hasDefs && bump.index >= 0) {
      doc.setIn(["plugins", "definitions", bump.index, "version"], bump.to);
    } else {
      doc.setIn(["plugins", "version"], bump.to);
    }
  }
  await fs.writeFile(agconfPath, doc.toString(), "utf-8");

  // Build the bumped config in-memory (retains any CLI overrides) and recompile.
  let newConfig: PluginsConfig;
  if (hasDefs) {
    const toByName = new Map(bumps.map((b) => [b.name, b.to]));
    newConfig = {
      ...pluginsConfig,
      definitions: definitions.map((d) =>
        toByName.has(d.name) ? { ...d, version: toByName.get(d.name) } : d,
      ),
    };
  } else {
    newConfig = { ...pluginsConfig, version: bumps[0]?.to ?? globalVersion };
  }

  // Record the new fingerprints as the next baseline.
  await writePluginState(targetDir, { version: previous.version, fingerprints });

  try {
    await compilePlugins(targetDir, source, newConfig, targets);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (quiet) return;
  console.log();
  console.log(pc.bold("agconf compile --bump"));
  console.log();
  console.log(`Bumped ${pc.bold(String(bumps.length))} plugin(s) (${level}):`);
  for (const bump of bumps) {
    console.log(`  ${pc.green("↑")} ${bump.name}: ${pc.dim(bump.from)} → ${pc.bold(bump.to)}`);
  }
  console.log();
  console.log(pc.dim(`Updated agconf.yaml and ${PLUGIN_STATE_FILE}; recompiled artifacts.`));
  console.log(pc.dim("Commit the changes so consumers pick up the new version."));
  console.log();
}

async function runCheck(
  targetDir: string,
  source: ResolvedSource,
  pluginsConfig: PluginsConfig,
  targets: PluginTarget[],
  quiet?: boolean,
): Promise<void> {
  const logger = createLogger(quiet);
  let drift: PluginDrift;
  try {
    drift = await verifyPluginsFresh(targetDir, source, pluginsConfig, targets);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const hasDrift = drift.drifted.length > 0 || drift.missing.length > 0 || drift.extra.length > 0;

  if (!hasDrift) {
    if (!quiet) {
      console.log();
      console.log(`${pc.green("✓")} Compiled plugins are up to date`);
      console.log();
    }
    return;
  }

  if (quiet) {
    process.exit(1);
  }

  console.log();
  console.log(pc.bold("agconf compile --check"));
  console.log();
  console.log(
    `${pc.red("✗")} Compiled plugin artifacts are out of date with the canonical source.`,
  );
  console.log();
  printList("Stale (content differs)", drift.drifted);
  printList("Missing (expected but absent)", drift.missing);
  printList("Stale (no longer produced)", drift.extra);
  console.log(pc.dim("Run `agconf compile` and commit the result."));
  console.log();
  process.exit(1);
}

function printList(label: string, files: string[]): void {
  if (files.length === 0) return;
  console.log(`${pc.yellow(label)}:`);
  for (const f of files) {
    console.log(`  ${f.split(path.sep).join("/")}`);
  }
  console.log();
}
