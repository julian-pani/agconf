import { createGitHubProvider } from "./github.js";
import { createLocalProvider } from "./local.js";
import type { SourceProvider, SourceProviderRegistry } from "./types.js";

/**
 * Default implementation of the source provider registry.
 */
class DefaultSourceProviderRegistry implements SourceProviderRegistry {
  private providers: SourceProvider[] = [];

  register(provider: SourceProvider): void {
    // Check for duplicate names
    const existing = this.providers.find((p) => p.name === provider.name);
    if (existing) {
      throw new Error(`Provider with name '${provider.name}' is already registered`);
    }
    this.providers.push(provider);
  }

  getProvider(source: string): SourceProvider | undefined {
    return this.providers.find((p) => p.canHandle(source));
  }

  getProviders(): SourceProvider[] {
    return [...this.providers];
  }
}

/**
 * Create a new provider registry with the default providers registered.
 */
export function createProviderRegistry(): SourceProviderRegistry {
  const registry = new DefaultSourceProviderRegistry();

  // Register built-in providers
  // Local provider should be checked first (for explicit paths)
  registry.register(createLocalProvider());
  registry.register(createGitHubProvider());

  return registry;
}

/**
 * Global default provider registry instance.
 * Use this for convenience, or create your own registry for testing.
 */
let defaultRegistry: SourceProviderRegistry | null = null;

/**
 * Get the default provider registry.
 * Creates it lazily on first access.
 */
export function getDefaultProviderRegistry(): SourceProviderRegistry {
  if (!defaultRegistry) {
    defaultRegistry = createProviderRegistry();
  }
  return defaultRegistry;
}

/**
 * Reset the default provider registry.
 * Useful for testing.
 */
export function resetDefaultProviderRegistry(): void {
  defaultRegistry = null;
}
