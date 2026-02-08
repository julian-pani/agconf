/**
 * GitHub workflow file management for agconf.
 *
 * Handles creating, reading, and updating workflow files in downstream repositories.
 * These workflow files call the reusable workflows in the canonical repository.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ResolvedConfig, WorkflowConfig as WorkflowConfigSchema } from "../config/schema.js";

/**
 * Per-downstream-repo workflow settings from .agconf/config.yaml.
 * These settings customize how the sync workflow behaves.
 */
export interface WorkflowSettings {
  /** Commit strategy: "pr" creates a pull request, "direct" commits directly */
  commit_strategy?: "pr" | "direct";
  /** Branch prefix for PR branches (only used with commit_strategy: "pr") */
  pr_branch_prefix?: string;
  /** Custom PR title (only used with commit_strategy: "pr") */
  pr_title?: string;
  /** Custom commit message */
  commit_message?: string;
  /** Comma-separated list of GitHub usernames for PR reviewers */
  reviewers?: string;
}

/**
 * Converts WorkflowConfig from schema to WorkflowSettings.
 * Only includes properties that are defined (for exactOptionalPropertyTypes).
 */
export function toWorkflowSettings(
  config: WorkflowConfigSchema | undefined,
): WorkflowSettings | undefined {
  if (!config) return undefined;
  const result: WorkflowSettings = {};
  if (config.commit_strategy !== undefined) result.commit_strategy = config.commit_strategy;
  if (config.pr_branch_prefix !== undefined) result.pr_branch_prefix = config.pr_branch_prefix;
  if (config.pr_title !== undefined) result.pr_title = config.pr_title;
  if (config.commit_message !== undefined) result.commit_message = config.commit_message;
  if (config.reviewers !== undefined) result.reviewers = config.reviewers;
  return result;
}

// Default values
const DEFAULT_CLI_NAME = "agconf";
const WORKFLOWS_DIR = ".github/workflows";

/**
 * Configuration for workflow generation.
 */
export interface WorkflowConfig {
  /** Source repository in owner/repo format */
  sourceRepo: string;
  /** CLI command name */
  cliName: string;
  /** GitHub secret name for the token */
  secretName: string;
  /** Workflow filename prefix (e.g., "agconf" -> "agconf-sync.yml") */
  workflowPrefix: string;
}

/**
 * Get workflow config from resolved config and source repo.
 * sourceRepo is required - there is no default content repository.
 */
export function getWorkflowConfig(
  sourceRepo: string,
  config?: Partial<ResolvedConfig>,
): WorkflowConfig {
  const markerPrefix = config?.markerPrefix ?? DEFAULT_CLI_NAME;
  // Convert markerPrefix to uppercase for secret name (e.g., "agconf" -> "AGCONF")
  const secretName = `${markerPrefix.toUpperCase().replace(/-/g, "_")}_TOKEN`;

  return {
    sourceRepo,
    cliName: config?.cliName ?? DEFAULT_CLI_NAME,
    secretName,
    workflowPrefix: markerPrefix,
  };
}

export interface WorkflowFile {
  name: string;
  filename: string;
  reusableWorkflow: string;
}

/**
 * Get workflow file definitions for a given config.
 */
export function getWorkflowFiles(config: WorkflowConfig): WorkflowFile[] {
  const prefix = config.workflowPrefix;
  return [
    {
      name: "sync",
      filename: `${prefix}-sync.yml`,
      reusableWorkflow: "sync-reusable.yml",
    },
    {
      name: "check",
      filename: `${prefix}-check.yml`,
      reusableWorkflow: "check-reusable.yml",
    },
  ];
}

export interface WorkflowStatus {
  exists: boolean;
  currentRef?: string;
  isManaged: boolean;
}

/**
 * Gets the path to the workflows directory in a repository.
 */
export function getWorkflowsDir(repoRoot: string): string {
  return path.join(repoRoot, WORKFLOWS_DIR);
}

/**
 * Gets the path to a specific workflow file.
 */
export function getWorkflowPath(repoRoot: string, filename: string): string {
  return path.join(repoRoot, WORKFLOWS_DIR, filename);
}

/**
 * Checks the status of a workflow file.
 */
export async function getWorkflowStatus(
  repoRoot: string,
  workflow: WorkflowFile,
  config: WorkflowConfig,
): Promise<WorkflowStatus> {
  const filePath = getWorkflowPath(repoRoot, workflow.filename);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const currentRef = extractWorkflowRef(content, workflow.reusableWorkflow, config.sourceRepo);
    const isManaged =
      content.includes(`# Managed by ${config.cliName}`) || content.includes(config.sourceRepo);

    const result: WorkflowStatus = { exists: true, isManaged };
    if (currentRef !== undefined) result.currentRef = currentRef;
    return result;
  } catch {
    // Expected: workflow file may not exist
    return {
      exists: false,
      isManaged: false,
    };
  }
}

