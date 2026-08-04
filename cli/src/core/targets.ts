export const SUPPORTED_TARGETS = ["claude", "codex"] as const;
export type Target = (typeof SUPPORTED_TARGETS)[number];

export interface TargetConfig {
  /** Directory name (e.g., ".claude", ".codex") */
  dir: string;
  /**
   * Directory (relative to the repo root) where this target's skills are
   * written. Note this is NOT always `${dir}/skills`: Claude discovers skills
   * under `.claude/skills`, but current Codex scans `.agents/skills` (walking
   * cwd → repo root) and does NOT look in `.codex/skills`. `dir` stays `.codex`
   * because Codex still uses it for other artifacts (e.g. `.codex/agents`).
   */
  skillsDir: string;
  /** Instructions file name if target needs one (only Claude uses this) */
  instructionsFile: string | null;
}

export const TARGET_CONFIGS: Record<Target, TargetConfig> = {
  claude: {
    dir: ".claude",
    skillsDir: ".claude/skills",
    instructionsFile: "CLAUDE.md",
  },
  codex: {
    dir: ".codex",
    skillsDir: ".agents/skills",
    instructionsFile: null, // Codex reads AGENTS.md directly
  },
};

export function isValidTarget(target: string): target is Target {
  return SUPPORTED_TARGETS.includes(target as Target);
}

export function parseTargets(input: string[]): Target[] {
  const targets: Target[] = [];
  for (const t of input) {
    // Support comma-separated values
    const parts = t.split(",").map((p) => p.trim().toLowerCase());
    for (const part of parts) {
      if (!isValidTarget(part)) {
        throw new Error(
          `Invalid target "${part}". Supported targets: ${SUPPORTED_TARGETS.join(", ")}`,
        );
      }
      if (!targets.includes(part)) {
        targets.push(part);
      }
    }
  }
  return targets.length > 0 ? targets : ["claude"];
}

export function getTargetConfig(target: Target): TargetConfig {
  return TARGET_CONFIGS[target];
}

/**
 * Resolve the skills directory (relative to the repo root) for a target.
 *
 * Accepts a loose `string` because several call sites operate on the untyped
 * `targets` arrays read from lockfiles. Known targets use their configured
 * `skillsDir`; anything else falls back to `.${target}/skills` (the historical
 * convention) so unexpected values degrade predictably rather than throwing.
 */
export function getSkillsDir(target: string): string {
  return isValidTarget(target) ? TARGET_CONFIGS[target].skillsDir : `.${target}/skills`;
}
