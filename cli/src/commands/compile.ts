import * as path from "node:path";
import pc from "picocolors";
import { loadCanonicalRepoConfig } from "../config/loader.js";
import type { PluginsConfig } from "../config/schema.js";
import {
  type CompileResult,
  compilePlugins,
  type PluginDrift,
  type PluginTarget,
  resolvePluginTargets,
  verifyPluginsFresh,
} from "../core/plugins.js";
import { type ResolvedSource, resolveLocalSource } from "../core/source.js";
import { createLogger } from "../utils/logger.js";

export interface CompileCommandOptions {
  /** Verify committed artifacts match source instead of writing (CI freshness gate). */
  check?: boolean | undefined;
  /** Override which targets to compile (claude, codex). */
  target?: string[] | undefined;
  /** Override the output directory (defaults to plugins.output_dir). */
  out?: string | undefined;
  /** Minimal output, just exit code. */
  quiet?: boolean | undefined;
  /** Working directory (default: process.cwd()). For testability. */
  cwd?: string | undefined;
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
