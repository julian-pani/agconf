# Plan: Per-Downstream-Repo Workflow Configuration

## Problem

The sync workflow file (`{prefix}-sync.yml`) is fully regenerated on each sync, overwriting any per-repo customizations like `commit_strategy`. Users need a way to configure workflow settings per downstream repo that persist across syncs.

## Solution

Implement a downstream config file (`.agconf/config.yaml`) with downstream-only settings. This is distinct from the canonical config (`agconf.yaml`) - the downstream config only contains settings relevant to consuming repos.

**Key distinction:**
- Canonical config (`agconf.yaml`): `version`, `meta`, `content.paths`, `targets`, `markers`, `merge` - defines what content exists and how it's organized
- Downstream config (`.agconf/config.yaml`): `workflow` settings - user preferences for how sync operates

## Files Modified

### 1. `cli/src/config/schema.ts`

Added `WorkflowConfigSchema` and extended `DownstreamConfigSchema`:

```typescript
export const WorkflowConfigSchema = z.object({
  commit_strategy: z.enum(["pr", "direct"]).default("pr"),
  pr_branch_prefix: z.string().optional(),
  pr_title: z.string().optional(),
  commit_message: z.string().optional(),
  reviewers: z.string().optional(),
});

export const DownstreamConfigSchema = z.object({
  sources: z.array(SourceConfigSchema).min(1).optional(),
  targets: z.array(z.string()).optional(),
  workflow: WorkflowConfigSchema.optional(),
});
```

### 2. `cli/src/config/loader.ts`

Added `loadDownstreamConfig()` function:
- Loads `.agconf/config.yaml` from downstream repos
- Uses `DownstreamConfigSchema` (NOT canonical schema)
- Returns `undefined` if file doesn't exist

### 3. `cli/src/core/workflows.ts`

- Added `WorkflowSettings` interface
- Added `toWorkflowSettings()` helper function
- Updated `generateSyncWorkflow()` to accept optional `WorkflowSettings` and embed them in the `with:` block
- Updated `syncWorkflows()` signature to pass settings through

### 4. `cli/src/commands/shared.ts`

Updated `performSync()`:
- Load downstream config via `loadDownstreamConfig()`
- Extract workflow settings and pass to `syncWorkflows()`

### 5. New Tests

- `cli/tests/unit/downstream-config.test.ts` - 19 tests for schema validation and config loading
- Additional tests in `cli/tests/unit/workflows.test.ts` for workflow settings

### 6. Documentation

- `cli/docs/DOWNSTREAM_REPOSITORY_CONFIGURATION.md` - New dedicated guide
- Updated `cli/README.md` - Added downstream configuration section
- Updated `AGENTS.md` - Added downstream config to key patterns
- Updated `cli/docs/CANONICAL_REPOSITORY_SETUP.md` - Added config files distinction

## Example `.agconf/config.yaml` (Downstream Repo)

```yaml
# Downstream repo configuration
# This file is NOT overwritten by sync

workflow:
  commit_strategy: direct  # "pr" (default) or "direct"
  commit_message: "chore: sync engineering standards"
  # pr_branch_prefix: "agconf/sync"  # Only for PR strategy
  # pr_title: "chore(agconf): sync agent configuration"
  # reviewers: "alice,bob"
```

## Generated Workflow Output

The sync workflow includes the settings in the `with:` block:

```yaml
jobs:
  sync:
    uses: owner/repo/.github/workflows/sync-reusable.yml@v1.0.0
    with:
      force: ${{ inputs.force || false }}
      commit_strategy: 'direct'              # From config.yaml
      commit_message: 'chore: sync...'       # From config.yaml
      reviewers: ${{ vars.AGCONF_REVIEWERS || '' }}
    secrets:
      token: ${{ secrets.AGCONF_TOKEN }}
```

## Backwards Compatibility

| Scenario | Behavior |
|----------|----------|
| No `.agconf/config.yaml` exists | Use defaults (`commit_strategy: pr`) |
| Config without `workflow` key | Use defaults |
| Partial `workflow` config | Use specified values, defaults for missing |

## Check Command

No changes needed - workflow settings are user preferences, not synced content to verify.

## Important: Config File Not Created by Default

The `.agconf/config.yaml` file is NOT created automatically during `init` or `sync`. Users create it manually if they need to customize workflow settings.

## Status

✅ **Completed** - PR #10
