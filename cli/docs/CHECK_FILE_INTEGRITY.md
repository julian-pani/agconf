---
layout: default
title: File Integrity
nav_order: 4
---

# File Integrity Checking

This document explains how agconf detects and prevents unauthorized modifications to managed files.

## Overview

agconf manages certain files in your repository:
- **AGENTS.md** (global block) - Company-wide engineering standards (`<!-- agconf:global:start/end -->`)
- **AGENTS.md** (rules section, Codex targets) - Concatenated rules (`<!-- agconf:rules:start/end -->`)
- **Skill files** (`.claude/skills/*/SKILL.md`) - Synced skill definitions
- **Rule files** (`.claude/rules/**/*.md`) - Modular project instructions (Claude only)
- **Agent files** (`.claude/agents/*.md`) - Claude Code sub-agents (Claude only)

These files should not be manually edited because changes will be overwritten on the next sync. agconf provides multiple layers of protection:

1. **Content hashing** - Detects modifications by comparing hashes
2. **Pre-commit hook** - Prevents committing modified files locally
3. **CI workflow** - Catches modifications in pull requests

## How Detection Works

### Content Hashing

Each managed file stores a content hash that allows agconf to detect modifications:

**For skill files** (`.claude/skills/*/SKILL.md`):
- Hash is stored in YAML frontmatter as `agconf_content_hash`
- Hash is computed from content excluding agconf metadata
- Example: `agconf_content_hash: "sha256:abc123def456"`

**For rule files** (`.claude/rules/**/*.md`) and **agent files** (`.claude/agents/*.md`):
- Hash is stored in YAML frontmatter as `agconf_content_hash`
- Hash is computed from content excluding agconf metadata
- Example: `agconf_content_hash: "sha256:abc123def456"`

**For AGENTS.md** (global block):
- Hash is stored in an HTML comment within the global block
- Hash is computed from the global block content excluding metadata comments
- Example: `<!-- Content hash: sha256:abc123def456 -->`

**For AGENTS.md** (rules section, Codex targets):
- Hash is stored in an HTML comment within the rules section markers
- Hash is computed from the concatenated rules content
- Example: `<!-- Content hash: sha256:abc123def456 -->`

### Detection Logic

When checking for modifications:
1. Read the stored hash from the file
2. Compute the current hash of the content
3. Compare: if hashes differ, the file has been modified

## The `check` Command

The `agconf check` command verifies all managed files:

```bash
# Show detailed results
agconf check

# Exit code only (for scripts/CI)
agconf check --quiet
```

### Output Format

When modifications are detected:
```
agconf check

Checking managed files...

✗ 2 managed file(s) have been modified:

  AGENTS.md (global block)
    Expected hash: sha256:abc123def456
    Current hash:  sha256:789xyz012345

  .claude/skills/git-conventions/SKILL.md
    Expected hash: sha256:111222333444
    Current hash:  sha256:555666777888

These files are managed by agconf and should not be modified manually.
Run 'agconf sync' to restore them to the expected state.
```

When all files are unchanged:
```
agconf check

Checking managed files...

✓ All managed files are unchanged
```

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All managed files unchanged (or repo not synced) |
| `1` | One or more managed files modified |

## Pre-commit Hook

The CLI automatically installs a git pre-commit hook at `.git/hooks/pre-commit`.

### How It Works

1. Hook runs before each commit
2. Checks if repository has been synced (lockfile exists)
3. Checks if `agconf` CLI is available
4. Runs `agconf check --quiet`
5. Blocks commit if modifications detected

### When Hook Blocks a Commit

```
Error: Cannot commit changes to agconf-managed files

To see details, run: agconf check

Options:
  1. Discard your changes: git checkout -- <file>
  2. Skip this check: git commit --no-verify
  3. Restore managed files: agconf sync
  4. For AGENTS.md: edit only the repo-specific block (between repo:start and repo:end)
  5. For skills: create a new custom skill instead
```

### Bypassing the Hook

In rare cases where you need to commit despite the warning:

```bash
git commit --no-verify -m "Your message"
```

**Note:** This should only be used when you understand why the files differ and have a valid reason (e.g., you're updating the agconf repository itself).

### Hook Installation

The hook is installed automatically during `agconf init` or `agconf sync`. If you need to reinstall:

```bash
# Re-run sync to reinstall the hook
agconf sync
```

The CLI will not overwrite existing custom pre-commit hooks. If you have a custom hook, you'll need to integrate the agconf check manually.

## CI Workflow Integration

The `check-reusable.yml` workflow runs `agconf check` in CI to catch modifications in pull requests.

### Usage in Downstream Repos

The CLI automatically creates this workflow file when you run `agconf init` or `agconf sync`. The workflow references reusable workflows in your **content repository**:

```yaml
# .github/workflows/agconf-check.yml (auto-generated)
name: agconf Check

on:
  pull_request:
    paths:
      - 'AGENTS.md'
      - '.claude/**'
      - '.codex/**'

jobs:
  check:
    # Points to YOUR content repository, not a hardcoded default
    uses: your-org/your-content-repo/.github/workflows/check-reusable.yml@v1.0.0
```

**Note:** The repository path and version are automatically set based on the source you specified during `agconf init --source <owner/repo>`.

### Workflow Outputs

| Output | Description |
|--------|-------------|
| `has_modifications` | `true` if any files modified, `false` otherwise |
| `check_output` | Full output from `agconf check` |

## Resolving Modifications

When you discover modified managed files:

### Option 1: Discard Changes

If you accidentally edited a managed file:

```bash
# Discard changes to specific file
git checkout -- AGENTS.md
git checkout -- .claude/skills/skill-name/SKILL.md

# Or restore all managed files
agconf sync
```

### Option 2: Re-sync

If files are out of sync for any reason:

```bash
agconf sync
```

This will restore all managed files to their expected state.

### Option 3: Customize Properly

If you need custom content:

**For AGENTS.md:**
- Edit only the repo-specific block (between `<!-- agconf:repo:start -->` and `<!-- agconf:repo:end -->`)
- The global block should never be edited manually

**For skills, rules, or agents:**
- Create a new custom file in the appropriate directory with a different name
- Custom files (without `agconf_managed: "true"` in frontmatter) are not checked

## Troubleshooting

### "Not synced" Message

If `agconf check` shows "Not synced":
- The repository hasn't been initialized with agconf
- Run `agconf init` to set up

### False Positives

If files are flagged as modified but you haven't changed them:
- Line ending differences (CRLF vs LF) can cause hash mismatches
- Run `agconf sync` to normalize the files

### Hook Not Running

If the pre-commit hook doesn't run:
- Check if `.git/hooks/pre-commit` exists and is executable
- Check if `agconf` CLI is in your PATH
- Run `agconf sync` to reinstall the hook
