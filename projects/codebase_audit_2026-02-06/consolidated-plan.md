# Audit Consolidated Plan

**Project:** agconf CLI (v0.6.2)
**Date:** 2026-02-06
**Scope:** Full codebase audit (`cli/src/` - 30 source files)

---

## Executive Summary

The agconf CLI is a well-built TypeScript project with strong fundamentals: strict TypeScript configuration, zero `any` types, Zod schema validation at boundaries, clean ESM imports, and no deprecated API usage. The codebase has zero TODO/FIXME/HACK comments, zero unused dependencies, and no commented-out code blocks -- signs of disciplined development.

However, five systemic issues undermine maintainability:

1. **Code duplication** -- `agents.ts` contains ~170 lines of copy-pasted YAML parsing from `frontmatter.ts`, despite `rules.ts` and `skill-metadata.ts` already using the shared module correctly.
2. **Misleading module names** -- `skill-metadata.ts` is the integrity-checking hub for *all* content types (skills, rules, agents, AGENTS.md), not just skills. Two `schema.ts` files serve unrelated purposes.
3. **Scattered hash computation** -- 7 hash functions across 5 files, despite AGENTS.md explicitly warning "Reuse existing hash functions - DO NOT create new ones."
4. **Test coverage gaps** -- 34% of source files (10 of 29) have zero tests. Critical untested modules include `source.ts`, `frontmatter.ts`, `shared.ts`, and `targets.ts`.
5. **Stale documentation** -- AGENTS.md references a non-existent plugin system, CHECK_FILE_INTEGRITY.md is missing 3 of 5 content types, and the agents feature is absent from all user-facing docs.

**Overall health:** Good foundation, moderate technical debt. The issues are concentrated and addressable. No architectural rewrites needed.

### Aggregate Issue Count

| Source Report | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| Code Quality | 2 | 4 | 6 | 7 | 19 |
| Dead Code / Tech Debt | -- | 3 | 4 | 3 | 10 |
| Test Coverage | 3 | 5 | 6 | 4 | 18 |
| Documentation | 5 | 3 | 3 | 3 | 14 |
| Module Organization | 2 | 3 | 3 | -- | 8 |
| **Cross-report (deduplicated)** | **6** | **10** | **12** | **9** | **37** |

Many issues appear in multiple reports (e.g., agents.ts duplication appears in Code Quality, Dead Code, and Module Organization). The deduplicated count represents ~37 distinct action items.

---

## Critical Issues (Fix Immediately)

These issues create active maintenance risk, potential bugs, or violate the project's own documented guidelines.

### 1. Eliminate YAML parsing duplication in `agents.ts`

**Reports:** Code Quality C1, Dead Code (Duplicated Code), Module Organization (Duplicated Code)

`agents.ts` contains ~170 lines of copy-pasted YAML infrastructure (`FRONTMATTER_REGEX`, `parseFrontmatter`, `parseSimpleYaml`, `serializeFrontmatter`, `needsQuoting`) that already exists in the shared `frontmatter.ts` module. Both `rules.ts` and `skill-metadata.ts` correctly import from `frontmatter.ts`, but `agents.ts` does not.

**Risk:** Any bug fix or behavior change to YAML parsing must be applied in two places. Divergence is inevitable.

**Action:** Refactor `agents.ts` to import from `frontmatter.ts`, exactly as `rules.ts` already does. Delete the 5 private copies. ~130 lines removed.

**Effort:** 1-2 hours

### 2. Remove dead exported functions and types

**Report:** Dead Code (Priority 1)

5 exported functions are never called from production code:
- `getReleaseByTag()` in `version.ts`
- `getModifiedAgentFiles()` in `skill-metadata.ts`
- `buildMarkdownWithFrontmatter()` in `frontmatter.ts`
- `hasFrontmatter()` in `frontmatter.ts`
- `formatWorkflowRef()` in `workflows.ts`

