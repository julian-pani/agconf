/**
 * Capabilities that a target agent may support.
 * Used to determine which features to sync for each target.
 */
export interface TargetCapabilities {
  /** Whether the target supports skills */
  skills: boolean;
  /** Whether the target supports sub-agents */
  subAgents: boolean;
  /** Whether the target supports hooks (pre-commit, etc.) */
  hooks: boolean;
  /** Whether the target supports @file references in instructions */
  fileReferences: boolean;
  /** Whether the target needs an instructions file that references AGENTS.md */
  instructionsFile: boolean;
}

/**
 * Configuration for a target agent.
 * This is the static configuration that defines how to sync to a target.
 */
export interface TargetConfig {
  /** Target directory name (e.g., ".claude", ".codex") */
  dir: string;
  /**
   * Instructions file name if target needs one (e.g., "CLAUDE.md").
   * If null, the target reads AGENTS.md directly.
   */
  instructionsFile: string | null;
  /**
   * Content to put in the instructions file.
   * Typically a reference to AGENTS.md like "@../AGENTS.md".
   * Only used if instructionsFile is set.
   */
  instructionsContent: string | null;
}

/**
 * Interface for target agents.
 * Targets represent AI coding agents that can consume synced content (Claude, Codex, etc.)
 */
export interface TargetAgent {
  /** Unique name of the target (e.g., "claude", "codex") */
  readonly name: string;
  /** Static configuration for the target */
  readonly config: TargetConfig;
  /** Capabilities supported by this target */
  readonly capabilities: TargetCapabilities;
}

/**
 * Result of syncing content to a target.
 */
export interface TargetSyncResult {
  /** The target that was synced */
  target: string;
  /** Number of skill files copied */
  skills: {
    copied: number;
  };
  /** Instructions file sync result */
  instructionsMd: {
    /** Whether a new instructions file was created */
    created: boolean;
    /** Whether an existing instructions file was updated */
    updated: boolean;
    /** Location of the instructions file */
    location: "root" | "target-dir";
    /** Whether content was merged from existing file into AGENTS.md */
    contentMerged: boolean;
  };
}

/**
 * Registry for target agents.
 */
export interface TargetRegistry {
  /**
   * Register a target agent.
   * @param target - The target to register
   */
  register(target: TargetAgent): void;

  /**
   * Get a target by name.
   * @param name - Target name
   * @returns The target, or undefined if not found
   */
  getTarget(name: string): TargetAgent | undefined;

  /**
   * Get all registered targets.
   */
  getTargets(): TargetAgent[];

  /**
   * Get all target names.
   */
  getTargetNames(): string[];

  /**
   * Check if a target is registered.
   */
  isValidTarget(name: string): boolean;
}
