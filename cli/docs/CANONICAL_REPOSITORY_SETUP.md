---
layout: default
title: Canonical Repository Setup
nav_order: 3
---

# Canonical Repository Setup Guide

This guide explains how to set up a canonical repository after scaffolding it with `agent-conf init-canonical-repo`.

## Overview

A **canonical repository** is the source of truth for your organization's engineering standards and AI agent skills. Downstream repositories sync from this canonical repository to receive updates.

## Quick Start

```bash
# 1. Create a new directory (or use existing)
mkdir my-standards && cd my-standards
git init

# 2. Scaffold the canonical repository structure
agent-conf init-canonical-repo

# 3. Edit the generated files (see sections below)

# 4. Commit and push
git add .
git commit -m "Initial canonical repository setup"
git push -u origin main
```

## Directory Structure

After running `init-canonical-repo`, you'll have:

```
my-standards/
├── agent-conf.yaml              # Repository configuration
├── instructions/
│   └── AGENTS.md                # Global engineering standards
├── skills/
│   └── example-skill/           # Example skill (optional)
│       ├── SKILL.md
│       └── references/
└── .github/
    └── workflows/
        ├── sync-reusable.yml    # Reusable workflow for syncing
        └── check-reusable.yml   # Reusable workflow for file checks
```

## Configuration Files

### `agent-conf.yaml`

This is the main configuration file for your canonical repository:

```yaml
version: "1"
meta:
  name: my-standards           # Unique identifier
  organization: ACME Corp      # Your organization name (optional)
content:
  instructions: instructions/AGENTS.md
  skills_dir: skills
targets:
  - claude                     # Supported AI agents
markers:
  prefix: agent-conf           # Marker prefix for managed content
merge:
  preserve_repo_content: true  # Preserve downstream repo-specific content
```

**Customization options:**

| Field | Description | Default |
|-------|-------------|---------|
| `meta.name` | Unique identifier for your standards | Directory name |
| `meta.organization` | Display name for your org | (none) |
| `targets` | AI agent platforms to support | `["claude"]` |
| `markers.prefix` | Prefix for content markers | `agent-conf` |

### `instructions/AGENTS.md`

This file contains your global engineering standards that will be synced to all downstream repositories. Edit this file to include:

- Company-wide coding standards
- Required practices and patterns
- Documentation requirements
- Testing guidelines
- Security policies

**Example structure:**

```markdown
# ACME Corp Engineering Standards for AI Agents

## Purpose
These standards ensure consistency across all engineering projects.

## Development Principles

### Code Quality
- Write clean, readable code
- Follow existing patterns
- ...

## Language-Specific Standards

### Python
- Use type hints
- ...

### TypeScript
- Enable strict mode
- ...
```

## Skills

Skills are reusable instructions that can be invoked by AI agents. Each skill lives in its own directory under `skills/`.

### Creating a Skill

1. Create a directory: `skills/my-skill/`
2. Add a `SKILL.md` file with frontmatter:

```markdown
---
name: my-skill
description: Brief description of what this skill does
---

# My Skill

## When to Use
Describe when this skill should be invoked.

## Instructions
Step-by-step instructions for the AI agent.

## Examples
Provide concrete examples.
```

### Skill References

If your skill needs additional files (templates, examples, etc.), place them in `skills/my-skill/references/`:

```
skills/my-skill/
├── SKILL.md
└── references/
    ├── template.yaml
    └── example.ts
```

## GitHub Workflows

The scaffolded workflows in `.github/workflows/` are **reusable workflows** that downstream repositories call. The repository references are automatically populated based on your organization and repository name.

### Configuring CLI Installation

The workflow files require you to configure how the `agent-conf` CLI is installed. By default, the workflows will fail with an error message until you update the installation step.

**`.github/workflows/sync-reusable.yml` and `check-reusable.yml`:**

Find the "Install agent-conf CLI" step and replace it with your installation method:

```yaml
- name: Install agent-conf CLI
  run: |
    # Option 1: Clone from your CLI repository
    git clone --depth 1 git@github.com:your-org/agent-conf.git /tmp/agent-conf \
      && /tmp/agent-conf/cli/scripts/install_local.sh

    # Option 2: Use a specific version
    git clone --depth 1 --branch v1.0.0 git@github.com:your-org/agent-conf.git /tmp/agent-conf \
      && /tmp/agent-conf/cli/scripts/install_local.sh

    # Option 3: If you publish to npm (future)
    # npm install -g @your-org/agent-conf
```

### How Reusable Workflows Work

1. Your canonical repository hosts the reusable workflows
2. Downstream repositories reference them with `uses: org/repo/.github/workflows/file.yml@ref`
3. When downstream repos run CI, they call your workflows
4. Your workflows run the `agent-conf` CLI commands

### Workflow Customization

The generated workflows are templates. Customize them based on your needs:

- Add additional steps (notifications, approvals, etc.)
- Modify the schedule for sync workflows
- Add environment-specific logic
- Configure reviewers for auto-generated PRs

## Publishing Your Canonical Repository

### 1. Create GitHub Repository

```bash
# Create the repository on GitHub (via web or gh CLI)
gh repo create my-org/engineering-standards --private

# Push your local repository
git remote add origin git@github.com:my-org/engineering-standards.git
git push -u origin main
```

### 2. Create a Release

Downstream repositories pin to specific versions. Create releases using semantic versioning:

```bash
git tag v1.0.0
git push origin v1.0.0

# Or use GitHub releases for release notes
gh release create v1.0.0 --title "Initial Release" --notes "First version of engineering standards"
```

### 3. Configure Repository Access (for private repos)

If your canonical repository is private, you must allow other repositories to use its reusable workflows:

1. Go to **Settings** → **Actions** → **General**
2. Scroll to **"Access"** section
3. Select **"Accessible from repositories in the 'OWNER' organization"**

Without this, downstream repos will see: `error parsing called workflow: workflow was not found`

### 4. Set Up Downstream Repositories

In each downstream repository:

```bash
agent-conf init --source my-org/engineering-standards
```

## Maintenance

### Updating Standards

1. Edit files in your canonical repository
2. Commit and push changes
3. Create a new release tag
4. Downstream repos can update with `agent-conf update`

### Adding New Skills

1. Create new skill directory under `skills/`
2. Add `SKILL.md` with proper frontmatter
3. Commit, push, and create release
4. Downstream repos receive the skill on next sync

### Deprecating Skills

1. Remove the skill directory
2. Create a new release
3. Downstream repos will be prompted to delete orphaned skills on sync

## Troubleshooting

### "workflow was not found" in downstream CI

Your canonical repository is private and hasn't been configured to share workflows. See [Configure Repository Access](#3-configure-repository-access-for-private-repos).

### Skills not appearing in downstream repos

1. Verify the skill has valid frontmatter (`name` and `description` required)
2. Check that `skills_dir` in `agent-conf.yaml` matches your directory structure
3. Run `agent-conf sync` in the downstream repo

### Workflow files not being created in downstream repos

Workflow files are only created when syncing from a GitHub source (not `--local` mode). Use:

```bash
agent-conf init --source my-org/engineering-standards
```

## Next Steps

- [Versioning Documentation](./VERSIONING.md) - How version management works
- [File Integrity Checking](./CHECK_FILE_INTEGRITY.md) - How file integrity is enforced
