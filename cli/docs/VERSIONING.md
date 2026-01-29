# agent-conf Versioning

This document explains how versioning works in agent-conf, including how versions are managed for the CLI, content repositories, and CI workflows.

## Overview

agent-conf uses a **3-repository model** with independent versioning:

| Component | Version Source | Update Method |
|-----------|---------------|---------------|
| **CLI** | Installed binary | Reinstall from CLI repository |
| **Content** | `.agent-conf/lockfile.json` | `agent-conf sync --ref` or `agent-conf update` |
| **Workflows** | `.github/workflows/*.yml` | Updated automatically with content |

The CLI and content are **independently versioned**. You can use CLI v2.0 to sync content v1.5 - they don't need to match.

## Content Versioning

Content repositories use semantic versioning (e.g., `v1.2.0`) for releases. When you sync content to a downstream repository:

- The **lockfile** records the pinned version
- The **workflow files** reference the same version
- The **CLI** knows how to resolve and update versions

### Version Locations

| Location | Purpose | Managed By |
|----------|---------|------------|
| `.agent-conf/lockfile.json` → `pinned_version` | Pinned content version | CLI commands |
| `.github/workflows/agent-conf-sync.yml` → `@vX.Y.Z` | Workflow version ref | CLI commands |
| `.github/workflows/agent-conf-check.yml` → `@vX.Y.Z` | Workflow version ref | CLI commands |

## Command Behaviors

### `agent-conf init`

Initializes a repository with content from a content repository.

**Version behavior:**
- Requires `--source` to specify the content repository
- If `--ref` not specified: Fetches and uses the **latest release**
- If `--ref v1.2.0` specified: Uses that specific version
- If `--ref my-branch` specified: Uses that branch (workflows reference `@my-branch`)
- If `--local` specified: No version management, no workflow files (development mode)

**What it creates:**
- `AGENTS.md` with global standards
- `.claude/skills/` directory with skills
- `.agent-conf/lockfile.json` with version info
- `.github/workflows/agent-conf-sync.yml` pinned to the ref
- `.github/workflows/agent-conf-check.yml` pinned to the ref

**Example:**
```bash
# Initialize from content repository with latest release (recommended)
agent-conf init --source acme/engineering-standards

# Initialize with specific version
agent-conf init --source acme/engineering-standards --ref v1.2.0

# Initialize from a branch (for testing)
agent-conf init --source acme/engineering-standards --ref feature-branch

# Initialize from local source (development)
agent-conf init --local /path/to/content-repo
```

### `agent-conf sync`

Re-syncs content from the content repository.

**Version behavior:**
- If `--ref` not specified: Uses **version from lockfile** (idempotent)
- If `--ref v1.3.0` specified: Updates to that version (lockfile + workflows)
- If `--ref my-branch` specified: Uses that branch (workflows reference `@my-branch`)
- If `--local` specified: No version management, no workflow files (development mode)
- Source is read from lockfile unless `--source` is specified

**Example:**
```bash
# Re-sync using current pinned version (restore files, fix modifications)
agent-conf sync

# Update to a new version
agent-conf sync --ref v1.3.0

# Sync from a branch (for testing)
agent-conf sync --ref feature-branch

# Sync from local source (development)
agent-conf sync --local /path/to/content-repo
```

### `agent-conf update`

Checks for and applies updates from the content repository.

**Version behavior:**
- Fetches the latest release from the content repository (stored in lockfile)
- Compares with current pinned version
- If newer version available, syncs to it
- Updates lockfile, workflows, and content

**Example:**
```bash
# Check for updates and apply
agent-conf update

# Non-interactive mode
agent-conf update --yes
```

### `agent-conf status`

Shows current sync status including version info.

**Example output:**
```
agent-conf status

Sync Status:
  Version: 1.2.0
  Synced: 2024-01-15T10:30:00Z
  Source: github:acme/engineering-standards@v1.2.0

Skills: 5 synced
  - conventional-commits
  - git-branch-naming
  ...
```

## Version Strategies

Choose the strategy that fits your needs:

### 1. Pin to Specific Version (Recommended for Production)

```bash
# Initial setup
agent-conf init --source acme/standards --ref v1.2.0

# Updates are manual - run when ready to upgrade
agent-conf sync --ref v1.3.0
```

**Pros:**
- Full control over when updates happen
- Reproducible builds
- No surprises

### 2. Track Latest Release

```bash
# Initial setup (auto-pins to latest)
agent-conf init --source acme/standards

# Update to latest when ready
agent-conf update
```

**Pros:**
- Easy updates
- Always get latest features

### 3. Development Mode (Local Source)