/**
 * Extracts the version ref from a workflow file content.
 * Looks for: uses: owner/repo/.github/workflows/name.yml@ref
 */
export function extractWorkflowRef(
  content: string,
  reusableWorkflow: string,
  sourceRepo: string,
): string | undefined {
  const pattern = new RegExp(
    `uses:\\s*${escapeRegex(sourceRepo)}\\/.github\\/workflows\\/${reusableWorkflow}@([^\\s]+)`,
  );
  const match = content.match(pattern);
  return match?.[1];
}

/**
 * Updates the version ref in a workflow file content.
 */
export function updateWorkflowRef(
  content: string,
  reusableWorkflow: string,
  newRef: string,
  sourceRepo: string,
): string {
  const pattern = new RegExp(
    `(uses:\\s*${escapeRegex(sourceRepo)}\\/.github\\/workflows\\/${reusableWorkflow})@[^\\s]+`,
    "g",
  );
  return content.replace(pattern, `$1@${newRef}`);
}

/**
 * Generates the content for the sync workflow file.
 */
export function generateSyncWorkflow(
  versionRef: string,
  config: WorkflowConfig,
  settings?: WorkflowSettings,
): string {
  const { sourceRepo, cliName, secretName, workflowPrefix } = config;

  // Build the 'with' section lines
  const withLines: string[] = [`      force: \${{ inputs.force || false }}`];

  // Add workflow settings if provided
  if (settings?.commit_strategy) {
    withLines.push(`      commit_strategy: '${settings.commit_strategy}'`);
  }
  if (settings?.pr_branch_prefix) {
    withLines.push(`      pr_branch_prefix: '${settings.pr_branch_prefix}'`);
  }
  if (settings?.pr_title) {
    withLines.push(`      pr_title: '${settings.pr_title}'`);
  }
  if (settings?.commit_message) {
    withLines.push(`      commit_message: '${settings.commit_message}'`);
  }

  // Reviewers: use settings value if provided, otherwise fall back to vars
  if (settings?.reviewers) {
    withLines.push(`      reviewers: '${settings.reviewers}'`);
  } else {
    withLines.push(
      `      reviewers: \${{ vars.${secretName.replace(/_TOKEN$/, "_REVIEWERS")} || '' }}`,
    );
  }

  return `# ${workflowPrefix} Auto-Sync Workflow
# Managed by ${cliName} CLI - do not edit the version ref manually
#
# This workflow syncs standards from the central repository.
# Version changes should be made using: ${cliName} sync --ref <version>
#
# TOKEN: Requires a PAT with read access to the source repository.
# Create a fine-grained PAT at https://github.com/settings/tokens?type=beta
# with read access to ${sourceRepo}, then add it as ${secretName} secret.
# Alternatively, set up a github app. See https://github.com/julian-pani/agconf/blob/master/cli/docs/CANONICAL_REPOSITORY_SETUP.md#cross-repository-authentication for more details

name: ${workflowPrefix} Sync

on:
  schedule:
    - cron: '0 6 * * *'  # Daily at 6am UTC

  workflow_dispatch:
    inputs:
      force:
        description: 'Force sync even if no updates detected'
        required: false
        default: false
        type: boolean

  repository_dispatch:
    types: [${workflowPrefix.replace(/-/g, "_")}-release]

concurrency:
  group: ${workflowPrefix}-sync
  cancel-in-progress: false

jobs:
  sync:
    uses: ${sourceRepo}/.github/workflows/sync-reusable.yml@${versionRef}
    with:
${withLines.join("\n")}
    secrets:
      token: \${{ secrets.${secretName} }}
`;
}

/**
 * Generates the content for the check workflow file.
 */
export function generateCheckWorkflow(versionRef: string, config: WorkflowConfig): string {
  const { sourceRepo, cliName, workflowPrefix } = config;

  return `# ${workflowPrefix} File Integrity Check
# Managed by ${cliName} CLI - do not edit the version ref manually
#
# This workflow checks that ${workflowPrefix}-managed files haven't been modified.
# Version changes should be made using: ${cliName} sync --ref <version>

name: ${workflowPrefix} Check

on:
  pull_request:
    paths:
      - '.claude/**'
      - '.codex/**'
      - 'AGENTS.md'
  push:
    branches:
      - main
      - master
    paths:
      - '.claude/**'
      - '.codex/**'
      - 'AGENTS.md'

concurrency:
  group: ${workflowPrefix}-check-\${{ github.head_ref || github.ref_name }}
  cancel-in-progress: true

jobs:
  check:
    uses: ${sourceRepo}/.github/workflows/check-reusable.yml@${versionRef}
`;
}

/**
 * Generates workflow content for a specific workflow type.
 */
export function generateWorkflow(
  workflow: WorkflowFile,
  versionRef: string,
  config: WorkflowConfig,
  settings?: WorkflowSettings,
): string {
  switch (workflow.name) {
    case "sync":
      return generateSyncWorkflow(versionRef, config, settings);
    case "check":
      return generateCheckWorkflow(versionRef, config);
    default:
      throw new Error(`Unknown workflow: ${workflow.name}`);
  }
}

