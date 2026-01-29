---
name: process-friction-logs
description: Process a pending friction log issue from the fbagents queue. Categorizes friction items into improvements, creates PRs for knowledge additions, and creates issues for environment improvements. Use when processing the friction log queue.
metadata:
---

# Process Friction Logs

This skill processes a single friction log issue from the fbagents repository queue. It categorizes friction items, determines appropriate actions, and creates the outputs (PRs or issues).

## When to Use This Skill

- When reviewing pending friction log issues in fbagents
- Invoked manually: `/process-friction-logs <issue-number>`

## Prerequisites

- Running in the fbagents repository
- GitHub CLI (`gh`) authenticated with permissions to:
  - Read/write issues on fbagents
  - Create PRs on fbagents
  - Create PRs/issues on source repositories (with fallback)

## Workflow Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  Fetch Friction Log Issue                                           │
│           ↓                                                         │
│  Load Context (fbagents, source repo, conversation)                 │
│           ↓                                                         │
│  Categorize Each Friction Item                                      │
│           ↓                                                         │
│  ┌────────┼────────┐                                                │
│  ↓        ↓        ↓                                                │
│ Env    Repo-     Global                                             │
│ Issue  Local     Knowledge                                          │
│  ↓     PR ↓         ↓                                               │
│ Create  Create   Delegate to                                        │
│ Issue   PR       fbagents-evolution                                 │
│ on src  on src   agent (opus)                                       │
│           ↓                                                         │
│  Update Friction Log Issue (close)                                  │
└─────────────────────────────────────────────────────────────────────┘
```

## Workflow

### Step 1: Fetch the Friction Log Issue

```bash
# Get issue details (accepts both 'friction-log' and legacy 'observation' labels)
gh issue view <issue-number> --repo i-FeelBetter/fbagents --json title,body,labels

# Download conversation attachment if present
gh issue view <issue-number> --repo i-FeelBetter/fbagents --json comments
```

Parse the issue body to extract:
- Session context (repo, branch, commit, session ID)
- Individual friction items

### Step 2: Load Context

**fbagents context** (always available):
- Read `instructions/AGENTS.md` for current global standards
- Scan `skills/` for existing skills
- Understand current patterns and what's already documented

**Source repo context** (if needed):
- Clone the source repository to a temp directory
- Read `.claude/AGENTS.md` if it exists
- Examine referenced files from friction items

**Conversation context** (if needed):
- Download and parse the attached conversation JSONL
- Search for additional context around specific friction items

### Step 3: Categorize Each Friction Item

For each friction item, determine:

#### A. Is it actionable?

Skip if:
- Too vague to act on
- One-time contextual decision
- No clear improvement path

Keep if:
- Clear pattern or preference
- Recurring issue
- Explicit user feedback
- Environment limitation that blocked work

#### B. What type of improvement?

| Type | Indicators | Output |
|------|------------|--------|
| **Knowledge** | Missing docs, patterns, preferences | PR with documentation |
| **Environment** | Missing tools, access, verification | Issue as backlog item |

#### C. What scope? (for knowledge only)

| Scope | Indicators | Destination |
|-------|------------|-------------|
| **Global** | "I always...", applies to all repos | Delegate to fbagents-evolution agent |
| **Repo-local** | Specific to source repo | PR to source repo |

### Step 4: Create Outputs

#### Environment Improvements → Issues on Source Repo

```bash
gh issue create \
  --repo <source-repo> \
  --title "[Agent Improvement] <brief description>" \
  --label "agent-improvement,environment" \
  --body "## Summary

<description of the environment improvement needed>

## Why This Matters

<explanation of how this affects agent effectiveness>

## Source

Identified from friction log issue: https://github.com/i-FeelBetter/fbagents/issues/<issue-number>

## Suggested Actions

