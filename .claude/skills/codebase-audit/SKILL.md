---
name: codebase-audit
description: Comprehensive codebase audit workflow for code quality, technical debt, test coverage, documentation, and module organization. Use when performing project health assessments, preparing for refactoring, onboarding to a new codebase, or identifying areas for improvement. Works with any programming language. Runs multiple parallel sub-agents for efficient analysis.
argument-hint: "[commit-range]"
---

# Codebase Audit

A structured workflow for comprehensive codebase analysis. This skill orchestrates multiple parallel sub-agents to audit different aspects of code health, then consolidates findings into an actionable improvement plan.

Works with any programming language or technology stack.

## Workflow Overview

1. **Scope**: Determine audit scope using git history
2. **Setup**: Create a project directory for audit artifacts
3. **Analysis**: Launch parallel sub-agents for each audit dimension
4. **Consolidation**: Synthesize findings into prioritized action items
5. **Execution**: Optionally spawn sub-agents to address critical issues

## Step 1: Gather Commit History as Context

Use git commit history as **hints** to inform the audit. The audit covers the entire codebase, but recent changes provide valuable context for prioritization and analysis.

### Optional Argument: Commit Range

The skill accepts an optional `$ARGUMENTS` parameter to specify the commit range:

| Format | Example | Meaning |
|--------|---------|---------|
| Date (YYYY-MM-DD) | `/codebase-audit 2026-01-15` | Commits since that date |
| Number | `/codebase-audit 50` | Last N commits |
| (none) | `/codebase-audit` | Auto-detect (see below) |

### Determining History Range

**If `$ARGUMENTS` is provided:**
- If it matches `YYYY-MM-DD` format → use as date: `git log --since="$ARGUMENTS"`
- If it's a number → use as count: `git log -$ARGUMENTS`

**If no argument provided (auto-detect):**
1. **Check for previous audits**: Look for existing `projects/codebase_audit_*` directories
2. **If previous audit exists**: Gather commits since the most recent audit date
   - Extract date from directory name (e.g., `codebase_audit_2026-01-15` → `2026-01-15`)
   - `git log --since="2026-01-15" --oneline`
3. **If no previous audit**: Default to the last 100 commits
   - `git log -100 --oneline`

### Gathering Commit Context

Run `git log` to collect:
- Commit messages (hints about what changed and why)
- Files modified per commit
- Authors (for context on who touched what)

Example commands:
```bash
# With date argument (e.g., /codebase-audit 2026-01-15)
git log --since="2026-01-15" --name-status --pretty=format:"%h %s (%an, %ad)" --date=short

# With count argument (e.g., /codebase-audit 50)
git log -50 --name-status --pretty=format:"%h %s (%an, %ad)" --date=short

# Auto-detect: since last audit or last 100 commits
git log -100 --name-status --pretty=format:"%h %s (%an, %ad)" --date=short
```

### How Sub-Agents Should Use Commit Context

Save the commit summary to `projects/codebase_audit_YYYY-MM-DD/commit-history.md` and provide it as context to each sub-agent. The commit history serves as **hints**, not constraints:

- **Prioritize findings**: Issues in recently modified files are more relevant
- **Understand intent**: Commit messages explain why changes were made
- **Detect hotspots**: Files with frequent changes may need extra scrutiny
- **Spot regressions**: Compare current state against stated commit intentions
- **Add context to reports**: Note when issues exist in recently-touched code vs legacy code

**Important**: The audit still examines the entire codebase. Commit history helps prioritize and contextualize findings, not limit the scope.

## Step 2: Create Project Directory

Create a project directory using the current date:

```
projects/codebase_audit_YYYY-MM-DD/
├── commit-history.md      # Recent commits (context for analysis)
├── code-quality.md        # Code quality analysis results
├── legacy-dead-code.md    # Technical debt inventory
├── test-coverage.md       # Test gap analysis
├── documentation.md       # Documentation audit
├── module-organization.md # Naming/structure analysis
├── consolidated-plan.md   # Prioritized action items
└── progress.md            # Work tracking
```

Example: `projects/codebase_audit_2026-02-03/`

## Step 3: Launch Parallel Analysis Sub-Agents

Launch all five audit sub-agents in parallel using the Task tool. Each sub-agent writes findings to its respective file in the project directory.

---

### Audit 1: Code Quality

**Scope:**
- Architecture pattern compliance (e.g., layered, service-oriented, MVC)
- Type safety and type annotation coverage
- Import/export consistency
- Code duplication detection
- Function/method complexity (cyclomatic complexity)
- Code smell detection
- Design pattern adherence
- Error handling patterns
- Asynchronous code patterns
- Debug/logging statement cleanup

**Language-specific examples:**
- TypeScript: zero `any` usage, strict mode compliance
- Python: type hints coverage, pylint/mypy compliance
- Go: error handling patterns, interface usage
- Java: null safety, exception handling

**Output format:**
```markdown
# Code Quality Report

## Critical Issues
[Issues requiring immediate attention]

## High Priority
[Significant problems affecting maintainability]

## Medium Priority
[Code smells and style violations]

## Low Priority
[Minor improvements]

## Summary
- Total issues: X
- Critical: X | High: X | Medium: X | Low: X
```

---

### Audit 2: Legacy & Dead Code

**Scope:**
- Dead code detection (unused functions, imports, files)
- Legacy code patterns (old APIs, deprecated methods)
- Code duplication analysis
- Technical debt inventory
- Unused dependencies in manifest files (e.g., package.json, requirements.txt, go.mod, pom.xml)
- Commented-out code blocks
- TODO/FIXME/HACK comments inventory

