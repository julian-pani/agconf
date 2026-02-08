---
layout: default
title: Canonical Repository Setup
nav_order: 3
---

# Canonical Repository Setup Guide

This guide explains how to set up a canonical repository after scaffolding it with `agconf canonical init`.

## Overview

A **canonical repository** is the source of truth for your organization's engineering standards and AI agent skills. Downstream repositories sync from this canonical repository to receive updates.

## Quick Start

```bash
# 1. Create a new directory (or use existing)
mkdir my-standards && cd my-standards
git init

# 2. Scaffold the canonical repository structure
agconf canonical init

# 3. Edit the generated files (see sections below)

# 4. Commit and push
git add .
git commit -m "Initial canonical repository setup"
git push -u origin main
```

## Directory Structure

After running `canonical init`, you'll have:

```
my-standards/
├── agconf.yaml              # Repository configuration
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

agconf uses two distinct configuration files:

| File | Location | Purpose |
|------|----------|---------|
| `agconf.yaml` | Canonical repo | Defines content structure, targets, markers |
| `.agconf/config.yaml` | Downstream repos | User preferences for how sync operates |

The canonical config defines **what** content exists and how it's organized. The downstream config defines **how** sync operations behave. They serve different purposes and are never mixed.

### `agconf.yaml` (Canonical Config)

This is the main configuration file for your canonical repository:

```yaml
version: "1"
meta:
  name: my-standards           # Unique identifier
  organization: ACME Corp      # Your organization name (optional)
content:
  instructions: instructions/AGENTS.md
  skills_dir: skills           # Directory for reusable skills
  rules_dir: rules             # Optional - modular project instructions
  agents_dir: agents           # Optional - Claude Code sub-agents
targets:
  - claude                     # Supported AI agents: "claude" or "codex"
markers:
  prefix: agconf               # Marker prefix for managed content
merge:
  preserve_repo_content: true  # Preserve downstream repo-specific content
```

**Customization options:**

| Field | Description | Default |
|-------|-------------|---------|
| `meta.name` | Unique identifier for your standards | Directory name |
| `meta.organization` | Display name for your org | (none) |
| `content.rules_dir` | Directory for modular rules (optional) | (none) |
| `content.agents_dir` | Directory for Claude sub-agents (optional) | (none) |
| `targets` | AI agent platforms to support | `["claude"]` |
| `markers.prefix` | Prefix for content markers | `agconf` |

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

## Rules

Rules are modular, topic-specific project instructions that allow you to organize standards by topic rather than putting everything in a single AGENTS.md file.

### Configuration

Add `rules_dir` to your canonical `agconf.yaml`:

```yaml
content:
  instructions: instructions/AGENTS.md
  skills_dir: skills
  rules_dir: rules  # Path to rules directory
```

### Directory Structure

Rules support arbitrary subdirectory nesting:

```
canonical-repo/
├── agconf.yaml
├── instructions/
├── skills/
└── rules/
    ├── code-style.md
    ├── security/
    │   ├── api-auth.md
    │   └── data-handling.md
    └── testing/
        └── unit-tests.md
```

### Creating a Rule

Each rule is a markdown file that can optionally include frontmatter with `paths` for conditional loading:

```markdown
---
paths:
  - "src/api/**/*.ts"
  - "lib/api/**/*.ts"
---

# API Authentication Rules

## Overview
All API endpoints must implement proper authentication...

## Requirements
1. Use JWT tokens
2. Validate on every request
...
```

### Target-Specific Behavior

**Claude Code**: Rules are copied to `.claude/rules/` preserving the directory structure. Each rule file gets metadata frontmatter (`agconf_managed`, `agconf_content_hash`, `agconf_source_path`) added to track sync status.

```
downstream-repo/
└── .claude/
    └── rules/
        ├── code-style.md
        ├── security/
        │   └── api-auth.md
        └── testing/
            └── unit-tests.md
```

**GitHub Copilot**: Rules are concatenated into AGENTS.md under a `# Project Rules` section between `<!-- agconf:rules:start/end -->` markers. Heading levels are automatically adjusted (h1 becomes h2, etc.) to nest properly. Source attribution comments (`<!-- Rule: path/to/rule.md -->`) are included for each rule.

For Copilot, `paths` frontmatter is included as comments since Copilot doesn't support conditional loading:

```markdown
<!-- agconf:rules:start -->
# Project Rules

<!-- Rule: security/api-auth.md -->
<!-- Applies to: src/api/**/*.ts, lib/api/**/*.ts -->
## API Authentication Rules
...
<!-- agconf:rules:end -->
```

## Agents

Agents are Claude Code sub-agents that define specialized AI assistants for specific tasks. Each agent is a markdown file with YAML frontmatter.

### Configuration

Add `agents_dir` to your canonical `agconf.yaml`:

```yaml
content:
  instructions: instructions/AGENTS.md
  skills_dir: skills
  agents_dir: agents  # Path to agents directory
targets:
  - claude  # Agents only work with Claude Code
```

