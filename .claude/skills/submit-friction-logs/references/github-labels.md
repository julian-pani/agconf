# GitHub Labels for Friction Log System

This document defines the GitHub labels used in the friction log processing system.

## Labels on fbagents Repository

These labels are used on friction log issues submitted to the fbagents repo.

| Label | Color | Description |
|-------|-------|-------------|
| `friction-log` | `#0E8A16` (green) | Session friction log submission |
| `observation` | `#0E8A16` (green) | Legacy label (still accepted for backward compatibility) |
| `pending` | `#FBCA04` (yellow) | Awaiting processing |
| `processed` | `#6F42C1` (purple) | Processing complete |

### Label Lifecycle

```
[New Issue] → friction-log + pending
    ↓
[Processing] → friction-log + pending (in progress)
    ↓
[Complete] → friction-log + processed
    ↓
[Closed]
```

### Backward Compatibility

The `observation` label is still accepted by the process-friction-logs skill for backward compatibility with issues created before the rename. New submissions should use the `friction-log` label.

## Labels on Source Repositories

These labels should be created on repositories where environment improvements are identified.

| Label | Color | Description |
|-------|-------|-------------|
| `agent-improvement` | `#1D76DB` (blue) | Improvement to make AI agents more effective |
| `environment` | `#D93F0B` (red/orange) | Development environment change needed |
| `knowledge` | `#0E8A16` (green) | Documentation or context addition |

### Usage

**Environment improvements** get both labels:
- `agent-improvement` + `environment`
- Example: "Add type checking to CI"

**Knowledge improvements** (when created as issues instead of PRs):
- `agent-improvement` + `knowledge`
- Example: "Document the API response format in AGENTS.md"

## Creating Labels

### Using GitHub CLI

```bash
# On fbagents repo
gh label create "friction-log" --color "0E8A16" --description "Session friction log submission" --repo i-FeelBetter/fbagents
gh label create "pending" --color "FBCA04" --description "Awaiting processing" --repo i-FeelBetter/fbagents
gh label create "processed" --color "6F42C1" --description "Processing complete" --repo i-FeelBetter/fbagents

# On source repos (run for each repo that will receive environment issues)
gh label create "agent-improvement" --color "1D76DB" --description "Improvement to make AI agents more effective" --repo ORG/REPO
gh label create "environment" --color "D93F0B" --description "Development environment change needed" --repo ORG/REPO
gh label create "knowledge" --color "0E8A16" --description "Documentation or context addition" --repo ORG/REPO
```

### Using GitHub UI

1. Go to repository Settings → Labels
2. Click "New label"
3. Enter name, description, and color code (without #)

## Label Colors Reference

| Color Code | Color | Usage |
|------------|-------|-------|
| `0E8A16` | Green | Positive/ready states, knowledge |
| `FBCA04` | Yellow | Pending/waiting states |
| `6F42C1` | Purple | Completed states |
| `1D76DB` | Blue | Agent-related improvements |
| `D93F0B` | Red/Orange | Environment/infrastructure |
