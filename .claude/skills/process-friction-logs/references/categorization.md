# Friction Item Categorization

This document provides detailed guidance on categorizing friction items into improvements.

## The Core Question

For each friction item, ask: **"What would make agents work better next time?"**

The two highest-leverage answers are:
1. **Environment**: Make the system more verifiable so agents can iterate
2. **Knowledge**: Provide missing context so agents know what to do

## Decision Tree

```
Is this friction item actionable?
├── No → Skip (too vague, one-time decision, no clear path)
└── Yes ↓

What type of improvement would help?
├── Agent couldn't verify their work → ENVIRONMENT
│   (missing tests, linting, types, access, tooling)
│
├── Agent didn't know something → KNOWLEDGE
│   (missing docs, patterns, preferences, conventions)
│
└── Both → Create both (environment issue + knowledge PR)
```

## Environment Improvements

These are structural changes to the development environment that enable verification.

### Indicators

- "Couldn't verify the change worked"
- "No tests caught this"
- "Type error at runtime"
- "Linting would have caught this"
- "Don't have access to..."
- "Can't run ... locally"
- Agent had to ask user to verify something

### Common Categories

| Category | Examples |
|----------|----------|
| **Verification tools** | Add linting, type checking, tests to CI |
| **Local development** | Set up local dev environment, docker-compose |
| **Cross-repo setup** | Enable running frontend + backend together |
| **Access & credentials** | API keys for testing, database access |
| **Automation** | Scripts for common verification tasks |

### Output

Create an issue on the source repository:
- Labels: `agent-improvement`, `environment`
- Clear description of what's needed
- Explanation of why it matters for agent effectiveness
- Specific actionable items

## Knowledge Improvements

These are documentation additions that provide missing context.

### Indicators

- "User said always/never..."
- "User corrected me..."
- "Didn't know about this pattern"
- "Missing documentation for..."
- "User preference for..."

### Scope Determination

**Global** (add to fbagents):
- Applies to all repositories
- Language/framework-level patterns
- Universal preferences
- User said "I always..." or "We always..."

**Repo-local** (add to source repo):
- Specific to this codebase
- Architecture patterns unique to repo
- Repo-specific conventions
- User said "In this repo..." or "This project..."

### Storage Location (for global)

```
Is this a simple rule (1-2 lines)?
├── Yes → instructions/AGENTS.md
│         (find appropriate section)
└── No → Does it fit an existing skill?
    ├── Yes → Update that skill
    │         (SKILL.md or references/)
    └── No → Is it substantial enough for new skill?
        ├── Yes → Create new skill
        └── No → instructions/AGENTS.md with more detail
```

### Output

Create a PR:
- For global: PR to fbagents
- For repo-local: PR to source repo

## Skipping Friction Items

Not every friction item becomes an improvement. Skip when:

- **Too vague**: "Something went wrong" (no clear action)
- **One-time decision**: Specific to that task, not recurring
- **Already covered**: Check existing docs first
- **No clear improvement**: The friction was unavoidable
- **Context-dependent**: Would only apply in very specific situations

When skipping, document why in the processing summary.

## Combination Cases

Sometimes a friction item suggests both types:

**Example**: "Agent made type errors that weren't caught"

- Environment: Add type checking to CI
- Knowledge: Document the type conventions used in the repo

Create both outputs when both would add value.

## Quality Checks

Before creating an improvement, verify:

- [ ] Is this truly recurring, not one-time?
- [ ] Is there enough context to act on?
- [ ] Does this not conflict with existing content?
- [ ] Will this actually help agents work better?

## Examples

### Environment Example

**Friction Item**: "Couldn't verify the backend changes worked with the frontend. The frontend is in a different repo and there's no way to run them together locally."

**Analysis**:
- Agent was blocked from verification
- This is structural (environment), not knowledge
- Affects all future work on this repo

**Output**: Issue on source repo
```
Title: [Agent Improvement] Set up local dev environment for full-stack testing
Labels: agent-improvement, environment

## Summary
There's no way to run the frontend and backend together locally, which blocks verification of changes that affect both.

## Why This Matters
AI agents (and developers) cannot verify that backend changes work correctly with the frontend until changes are deployed. This increases the risk of bugs and slows iteration.

## Suggested Actions
- Add docker-compose setup for running frontend + backend
- Document how to run full-stack locally
- Consider adding integration tests
```

### Knowledge Example

**Friction Item**: "User corrected me twice about return type annotations. Said 'I always want explicit return types, even for simple functions.'"

**Analysis**:
- Clear user preference
- "Always" indicates global scope
- Simple rule (1-2 lines)

**Output**: PR to fbagents, add to Python section in AGENTS.md
```markdown
### Python Type Annotations

**Principle**: Always include explicit return type annotations on functions.

**How to apply**:
- Every function should have a return type annotation
- Use `-> None` for functions that don't return anything
- Don't rely on type inference for return types
```

### Skip Example

**Friction Item**: "Had to refactor the payment flow"

**Analysis**:
- Too vague - what about it?
- No clear action
- Sounds like normal work, not friction

**Action**: Skip - not actionable
