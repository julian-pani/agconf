---
layout: default
title: Versioning
nav_order: 2
---

# agconf Versioning

This document explains how versioning works in agconf, including schema versioning, CLI versioning, and content versioning.

## Core Principle: Schema-Based Versioning

**Schema version determines compatibility, not CLI version.**

agconf uses semantic versioning for its schema format. The CLI checks schema compatibility and:
- Refuses to work across **major** schema versions
- Warns but continues for **minor** version differences
- Tracks CLI version for diagnostics only

## What Gets Versioned

| Component | Version Field | Format | Location |
|-----------|--------------|--------|----------|
| Lockfile schema | `version` | Semver (`1.0.0`) | `.agconf/lockfile.json` |
| Canonical config | `version` | Semver (`1.0.0`) | `agconf.yaml` |
| Content release | `pinned_version` | Semver (`1.0.0`) | `.agconf/lockfile.json` |
| CLI (diagnostics) | `cli_version` | Semver (`1.0.0`) | `.agconf/lockfile.json` (optional) |

## Schema Compatibility Rules

```
CLI can work with content if: CLI_SCHEMA_MAJOR == CONTENT_SCHEMA_MAJOR
```

### Behavior Matrix

| Scenario | Behavior |
|----------|----------|
| Schema version matches | Proceed normally |
| Schema minor/patch newer | Warn, proceed (may miss features) |
| Schema major newer | Error: "Upgrade CLI to work with this repo" |
| Schema major older | Error: "Schema version outdated and no longer supported" |

### Examples

```bash
# CLI supports schema 1.x

# OK - exact match
lockfile version: 1.0.0  # Works fine

# OK with warning - newer minor
lockfile version: 1.2.0  # Warns but continues

# ERROR - major too new
lockfile version: 2.0.0  # Refuses: "Upgrade CLI"

# ERROR - major too old
lockfile version: 0.9.0  # Refuses: "Schema outdated"
```

## Content Versioning

Content repositories use semantic versioning (e.g., `v1.2.0`) for releases. When you sync content:

- The **lockfile** records the pinned release version
- The **workflow files** reference the canonical repository
- The **CLI** knows how to resolve and update versions

### Version Locations

| Location | Purpose |
|----------|---------|
| `.agconf/lockfile.json` → `pinned_version` | Pinned content release version |
| `.agconf/lockfile.json` → `version` | Schema format version |
| `agconf.yaml` → `version` | Canonical config schema version |

## Command Behaviors

### `agconf init`

Initializes a repository with content from a content repository.

**Version behavior:**
- Requires `--source` to specify the content repository
- If `--ref` not specified: Fetches and uses the **latest release**
- If `--ref v1.2.0` specified: Uses that specific version
- If `--ref my-branch` specified: Uses that branch
- If `--local` specified: No version management, no workflow files

**Example:**
```bash
# Initialize from content repository with latest release (recommended)
agconf init --source acme/engineering-standards

# Initialize with specific version
agconf init --source acme/engineering-standards --ref v1.2.0

# Initialize from a branch (for testing)
agconf init --source acme/engineering-standards --ref feature-branch

# Initialize from local source (development)
agconf init --local /path/to/content-repo
```

### `agconf sync`

Syncs content from the content repository. By default, fetches the latest release.

**Version behavior:**
- Default: Fetches **latest release** and syncs to it
- `--pinned`: Uses **version from lockfile** (no fetch, idempotent)
- `--ref v1.3.0`: Uses that specific version
- `--ref my-branch`: Uses that branch
- `--local`: No version management

**Schema compatibility check:** Before syncing, the CLI checks the lockfile's schema version and refuses to proceed if incompatible.

**Example:**
```bash
# Sync to latest release (default)
agconf sync

# Re-sync using pinned version
agconf sync --pinned

# Update to a specific version
agconf sync --ref v1.3.0
```

### `agconf check`

Checks if managed files have been modified.

**Schema compatibility check:** The CLI checks the lockfile's schema version before proceeding.

## CLI Version (Diagnostics Only)

The CLI version is tracked in the lockfile (`cli_version`) for diagnostic purposes only. It does **not** affect compatibility.

**The CLI version is optional** - older lockfiles without `cli_version` are valid.

If the lockfile was created with a newer CLI, a warning is shown:
```
⚠ CLI is outdated: v1.0.0 installed, but repo was synced with v1.2.0
  Run: agconf upgrade-cli
```

This is informational only - the CLI will still work if schema versions are compatible.

## Canonical Repository Setup

When creating a canonical repository with `agconf canonical init`:

1. The `agconf.yaml` file is created with the current schema version
2. Workflow files are generated without CLI version pinning
3. Downstream repos can use any compatible CLI version

**Example:**
```bash
agconf canonical init --name my-standards --org my-org
```

The generated workflows use unpinned CLI installation:
```yaml
- name: Install agconf CLI
  run: npm install -g agconf  # Uses latest compatible version
```

## Version Bump Guidelines

### Schema Version Bumps

| Change Type | Version Bump | Example |
|------------|--------------|---------|
| Add optional field | Minor | Add `hooks` array to lockfile |
| Add required field | Major | Make `hooks` required |
| Change field type | Major | Change `skills` from array to object |
| Remove field | Major | Remove `marker_prefix` |
| Bug fix in validation | Patch | Fix regex pattern |

### When to Upgrade CLI

- **Patch releases:** Bug fixes, safe to upgrade anytime
- **Minor releases:** New features, backwards compatible
- **Major releases:** Breaking changes, verify compatibility first

## Lockfile Structure

```json
{
  "version": "1.0.0",
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
    "skills": ["conventional-commits", "git-branch-naming"],
    "rules": {
      "files": ["code-style.md", "security/api-auth.md"],
      "content_hash": "sha256:def456..."
    },
    "agents": {
      "files": ["reviewer.md"],
      "content_hash": "sha256:789abc..."
    },
    "targets": ["claude"],
    "marker_prefix": "agconf"
  },
  "cli_version": "1.0.0"
}
```

## Troubleshooting

### "Schema version X.Y.Z requires a newer CLI"

The lockfile was created with a CLI that uses a newer schema format.

**Solution:** Upgrade the CLI: `npm install -g agconf@latest`

### "Schema version X.Y.Z is outdated and no longer supported"

The lockfile uses an old schema format that the current CLI no longer supports.

**Solution:** This typically requires manual migration or reinitializing.

### "Content uses schema X.Y.Z, CLI supports X.0.0. Some features may not work"

The lockfile has features from a newer minor version. The CLI will work but may miss some features.

**Solution:** Consider upgrading: `npm install -g agconf@latest`

### "No releases found"

The GitHub API couldn't find releases.

**Solution:** Use `--ref master` for development, or check the repository.

### Version Mismatch Between Lockfile and Workflows

If you manually edited workflow files, versions might be out of sync.

**Solution:** Run `agconf sync --pinned` to re-sync everything.
