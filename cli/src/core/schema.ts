/**
 * Schema versioning utilities for agent-conf.
 *
 * Schema versioning strategy:
 * - Schema version determines compatibility, not CLI version
 * - CLI refuses to work across major schema versions
 * - CLI warns but continues for minor version differences
 * - CLI version in lockfile is optional and for diagnostics only
 */

/**
 * The schema version this CLI understands.
 * This is the version of the lockfile/config schema format.
 */
export const SUPPORTED_SCHEMA_VERSION = "1.0.0";

export interface SchemaCompatibility {
  /** Whether the CLI can work with this schema version */
  compatible: boolean;
  /** Warning message for minor version differences (continue with warning) */
  warning?: string;
  /** Error message for major version incompatibility (refuse to proceed) */
  error?: string;
}

/**
 * Checks if the CLI can work with a given schema version.
 *
 * Compatibility rules:
 * - Same major version: compatible
 * - Content has newer minor/patch: warn (may miss features)
 * - Content has newer major: error (upgrade CLI needed)
 * - Content has older major: error (migration needed)
 *
 * @param contentVersion - The schema version from the lockfile or config
 * @returns Compatibility status with optional warning/error messages
 */
export function checkSchemaCompatibility(contentVersion: string): SchemaCompatibility {
  const contentParts = contentVersion.split(".").map(Number);
  const supportedParts = SUPPORTED_SCHEMA_VERSION.split(".").map(Number);

  const contentMajor = contentParts[0] ?? 0;
  const contentMinor = contentParts[1] ?? 0;
  const supportedMajor = supportedParts[0] ?? 0;
  const supportedMinor = supportedParts[1] ?? 0;

  // Major version mismatch = hard error
  if (contentMajor > supportedMajor) {
    return {
      compatible: false,
      error: `Schema version ${contentVersion} requires a newer CLI. Run: npm install -g agconf@latest`,
    };
  }

  if (contentMajor < supportedMajor) {
    return {
      compatible: false,
      error: `Schema version ${contentVersion} is outdated and no longer supported. This content was created with an older version of agent-conf.`,
    };
  }

  // Same major, but content has newer minor = warn (may miss features)
  if (contentMinor > supportedMinor) {
    return {
      compatible: true,
      warning: `Content uses schema ${contentVersion}, CLI supports ${SUPPORTED_SCHEMA_VERSION}. Some features may not work. Consider upgrading: npm install -g agconf@latest`,
    };
  }

  // Fully compatible (same major, same or older minor)
  return { compatible: true };
}

/**
 * Validates that a string is a valid semver format.
 *
 * @param version - The version string to validate
 * @returns true if the version is valid semver format
 */
export function isValidSemver(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}