14 exported types/interfaces are never imported:
- `ConfigOptions`, `CheckResult`, `ManagedMetadata`, `Content`, `RulesContent`, `AgentsContent`, `CanonicalMeta`, `CanonicalPaths`, `MarkersConfig`, `MergeConfig`, `SourceConfig`
- 3 types to de-export (keep internal): `SkillFileCheckResult`, `RuleFileCheckResult`, `AgentFileCheckResult`

3 unnecessarily exported symbols in `frontmatter.ts`: `FRONTMATTER_REGEX`, `needsQuoting()`, `parseSimpleYaml()`

**Action:** Remove dead code. De-export internal-only symbols. ~100 lines removed.

**Effort:** 1 hour

### 3. Fix `checkCommand` path resolution

**Reports:** Code Quality H3, Test Coverage (Weakness #1)

`checkCommand` uses `process.cwd()` directly instead of `resolveTargetDirectory()`. This means:
- It produces incorrect results when run from a subdirectory (doesn't resolve to git root)
- It's untestable without mocking `process.cwd()`
- It violates the project's own AGENTS.md guideline: "For commands that use `process.cwd()`, add a `cwd` option for testability"

**Action:** Add a `cwd` option to `checkCommand`. Use `resolveTargetDirectory()` for consistency. Refactor `check.test.ts` to pass `cwd` instead of mocking `process.cwd()`.

**Effort:** 1-2 hours

### 4. Fix stale AGENTS.md plugin system reference

**Reports:** Documentation #3, Dead Code (Non-existent Plugin System)

AGENTS.md references `cli/src/plugins/targets/` and `cli/src/plugins/providers/` which do not exist. Also references "GitHub Copilot" instead of "Codex". This actively misleads contributors and AI agents working on the codebase.

**Action:** Remove the "Plugin System" section from AGENTS.md. Update to reference the actual locations: `core/targets.ts` and `core/source.ts`.

**Effort:** 15 minutes

### 5. Update CHECK_FILE_INTEGRITY.md for all content types

**Report:** Documentation #1, #2

The document only lists 2 of 5 verified content types (AGENTS.md global block and skill files). Missing: rule files, agent files, and AGENTS.md rules section. The example CI workflow paths are also incomplete.

**Action:** Update the document to cover all 5 content types. Update the workflow paths example.

**Effort:** 30 minutes

### 6. Add unit tests for `core/frontmatter.ts`

**Reports:** Code Quality L7, Test Coverage (Priority 1 #2)

This is a custom YAML parser shared by skills, rules, and agents. It has zero dedicated tests. Bugs here silently corrupt all synced content types. Edge cases (special YAML characters, multiline values, empty frontmatter, malformed delimiters) are untested.

**Action:** Create `tests/unit/frontmatter.test.ts` with comprehensive edge case coverage.

**Effort:** 3-4 hours

---

## High Priority (This Sprint)

These issues significantly affect maintainability, testability, or developer experience.

### 7. Rename `skill-metadata.ts` to `managed-content.ts`

**Report:** Module Organization (Phase 1)

The file handles integrity checking for ALL content types (skills, rules, agents, AGENTS.md), not just skills. Both `rules.ts` and `agents.ts` alias their import of `computeContentHash` to `computeSkillContentHash` -- a clear signal the name is wrong.

**Action:** Rename file. Update 5 import sites. Remove import aliasing. Update AGENTS.md references.

**Effort:** 30 minutes

### 8. Replace dynamic imports with static imports in `sync.ts`

**Report:** Code Quality H1

Two functions use `await import("./skill-metadata.js")` despite the module already being statically imported at the top of the file. This creates confusion about circular dependencies that don't exist.

**Action:** Replace with references to the existing static import.

**Effort:** 15 minutes

### 9. Add unit tests for `core/source.ts`

**Report:** Test Coverage (Priority 1 #1)

This module handles all source resolution (local and GitHub) and is on the critical path for every sync operation. It has zero test coverage.

**Action:** Create `tests/unit/source.test.ts` with mocked git operations. Test `resolveLocalSource()` validation, `validateCanonicalRepo()` with malformed configs, `findCanonicalRepo()` traversal, `isCanonicalRepo()` detection.

**Effort:** 4-6 hours

### 10. Add unit tests for `core/targets.ts`

**Report:** Test Coverage (Priority 2 #5), Code Quality H4

Simple validation functions (`isValidTarget`, `parseTargets`, `getTargetConfig`) with zero tests. Easy to write, high value.

**Action:** Create `tests/unit/targets.test.ts`.

**Effort:** 1-2 hours

### 11. Add unit tests for `commands/shared.ts`

**Report:** Test Coverage (Priority 1 #3)

Contains `performSync()` (the main orchestration function), `checkModifiedFilesBeforeSync()` (safety-critical), and `resolveVersion()` (complex version resolution logic). All untested.

**Action:** Create `tests/unit/shared.test.ts` focusing on `checkModifiedFilesBeforeSync()` and `resolveVersion()`.

**Effort:** 4-6 hours

### 12. Fix SECURITY.md, CONTRIBUTING.md, and CLI README issues

**Reports:** Documentation #3-5

- SECURITY.md claims `1.x.x` support but current version is `0.6.2`
- CONTRIBUTING.md references `pnpm changeset` (project uses semantic-release)
- CLI README has a structural issue with duplicate/disjointed Quick Start section

**Action:** Fix all three documents.

**Effort:** 30 minutes

### 13. Document agents feature in user-facing docs

**Report:** Documentation (Priority 2 #6-7)

The agents sync feature (v0.6.0) is documented in AGENTS.md but missing from all user-facing documentation: CANONICAL_REPOSITORY_SETUP.md, README, CLI README, CHECK_FILE_INTEGRITY.md.

**Action:** Add `agents_dir` to canonical setup docs. Update README "Files Created" table to include `.claude/rules/` and `.claude/agents/`.

**Effort:** 1 hour

---

## Medium Priority (Backlog)

### 14. Extract hash utilities to `core/hashing.ts`

**Reports:** Code Quality C2, Module Organization (Phase 3)

7 hash functions across 5 files all implement `sha256:${hash.slice(0,12)}`. Extract a shared `computeHash(content: string): string` utility.

**Effort:** 2-3 hours

### 15. Rename `core/schema.ts` to `core/schema-compat.ts`

**Report:** Module Organization (Phase 1)

Two `schema.ts` files serve different purposes (version compatibility checking vs Zod schema definitions).

**Effort:** 15 minutes

### 16. Eliminate `directoryExists` duplication

**Reports:** Code Quality M4, Dead Code, Module Organization

`git.ts` has a private copy of `directoryExists()` identical to the one in `fs.ts`.

**Effort:** 15 minutes

### 17. Extract presentation logic from `performSync()`

**Reports:** Code Quality H2/M3

`performSync()` is 492 lines. The four nearly-identical `formatXxxList` closures (~120 lines) should be a single generic `formatItemList()` helper. Presentation logic should be separated from orchestration.

**Effort:** 2-3 hours

### 18. Clean up `syncWorkflows()` overloaded signature

**Report:** Dead Code (Deprecated Patterns #3)

`syncWorkflows()` accepts two parameter shapes via runtime type checking. Migrate all callers to `SyncWorkflowsOptions`.

**Effort:** 1-2 hours

### 19. Rename workflow generators in `canonical.ts`

**Reports:** Dead Code (Duplicate workflow generation)

`generateSyncWorkflow()` and `generateCheckWorkflow()` exist in both `canonical.ts` (reusable workflows) and `workflows.ts` (caller workflows). Rename canonical versions to `generateReusableSyncWorkflow()` / `generateReusableCheckWorkflow()`.

**Effort:** 30 minutes

### 20. Add unit tests for `sync()` main function in isolation

**Report:** Test Coverage (Priority 2 #4)

The 400+ line `sync()` orchestrator is only tested through integration. Individual error branches, partial failure scenarios, and component interaction are untested at the unit level.

**Effort:** 4-6 hours

### 21. Add unit tests for `markers.ts` rules section functions

**Report:** Test Coverage (Priority 2 #6)

`parseRulesSection()`, `computeRulesSectionHash()`, `hasRulesSectionChanges()` need direct unit tests.

**Effort:** 2-3 hours

### 22. Add unit tests for `lockfile.ts` I/O functions

**Report:** Test Coverage (Priority 2 #7)

`readLockfile()`, `writeLockfile()`, `checkCliVersionMismatch()` have no tests for corrupt files, missing directories, or version edge cases.

**Effort:** 2-3 hours

### 23. Add integration tests for rules and agents sync end-to-end

**Report:** Test Coverage (Priority 3 #9-10)

Complete flow: source with rules/agents -> sync -> verify files with correct metadata.

**Effort:** 3-4 hours

### 24. Update VERSIONING.md lockfile example

**Report:** Documentation (Priority 2 #8)

Missing `rules`, `agents`, and `marker_prefix` fields in the example lockfile JSON.

**Effort:** 15 minutes

### 25. Add JSDoc to critical undocumented functions

**Report:** Documentation (Priority 3 #9-12)

- `sync()` in `sync.ts` -- the most important function in the codebase, no documentation
- `mergeAgentsMd()` in `merge.ts` -- complex merge algorithm, no documentation
- `resolveLocalSource()` and `resolveGithubSource()` in `source.ts` -- key public functions
- Utility functions in `utils/fs.ts`

**Effort:** 1-2 hours

---

## Low Priority (Future)

### 26. Remove unused `_source` parameter from `mergeAgentsMd`

**Report:** Code Quality L1

Dead parameter that was needed in an earlier version.

### 27. Remove placeholder config command or implement it

**Report:** Code Quality L2

`configShowCommand`, `configGetCommand`, `configSetCommand` are stubs that always report "No configuration options available."

### 28. Replace `execSync` with async alternatives

**Report:** Dead Code (Deprecated Patterns #1)

`version.ts` and `upgrade-cli.ts` use synchronous `execSync` where async alternatives exist.

### 29. Add Zod validation for GitHub API responses

**Report:** Code Quality M2

`version.ts` uses unsafe `as` type assertions for GitHub API response fields.

### 30. Simplify `getMarkers()` indirection

**Report:** Dead Code (Priority 4 #11), Module Organization (Phase 3)

`markers.ts` re-exports `getMarkers` from `config/schema.ts` through a wrapper.

### 31. Clean up CHANGELOG.md

**Report:** Documentation (Priority 4 #13)

Duplicate 0.2.0 entries, mid-file Jekyll frontmatter, duplicate "Unreleased" sections.

### 32. Add E2E tests

**Report:** Test Coverage (Priority 4 #15)

Test the actual CLI binary via child process execution.

### 33. Set up coverage thresholds

**Report:** Test Coverage (Priority 4 #18)

Configure Vitest coverage reporting with minimum thresholds for `core/` modules.

### 34. Set up HTTP mocking infrastructure

**Report:** Test Coverage (Priority 2 #8)

Add `msw` or similar for testing `version.ts` network functions.

### 35. Enable `noNonNullAssertion` in Biome config

**Report:** Code Quality L3

Currently disabled, removing a type safety net.

### 36. Split `version.ts` into semver utilities and GitHub API

**Report:** Module Organization (Phase 4)

Separates pure functions from network/auth code.

### 37. Consider splitting `managed-content.ts` further

**Report:** Module Organization (Phase 4)

After renaming, evaluate splitting metadata operations from integrity checking.

---

## Recommended Order of Operations

This sequence minimizes risk and maximizes each step's value. Steps within the same phase can be parallelized.

### Phase A: Quick wins (1 session, ~3 hours)

1. Remove dead exported functions and types (#2)
2. Fix AGENTS.md plugin system reference (#4)
3. Fix SECURITY.md, CONTRIBUTING.md, CLI README (#12)
4. Update CHECK_FILE_INTEGRITY.md (#5)
5. Replace dynamic imports in `sync.ts` (#8)
6. Rename `core/schema.ts` to `core/schema-compat.ts` (#15)
7. Eliminate `directoryExists` duplication (#16)
8. Rename workflow generators in `canonical.ts` (#19)

### Phase B: Structural cleanup (1 session, ~3 hours)

9. Refactor `agents.ts` to use `frontmatter.ts` (#1) -- the highest-impact change
10. Rename `skill-metadata.ts` to `managed-content.ts` (#7)
11. Fix `checkCommand` path resolution and add `cwd` option (#3)
12. Document agents feature in user-facing docs (#13)
13. Update VERSIONING.md lockfile example (#24)

### Phase C: Test coverage - critical gaps (2-3 sessions, ~12 hours)

14. Add unit tests for `frontmatter.ts` (#6)
15. Add unit tests for `targets.ts` (#10)
16. Add unit tests for `source.ts` (#9)
17. Add unit tests for `shared.ts` (#11)

### Phase D: Deeper refactoring (1-2 sessions, ~5 hours)

18. Extract hash utilities to `core/hashing.ts` (#14)
19. Extract presentation logic from `performSync()` (#17)
20. Clean up `syncWorkflows()` overloaded signature (#18)
21. Add JSDoc to critical functions (#25)

### Phase E: Test coverage - expanded (2-3 sessions, ~12 hours)

22. Add unit tests for `sync()` main function (#20)
23. Add unit tests for markers rules section functions (#21)
24. Add unit tests for lockfile I/O (#22)
25. Add integration tests for rules/agents end-to-end (#23)

### Phase F: Polish (ongoing)

26-37. Low priority items as time permits.

---

## Estimated Total Effort

| Phase | Items | Effort |
|---|---|---|
| A: Quick wins | 8 | ~3 hours |
| B: Structural cleanup | 5 | ~3 hours |
| C: Test coverage (critical) | 4 | ~12 hours |
| D: Deeper refactoring | 4 | ~5 hours |
| E: Test coverage (expanded) | 4 | ~12 hours |
| F: Polish | 12 | ~8 hours |
| **Total** | **37** | **~43 hours** |

Phases A+B alone (~6 hours) would resolve all critical issues and significantly improve the codebase. Phase C addresses the most impactful test coverage gaps. Phases D-F are incremental improvements that can be done over multiple sprints.

---

## Execution Progress

**Executed on:** 2026-02-06
**Branch:** `audit/codebase-audit-2026-02-06` (worktree at `.worktrees/codebase-audit/`)
**Final state:** 517 tests passing, typecheck clean, lint clean

### Completed Items

All Critical (#1-#6) and most High Priority (#7-#8, #10, #12-#13) items have been implemented.

| # | Item | Status | Details |
|---|---|---|---|
| 1 | Eliminate YAML duplication in agents.ts | **DONE** | Removed ~170 lines. `agents.ts` now imports from `frontmatter.ts` via thin wrapper, matching `rules.ts` pattern. |
| 2 | Remove dead exported functions and types | **DONE** | Removed 5 functions (`getReleaseByTag`, `getModifiedAgentFiles`, `buildMarkdownWithFrontmatter`, `hasFrontmatter`, `formatWorkflowRef`), 11 dead type exports, de-exported 3 internal types and 3 internal symbols in `frontmatter.ts`. Also removed `formatWorkflowRef` test block from `workflows.test.ts`. |
| 3 | Fix `checkCommand` path resolution | **DONE** | Added `cwd?: string` to `CheckOptions`, changed `process.cwd()` to `options.cwd ?? process.cwd()`. Removed `CheckResult` dead interface. Updated all 28 test cases to use `cwd` option instead of `process.cwd` mock. |
| 4 | Fix stale AGENTS.md plugin system reference | **DONE** | Removed "Plugin System" section, updated "Key Patterns" to reference actual `targets.ts` and `source.ts` locations, changed "GitHub Copilot" to "Codex". |
| 5 | Update CHECK_FILE_INTEGRITY.md | **DONE** | Added all 5 content types (was only 2), updated CI workflow paths to include `.claude/rules/**` and `.claude/agents/**`. |
| 6 | Add unit tests for frontmatter.ts | **DONE** | Created `tests/unit/frontmatter.test.ts` with 57 tests covering `parseFrontmatter` and `serializeFrontmatter` including edge cases, roundtrip, special characters, CRLF handling. Documented known limitation with CRLF line endings in intermediate YAML lines. |
| 7 | Rename `skill-metadata.ts` to `managed-content.ts` | **DONE** | Renamed source and test file. Updated all 5 import sites. Removed `computeSkillContentHash` aliasing in `rules.ts` and `agents.ts`. Updated AGENTS.md references. |
| 8 | Replace dynamic imports in sync.ts | **DONE** | Added `isManaged` and `hasManualChanges` to existing static import. Removed 2 dynamic `await import()` calls in `deleteOrphanedAgents` and `deleteOrphanedSkills`. |
| 10 | Add unit tests for targets.ts | **DONE** | Created `tests/unit/targets.test.ts` with 42 tests covering `isValidTarget`, `parseTargets`, `getTargetConfig`, `SUPPORTED_TARGETS`, `TARGET_CONFIGS`. |
| 12 | Fix SECURITY.md, CONTRIBUTING.md, CLI README | **DONE** | Fixed version `1.x.x` → `0.x.x` in SECURITY.md. Removed `pnpm changeset` section from CONTRIBUTING.md. Fixed disjointed Quick Start in CLI README. |
| 13 | Document agents feature in user-facing docs | **DONE** | Updated root README "Files Created" table (added `.claude/rules/`, `.claude/agents/`). Added `agents_dir`/`rules_dir` to CANONICAL_REPOSITORY_SETUP.md. Updated VERSIONING.md lockfile example with `rules`, `agents`, `marker_prefix` fields. |

### Files Changed Summary

| Category | Files | Lines Changed |
|---|---|---|
| Code refactoring | `agents.ts`, `sync.ts`, `rules.ts`, `check.ts`, `shared.ts` | -172 net (agents.ts duplication) |
| Dead code removal | `version.ts`, `frontmatter.ts`, `workflows.ts`, `config.ts`, `schema.ts`, `lockfile.ts`, `managed-content.ts` | -97 lines removed |
| Rename | `skill-metadata.ts` → `managed-content.ts` (source + test) | 12 files updated |
| Documentation | `AGENTS.md`, `README.md`, `cli/README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CHECK_FILE_INTEGRITY.md`, `CANONICAL_REPOSITORY_SETUP.md`, `VERSIONING.md` | 8 docs fixed |
| New tests | `frontmatter.test.ts` (57 tests), `targets.test.ts` (42 tests), `managed-content.test.ts` (renamed) | +99 new tests |
| **Total** | **26 files modified, 3 new files** | **net -1,153 lines** |

| 9 | Add unit tests for `source.ts` | **DONE** | Created `tests/unit/source.test.ts` with 36 tests (+1 skipped for network-dependent `resolveGithubSource`). Covers `formatSourceString`, `resolveLocalSource`, `validateCanonicalRepo` (via resolveLocalSource), `findCanonicalRepo`, `ResolvedSource` structure, edge cases. |
| 11 | Add unit tests for `shared.ts` | **DONE** | Created `tests/unit/shared.test.ts` with 44 tests. Covers `parseAndValidateTargets`, `resolveTargetDirectory`, `resolveVersion`, `resolveSource`, `checkModifiedFilesBeforeSync`, `promptMergeOrOverride`. Uses `vi.mock()` for external dependencies. |

**Final test count:** 597 passing, 1 skipped, across 21 test files (up from 420 tests / 17 files at audit start).

### Remaining Items (Not Yet Implemented)

**Medium Priority (not started):**
- #14: Extract hash utilities to `core/hashing.ts`
- #15: Rename `core/schema.ts` to `core/schema-compat.ts`
- #16: Eliminate `directoryExists` duplication in `git.ts`
- #17: Extract presentation logic from `performSync()`
- #18: Clean up `syncWorkflows()` overloaded signature
- #19: Rename workflow generators in `canonical.ts`
- #20-#23: Additional test coverage (sync, markers, lockfile, integration)
- #24: Update VERSIONING.md lockfile example — **DONE** (included in #13 above)
- #25: Add JSDoc to critical undocumented functions

**Low Priority (not started):**
- #26-#37: See Low Priority section above
