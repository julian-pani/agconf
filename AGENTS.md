# Company Engineering Standards for AI Agents

This document defines company-wide engineering standards that all AI coding agents must follow when working in our repositories.

## Purpose

These standards ensure consistency, maintainability, and operational excellence across all engineering projects. AI agents must treat these as **required practices**, not suggestions.

---

## Python Standards

### Logging Configuration (REQUIRED)
 
**Policy**: All Python services MUST use the `python-structlog-datadog` skill for logging configuration.

**When to apply**:
- Creating new Python services
- Modifying existing Python services (logging code)
- Refactoring or major feature work in Python services

**Agent instruction**: Read and follow the `$python-structlog-datadog` skill for complete implementation details.

**Exceptions**: Must be approved by VP Engineering and documented in service's README.

### Agent Workflow for Python Services

**New Python Services**:
1. Read and apply `$python-structlog-datadog` skill before writing business logic
2. Set up logging in initial scaffolding

**Existing Python Services**:
1. Check current logging implementation
2. If non-compliant: flag violation, offer migration, reference skill's migration guide
3. If compliant: maintain consistency

---

## Agent Workflow Guidelines

When working on any codebase, you must follow:
1. The general guidelines in this document (Development Principles, Documentation Standards, etc.)
2. The standards for the specific programming language(s) used in the codebase (e.g., Python Standards)
3. Any other applicable standards based on the work being done (CI/CD, Version Control, etc.)

### Standards Violations
When detecting non-compliance with any standard:
- Report the violation clearly to the user
- Offer to fix/migrate using the relevant skill
- If user declines: document for later, continue with requested work

---

## Development Principles

These are fundamental engineering practices that should guide all AI agent work, regardless of technology or domain.

### Prefer Simplicity Over Complexity

**Principle**: When multiple approaches are possible, choose the simpler one that achieves the goal.

**How to apply**:
- Start with the simplest approach that could work
- Only add complexity when it's absolutely necessary
- If uncertain which approach is simpler, ask the user for preferences
- Avoid premature optimization or over-engineering

**Why this matters**: Simple code is easier to understand, maintain, debug, and extend. Complexity should only be introduced when there's a clear, justified need.

### Extend Existing Patterns, Don't Replace Them

**Principle**: Before creating new patterns or architectures, thoroughly explore and extend what already exists.

**How to apply**:
- Search the codebase for similar functionality before implementing from scratch
- Look for established patterns (naming conventions, directory structures, configuration approaches)
- When you find an existing pattern that solves a similar problem, extend it rather than creating a new one
- Only create new patterns when existing ones genuinely don't fit the use case
- If an existing pattern is considered bad or outdated and there's a much better way: document this in friction logs and add TODO comments to the code. This will be handled by a different agent at a different time
- This rule does NOT apply when the task is explicitly about finding, refactoring, or improving existing patterns

**Why this matters**: Extending proven patterns maintains codebase consistency, reduces mental overhead for developers, leverages existing error handling and edge cases, and prevents pattern proliferation that makes codebases harder to navigate.

### Environment-Specific Configuration

**Principle**: Development and production environments usually have different configuration needs, and there must be a way to override relevant configuration fields.

**How to apply**:
- When implementing configuration, consider both dev and prod use cases
- Look for existing config patterns in the codebase (environment variables, config files, runtime configs) and reuse them
- Ensure configuration can be overridden without code changes (via files, environment variables, or runtime injection)
- If there's no clear existing pattern and no information about how configuration should work, ask the user

**Why this matters**: Hard-coded configuration breaks in different environments. Flexible, environment-aware configuration enables the same code to run in dev, staging, and production with appropriate settings.

### Documentation Should Show Multiple Valid Patterns

**Principle**: When documenting configuration, features, or workflows, show multiple valid approaches to accommodate different user preferences and contexts.

**How to apply**:
- Include at least 2 examples when multiple valid approaches exist (e.g., file-based vs inline config)
- Show both simple and complex use cases where appropriate
- Explain when each approach is most suitable
- Don't assume all users will prefer the same workflow

**Why this matters**: Real-world usage varies more than we might assume. Different teams, projects, and individuals prefer different approaches. Comprehensive documentation reduces friction and support requests.