### Directory Structure

Agents are stored as flat files in the agents directory:

```
canonical-repo/
├── agconf.yaml
├── instructions/
├── skills/
└── agents/
    ├── code-reviewer.md
    ├── test-writer.md
    └── doc-planner.md
```

### Creating an Agent

Each agent requires frontmatter with `name` and `description` fields:

```markdown
---
name: code-reviewer
description: Reviews code changes for quality and best practices
tools:
  - Read
  - Grep
  - Bash
---

# Code Reviewer Agent

You are a code reviewer. Your job is to analyze code changes and provide constructive feedback.

## Review Process

1. Read the files that were changed
2. Check for common issues
3. Provide specific suggestions
...
```

### Target-Specific Behavior

**Claude Code**: Agents are copied to `.claude/agents/` as flat files. Metadata frontmatter (`agconf_managed`, `agconf_content_hash`) is added for change tracking.

```
downstream-repo/
└── .claude/
    └── agents/
        ├── code-reviewer.md
        ├── test-writer.md
        └── doc-planner.md
```

**GitHub Copilot**: Not supported. Copilot does not have sub-agents. When agents exist in the canonical repository but only Codex target is configured, a warning is displayed and agents are skipped.

## GitHub Workflows

The scaffolded workflows in `.github/workflows/` are **reusable workflows** that downstream repositories call. The repository references are automatically populated based on your organization and repository name.

### CLI Installation

The generated workflow files install the `agconf` CLI with a pinned version:

```yaml
- name: Install agconf CLI
  run: npm install -g agconf@1.2.0
```

The version is automatically set to the CLI version used when running `agconf canonical init`. This ensures consistent behavior between local development and CI.

To update the CLI version in your workflows after upgrading:

```bash
# Update to your current CLI version
agconf canonical update

# Or specify a version explicitly
agconf canonical update --cli-version 2.0.0
```

### How Reusable Workflows Work

1. Your canonical repository hosts the reusable workflows
2. Downstream repositories reference them with `uses: org/repo/.github/workflows/file.yml@ref`
3. When downstream repos run CI, they call your workflows
4. Your workflows run the `agconf` CLI commands

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
agconf init --source my-org/engineering-standards
```

### 5. Configure Downstream Workflow Settings (Optional)

Each downstream repository can optionally customize sync behavior (commit strategy, PR settings, reviewers). See [Downstream Repository Configuration](./DOWNSTREAM_REPOSITORY_CONFIGURATION.md) for details.

## Cross-Repository Authentication

For the sync workflows to function, downstream repositories need read access to the canonical repository, and optionally the canonical repository may need write access to downstream repos to push updates.

**Note:** The `check` workflow (`agconf-check.yml`) does **not** require any tokens or secrets. It only runs `agconf check` to verify file integrity within the repository.

There are two authentication methods:
1. **GitHub App** (recommended) - More secure, granular permissions, higher rate limits
2. **Personal Access Token (PAT)** - Simpler setup, but tied to a user account

### Option 1: GitHub App (Recommended)

A GitHub App provides better security and granular permissions. The app is installed on repositories rather than tied to a user.

#### Step 1: Create the GitHub App

1. Go to your organization settings: `https://github.com/organizations/YOUR-ORG/settings/apps`
   - For personal accounts: `https://github.com/settings/apps`

2. Click **"New GitHub App"**

3. Configure the app:
   - **GitHub App name**: `agconf-sync` (or your preferred name)
   - **Homepage URL**: Your organization URL or repo URL
   - **Webhook**: Uncheck "Active" (not needed for this use case)

4. Set **Repository permissions**:
   - **Contents**: Read and write (to read canonical repo, write sync PRs)
   - **Pull requests**: Read and write (to create sync PRs)
   - **Workflows**: Read and write (if you want to update workflow files)
   - **Metadata**: Read-only (required, auto-selected)

5. Under **"Where can this GitHub App be installed?"**:
   - Select **"Only on this account"** for organization-only use
   - Or **"Any account"** if repos span multiple orgs

6. Click **"Create GitHub App"**

#### Step 2: Generate a Private Key

1. After creating the app, scroll down to **"Private keys"**
2. Click **"Generate a private key"**
3. A `.pem` file will download - **keep this secure**

#### Step 3: Note the App ID and Installation ID

1. **App ID**: Found at the top of the app settings page
2. **Installation ID**:
   - Go to your app's installations: Click "Install App" in the sidebar
   - Install the app on your organization/repos
   - After installation, the URL will contain the installation ID:
     `https://github.com/organizations/YOUR-ORG/settings/installations/12345678`
     The number (12345678) is your Installation ID

#### Step 4: Add Secrets to Repositories

Add these secrets to your **downstream repositories** (or at the organization level):

