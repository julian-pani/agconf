# Process Friction Logs Skill

This skill processes friction log issues from the fbagents queue, creating appropriate improvements.

## Overview

When friction log issues are submitted to fbagents, they enter a processing queue. This skill processes individual issues, analyzing each friction item and routing it appropriately:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Friction Log Issue                                                 │
│           ↓                                                         │
│  ┌────────┼────────┐                                                │
│  ↓        ↓        ↓                                                │
│ Env    Repo-     Global                                             │
│ Issue  Local     Knowledge                                          │
│  ↓     PR ↓         ↓                                               │
│ Create  Create   Delegate to                                        │
│ Issue   PR       fbagents-evolution                                 │
│ on src  on src   agent (opus)                                       │
└─────────────────────────────────────────────────────────────────────┘
```

## How It Works

1. **Fetch**: Read the friction log issue and any attachments
2. **Load context**: Read fbagents structure, optionally clone source repo
3. **Categorize**: For each friction item, determine type and scope
4. **Route**: Based on category:
   - Environment → Issue on source repo
   - Repo-local knowledge → PR on source repo
   - Global knowledge → Delegate to fbagents-evolution agent
5. **Close issue**: Mark as processed with summary

## Improvement Types

### Knowledge Improvements

Missing documentation, patterns, or preferences.

**Global** (affects all repos):
- Delegated to fbagents-evolution agent (opus)
- Agent handles conflict detection and storage decisions
- Example: "Always use explicit return types in Python"

**Repo-local** (specific to source repo):
- Added to source repo's AGENTS.md
- Example: "This repo uses hexagonal architecture"

### Environment Improvements

Structural changes that enable verification.

- Created as issues on source repo
- Labels: `agent-improvement`, `environment`
- Example: "Add type checking to CI"

## Usage

```
/process-friction-logs <issue-number>
```

Or invoke programmatically for batch processing.

## Files

```
process-friction-logs/
├── SKILL.md                        # Agent instructions
├── README.md                       # This file
└── references/
    └── categorization.md           # How to categorize friction items
```

## Prerequisites

- Running in fbagents repository
- GitHub CLI authenticated
- Write access to fbagents
- Ideally write access to source repos (falls back gracefully)

## Related

- **Submit Friction Logs**: The skill that submits friction logs to the queue
- **fbagents-evolution agent**: Handles all global knowledge integration (conflict detection, storage decisions, execution)
