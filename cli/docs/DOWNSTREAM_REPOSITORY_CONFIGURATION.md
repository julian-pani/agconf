---
layout: default
title: Downstream Repository Configuration
nav_order: 4
---

# Downstream Repository Configuration

This guide explains how to customize sync behavior in downstream repositories (repos that consume content from a canonical source).

## Overview

After initializing a downstream repository with `agconf init`, you can optionally configure how sync operations behave by creating `.agconf/config.yaml`.

**Key distinction:**
- **Canonical config (`agconf.yaml`)** in the source repo defines *what* content exists
- **Downstream config (`.agconf/config.yaml`)** in consuming repos defines *how* sync operates

## Configuration File

Create `.agconf/config.yaml` in your downstream repository:

```yaml
# .agconf/config.yaml - Downstream repo configuration
# This file is NOT overwritten by sync

workflow:
  # Commit strategy: "pr" (default) or "direct"
  commit_strategy: direct

  # Custom commit message for sync commits
  commit_message: "chore: sync engineering standards"

  # PR-specific settings (only used when commit_strategy: pr)
  pr_branch_prefix: "agconf/sync"
  pr_title: "chore(agconf): sync agent configuration"

  # Comma-separated list of reviewers for PRs
  reviewers: "alice,bob"

# Per-type delivery for plugin-capable content (skills/agents/mcps).
# Omit entirely for the default: everything is synced into the repo.
delivery:
  skills: plugin   # sync (default) | plugin | off
  agents: plugin
  mcps: plugin
```

## Workflow Settings Reference

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `commit_strategy` | `"pr"` \| `"direct"` | `"pr"` | How to apply changes: create PR or commit directly |
| `pr_branch_prefix` | `string` | - | Branch name prefix for PR branches (PR strategy only) |
| `pr_title` | `string` | - | Custom title for sync PRs (PR strategy only) |
| `commit_message` | `string` | - | Custom commit message for sync commits |
| `reviewers` | `string` | - | Comma-separated GitHub usernames for PR reviewers |

## Delivery Settings Reference

The optional `delivery` map controls how each **plugin-capable** content type is
delivered, so a repo can rely on an installed plugin instead of committing the
content. It applies only to `skills`, `agents`, and `mcps` — instructions and
rules have no plugin slot (their scope is set by the sync `--scope` flag).

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `delivery.skills` | `"sync"` \| `"plugin"` \| `"off"` | `"sync"` | `sync` writes skills into the repo; `plugin`/`off` skip them |
| `delivery.agents` | `"sync"` \| `"plugin"` \| `"off"` | `"sync"` | Same, for sub-agents |
| `delivery.mcps` | `"sync"` \| `"plugin"` \| `"off"` | `"sync"` | MCP servers are never repo-synced today, so only `plugin`/`off` are meaningful |

- **`sync`** — agconf writes the files into the repo (today's behavior).
- **`plugin`** — the type is delivered by an installed Claude/Codex plugin; sync
  skips writing it, and **the next sync removes any previously-synced copies**
  (orphan cleanup), so you don't get the same skill twice (once as a repo file
  and once from the plugin).
- **`off`** — agconf does not deliver the type at all.

Switching a type from `sync` to `plugin`/`off` and re-running `agconf sync`
cleans up the files it previously wrote (managed, unmodified files only —
anything you edited by hand is preserved and reported). See
[Distribution Scopes](DISTRIBUTION_SCOPES.md) for how this interacts with the
`--scope` flag and cross-scope duplication detection.

## Commit Strategies

### PR Strategy (Default)

Creates a pull request for each sync, allowing review before merge:

```yaml
workflow:
  commit_strategy: pr
  pr_branch_prefix: "agconf/sync"
  pr_title: "chore(agconf): sync agent configuration"
  reviewers: "team-lead,security-team"
```

**Use when:**
- You want to review changes before they're applied
- Multiple stakeholders need to approve updates
- You need an audit trail of sync changes

### Direct Strategy

Commits changes directly to the default branch:

```yaml
workflow:
  commit_strategy: direct
  commit_message: "chore: sync engineering standards"
```

**Use when:**
- You trust the canonical source completely
- You want updates applied immediately
- The repo is low-risk or for development purposes

## Generated Workflow Output

The settings are embedded in the generated sync workflow's `with:` and `secrets:` blocks:

```yaml
jobs:
  sync:
    uses: owner/canonical-repo/.github/workflows/sync-reusable.yml@v1.0.0
    with:
      force: ${{ inputs.force || false }}
      commit_strategy: 'direct'
      commit_message: 'chore: sync engineering standards'
      reviewers: ${{ vars.AGCONF_REVIEWERS || '' }}
    secrets:
      token: ${{ secrets.AGCONF_TOKEN }}
      app_id: ${{ secrets.AGCONF_APP_ID }}
      app_private_key: ${{ secrets.AGCONF_APP_PRIVATE_KEY }}
```

All three secrets are passed through, but you only need to configure **one** authentication method (PAT or GitHub App). See [Cross-Repository Authentication](./CANONICAL_REPOSITORY_SETUP.md#cross-repository-authentication) for setup details.

## Defaults and Backwards Compatibility

| Scenario | Behavior |
|----------|----------|
| No `.agconf/config.yaml` exists | Use defaults (`commit_strategy: pr`, all content synced) |
| Config exists without `workflow` key | Use defaults |
| Partial `workflow` config | Use specified values, defaults for missing |
| Config exists without `delivery` key | All content types synced into the repo (today's behavior) |
| Partial `delivery` map | Specified types use their value; unspecified types default to `sync` |

## Important Notes

1. **File is never overwritten** - Your `.agconf/config.yaml` persists across syncs
2. **File is optional** - Only create it if you need to customize behavior
3. **Reviewers fallback** - If `reviewers` is not set, falls back to `vars.{PREFIX}_REVIEWERS` GitHub variable

## Next Steps

- [Canonical Repository Setup](./CANONICAL_REPOSITORY_SETUP.md) - Setting up a source repository
- [Versioning Documentation](./VERSIONING.md) - How version management works
