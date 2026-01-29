import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ResolvedConfig } from "../config/schema.js";

// Default values for hook configuration
const DEFAULT_CLI_NAME = "agent-conf";
const DEFAULT_CONFIG_DIR = ".agent-conf";
const DEFAULT_LOCKFILE_NAME = "lockfile.json";

// Hook identifier for detecting managed hooks
const HOOK_IDENTIFIER = "# agent-conf pre-commit hook";

/**
 * Configuration for hook generation.
 */
export interface HookConfig {
  /** CLI command name (e.g., "agent-conf") */
  cliName: string;
  /** Config directory name (e.g., ".agent-conf") */
  configDir: string;
  /** Lockfile name (e.g., "lockfile.json") */
  lockfileName: string;
}

/**
 * Generate pre-commit hook content with configurable names.
 */
export function generatePreCommitHook(config: HookConfig): string {
  const { cliName, configDir, lockfileName } = config;

  return `#!/bin/bash
# ${cliName} pre-commit hook
# Prevents committing changes to managed files (skills and AGENTS.md global block)
#
# Installation:
#   Copy this file to .git/hooks/pre-commit
#   Or run: ${cliName} hooks install

set -e

# Get the repository root
REPO_ROOT=$(git rev-parse --show-toplevel)

# Check if ${cliName} has been synced
if [ ! -f "$REPO_ROOT/${configDir}/${lockfileName}" ]; then
    # Not synced, nothing to check
    exit 0
fi

# Check if ${cliName} CLI is available
if ! command -v ${cliName} &> /dev/null; then
    # CLI not installed, skip check
    exit 0
fi

# Run ${cliName} check and capture output
cd "$REPO_ROOT"
CHECK_OUTPUT=$(${cliName} check 2>&1) || CHECK_EXIT=$?
CHECK_EXIT=\${CHECK_EXIT:-0}

if [ $CHECK_EXIT -ne 0 ]; then
    echo ""
    echo "Error: Cannot commit changes to ${cliName}-managed files"
    echo ""
    echo "Output from '${cliName} check' command:"
    echo "$CHECK_OUTPUT"
    echo ""
    echo "Options:"
    echo "  1. Discard your changes: git checkout -- <file>"
    echo "  2. Skip this check: git commit --no-verify"
    echo "  3. Restore managed files: ${cliName} sync"
    echo "  4. For AGENTS.md: edit only the repo-specific block (between repo:start and repo:end)"
    echo "  5. For skills: create a new custom skill instead"
    echo ""
    exit 1
fi

exit 0
`;
}

/**
 * Get hook config from resolved config or use defaults.
 */
export function getHookConfig(config?: Partial<ResolvedConfig>): HookConfig {
  return {
    cliName: config?.cliName ?? DEFAULT_CLI_NAME,
    configDir: config?.configDir ?? DEFAULT_CONFIG_DIR,
    lockfileName: config?.lockfileName ?? DEFAULT_LOCKFILE_NAME,
  };
}

export interface HookInstallResult {
  installed: boolean;
  path: string;
  alreadyExisted: boolean;
  wasUpdated: boolean;
}

/**
 * Install the pre-commit hook in a git repository.
 * If a pre-commit hook already exists and is not from agent-conf, it will not be overwritten.
 */
export async function installPreCommitHook(
  targetDir: string,
  config?: Partial<ResolvedConfig>,
): Promise<HookInstallResult> {
  const hookConfig = getHookConfig(config);
  const hooksDir = path.join(targetDir, ".git", "hooks");
  const hookPath = path.join(hooksDir, "pre-commit");

  // Generate hook content
  const hookContent = generatePreCommitHook(hookConfig);

  // Ensure hooks directory exists
  await fs.mkdir(hooksDir, { recursive: true });

  // Check if hook already exists
  let existingContent: string | null = null;
  try {
    existingContent = await fs.readFile(hookPath, "utf-8");
  } catch {
    // Hook doesn't exist
  }

  if (existingContent !== null) {
    // Check if it's our hook (contains our identifier)
    const isOurHook = existingContent.includes(HOOK_IDENTIFIER);

    if (!isOurHook) {
      // Not our hook, don't overwrite
      return {
        installed: false,
        path: hookPath,
        alreadyExisted: true,
        wasUpdated: false,
      };
    }

    // Check if content is the same
    if (existingContent === hookContent) {
      return {
        installed: true,
        path: hookPath,
        alreadyExisted: true,
        wasUpdated: false,
      };
    }

    // Our hook but outdated, update it
    await fs.writeFile(hookPath, hookContent, { mode: 0o755 });
    return {
      installed: true,
      path: hookPath,
      alreadyExisted: true,
      wasUpdated: true,
    };
  }

  // Install new hook
  await fs.writeFile(hookPath, hookContent, { mode: 0o755 });
  return {
    installed: true,
    path: hookPath,
    alreadyExisted: false,
    wasUpdated: false,
  };
}

/**
 * Check if the pre-commit hook is installed.
 */
export async function isPreCommitHookInstalled(targetDir: string): Promise<boolean> {
  const hookPath = path.join(targetDir, ".git", "hooks", "pre-commit");

  try {
    const content = await fs.readFile(hookPath, "utf-8");
    return content.includes(HOOK_IDENTIFIER);
  } catch {
    return false;
  }
}
