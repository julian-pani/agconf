import { createClaudeTarget } from "./claude.js";
import { createCodexTarget } from "./codex.js";
import type { TargetAgent, TargetRegistry } from "./types.js";

/**
 * Default implementation of the target registry.
 */
class DefaultTargetRegistry implements TargetRegistry {
  private targets: Map<string, TargetAgent> = new Map();

  register(target: TargetAgent): void {
    if (this.targets.has(target.name)) {
      throw new Error(`Target '${target.name}' is already registered`);
    }
    this.targets.set(target.name, target);
  }

  getTarget(name: string): TargetAgent | undefined {
    return this.targets.get(name);
  }

  getTargets(): TargetAgent[] {
    return Array.from(this.targets.values());
  }

  getTargetNames(): string[] {
    return Array.from(this.targets.keys());
  }

  isValidTarget(name: string): boolean {
    return this.targets.has(name);
  }
}

/**
 * Create a new target registry with the default targets registered.
 */
export function createTargetRegistry(): TargetRegistry {
  const registry = new DefaultTargetRegistry();

  // Register built-in targets
  registry.register(createClaudeTarget());
  registry.register(createCodexTarget());

  return registry;
}

/**
 * Global default target registry instance.
 * Use this for convenience, or create your own registry for testing.
 */
let defaultRegistry: TargetRegistry | null = null;

/**
 * Get the default target registry.
 * Creates it lazily on first access.
 */
export function getDefaultTargetRegistry(): TargetRegistry {
  if (!defaultRegistry) {
    defaultRegistry = createTargetRegistry();
  }
  return defaultRegistry;
}

/**
 * Reset the default target registry.
 * Useful for testing.
 */
export function resetDefaultTargetRegistry(): void {
  defaultRegistry = null;
}

/**
 * Parse target names from user input.
 * Supports comma-separated values.
 */
export function parseTargetNames(
  input: string[],
  registry: TargetRegistry = getDefaultTargetRegistry(),
): string[] {
  const targets: string[] = [];
  const validNames = registry.getTargetNames();

  for (const t of input) {
    // Support comma-separated values
    const parts = t.split(",").map((p) => p.trim().toLowerCase());
    for (const part of parts) {
      if (!registry.isValidTarget(part)) {
        throw new Error(
          `Invalid target "${part}". Supported targets: ${validNames.join(", ")}`,
        );
      }
      if (!targets.includes(part)) {
        targets.push(part);
      }
    }
  }

  // Default to claude if no targets specified
  return targets.length > 0 ? targets : ["claude"];
}
