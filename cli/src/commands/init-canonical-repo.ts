import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as prompts from "@clack/prompts";
import pc from "picocolors";
import { stringify as stringifyYaml } from "yaml";
import { directoryExists, ensureDir, fileExists } from "../utils/fs.js";
import { getGitOrganization, getGitProjectName, isGitRoot } from "../utils/git.js";
import { createLogger, formatPath } from "../utils/logger.js";

export interface InitCanonicalRepoOptions {
  /** Canonical repo name */
  name?: string;
  /** Organization name */
  org?: string;
  /** Target directory (default: cwd) */
  dir?: string;
  /** Marker prefix (default: "agent-conf") */
  markerPrefix?: string;
  /** Include example skill (default: true) */
  includeExamples?: boolean;
  /** Non-interactive mode */
  yes?: boolean;
}

interface ResolvedOptions {
  name: string;
  organization?: string;
  targetDir: string;
  markerPrefix: string;
  includeExamples: boolean;
}

/**
 * Generates the agent-conf.yaml configuration file content.
 */
function generateConfigYaml(options: ResolvedOptions): string {
  const config: Record<string, unknown> = {
    version: "1",
    meta: {
      name: options.name,
    },
    content: {
      instructions: "instructions/AGENTS.md",
      skills_dir: "skills",
    },
    targets: ["claude"],
    markers: {
      prefix: options.markerPrefix,
    },
    merge: {
      preserve_repo_content: true,
    },
  };

  if (options.organization) {
    (config.meta as Record<string, unknown>).organization = options.organization;
  }

  return stringifyYaml(config, { lineWidth: 0 });
}

/**
 * Generates a template AGENTS.md file.
 */
function generateAgentsMd(options: ResolvedOptions): string {
  const orgName = options.organization ?? "Your Organization";
  return `# ${orgName} Engineering Standards for AI Agents

This document defines company-wide engineering standards that all AI coding agents must follow.

## Purpose

These standards ensure consistency, maintainability, and operational excellence across all engineering projects.

---

## Development Principles

### Code Quality

- Write clean, readable code with meaningful names
- Follow existing patterns in the codebase
- Keep functions small and focused
- Add comments only when the "why" isn't obvious

### Testing

- Write tests for new functionality
- Ensure tests are deterministic and fast
- Use descriptive test names

---

## Getting Started

Add your organization's specific engineering standards below.

---

**Version**: 1.0
**Last Updated**: ${new Date().toISOString().split("T")[0]}
`;
}

/**
 * Generates an example skill SKILL.md file.
 */
function generateExampleSkillMd(): string {
  return `---
name: example-skill
description: An example skill demonstrating the skill format
---

# Example Skill

This is an example skill that demonstrates the skill format.

## When to Use

Use this skill when you need an example of how skills are structured.

## Instructions

1. Skills are defined in their own directories under \`skills/\`
2. Each skill has a \`SKILL.md\` file with frontmatter
3. The frontmatter must include \`name\` and \`description\`
4. Optional: Include a \`references/\` directory for additional files

## Example

\`\`\`
skills/
  example-skill/
    SKILL.md
    references/
      .gitkeep
\`\`\`
`;
}

/**
 * Generates the sync workflow file content.
 */
function generateSyncWorkflow(repoFullName: string, prefix: string): string {
  return `# ${prefix} Auto-Sync Workflow (Reusable)
# This workflow is called by downstream repositories.
#
# Downstream repos will reference this workflow like:
#   uses: ${repoFullName}/.github/workflows/sync-reusable.yml@v1.0.0
#
# SETUP REQUIRED: Update the CLI installation step below with your installation method.
# See docs/CANONICAL_REPOSITORY_SETUP.md for detailed instructions.

name: Sync Reusable

on:
  workflow_call:
    inputs:
      force:
        description: 'Force sync even if no updates detected'
        required: false
        default: false
        type: boolean
      reviewers:
        description: 'PR reviewers (comma-separated)'
        required: false
        type: string
    secrets:
      token:
        description: 'GitHub token with repo access'
        required: true

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout downstream repo
        uses: actions/checkout@v4
        with:
          token: \${{ secrets.token }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install agent-conf CLI
        run: |
          # TODO: Update with your CLI installation method
          # Example using git clone (replace with your CLI repository):
          # git clone --depth 1 git@github.com:your-org/agent-conf.git /tmp/agent-conf \\
          #   && /tmp/agent-conf/cli/scripts/install_local.sh
          echo "ERROR: CLI installation not configured. See docs/CANONICAL_REPOSITORY_SETUP.md"
          exit 1

      - name: Run sync
        run: |
          agent-conf sync --yes
        env:
          GITHUB_TOKEN: \${{ secrets.token }}
`;
}

/**
 * Generates the check workflow file content.
 */
