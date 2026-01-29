# Friction Log Format

This document describes how to write effective friction log entries during a session. Good friction items are self-contained, factual, and actionable.

## What to Log

Capture events that suggest ways to improve agent effectiveness:

### Friction Points
- Agent struggled to find information
- Multiple attempts needed to accomplish something
- Agent made assumptions that turned out wrong

### Corrections
- User corrected agent's approach
- User provided information agent didn't have
- User expressed preferences

### Environment Limitations
- Couldn't verify a change worked
- Missing tools (linting, tests, types)
- Missing access (APIs, credentials, other repos)

### Knowledge Gaps
- Agent didn't know about a pattern or convention
- Documentation was missing or outdated
- User had to explain something that should have been documented

## Friction Log Entry Format

Each friction item should be a self-contained entry:

```markdown
### [Brief title - what happened]

**What happened**: [Factual description of the event. Be specific.]

**Evidence**:
- [Specific quotes from the conversation]
- [File paths and line numbers if relevant]
- [User feedback or corrections]

**Impact**: [How this affected the work. What was slowed down or blocked?]

**Suggested type**: [Knowledge | Environment]
```

## Field Descriptions

### Title
A brief summary of what happened. Should be scannable.

Good: "Type errors not caught before runtime"
Bad: "Problem with types"

### What happened
Factual description without interpretation. Focus on the event, not the conclusion.

Good: "Agent modified src/auth.py line 45, changing the return type from int to str. User pointed out this would break callers."
Bad: "Agent made a mistake with types."

### Evidence
Specific, quotable evidence that supports the friction item. Include:
- Direct quotes from the conversation
- File paths and line numbers
- Commands that were run
- Error messages received

### Impact
How did this affect the work? What was the cost?
- Time spent correcting
- Changes that had to be reverted
- Work that couldn't be completed

### Suggested type
Your best guess at whether this needs:
- **Knowledge**: Missing documentation, patterns, preferences
- **Environment**: Missing verification tools, access, setup

This is just a hint - the processing agent will make the final determination.

## Examples

### Good Friction Item

```markdown
### Type errors not caught before runtime

**What happened**: Agent modified the `calculate_total` function in
`src/billing/calculator.py:45`, changing the return type from `Decimal` to `float`.
This caused a runtime error when the calling code tried to use Decimal methods.

**Evidence**:
- User said: "This broke the invoice generation. You can't just change Decimal to float."
- Error occurred at `src/billing/invoice.py:82` when calling `total.quantize()`
- No type checker caught this before the agent committed

**Impact**: Had to revert the change and redo the refactoring. ~15 minutes lost.

**Suggested type**: Environment (add type checking to catch these errors)
```

### Good Friction Item

```markdown
### User prefers explicit return type annotations

**What happened**: Agent wrote functions without return type annotations. User
corrected this twice during the session.

**Evidence**:
- First correction: "Add the return type to this function"
- Second correction: "I always want explicit return types, even for simple functions"
- Pattern: User wants `def foo() -> int:` not `def foo():`

**Impact**: Minor rework to add annotations after the fact.

**Suggested type**: Knowledge (document as global Python preference)
```

### Weak Friction Item (Don't write like this)

```markdown
### Types issue

**What happened**: Something went wrong with types.

**Evidence**: User was unhappy.

**Impact**: Had to fix it.

**Suggested type**: Knowledge
```

This is too vague to be actionable. The processing agent won't have enough context.

## When NOT to Log

Don't capture:
- One-time decisions specific to the current task
- Normal back-and-forth that doesn't indicate an improvement opportunity
- Things that went smoothly (no friction)
- User opinions that weren't stated as preferences

## Session ID

Include the session ID in friction logs to enable conversation lookup:

```markdown
---
Session ID: 36fc3550-39f2-49dc-8b9a-751a10bb4359
Date: 2026-01-07
Repository: company/backend-api
---

### Friction item 1...
```

The session ID is discovered using the `find-session-file.sh` script.