/**
 * Ensures the workflows directory exists.
 */
export async function ensureWorkflowsDir(repoRoot: string): Promise<void> {
  const dir = getWorkflowsDir(repoRoot);
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Writes a workflow file to the repository.
 */
export async function writeWorkflow(
  repoRoot: string,
  workflow: WorkflowFile,
  versionRef: string,
  config: WorkflowConfig,
  settings?: WorkflowSettings,
): Promise<void> {
  await ensureWorkflowsDir(repoRoot);
  const filePath = getWorkflowPath(repoRoot, workflow.filename);
  const content = generateWorkflow(workflow, versionRef, config, settings);
  await fs.writeFile(filePath, content, "utf-8");
}

/**
 * Updates the version ref in an existing workflow file.
 */
export async function updateWorkflowVersion(
  repoRoot: string,
  workflow: WorkflowFile,
  newRef: string,
  config: WorkflowConfig,
): Promise<boolean> {
  const filePath = getWorkflowPath(repoRoot, workflow.filename);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const currentRef = extractWorkflowRef(content, workflow.reusableWorkflow, config.sourceRepo);

    if (currentRef === newRef) {
      return false; // No change needed
    }

    const updatedContent = updateWorkflowRef(
      content,
      workflow.reusableWorkflow,
      newRef,
      config.sourceRepo,
    );
    await fs.writeFile(filePath, updatedContent, "utf-8");
    return true;
  } catch {
    // Expected: file doesn't exist, create it
    await writeWorkflow(repoRoot, workflow, newRef, config);
    return true;
  }
}

/**
 * Result of syncing all workflow files.
 */
export interface WorkflowSyncResult {
  created: string[];
  updated: string[];
  unchanged: string[];
}

/**
 * Options for syncing workflow files.
 */
export interface SyncWorkflowsOptions {
  /** Resolved config (for marker prefix, cli name, etc.) */
  resolvedConfig?: Partial<ResolvedConfig> | undefined;
  /** Workflow settings from downstream config */
  workflowSettings?: WorkflowSettings | undefined;
}

/**
 * Syncs all workflow files to a specific version.
 * Always overwrites existing workflow files if they differ from the expected content.
 */
export async function syncWorkflows(
  repoRoot: string,
  versionRef: string,
  sourceRepo: string,
  options?: Partial<ResolvedConfig> | SyncWorkflowsOptions,
): Promise<WorkflowSyncResult> {
  // Support both old signature (just resolvedConfig) and new signature (options object)
  const resolvedConfig =
    options && "resolvedConfig" in options
      ? options.resolvedConfig
      : (options as Partial<ResolvedConfig> | undefined);
  const workflowSettings =
    options && "workflowSettings" in options ? options.workflowSettings : undefined;

  const config = getWorkflowConfig(sourceRepo, resolvedConfig);
  const workflowFiles = getWorkflowFiles(config);

  const result: WorkflowSyncResult = {
    created: [],
    updated: [],
    unchanged: [],
  };

  for (const workflow of workflowFiles) {
    const filePath = getWorkflowPath(repoRoot, workflow.filename);
    const expectedContent = generateWorkflow(workflow, versionRef, config, workflowSettings);

    let existingContent: string | null = null;
    try {
      existingContent = await fs.readFile(filePath, "utf-8");
    } catch {
      // Expected: file doesn't exist yet
    }

    if (existingContent === null) {
      // File doesn't exist, create it
      await writeWorkflow(repoRoot, workflow, versionRef, config, workflowSettings);
      result.created.push(workflow.filename);
    } else if (existingContent !== expectedContent) {
      // File exists but differs from expected content, overwrite it
      await writeWorkflow(repoRoot, workflow, versionRef, config, workflowSettings);
      result.updated.push(workflow.filename);
    } else {
      // File exists and matches expected content
      result.unchanged.push(workflow.filename);
    }
  }

  return result;
}

/**
 * Gets the current version ref from workflow files.
 * Returns the ref if all workflows have the same version, or undefined if mixed/missing.
 */
export async function getCurrentWorkflowVersion(
  repoRoot: string,
  sourceRepo: string,
  resolvedConfig?: Partial<ResolvedConfig>,
): Promise<string | undefined> {
  const config = getWorkflowConfig(sourceRepo, resolvedConfig);
  const workflowFiles = getWorkflowFiles(config);
  const refs: (string | undefined)[] = [];

  for (const workflow of workflowFiles) {
    const status = await getWorkflowStatus(repoRoot, workflow, config);
    refs.push(status.currentRef);
  }

  // Check if all refs are the same and defined
  const uniqueRefs = [...new Set(refs.filter(Boolean))];
  if (uniqueRefs.length === 1) {
    return uniqueRefs[0];
  }

  return undefined;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
