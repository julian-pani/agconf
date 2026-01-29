export const SUPPORTED_TARGETS = ["claude", "codex"] as const;
export type Target = (typeof SUPPORTED_TARGETS)[number];

export interface TargetConfig {
  /** Directory name (e.g., ".claude", ".codex") */
  dir: string;
  /** Instructions file name if target needs one (only Claude uses this) */
  instructionsFile: string | null;
}

export const TARGET_CONFIGS: Record<Target, TargetConfig> = {
  claude: {
    dir: ".claude",
    instructionsFile: "CLAUDE.md",
  },
  codex: {
    dir: ".codex",
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
