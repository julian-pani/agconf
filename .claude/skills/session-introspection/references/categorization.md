# Learning Scope Categorization

This document provides guidance on determining the **scope** of learnings. Format decisions (AGENTS.md vs skill) are handled by the `fbagents-evolution` agent.

## Scope Categories

### Global Scope

Learnings that apply across all repositories and projects.

**Indicators**:
- User says "I always...", "We always...", "Never..."
- Applies to a language/framework, not a specific codebase
- Would benefit other projects the user works on
- Relates to tooling, workflow, or general preferences

**Examples**:
- "Always use explicit type hints in Python"
- "Prefer pytest fixtures over setUp methods"
- "Use pnpm instead of npm"
- "Include error context in log messages"

**Handler**: Delegate to `fbagents-evolution` agent (decides format and location)

### Repo-Local Scope

Learnings specific to a particular codebase or repository.

**Indicators**:
- Relates to this repo's architecture or patterns
- References specific files, modules, or conventions in this codebase
- Would not apply to other projects
- Documents "how we do things here"

**Examples**:
- "This repo uses hexagonal architecture"
- "Authentication is handled by the AuthService in src/auth/"
- "Tests must pass CI before merge (run `make test`)"
- "API responses follow the {data, error, meta} shape"

**Handler**: Add to `repo/.claude/CLAUDE.md` directly

### Project-Local Scope

Learnings specific to the current work/task that don't generalize.

**Indicators**:
- Only relevant to understanding this specific piece of work
- Temporary or contextual knowledge
- Would clutter permanent documentation
- More like "notes" than "standards"

**Examples**:
- "The payment flow uses Stripe webhooks for confirmation"
- "Had to work around bug in library X by doing Y"
- "User wants to revisit this decision later"

**Handler**: No action (stays in `projects/<name>/learnings.md`)

## Decision Tree

```
Is this learning specific to the current task/project only?
├── Yes → PROJECT-LOCAL
│         (no action needed)
└── No ↓

Does this apply only to this repository/codebase?
├── Yes → REPO-LOCAL
│         (add to repo/.claude/CLAUDE.md)
└── No → GLOBAL
          (delegate to fbagents-evolution agent)
```

## Common Patterns

| Learning Pattern | Typical Scope |
|-----------------|---------------|
| "I always..." / "We always..." | Global |
| "Never do X" / "Always do Y" | Global |
| "This repo uses..." | Repo-local |
| "Run tests with..." (repo-specific) | Repo-local |
| "For this feature..." | Project-local |
| "Workaround for this bug..." | Project-local |

## When Unsure

Default to the more conservative (narrower) scope:
- Unsure between Global and Repo-local → Choose Repo-local
- Unsure between Repo-local and Project-local → Choose Project-local

You can always promote a learning to a broader scope later.

## When to Document Preferences vs One-Time Decisions

Not every pattern observed is a preference worth documenting:

**Document as preference when:**
- User explicitly states it: "I always...", "We always...", "The team uses..."
- Pattern observed multiple times across different contexts
- User corrects you when you deviate from the pattern
- Clear evidence of intentional, repeatable standard

**Don't document when:**
- Pattern observed only once
- Contextual decision specific to that task
- No explicit confirmation from user
- Uncertain if it's a true standard vs situational choice

**Examples of one-time decisions** (don't document):
- User places a specific config file template at the project root - do not try to generalize to "all config files should be placed in the project root", it's too general. You may suggest a learning for this specific config file. If the config file is something widely used like a .gitignore or a Dockerfile, it's ok to suggest this as a possibly recurring pattern. But if it's something very specific to the current project or task, then no.
- Adding a specific library relevant for the current task

**Examples of true preferences** (document):
- User says "I prefer config in .env files" after you suggested another approach
- User corrects naming convention twice across different files
- Codebase shows consistent pattern (e.g., all tests in __tests__ directories)

**Why this matters**: Distinguish between one-time decisions and true team standards. We want to capture recurring patterns that enable standardization, not create noise by documenting every contextual decision. Focus on what could truly be a repeatable pattern vs what was specific to the current task.