### Test-Driven Bug Fixes

**Principle**: When fixing bugs, always follow TDD to ensure the test catches the bug and prevents regressions.

**How to apply**:
- Write a test that reproduces the bug (should fail)
- Verify the test fails for the right reason
- Apply the fix
- Verify the test now passes
- Add a docstring documenting what bug the test guards against

**Why this matters**: TDD ensures the test actually catches the bug, provides clear verification that the fix works, and prevents the bug from reoccurring. This is standard practice for all bug fixes - no need to ask the user.

### Testing Best Practices

**Principle**: Tests should verify specific, expected behavior and serve as living documentation of how the code works.

**How to apply**:
- **Assert specific outcomes, not ranges**: Never write tests like `assert status in [200, 400, 404]` with "may vary" comments. Read the implementation first and assert the exact expected behavior.
- **Verify error handling content**: When testing graceful error handling, assert both the success status AND the specific error content in the response. A 200 status alone doesn't prove the error was handled correctly.
- **Use existing test utilities**: Before writing custom parsers or helpers for tests, search the codebase for existing implementations (e.g., SSE parsers, mock factories, fixture helpers).

**Why this matters**: Vague assertions don't catch regressions and provide no documentation value. Tests that pass regardless of actual behavior are worse than no tests - they provide false confidence.

---

## Documentation Standards (REQUIRED)

These standards cover feature and codebase documentation - the persistent knowledge that helps humans and AI agents understand how the system works. This is distinct from project-level documentation (plans, progress, friction logs) which is covered separately below.

### Feature Documentation

**Policy**: Document features that introduce new concepts, have non-obvious behavior, or span multiple files.

**Location**: `/docs` directory at repository root
- `docs/architecture/` - System design, component interactions
- `docs/features/` - Individual feature documentation
- Create subdirectories as needed for modules

**What to document**:
- High-level understanding of the big picture (hard to understand from code alone)
- Gotchas and details not obvious from code but important for understanding, debugging, or making changes
- The "why" - implicit decisions and the reasoning behind them

**Audience**: Both humans and AI agents working on the repo without prior context.

### README Updates

**Policy**: Keep README as the overview and index; detailed information lives in `/docs`.

**What belongs in README**:
- User-facing features and entry points
- Information someone cloning the repo needs to know
- Links to detailed documentation in `/docs`

### Code Pointers in Documentation

**Policy**: Reference files or classes, not line numbers (too brittle).

**How to apply**:
- Point to files: "Authentication logic is in `src/auth/handler.ts`"
- For very long files, mention class or function names: "...specifically the `AuthHandler` class"
- Avoid line number references - they break with every code change

### Documentation-First Workflow (IMPORTANT)

**Policy**: Check existing documentation before starting work; update docs as part of feature changes.

**How to apply**:
- Before starting work or exploration: check `/docs` and README for existing documentation
- This integrates with "Extend Existing Patterns" - understand what exists before acting
- When modifying existing features: update related documentation as part of the change
- Proactively flag obviously outdated or stale docs when discovered

### Handling Undocumented Codebases

**Policy**: Grow documentation organically as code is touched; don't block on documenting everything.

**How to apply**:
- When documenting a new feature that depends on undocumented modules: add minimal context docs for those modules as needed
- Write a friction log entry about the missing documentation gap so it can be addressed later
- Focus on the immediate task - comprehensive documentation happens incrementally

**Why this matters**: Many repos have undocumented code. Blocking on full documentation would prevent progress. Organic growth ensures docs are written by those with fresh context.

---

## CI/CD Standards

When implementing or modifying CI/CD pipelines, refer to the `$ci-cd-standards` skill for platform-specific guidance and best practices.

---

## Version Control Standards

### Git Conventions (REQUIRED)

**Policy**: All repositories MUST use the `git-conventions` skill for git workflows and best practices.

**When to apply**:
- Performing git operations (commits, branches, PRs)
- Need quick overview of git standards
- Unsure which specific git skill to reference

**Agent instruction**: Read and follow the `$git-conventions` skill for overview of git standards. This skill references detailed skills (`$conventional-commits` for commit messages, `$git-branch-naming` for branch naming) - dive into those when detailed guidance is needed.

