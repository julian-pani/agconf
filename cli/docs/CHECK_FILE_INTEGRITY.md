# File Integrity Checking

This document explains how agent-conf detects and prevents unauthorized modifications to managed files.

## Overview

agent-conf manages certain files in your repository:
- **AGENTS.md** (global block) - Company-wide engineering standards
- **Skill files** (`.claude/skills/*/SKILL.md`) - Synced skill definitions

These files should not be manually edited because changes will be overwritten on the next sync. agent-conf provides multiple layers of protection:

1. **Content hashing** - Detects modifications by comparing hashes
2. **Pre-commit hook** - Prevents committing modified files locally
3. **CI workflow** - Catches modifications in pull requests

## How Detection Works

### Content Hashing

Each managed file stores a content hash that allows agent-conf to detect modifications:

**For skill files** (`SKILL.md`):
- Hash is stored in YAML frontmatter as `agent_conf_content_hash`
- Hash is computed from content excluding agent-conf metadata
- Example: `agent_conf_content_hash: "sha256:abc123def456"`

**For AGENTS.md** (global block):
- Hash is stored in an HTML comment within the global block
- Hash is computed from the global block content excluding metadata comments
- Example: `<!-- Content hash: sha256:abc123def456 -->`

### Detection Logic

When checking for modifications:
1. Read the stored hash from the file
2. Compute the current hash of the content
3. Compare: if hashes differ, the file has been modified

## The `check` Command

The `agent-conf check` command verifies all managed files:

```bash
# Show detailed results
agent-conf check

# Exit code only (for scripts/CI)
agent-conf check --quiet
```

### Output Format

When modifications are detected:
```
agent-conf check

Checking managed files...

✗ 2 managed file(s) have been modified:

  AGENTS.md (global block)
    Expected hash: sha256:abc123def456
    Current hash:  sha256:789xyz012345

  .claude/skills/git-conventions/SKILL.md
    Expected hash: sha256:111222333444
    Current hash:  sha256:555666777888

These files are managed by agent-conf and should not be modified manually.
Run 'agent-conf sync' to restore them to the expected state.
```

When all files are unchanged:
```
agent-conf check

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
3. Checks if `agent-conf` CLI is available
4. Runs `agent-conf check --quiet`
5. Blocks commit if modifications detected

### When Hook Blocks a Commit

```
Error: Cannot commit changes to agent-conf-managed files

To see details, run: agent-conf check

Options:
  1. Discard your changes: git checkout -- <file>
  2. Skip this check: git commit --no-verify
  3. Restore managed files: agent-conf sync
  4. For AGENTS.md: edit only the repo-specific block (between repo:start and repo:end)
  5. For skills: create a new custom skill instead
```

### Bypassing the Hook

In rare cases where you need to commit despite the warning:

```bash
git commit --no-verify -m "Your message"
```

**Note:** This should only be used when you understand why the files differ and have a valid reason (e.g., you're updating the agent-conf repository itself).

### Hook Installation

The hook is installed automatically during `agent-conf init` or `agent-conf sync`. If you need to reinstall:

```bash
# Re-run sync to reinstall the hook
agent-conf sync
```

The CLI will not overwrite existing custom pre-commit hooks. If you have a custom hook, you'll need to integrate the agent-conf check manually.

## CI Workflow Integration

The `check-reusable.yml` workflow runs `agent-conf check` in CI to catch modifications in pull requests.

### Usage in Downstream Repos

The CLI automatically creates this workflow file when you run `agent-conf init` or `agent-conf sync`. The workflow references reusable workflows in your **content repository**:

```yaml
# .github/workflows/agent-conf-check.yml (auto-generated)
name: agent-conf Check

on:
  pull_request:
    paths:
      - 'AGENTS.md'
      - '.claude/skills/**'

jobs:
  check:
    # Points to YOUR content repository, not a hardcoded default
    uses: your-org/your-content-repo/.github/workflows/check-reusable.yml@v1.0.0
    secrets:
      token: ${{ secrets.GITHUB_TOKEN }}
```

**Note:** The repository path and version are automatically set based on the source you specified during `agent-conf init --source <owner/repo>`.

### Workflow Outputs

| Output | Description |
|--------|-------------|
| `has_modifications` | `true` if any files modified, `false` otherwise |
| `check_output` | Full output from `agent-conf check` |

## Resolving Modifications

When you discover modified managed files:

### Option 1: Discard Changes

If you accidentally edited a managed file:

```bash
# Discard changes to specific file
git checkout -- AGENTS.md
git checkout -- .claude/skills/skill-name/SKILL.md

# Or restore all managed files
agent-conf sync
```

### Option 2: Re-sync

If files are out of sync for any reason:

```bash
agent-conf sync
```

This will restore all managed files to their expected state.

### Option 3: Customize Properly

If you need custom content:

**For AGENTS.md:**
- Edit only the repo-specific block (between `<!-- agent-conf:repo:start -->` and `<!-- agent-conf:repo:end -->`)
- The global block should never be edited manually

**For skills:**
- Create a new custom skill in `.claude/skills/` with a different name
- Custom skills (without `agent_conf_managed: "true"`) are not checked

## Troubleshooting

### "Not synced" Message

If `agent-conf check` shows "Not synced":
- The repository hasn't been initialized with agent-conf
- Run `agent-conf init` to set up

### False Positives

If files are flagged as modified but you haven't changed them:
- Line ending differences (CRLF vs LF) can cause hash mismatches
- Run `agent-conf sync` to normalize the files

### Hook Not Running

If the pre-commit hook doesn't run:
- Check if `.git/hooks/pre-commit` exists and is executable
- Check if `agent-conf` CLI is in your PATH
- Run `agent-conf sync` to reinstall the hook