**Output format:**
```markdown
# Technical Debt Report

## Dead Code
[Unused functions, imports, and files to remove]

## Deprecated Patterns
[Legacy APIs and methods to modernize]

## Duplicated Code
[Copy-paste violations to consolidate]

## Unused Dependencies
[Packages to remove from dependency manifests]

## Code Comments Inventory
### TODOs
[List with file locations]

### FIXMEs
[List with file locations]

### HACKs
[List with file locations]

## Cleanup Recommendations
[Prioritized cleanup actions]
```

---

### Audit 3: Test Coverage

**Scope:**
- Current coverage metrics (overall, by domain/module)
- Coverage gaps (untested files, functions)
- Missing test types (unit, integration, E2E)
- Test quality assessment
- Mock/stub quality
- Test organization and naming
- Flaky test detection
- Test execution time analysis

**Output format:**
```markdown
# Test Coverage Report

## Coverage Metrics
| Domain | Line % | Branch % | Function % |
|--------|--------|----------|------------|
| ...    | ...    | ...      | ...        |

## Coverage Gaps
### Untested Files
[Files with 0% coverage]

### Untested Functions
[Critical functions lacking tests]

## Missing Test Types
### Unit Tests Needed
[Components requiring unit tests]

### Integration Tests Needed
[Interactions requiring integration tests]

### E2E Tests Needed
[User flows requiring E2E coverage]

## Test Quality Issues
[Weak assertions, poor mocking, etc.]

## Recommendations
[Prioritized testing improvements]
```

---

### Audit 4: Documentation

**Scope:**
- Code documentation coverage (docstrings, comments)
- API documentation completeness
- User documentation (HOW-TO guides)
- Architecture documentation (ADRs)
- README completeness
- Outdated documentation detection
- Missing documentation for features
- Troubleshooting guides

**Language-specific examples:**
- TypeScript/JavaScript: JSDoc coverage
- Python: docstring coverage (Google/NumPy/Sphinx style)
- Go: GoDoc comments
- Java: Javadoc coverage

**Output format:**
```markdown
# Documentation Audit Report

## Code Documentation
### Well-Documented
[Files/modules with good inline docs]

### Needs Documentation
[Files/modules lacking docs]

## API Documentation
[Status of API docs, missing endpoints]

## User Documentation
### Existing Guides
[Available HOW-TO content]

### Missing Guides
[User flows without documentation]

## Architecture Documentation
[ADR status, missing decisions]

## README Assessment
[Completeness checklist]

## Stale Documentation
[Docs that don't match current code]

## Recommendations
[Prioritized documentation work]
```

---

### Audit 5: Module Naming & Organization

**Scope:**
- Module naming vs actual responsibilities
- Generic utilities hidden in domain-specific modules
- Cross-module dependency analysis
- Import aliasing that suggests naming confusion
- Single Responsibility Principle violations
- Utility code placement

**Detection heuristics:**

1. **Domain-specific filename analysis**
   - Identify files with domain names (e.g., `user_*.py`, `payment_service.go`, `AuthController.java`)
   - Check importers: if imported by 3+ unrelated modules → likely misplaced generic code
   - Review exports: do all functions relate to the filename's domain?

2. **Import aliasing patterns**
   - Look for aliased imports adding domain context
   - Example (TypeScript): `import { computeHash as computeUserHash }`
   - Example (Python): `from utils import hash as user_hash`
   - Signals: original name too generic, or function is misplaced

3. **Utility function placement**
   - Generic functions (hashing, parsing, formatting) should live in shared locations (`/utils/`, `/lib/`, `/common/`, `/shared/`)
   - Domain modules should only export domain-specific logic

4. **Dependency graph analysis**
   - Map which modules import which
   - Modules imported by many unrelated domains → extract shared utilities

**Output format:**
```markdown
# Module Organization Report

## Naming Issues
| File | Problem | Recommendation |
|------|---------|----------------|
| ...  | ...     | ...            |

## Misplaced Utilities
| Function | Current Location | Recommended Location | Importers |
|----------|------------------|----------------------|-----------|
| ...      | ...              | ...                  | ...       |

## SRP Violations
[Modules with multiple responsibilities]

## Dependency Analysis
[High fan-in modules suggesting extraction]

## Refactoring Plan
[Ordered steps with import update lists]
```

---

## Step 4: Consolidate Findings

After all sub-agents complete, create `consolidated-plan.md`:

```markdown
# Audit Consolidated Plan

## Executive Summary
[High-level health assessment]

## Critical Issues (Fix Immediately)
[Issues blocking development or causing bugs]

## High Priority (This Sprint)
[Significant technical debt]

## Medium Priority (Backlog)
[Improvements for code health]

## Low Priority (Future)
[Nice-to-haves]

## Recommended Order of Operations
1. [First action]
2. [Second action]
...
```

## Step 5: Execute Fixes (Optional)

If the user wants to proceed with fixes, spawn sub-agents for each priority tier, starting with critical issues.

### Commit Strategy

**Each issue type must be committed separately** for easier PR review. Group related fixes of the same kind into one commit, but keep different issue types in separate commits.

- Group by issue type, not by file. For example, "remove unused imports" across multiple files is one commit, but "remove unused imports" and "simplify error handling" are two separate commits.
- Use descriptive commit messages (e.g., `fix: remove unused imports`, `refactor: extract shared hash utility`)
- Follow the repository's commit conventions (check AGENTS.md / CLAUDE.md)
- Update `progress.md` after each commit to track what has been completed

## Tips for Effective Audits

- **Scope appropriately**: For large codebases, audit specific modules or recent changes
- **Use git history**: Focus on recently modified files for higher relevance
- **Check CI/CD**: Review existing linting rules and test configurations
- **Leverage existing tools**: Run language-specific analyzers (e.g., type checkers, linters, coverage tools)
- **Be specific**: Include file paths and line numbers in findings