**Exceptions**: Personal projects may use alternative formats (team repositories require team lead approval).

---

## Project-Level Documentation

### Organizing Work into Projects

**Policy**: Organize work artifacts (plans, progress, learnings, notes) into project-scoped directories for all changes except very small and trivial ones.

**Location**: `projects/<project-name>/` at repository root (or module root in monorepos)

**When to apply**:
- **Default behavior**: Use project documentation for all work
- Multi-session work that needs persistent documentation
- Tasks requiring plans, progress tracking, or learning capture
- Any work where context should survive across sessions
- When explicitly requested by the engineer (e.g., "start a project for this work", "create project docs")

**When to skip** (exceptions):
- Single-line fixes (typos, obvious bugs)
- Trivial configuration changes

**Project naming**:
- First time needed in a session: ask the user for confirmation
- Suggest a semantic, kebab-case name based on the work (e.g., `mongodb-migration`, `auth-refactor`)
- If name already exists: ask user to continue existing project or create new
- New project with same name: append date suffix (e.g., `auth-refactor-2025-12-30`)
- Remember chosen name for the rest of the session

**Common files** (create as needed):
- `plan.md` - Implementation plan and design decisions
- `progress.md` - What's been done, current state, next steps
- `friction-logs.md` - Session friction logs: friction points, corrections, mistakes, environment limitations. These are submitted for async processing into improvements.
- `notes.md` - Additional context, decisions, references

**Persistence philosophy**:
- Project notes are permanent reference material (not scratchpads)
- Friction logs stay in project notes even after being submitted for processing
- Content should be self-contained and meaningful for future sessions

**Agent instruction**: When you need to persist session artifacts, use project directories. Ask the user for project name confirmation before first write.

### Capturing Friction Logs During Sessions (MANDATORY)

**Policy**: Friction logs MUST be captured during every session. This is non-negotiable and essential for continuous improvement of agent effectiveness.

**This is mandatory because**: Friction logs are the primary mechanism for improving agent behavior over time. Without them, mistakes repeat, preferences are forgotten, and the system cannot evolve. Every session generates learnings that benefit all future sessions.

**What to capture**:
- Mistakes the agent made and how they were corrected
- User corrections or explicit preferences ("I always want X", "We do Y because...")
- Friction points where the agent struggled or backtracked
- Missing information that would have helped
- Environment limitations that blocked verification (no tests, no linting, missing access)
- Patterns observed in the codebase that aren't documented

**How to capture**:
- Write to `projects/<project-name>/friction-logs.md`
- Each entry must be **self-contained** - include enough context for async processing
- Include: what happened, evidence (quotes, file paths), impact, suggested improvement type (Knowledge or Environment)

**Agent instruction**: Capture friction items as they occur - do not wait until the end of the session. Each friction item should be recorded and submitted immediately after identification.

See `$submit-friction-logs` skill for the friction log entry format.

### Submitting Friction Logs (MANDATORY)

**Policy**: Submit friction logs immediately after each friction item is identified. Do not batch them until end of session.

**When to submit**:
- **Immediately** after identifying and recording a friction item
- Each friction item should result in its own GitHub issue
- Do not wait for session end or work completion
- Multiple issues per session is expected and acceptable

**What happens**:
1. Agent gathers session context (repo, branch, commit, session ID)
2. Creates GitHub issue on fbagents repo with the friction item + context
3. Attaches conversation reference for context
4. Issue enters processing queue immediately

**Async processing** (by dedicated agent):
- Categorizes friction items into improvements
- **Knowledge improvements** → PRs to fbagents (global) or source repo (local)
- **Environment improvements** → Issues on source repo as backlog items

**Agent instruction**: After recording a friction item, invoke `/submit-friction-logs <project-name>` to submit it. This runs as a background subagent and won't block your work. Do not wait for user prompt or session end. One friction item = one submission = one GitHub issue.

---

## Future Standards

As we add more company-wide standards, they will be documented here.
---

## Feedback and Updates

These standards evolve based on engineering team feedback and operational learnings.

**Current Version**: 1.5
**Last Updated**: 2026-01-27
**Maintained By**: Platform Engineering Team
**Questions**: #platform-engineering on Slack