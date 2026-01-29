# GitHub Issue Format for Friction Logs

This document defines the format for friction log issues submitted to the fbagents repository.

## Issue Title

```
[Friction Log] Session in {org}/{repo}
```

Example: `[Friction Log] Session in company/backend-api`

## Labels

Required labels:
- `friction-log` - Identifies this as a friction log submission
- `pending` - Indicates it hasn't been processed yet

## Issue Body Template

```markdown
## Session Context

| Field | Value |
|-------|-------|
| Source Repository | `{org}/{repo}` |
| Repository URL | {repo_url} |
| Branch | `{branch}` |
| Commit SHA | `{commit_sha}` |
| Session Date | {date} |
| Session ID | `{session_id}` |

---

## Friction Items

### 1. {item_title}

**What happened**: {description}

**Evidence**:
{evidence_list}

**Impact**: {impact}

**Suggested type**: {Knowledge|Environment}

---

### 2. {item_title}

...

---

## Conversation Reference

Full conversation JSONL attached to this issue.
Session file: `{session_file_path}`
```

## Field Descriptions

### Session Context Table

| Field | Description | Example |
|-------|-------------|---------|
| Source Repository | GitHub org/repo format | `company/backend-api` |
| Repository URL | Full clone URL | `https://github.com/company/backend-api` |
| Branch | Git branch at time of session | `feature/add-auth` |
| Commit SHA | Full commit hash at end of session | `abc123def456...` |
| Session Date | ISO date of submission | `2026-01-07` |
| Session ID | Claude Code session UUID | `36fc3550-39f2-49dc-8b9a-751a10bb4359` |

### Friction Items Section

Each friction item should be numbered and include all required fields from `friction-log-format.md`.

### Conversation Reference

The full conversation JSONL should be attached to the issue. This enables the processing agent to look up additional context if needed.

## Example Issue

```markdown
## Session Context

| Field | Value |
|-------|-------|
| Source Repository | `company/backend-api` |
| Repository URL | https://github.com/company/backend-api |
| Branch | `feature/add-auth` |
| Commit SHA | `a1b2c3d4e5f6g7h8i9j0` |
| Session Date | 2026-01-07 |
| Session ID | `36fc3550-39f2-49dc-8b9a-751a10bb4359` |

---

## Friction Items

### 1. Type errors not caught before runtime

**What happened**: Agent modified the `calculate_total` function in
`src/billing/calculator.py:45`, changing the return type from `Decimal` to `float`.
This caused a runtime error when the calling code tried to use Decimal methods.

**Evidence**:
- User said: "This broke the invoice generation. You can't just change Decimal to float."
- Error occurred at `src/billing/invoice.py:82` when calling `total.quantize()`
- No type checker caught this before the agent committed

**Impact**: Had to revert the change and redo the refactoring. ~15 minutes lost.

**Suggested type**: Environment

---

### 2. User prefers explicit return type annotations

**What happened**: Agent wrote functions without return type annotations. User
corrected this twice during the session.

**Evidence**:
- First correction: "Add the return type to this function"
- Second correction: "I always want explicit return types, even for simple functions"
- Pattern: User wants `def foo() -> int:` not `def foo():`

**Impact**: Minor rework to add annotations after the fact.

**Suggested type**: Knowledge

---

### 3. No way to test UI integration

**What happened**: Agent implemented backend changes but couldn't verify they worked
with the frontend because there's no local setup for running both together.

**Evidence**:
- Agent asked: "How can I verify this works with the UI?"
- User: "You can't, the frontend is in a different repo and we don't have a local setup"

**Impact**: Could not verify end-to-end behavior. Potential bugs discovered later.

**Suggested type**: Environment

---

## Conversation Reference

Full conversation JSONL attached to this issue.
Session file: `/Users/user/.claude/projects/-company-backend-api/36fc3550-39f2-49dc-8b9a-751a10bb4359.jsonl`
```

## Attachment

The conversation JSONL file should be attached to the issue. If the file is too large:

1. **Compress**: Gzip the file before attaching
2. **Excerpt**: Include only messages related to the friction items
3. **Reference**: Include the session file path for manual lookup

## Processing

Once submitted, the friction log issue enters the processing queue. A processing agent will:

1. Read the issue content
2. Load fbagents context
3. Optionally clone/read the source repo
4. Optionally read the conversation attachment
5. Categorize each friction item
6. Create appropriate outputs (PRs for knowledge, issues for environment)
7. Close the friction log issue with links to outputs
8. Change label from `pending` to `processed`
