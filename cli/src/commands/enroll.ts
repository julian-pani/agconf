import * as path from "node:path";
import pc from "picocolors";
import { loadCanonicalRepoConfig, loadDownstreamConfig } from "../config/loader.js";
import {
  buildEnrollmentPlan,
  mergeEnrollment,
  overlapWarnings,
  readClaudeSettings,
  readCompiledPluginContents,
  writeClaudeSettings,
} from "../core/enrollment.js";
import { createLogger } from "../utils/logger.js";

export interface EnrollCommandOptions {
  /** Path to the (compiled) canonical repo — enables overlap warnings for the enrolled set. */
  local?: string | undefined;
  /** Minimal output. */
  quiet?: boolean | undefined;
  /** Working directory (default: process.cwd()). For testability. */
  cwd?: string | undefined;
}

/**
 * EXPERIMENTAL (Claude-only): enroll this repo in a compiled plugin marketplace
 * by writing `extraKnownMarketplaces` + `enabledPlugins` into a committed
 * `.claude/settings.json`, per the `experimental.enrollment` block in
 * `.agconf/config.yaml`. Collaborators who trust the repo are then prompted by
 * Claude Code to install the declared plugins.
 */
export async function enrollCommand(options: EnrollCommandOptions = {}): Promise<void> {
  const targetDir = options.cwd ?? process.cwd();
  const logger = createLogger(options.quiet);

  let config: Awaited<ReturnType<typeof loadDownstreamConfig>>;
  try {
    config = await loadDownstreamConfig(targetDir);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  const enrollment = config?.experimental?.enrollment;
  if (!enrollment) {
    logger.error(
      "No `experimental.enrollment` block in .agconf/config.yaml. Add one to enroll in a plugin marketplace (see docs/PLUGINS.md).",
    );
    process.exit(1);
  }

  const plan = buildEnrollmentPlan(enrollment);
  const warnings: string[] = [];

  // Best-effort overlap detection: only possible with the compiled canonical.
  if (options.local) {
    const canonicalDir = path.resolve(options.local);
    const canonicalConfig = await loadCanonicalRepoConfig(canonicalDir).catch(() => undefined);
    const outputDir = canonicalConfig?.plugins?.output_dir ?? "plugins";
    const { contents, missing } = await readCompiledPluginContents(
      canonicalDir,
      outputDir,
      enrollment.plugins,
    );
    if (missing.length > 0) {
      warnings.push(`plugins not found in compiled canonical: ${missing.join(", ")}`);
    }
    warnings.push(...overlapWarnings(contents));
  }

  // Merge into the committed .claude/settings.json.
  let existing: Record<string, unknown>;
  try {
    existing = await readClaudeSettings(targetDir);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  const merged = mergeEnrollment(existing, plan);
  await writeClaudeSettings(targetDir, merged);

  if (options.quiet) return;

  console.log();
  console.log(pc.bold("agconf enroll"), pc.dim("(experimental)"));
  console.log();
  console.log(`Marketplace: ${pc.cyan(plan.marketplace)} ${pc.dim(sourceLabel(plan))}`);
  console.log(`Enabled plugins:`);
  for (const id of plan.enabledPlugins) console.log(`  ${pc.green("+")} ${id}`);
  console.log();
  console.log(
    pc.dim("Wrote .claude/settings.json — commit it so collaborators are prompted to install."),
  );

  if (warnings.length > 0) {
    console.log();
    for (const w of warnings) logger.warn(w);
  }
  console.log();
}

function sourceLabel(plan: { marketplaceEntry: { source: Record<string, string> } }): string {
  const { repo, ref } = plan.marketplaceEntry.source;
  return ref ? `(${repo}@${ref})` : `(${repo})`;
}
