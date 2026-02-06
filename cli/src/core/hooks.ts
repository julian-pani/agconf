import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ResolvedConfig } from "../config/schema.js";

// Default values for hook configuration
const DEFAULT_CLI_NAME = "agconf";
const DEFAULT_CONFIG_DIR = ".agconf";
const DEFAULT_LOCKFILE_NAME = "lockfile.json";

// Hook identifier for detecting managed hooks (legacy and current)
const HOOK_IDENTIFIER = "# agconf pre-commit hook";

// Markers for identifying the agconf section within a hook
const HOOK_MARKER_START = "# agconf:hook:start";
const HOOK_MARKER_END = "# agconf:hook:end";

/**
 * Configuration for hook generation.
 */
export interface HookConfig {
  /** CLI command name (e.g., "agconf") */
  cliName: string;
  /** Config directory name (e.g., ".agconf") */
  configDir: string;
  /** Lockfile name (e.g., "lockfile.json") */
  lockfileName: string;
}

/**
 * Generate the marker-wrapped agconf hook section.
 * This is the single source of truth for the hook logic.
 * Can be used standalone (in a full hook) or appended to an existing hook.
 */
export function generateHookSection(config: HookConfig): string {
  const { cliName, configDir, lockfileName } = config;

  return `${HOOK_MARKER_START}
${HOOK_IDENTIFIER} - DO NOT EDIT THIS SECTION
_agconf_check() {
    local repo_root
    repo_root=$(git rev-parse --show-toplevel)
    if [ ! -f "$repo_root/${configDir}/${lockfileName}" ]; then return 0; fi
    if ! command -v ${cliName} &> /dev/null; then return 0; fi
    local check_output check_exit
    cd "$repo_root"
    check_output=$(${cliName} check 2>&1) || check_exit=$?
    check_exit=\${check_exit:-0}
    if [ "$check_exit" -ne 0 ]; then
        echo ""
        echo "Error: Cannot commit changes to ${cliName}-managed files"
        echo ""
        echo "Output from '${cliName} check' command:"
        echo "$check_output"
        echo ""
        echo "Options:"
        echo "  1. Discard your changes: git checkout -- <file>"
        echo "  2. Skip this check: git commit --no-verify"
        echo "  3. Restore managed files: ${cliName} sync"
        echo "  4. For AGENTS.md: edit only the repo-specific block (between repo:start and repo:end)"
        echo "  5. For skills: create a new custom skill instead"
        echo ""
        return 1
    fi
}
_agconf_check || exit 1
${HOOK_MARKER_END}`;
}

/**
 * Generate a full standalone pre-commit hook script.
 */
export function generatePreCommitHook(config: HookConfig): string {
  return `#!/bin/bash
${generateHookSection(config)}
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
  wasAppended: boolean;
}

/**
 * Check if hook content contains agconf marker comments.
 */
function hasHookMarkers(content: string): boolean {
  return content.includes(HOOK_MARKER_START) && content.includes(HOOK_MARKER_END);
}

/**
 * Replace the agconf section (between and including markers) in existing hook content.
 */
function replaceHookSection(existingContent: string, newSection: string): string {
  const startIdx = existingContent.indexOf(HOOK_MARKER_START);
  const endIdx = existingContent.indexOf(HOOK_MARKER_END);
  if (startIdx === -1 || endIdx === -1) {
    return existingContent;
  }
  const before = existingContent.slice(0, startIdx);
  const after = existingContent.slice(endIdx + HOOK_MARKER_END.length);
  return before + newSection + after;
}

/**
 * Install the pre-commit hook in a git repository.
 * If a pre-commit hook already exists, the agconf section is appended or updated
 * using marker comments, preserving custom hook logic.
 */
export async function installPreCommitHook(
  targetDir: string,
  config?: Partial<ResolvedConfig>,
): Promise<HookInstallResult> {
  const hookConfig = getHookConfig(config);
  const hooksDir = path.join(targetDir, ".git", "hooks");
  const hookPath = path.join(hooksDir, "pre-commit");

  const hookSection = generateHookSection(hookConfig);
  const fullHook = generatePreCommitHook(hookConfig);

  // Ensure hooks directory exists
  await fs.mkdir(hooksDir, { recursive: true });

  // Check if hook already exists
  let existingContent: string | null = null;
  try {
    existingContent = await fs.readFile(hookPath, "utf-8");
  } catch {
    // Expected: hook file doesn't exist yet
  }

  // Case 1: No existing hook — write full standalone hook
  if (existingContent === null) {
    await fs.writeFile(hookPath, fullHook, { mode: 0o755 });
    return {
      installed: true,
      path: hookPath,
      alreadyExisted: false,
      wasUpdated: false,
      wasAppended: false,
    };
  }

  // Case 2: Existing hook with markers — update or no-op
  if (hasHookMarkers(existingContent)) {
    const updated = replaceHookSection(existingContent, hookSection);
    if (updated === existingContent) {
      // Section is already current
      return {
        installed: true,
        path: hookPath,
        alreadyExisted: true,
        wasUpdated: false,
        wasAppended: true,
      };
    }
    // Section was outdated, replace it
    await fs.writeFile(hookPath, updated, { mode: 0o755 });
    return {
      installed: true,
      path: hookPath,
      alreadyExisted: true,
      wasUpdated: true,
      wasAppended: true,
    };
  }

  // Case 3: Legacy agconf hook (has identifier but no markers) — replace entirely
  if (existingContent.includes(HOOK_IDENTIFIER)) {
    await fs.writeFile(hookPath, fullHook, { mode: 0o755 });
    return {
      installed: true,
      path: hookPath,
      alreadyExisted: true,
      wasUpdated: true,
      wasAppended: false,
    };
  }

  // Case 4: Custom hook with no agconf content — append section
  const separator = existingContent.endsWith("\n") ? "\n" : "\n\n";
  const appended = `${existingContent}${separator}${hookSection}\n`;
  await fs.writeFile(hookPath, appended, { mode: 0o755 });
  return {
    installed: true,
    path: hookPath,
    alreadyExisted: true,
    wasUpdated: false,
    wasAppended: true,
  };
}