- <specific actionable items>
"
```

**Fallback**: If issue creation fails (permissions), document the improvement in the friction log issue comments.

#### Repo-Local Knowledge → PRs on Source Repo

```bash
# Clone source repo
git clone <source-repo-url> /tmp/source-repo
cd /tmp/source-repo

# Create branch and make changes
git checkout -b improvement/from-fbagents-friction-log

# Edit AGENTS.md or .claude/CLAUDE.md
# ... make changes ...

# Create PR
gh pr create \
  --repo <source-repo> \
  --title "docs: add <description>" \
  --body "Improvement from fbagents friction log processing."
```

**Fallback**: If PR creation fails (permissions), create an issue with the proposed content.

#### Global Knowledge → Delegate to fbagents-evolution Agent

For global knowledge improvements, delegate to the fbagents-evolution agent which handles conflict detection, storage location decisions, and execution.

Use the Task tool to invoke the agent:

```
Task(
  subagent_type="fbagents-evolution",
  model="opus",
  prompt="""
Process this global knowledge improvement from friction log issue #<issue-number>:

**Friction Item**: <friction item text>

**Evidence**: <supporting context from conversation>

**Source repo**: <repo-name>
**Session ID**: <session-id>

Please analyze this friction item, check for conflicts with existing content,
determine the appropriate storage location, and create a PR with the improvement.
"""
)
```

The fbagents-evolution agent will:
1. Check for conflicts with existing content
2. Determine storage location (AGENTS.md vs skill)
3. Generate a change plan
4. Execute approved changes
5. Create a PR

### Step 5: Update Friction Log Issue

After processing all friction items:

```bash
# Add comment with summary
gh issue comment <issue-number> --repo i-FeelBetter/fbagents --body "## Processing Complete

### Outputs Created

**Global Knowledge** (delegated to fbagents-evolution):
- Friction item X: Delegated, PR #XX created

**Repo-Local Knowledge:**
- PR #YY: <description> (source-repo)

**Environment Improvements:**
- Issue #ZZ: <description> (source-repo)

**Skipped:**
- Friction item 3: Too vague to act on
"

# Update labels
gh issue edit <issue-number> --repo i-FeelBetter/fbagents --remove-label "pending" --add-label "processed"

# Close the issue
gh issue close <issue-number> --repo i-FeelBetter/fbagents
```

## Categorization Reference

| Friction Pattern | Type | Scope | Action |
|------------------|------|-------|--------|
| "User said always/never..." | Knowledge | Global | Delegate to fbagents-evolution |
| "This repo uses pattern X" | Knowledge | Repo-local | PR to source repo |
| "Couldn't verify because no tests" | Environment | Repo | Issue on source repo |
| "No linting caught the error" | Environment | Repo | Issue on source repo |
| "Missing API credentials" | Environment | Repo | Issue on source repo |
| "Can't run UI locally" | Environment | Repo | Issue on source repo |
| "User preference for this repo only" | Knowledge | Repo-local | PR to source repo |

## Error Handling

| Error | Action |
|-------|--------|
| Source repo not accessible | Work from friction item alone, note limitation |
| PR creation fails | Create issue with proposed content instead |
| Issue creation fails | Document in friction log issue comments |
| fbagents-evolution agent fails | Document in friction log issue, flag for manual review |

## Example Processing

```
Processing friction log issue #42...

Parsed 3 friction items from issue.

Friction item 1: "Type errors not caught"
  → Type: Environment
  → Action: Create issue on source repo
  → Created: company/backend-api#123

Friction item 2: "User prefers explicit return types"
  → Type: Knowledge
  → Scope: Global (applies to all Python)
  → Action: Delegate to fbagents-evolution agent
  → Agent created: PR #45 (instructions/AGENTS.md)

Friction item 3: "Auth flow explanation"
  → Skipped: Project-local context, not actionable

Updated issue #42: pending → processed
Closed issue #42
```

## Reference Documents

- `references/categorization.md` - Detailed categorization guidance