function generateCheckWorkflow(repoFullName: string, prefix: string): string {
  return `# ${prefix} File Integrity Check (Reusable)
# This workflow is called by downstream repositories.
#
# Downstream repos will reference this workflow like:
#   uses: ${repoFullName}/.github/workflows/check-reusable.yml@v1.0.0
#
# SETUP REQUIRED: Update the CLI installation step below with your installation method.
# See docs/CANONICAL_REPOSITORY_SETUP.md for detailed instructions.

name: Check Reusable

on:
  workflow_call:
    secrets:
      token:
        description: 'GitHub token with repo access'
        required: true

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          token: \${{ secrets.token }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install agent-conf CLI
        run: |
          # TODO: Update with your CLI installation method
          # Example using git clone (replace with your CLI repository):
          # git clone --depth 1 git@github.com:your-org/agent-conf.git /tmp/agent-conf \\
          #   && /tmp/agent-conf/cli/scripts/install_local.sh
          echo "ERROR: CLI installation not configured. See docs/CANONICAL_REPOSITORY_SETUP.md"
          exit 1

      - name: Check file integrity
        run: |
          agent-conf check
`;
}

export async function initCanonicalRepoCommand(options: InitCanonicalRepoOptions): Promise<void> {
  const logger = createLogger();

  console.log();
  prompts.intro(pc.bold("agent-conf init-canonical-repo"));

  // Determine target directory
  const targetDir = options.dir ? path.resolve(options.dir) : process.cwd();
  const dirName = path.basename(targetDir);
  const cwd = process.cwd();

  // Compute smart defaults for name and organization
  // Check both target dir and cwd for git info
  // If target dir exists and is at git root, use that
  // Otherwise, if cwd is at git root and target is cwd or a new subdir, use cwd's git info
  let isAtGitRoot = await isGitRoot(targetDir);
  let gitProjectName = await getGitProjectName(targetDir);
  let gitOrganization = await getGitOrganization(targetDir);

  // If target dir doesn't have git info, try cwd (useful when creating new dir inside git repo)
  if (!gitProjectName) {
    const cwdIsGitRoot = await isGitRoot(cwd);
    const cwdGitProjectName = await getGitProjectName(cwd);
    const cwdGitOrganization = await getGitOrganization(cwd);

    // If cwd is a git root and target is cwd, use cwd's info
    if (cwdIsGitRoot && path.resolve(targetDir) === path.resolve(cwd)) {
      isAtGitRoot = true;
      gitProjectName = cwdGitProjectName;
      gitOrganization = cwdGitOrganization;
    } else if (cwdGitOrganization && !gitOrganization) {
      // At least use the organization from cwd if available
      gitOrganization = cwdGitOrganization;
    }
  }

  // Determine the default name suggestion
  let defaultName: string;
  let nameHint: string;
  if (isAtGitRoot && gitProjectName) {
    defaultName = gitProjectName;
    nameHint = " (from current git project)";
  } else {
    defaultName = dirName;
    nameHint = "";
  }

  // Check if directory exists and has content
  const dirExists = await directoryExists(targetDir);
  if (dirExists) {
    const configExists = await fileExists(path.join(targetDir, "agent-conf.yaml"));
    if (configExists && !options.yes) {
      const shouldContinue = await prompts.confirm({
        message: "This directory already has an agent-conf.yaml. Overwrite?",
        initialValue: false,
      });

      if (prompts.isCancel(shouldContinue) || !shouldContinue) {
        prompts.cancel("Operation cancelled");
        process.exit(0);
      }
    }
  }

  // Gather options (interactive or from CLI)
  let resolvedOptions: ResolvedOptions;

  if (options.yes) {
    // Non-interactive mode: use defaults or provided values
    resolvedOptions = {
      name: options.name ?? defaultName,
      organization: options.org ?? gitOrganization,
      targetDir,
      markerPrefix: options.markerPrefix ?? "agent-conf",
      includeExamples: options.includeExamples !== false,
    };
  } else {
    // Interactive mode: prompt for values
    const name = await prompts.text({
      message: `Canonical repository name${nameHint}:`,
      placeholder: defaultName,
      defaultValue: options.name ?? defaultName,
      validate: (value) => {
        if (!value.trim()) return "Name is required";
        if (!/^[a-z0-9-]+$/.test(value)) return "Name must be lowercase alphanumeric with hyphens";
        return undefined;
      },
    });

    if (prompts.isCancel(name)) {
      prompts.cancel("Operation cancelled");
      process.exit(0);
    }

    // Determine organization suggestion
    const orgDefault = options.org ?? gitOrganization;
    const orgHint = gitOrganization && !options.org ? " (from git)" : "";

    const organization = await prompts.text({
      message: `Organization name${orgHint} (optional):`,
      placeholder: orgDefault ?? "ACME Corp",
      defaultValue: orgDefault,
    });

    if (prompts.isCancel(organization)) {
      prompts.cancel("Operation cancelled");
      process.exit(0);
    }

    const markerPrefix = await prompts.text({
      message: "Marker prefix for managed content:",
      placeholder: "agent-conf",
      defaultValue: options.markerPrefix ?? "agent-conf",
      validate: (value) => {
        if (!value.trim()) return "Prefix is required";
        if (!/^[a-z0-9-]+$/.test(value)) return "Prefix must be lowercase alphanumeric with hyphens";
        return undefined;
      },
    });

    if (prompts.isCancel(markerPrefix)) {
      prompts.cancel("Operation cancelled");
      process.exit(0);
    }

    const includeExamples = await prompts.confirm({
      message: "Include example skill?",
      initialValue: options.includeExamples !== false,
    });

    if (prompts.isCancel(includeExamples)) {
      prompts.cancel("Operation cancelled");
      process.exit(0);
    }

    resolvedOptions = {
      name: name as string,
      organization: (organization as string) || undefined,
      targetDir,
      markerPrefix: markerPrefix as string,
      includeExamples: includeExamples as boolean,
    };
  }

  // Create directory structure
  const spinner = logger.spinner("Creating canonical repository structure...");
  spinner.start();

  try {
    // Ensure target directory exists
    await ensureDir(resolvedOptions.targetDir);

    // Create directories
    const instructionsDir = path.join(resolvedOptions.targetDir, "instructions");
    const skillsDir = path.join(resolvedOptions.targetDir, "skills");
    const workflowsDir = path.join(resolvedOptions.targetDir, ".github", "workflows");

    await ensureDir(instructionsDir);
    await ensureDir(skillsDir);
    await ensureDir(workflowsDir);

    // Write agent-conf.yaml
    const configPath = path.join(resolvedOptions.targetDir, "agent-conf.yaml");
    await fs.writeFile(configPath, generateConfigYaml(resolvedOptions), "utf-8");

    // Write AGENTS.md
    const agentsMdPath = path.join(instructionsDir, "AGENTS.md");
    await fs.writeFile(agentsMdPath, generateAgentsMd(resolvedOptions), "utf-8");

    // Write example skill if requested
    if (resolvedOptions.includeExamples) {
      const exampleSkillDir = path.join(skillsDir, "example-skill");
      const referencesDir = path.join(exampleSkillDir, "references");
      await ensureDir(referencesDir);

      const skillMdPath = path.join(exampleSkillDir, "SKILL.md");
      await fs.writeFile(skillMdPath, generateExampleSkillMd(), "utf-8");

      const gitkeepPath = path.join(referencesDir, ".gitkeep");
      await fs.writeFile(gitkeepPath, "", "utf-8");
    }

    // Write workflow files
    const syncWorkflowPath = path.join(workflowsDir, "sync-reusable.yml");
    const checkWorkflowPath = path.join(workflowsDir, "check-reusable.yml");

    // Build repo full name for workflow references (org/name or just name if no org)
    const repoFullName = resolvedOptions.organization
      ? `${resolvedOptions.organization}/${resolvedOptions.name}`
      : resolvedOptions.name;

    await fs.writeFile(
      syncWorkflowPath,
      generateSyncWorkflow(repoFullName, resolvedOptions.markerPrefix),
      "utf-8",
    );
    await fs.writeFile(
      checkWorkflowPath,
      generateCheckWorkflow(repoFullName, resolvedOptions.markerPrefix),
      "utf-8",
    );

    spinner.succeed("Canonical repository structure created");

    // Summary
    console.log();
    console.log(pc.bold("Created:"));
    console.log(`  ${pc.green("+")} ${formatPath(configPath)}`);
    console.log(`  ${pc.green("+")} ${formatPath(agentsMdPath)}`);
    if (resolvedOptions.includeExamples) {
      console.log(`  ${pc.green("+")} ${formatPath(path.join(skillsDir, "example-skill/SKILL.md"))}`);
    }
    console.log(`  ${pc.green("+")} ${formatPath(syncWorkflowPath)}`);
    console.log(`  ${pc.green("+")} ${formatPath(checkWorkflowPath)}`);

    console.log();
    console.log(pc.dim(`Name: ${resolvedOptions.name}`));
    if (resolvedOptions.organization) {
      console.log(pc.dim(`Organization: ${resolvedOptions.organization}`));
    }
    console.log(pc.dim(`Marker prefix: ${resolvedOptions.markerPrefix}`));

    console.log();
    console.log(pc.bold("Next steps:"));
    console.log(`  1. Edit ${pc.cyan("instructions/AGENTS.md")} with your engineering standards`);
    console.log(`  2. Add skills to ${pc.cyan("skills/")} directory`);
    console.log(`  3. Update ${pc.cyan(".github/workflows/")} files with your CLI installation method`);
    console.log(`     (The workflow files will fail until you configure how to install the CLI)`);
    console.log(`  4. Commit and push to create your canonical repository`);
    console.log();
    console.log(pc.dim(`See docs/CANONICAL_REPOSITORY_SETUP.md for detailed setup instructions.`));

    prompts.outro(pc.green("Done!"));
  } catch (error) {
    spinner.fail("Failed to create canonical repository");
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