| Secret Name | Value |
|-------------|-------|
| `AGENT_CONF_APP_ID` | Your GitHub App ID |
| `AGENT_CONF_APP_PRIVATE_KEY` | Contents of the `.pem` private key file |
| `AGENT_CONF_APP_INSTALLATION_ID` | Your Installation ID |

To add at organization level:
1. Go to **Organization Settings** → **Secrets and variables** → **Actions**
2. Add each secret with **"All repositories"** or **"Selected repositories"**

#### Step 5: Update Workflow to Use GitHub App

Modify your reusable workflows to generate a token from the GitHub App. Update `.github/workflows/sync-reusable.yml`:

```yaml
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Generate GitHub App Token
        id: app-token
        uses: actions/create-github-app-token@v1
        with:
          app-id: ${{ secrets.AGENT_CONF_APP_ID }}
          private-key: ${{ secrets.AGENT_CONF_APP_PRIVATE_KEY }}
          owner: ${{ github.repository_owner }}

      - name: Checkout downstream repo
        uses: actions/checkout@v4
        with:
          token: ${{ steps.app-token.outputs.token }}

      # ... rest of workflow
```

### Option 2: Personal Access Token (PAT)

A PAT is simpler to set up but is tied to a user account. Use fine-grained PATs for better security.

#### Step 1: Create a Fine-Grained PAT

1. Go to: `https://github.com/settings/tokens?type=beta`
2. Click **"Generate new token"**
3. Configure:
   - **Token name**: `agconf-sync`
   - **Expiration**: Choose an appropriate duration (90 days recommended)
   - **Repository access**: Select repositories that need access
     - Include your canonical repository
     - Include downstream repositories (for PR creation)

4. Set **Repository permissions**:
   - **Contents**: Read and write
   - **Pull requests**: Read and write
   - **Workflows**: Read and write (if updating workflow files)

5. Click **"Generate token"** and copy the token

#### Step 2: Add Token as Secret

Add the token to your downstream repositories:

1. Go to each downstream repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **"New repository secret"**
3. Name: `AGENT_CONF_TOKEN`
4. Value: Paste your PAT

Or add at organization level for all repos.

#### Step 3: Verify Workflow Configuration

The default workflow files use `secrets.AGENT_CONF_TOKEN`. No changes needed if you used that secret name.

### Pushing Changes from Canonical to Downstream

If you want the canonical repository to automatically push changes to downstream repos when you release a new version:

#### Using Repository Dispatch

1. In your canonical repository, create a release workflow that triggers downstream repos:

```yaml
# .github/workflows/notify-downstream.yml
name: Notify Downstream Repos

on:
  release:
    types: [published]

jobs:
  notify:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        repo:
          - my-org/app-one
          - my-org/app-two
          - my-org/app-three
    steps:
      - name: Generate GitHub App Token
        id: app-token
        uses: actions/create-github-app-token@v1
        with:
          app-id: ${{ secrets.AGENT_CONF_APP_ID }}
          private-key: ${{ secrets.AGENT_CONF_APP_PRIVATE_KEY }}
          owner: ${{ github.repository_owner }}
          repositories: ${{ matrix.repo }}

      - name: Trigger downstream sync
        run: |
          curl -X POST \
            -H "Authorization: token ${{ steps.app-token.outputs.token }}" \
            -H "Accept: application/vnd.github.v3+json" \
            https://api.github.com/repos/${{ matrix.repo }}/dispatches \
            -d '{"event_type": "agent_conf-release", "client_payload": {"version": "${{ github.event.release.tag_name }}"}}'
```

2. The downstream repos' sync workflow already listens for `repository_dispatch` events with type `agent_conf-release`.

### Security Best Practices

1. **Prefer GitHub Apps over PATs** - Apps have granular permissions and aren't tied to user accounts
2. **Minimize permissions** - Only grant the permissions actually needed
3. **Use short token expiration** - For PATs, set reasonable expiration (90 days or less)
4. **Rotate credentials regularly** - Regenerate private keys and PATs periodically
5. **Use organization-level secrets** - Easier to manage and audit than per-repo secrets
6. **Audit access logs** - Review GitHub App and PAT usage in security logs

## Maintenance

### Updating Standards

1. Edit files in your canonical repository
2. Commit and push changes
3. Create a new release tag
4. Downstream repos can update with `agconf sync`

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
2. Check that `skills_dir` in `agconf.yaml` matches your directory structure
3. Run `agconf sync` in the downstream repo

### Workflow files not being created in downstream repos

Workflow files are only created when syncing from a GitHub source (not `--local` mode). Use:

```bash
agconf init --source my-org/engineering-standards
```

## Next Steps

- [Downstream Repository Configuration](./DOWNSTREAM_REPOSITORY_CONFIGURATION.md) - Customizing sync behavior in downstream repos
- [Versioning Documentation](./VERSIONING.md) - How version management works
- [File Integrity Checking](./CHECK_FILE_INTEGRITY.md) - How file integrity is enforced