```bash
# Use local content repository clone
agent-conf init --local /path/to/content-repo

# Re-sync from local
agent-conf sync --local
```

**Pros:**
- Test changes before release
- No network required

**Note:** Local mode (`--local`) doesn't create workflow files. It's intended for development and testing of content changes.

## CI/CD Integration

### Workflow Files

When you run `agent-conf init` or `agent-conf sync` from a GitHub source (not `--local`), the CLI creates/updates workflow files with the ref pinned:

```yaml
# .github/workflows/agent-conf-sync.yml
jobs:
  sync:
    uses: acme/engineering-standards/.github/workflows/sync-reusable.yml@v1.2.0  # <- Ref managed by CLI
```

The ref can be a version tag (`@v1.2.0`) or a branch name (`@master`, `@feature-branch`) depending on how you synced.

### Automatic Updates via CI

The sync workflow can automatically create PRs when your content repository releases new versions:

1. Content repository release triggers `repository_dispatch` to downstream repos
2. The sync workflow runs and detects the update
3. A PR is created with the changes

To enable this, configure the `DOWNSTREAM_REPOS` secret in the content repository.

### Manual CI Trigger

You can manually trigger the sync workflow with a specific version:

1. Go to Actions → agent-conf Sync
2. Click "Run workflow"
3. Enter the desired version in the `ref` input

## Lockfile Structure

The lockfile tracks all sync metadata:

```json
{
  "version": "1",
  "pinned_version": "1.2.0",
  "synced_at": "2024-01-15T10:30:00.000Z",
  "source": {
    "type": "github",
    "repository": "acme/engineering-standards",
    "ref": "v1.2.0",
    "commit_sha": "abc123def456..."
  },
  "content": {
    "agents_md": {
      "global_block_hash": "sha256:abc123...",
      "merged": true
    },
    "skills": ["conventional-commits", "git-branch-naming", ...],
    "targets": ["claude"]
  },
  "cli_version": "1.2.0"
}
```

## CLI Versioning

The CLI version is tracked separately from content versions. The CLI version in the lockfile (`cli_version`) records which CLI version performed the sync, but doesn't affect content versioning.

**To update the CLI:**

```bash
# Using the upgrade-cli command (recommended)
# First time: specify the CLI repository
agent-conf upgrade-cli --repo your-org/agent-conf

# Subsequent times: uses saved config
agent-conf upgrade-cli

# Or manually reinstall from CLI repository
git clone --depth 1 git@github.com:your-org/agent-conf.git /tmp/agent-conf \
  && /tmp/agent-conf/cli/scripts/install_local.sh

# Or install a specific CLI version
git clone --depth 1 --branch v2.0.0 git@github.com:your-org/agent-conf.git /tmp/agent-conf \
  && /tmp/agent-conf/cli/scripts/install_local.sh
```

The `upgrade-cli` command saves the CLI repository to `~/.agent-conf/config.json`, so you only need to specify `--repo` once.

## Upgrade Scenarios

### Scenario 1: Routine Content Update

```bash
# Check what's available
agent-conf update

# Output shows:
# CLI version: 1.2.0
# Content source: acme/engineering-standards
# Latest release: v1.3.0
# Pinned version: 1.2.0
#   -> Update available: 1.3.0
#
# Proceed with update? (y/n)

# Apply the update
agent-conf update --yes
```

### Scenario 2: Skip a Version

```bash
# Currently on v1.2.0, want to skip v1.3.0 and go to v1.4.0
agent-conf sync --ref v1.4.0
```

### Scenario 3: Rollback

```bash
# Something broke in v1.4.0, rollback to v1.3.0
agent-conf sync --ref v1.3.0
```

### Scenario 4: Multiple Repos

```bash
# Update all repos to same version
for repo in ~/projects/repo-*; do
  cd "$repo"
  agent-conf sync --ref v1.3.0 --yes
done
```

## Troubleshooting

### "No releases found"

The GitHub API couldn't find releases. This might mean:
- No releases have been created in the content repository
- Network issues
- Rate limiting

**Solution:** Use `--ref master` for development, or wait and retry.

### Version Mismatch Between Lockfile and Workflows

If you manually edited workflow files, the versions might be out of sync.

**Solution:** Run `agent-conf sync` to re-sync everything to the lockfile version.

### CI Workflow Uses Wrong Version

The workflow file might have a different version than the lockfile.

**Solution:** Run `agent-conf sync` (without `--ref`) to update workflows to match the lockfile version.

### "No GitHub source found in lockfile"

The repository was synced using `--local` mode or the lockfile is missing.

**Solution:** Run `agent-conf init --source <owner/repo>` to set up with a GitHub source.
