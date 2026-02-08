# Code Quality Report

**Project:** agconf CLI (v0.6.2)
**Date:** 2026-02-06
**Scope:** cli/src/ (core modules, commands, config, utils, schemas)

---

## Critical Issues

### C1. Significant Code Duplication in `agents.ts` - Full YAML Parser/Serializer Copy

**Files:**
- `/cli/src/core/agents.ts` (lines 74-241)
- `/cli/src/core/frontmatter.ts` (lines 40-275)

**Description:** The `agents.ts` module contains a complete, independent copy of the YAML frontmatter parsing and serialization system that already exists in the shared `frontmatter.ts` module. Specifically:

- `FRONTMATTER_REGEX` (agents.ts:74) duplicates `frontmatter.ts:40`
- `parseFrontmatter()` (agents.ts:80-99) duplicates `frontmatter.ts:60-76`
- `parseSimpleYaml()` (agents.ts:105-191) duplicates `frontmatter.ts:89-177`
- `serializeFrontmatter()` (agents.ts:196-226) duplicates `frontmatter.ts:199-229`
- `needsQuoting()` (agents.ts:231-240) duplicates `frontmatter.ts:236-245`

The `frontmatter.ts` module was clearly created as a shared module (its JSDoc states "Used by skills, rules, and agents"), and both `rules.ts` and `skill-metadata.ts` correctly import from it. But `agents.ts` never adopted it, retaining its own private implementations. This creates a maintenance burden: any bug fix or behavior change to YAML parsing must be applied in two places, and divergence is likely over time.

**Impact:** Maintenance risk; future bug fixes may be applied inconsistently. Approximately 170 lines of pure duplication.

---

### C2. Seven Distinct Hash Functions With Subtle Inconsistencies

**Files:**
- `/cli/src/core/lockfile.ts` (line 107) - `hashContent()`
- `/cli/src/core/markers.ts` (line 87) - `computeGlobalBlockHash()`
- `/cli/src/core/markers.ts` (line 321) - `computeRulesSectionHash()`
- `/cli/src/core/skill-metadata.ts` (line 111) - `computeContentHash()`
- `/cli/src/core/sync.ts` (line 109) - `computeRulesHash()`
- `/cli/src/core/sync.ts` (line 220) - `computeAgentsHash()`
- `/cli/src/core/rules.ts` (line 230) - inline hash in `generateRulesSection()`

**Description:** Although the AGENTS.md documentation explicitly warns "Reuse existing hash functions - DO NOT create new ones," there are seven places where SHA-256 hashes are independently computed with `sha256:${hash.slice(0, 12)}` format. The functions have subtle differences in how they pre-process content before hashing:

- `hashContent()` in lockfile.ts hashes raw content (no trimming)
- `computeGlobalBlockHash()` and `computeRulesSectionHash()` hash `content.trim()`
- `computeContentHash()` in skill-metadata.ts first strips managed metadata
- `computeRulesHash()` and `computeAgentsHash()` in sync.ts concatenate sorted content with separators
- `generateRulesSection()` in rules.ts computes the hash inline

These are all correctly producing 12-character hex digests, so there is no current format inconsistency. However, the proliferation makes it difficult to reason about hash correctness and violates the project's own documented guidelines.

**Impact:** If the hash format needs to change, seven locations must be updated. The inline hash computation in `rules.ts:230-231` is particularly fragile since it bypasses any centralized function.

---

## High Priority

### H1. Dynamic Imports Used Unnecessarily in `sync.ts`

**File:** `/cli/src/core/sync.ts` (lines 333, 790)

**Description:** Two functions (`deleteOrphanedAgents` and `deleteOrphanedSkills`) use dynamic `await import("./skill-metadata.js")` to import `isManaged` and `hasManualChanges`:

```typescript
const { isManaged, hasManualChanges } = await import("./skill-metadata.js");
```

These dynamic imports are unnecessary since `sync.ts` already has a static import from `./skill-metadata.js` at the top of the file (line 24-27). The module is already loaded; the dynamic import adds no code-splitting benefit and creates an unexpected pattern that makes the dependency graph harder to analyze.

**Impact:** Code confusion; suggests a circular dependency concern that does not actually exist. Makes static analysis tools less effective.

---

### H2. `performSync()` Function Excessive Length (492 lines)

**File:** `/cli/src/commands/shared.ts` (lines 338-829)

**Description:** The `performSync()` function is approximately 492 lines long, making it one of the longest functions in the codebase. It handles:

1. Loading downstream config and previous lockfile (lines 345-353)
2. Running the core sync (lines 355-367)
3. Orphaned skill detection and deletion (lines 370-415)
4. Validation error display (lines 418-431)
5. Workflow file syncing (lines 434-449)
6. Hook installation (line 452)
7. Console output summary generation (lines 454-803) -- this is the bulk
8. Summary file writing (lines 805-819)
9. Error handling (lines 822-828)

The function mixes orchestration logic with presentation/UI logic (console output formatting). The summary generation section alone is approximately 350 lines with repeated patterns for formatting skill/rule/agent lists.

**Impact:** Difficult to test, read, and maintain. The list formatting logic (formatSkillList, formatRuleList, formatCodexRuleList, formatAgentList) is defined as nested closures with identical signatures, repeated four times.

---

### H3. `checkCommand` Hardcodes `process.cwd()` Without `cwd` Parameter

**File:** `/cli/src/commands/check.ts` (line 48)

**Description:** The check command uses `process.cwd()` directly:

```typescript
export async function checkCommand(options: CheckOptions = {}): Promise<void> {
  const targetDir = process.cwd();
```

The project's own AGENTS.md testing guidelines state: "For commands that use `process.cwd()`, add a `cwd` option for testability." Other commands like `init` and `sync` correctly use `resolveTargetDirectory()` which resolves to the git root. The `checkCommand` does not follow either pattern, making it:

1. Untestable without changing the process working directory
2. Inconsistent with other commands (does not resolve to git root)
3. Will produce incorrect results if run from a subdirectory

**Impact:** Testing limitation and potential incorrect behavior when run from subdirectories.

---

### H4. Missing Unit Tests for Core Modules

**Description:** Comparing source modules against test files reveals gaps:

| Module | Has Unit Test |
|---|---|
| `core/frontmatter.ts` | No |
| `core/source.ts` | No |
| `core/targets.ts` | No |
| `core/schema.ts` | No |
| `commands/config.ts` | No |
| `commands/upgrade-cli.ts` | No |
| `commands/init.ts` | Integration only |
| `commands/sync.ts` | No |
| `commands/shared.ts` | No |
| `utils/fs.ts` | No |
| `utils/logger.ts` | No |

While `frontmatter.ts` functions are indirectly tested through modules that use them, there are no dedicated tests for the shared module itself. The `source.ts` module (which resolves canonical repos with git operations and GitHub cloning) has no test coverage at all. The `targets.ts` module (which parses and validates target strings) similarly lacks tests.

**Impact:** Regressions in untested modules can go undetected. The `source.ts` module in particular contains complex logic for resolving local and GitHub sources.

---

## Medium Priority

### M1. Inconsistent Error Handling: Empty `catch {}` Blocks

**Files:** Multiple (43 instances across the codebase)

**Description:** There are 43 empty `catch {}` blocks across the source code. While many are documented with comments like `// Expected: directory doesn't exist` or `// File doesn't exist`, the pattern is overused. Some cases silently swallow errors that could indicate real problems:

- `/cli/src/core/sync.ts:352` - Catches any error during orphaned agent deletion safety check, silently skipping
- `/cli/src/core/sync.ts:814` - Catches any error during orphaned skill SKILL.md read
- `/cli/src/core/source.ts:127` - Silently ignores gh CLI clone failures
- `/cli/src/core/source.ts:223` - Catches any error during git remote verification
- `/cli/src/core/workflows.ts:377` - Catches any error and falls through to create a new file

While empty catch blocks are acceptable for "file may not exist" checks, several of these catch broader errors (network failures, permission issues) that should be logged or handled differently.

**Impact:** Debugging difficulty when unexpected errors occur. Silent failures in operations like orphan cleanup or source resolution.

---

### M2. Type Assertions (`as`) Used Extensively for Metadata Access

**Files:**
- `/cli/src/commands/check.ts` (lines 123, 142, 159, 212)
- `/cli/src/core/skill-metadata.ts` (lines 134, 179, 203, 226, 337)
- `/cli/src/core/agents.ts` (lines 123, 134, 211, 352)
- `/cli/src/core/rules.ts` (line 337)
- `/cli/src/core/version.ts` (lines 94, 117, 124, 128-130)

**Description:** There are approximately 25 type assertions (`as Record<string, string>`, `as Record<string, unknown>`, `as string`) used throughout the codebase. The most common pattern is accessing `frontmatter.metadata`:

```typescript
const metadata = frontmatter.metadata as Record<string, string> | undefined;
```

This is repeated nearly identically in multiple locations because the frontmatter types use `Record<string, unknown>` for extensibility. In `version.ts`, the GitHub API response is parsed with multiple unsafe assertions:

```typescript
const tag = data.tag_name as string;
const commitSha = (data.target_commitish as string) || "";
const publishedAt = data.published_at as string;
const tarballUrl = data.tarball_url as string;
```

There is no runtime validation of these fields, meaning a changed API response would cause silent type mismatches.

**Impact:** Type safety gap. If GitHub changes their API response shape, the assertions would hide the problem until a runtime error occurs elsewhere. A Zod schema for the GitHub API response (like those used for lockfile and config) would be more robust.

---

### M3. `shared.ts` Contains Presentation Logic Mixed With Business Logic

**File:** `/cli/src/commands/shared.ts`

**Description:** The `shared.ts` file at 829 lines is the largest file in the codebase. It mixes:

1. Source resolution logic (resolveSource, resolveVersion)
2. Target directory resolution (resolveTargetDirectory)
3. User interaction (promptMergeOrOverride, checkModifiedFilesBeforeSync)
4. Sync orchestration (performSync)
5. Console output formatting (all within performSync)
6. Summary file generation (within performSync)

The four nearly identical `formatXxxList` closures within `performSync` (formatSkillList, formatRuleList, formatCodexRuleList, formatAgentList) each accept the same 5 parameters `(items, icon, colorFn, label, mdLabel)` and perform the same truncation/display logic.

**Impact:** Low cohesion. Changing console output format requires modifying the same function that handles sync orchestration.

---

### M4. `directoryExists` Function Duplicated Between `utils/fs.ts` and `utils/git.ts`

**Files:**
- `/cli/src/utils/fs.ts` (line 18) - `directoryExists()`
- `/cli/src/utils/git.ts` (line 8) - `directoryExistsForGit()`

**Description:** Both functions check if a directory exists using `fs.stat()` with identical logic:

```typescript
// utils/fs.ts
export async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch { return false; }
}

// utils/git.ts (private)
async function directoryExistsForGit(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory();
  } catch { return false; }
}
```

The `git.ts` version is private and used 4 times within that module. It could simply import from `utils/fs.ts`.

**Impact:** Minor duplication, but indicates a pattern where internal utilities are not being shared.

---

### M5. `canonical.ts` Contains Large Inline Template Strings

**File:** `/cli/src/commands/canonical.ts` (lines 163-406)

**Description:** Two functions (`generateSyncWorkflow` and `generateCheckWorkflow`) contain workflow YAML templates as massive template literal strings totaling approximately 250 lines. These templates embed shell scripts, YAML configuration, and GitHub Actions syntax directly in TypeScript code, making them difficult to read, test, and maintain.

The sync workflow template alone is over 200 lines of YAML/shell embedded in a template string, compared to the similar (but shorter) templates in `workflows.ts` which only generate the downstream caller workflows.

**Impact:** Readability and maintainability. Template changes require careful escaping and are hard to validate. No tests verify the correctness of the generated workflow YAML.

---

### M6. Inconsistent `process.exit()` Usage Pattern

**Files:** Multiple command files

**Description:** There are 34 calls to `process.exit()` across the command layer. Some commands use `process.exit(1)` within helper functions (e.g., `parseAndValidateTargets` in shared.ts:58, `resolveTargetDirectory` in shared.ts:71), which makes these functions impossible to test without mocking `process.exit`. Functions that call `process.exit()` deep in the call stack prevent proper error propagation.

For example, `parseAndValidateTargets()` calls `process.exit(1)` on validation failure instead of throwing an error:

```typescript
export async function parseAndValidateTargets(targetOptions: string[] | undefined): Promise<Target[]> {
  try {
    return parseTargets(targetOptions ?? ["claude"]);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exit(1);  // Cannot be caught by callers
  }
}
```

**Impact:** Testing difficulty. Makes it impossible to write unit tests that verify error paths without mocking process.exit.

---

## Low Priority

### L1. Unused `_source` Parameter in `mergeAgentsMd`

**File:** `/cli/src/core/merge.ts` (line 65)

**Description:** The `mergeAgentsMd` function accepts a `_source: Source` parameter (prefixed with underscore to indicate unused) that is never used in the function body. This was likely needed in an earlier version for metadata but is now dead code.

```typescript
export async function mergeAgentsMd(
  targetDir: string,
  globalContent: string,
  _source: Source,  // Unused parameter
  options: MergeOptions = { override: false },
): Promise<...>
```

All callers still pass this argument (sync.ts:420 passes `resolvedSource.source`).

**Impact:** Minor API pollution. The parameter should be removed to clean up the interface.

---

### L2. `ConfigOptions` Type Is an Empty Record

**File:** `/cli/src/commands/config.ts` (line 5)

**Description:**

```typescript
export type ConfigOptions = Record<string, never>;
```

This type is defined but never used. The config commands (`configShowCommand`, `configGetCommand`, `configSetCommand`) are placeholder stubs that always report "No configuration options available." The entire config command implementation is effectively dead code.

**Impact:** Minimal. The config subcommand exists in the CLI definition but has no functionality. It may confuse users who expect it to work.

---

### L3. `noNonNullAssertion` Disabled in Biome Configuration

**File:** `/cli/biome.json` (line 22)

**Description:** The Biome linter has `noNonNullAssertion` set to `"off"`, meaning the non-null assertion operator (`!`) can be used anywhere without linting warnings. While the codebase appears to use this sparingly, disabling the rule entirely removes a safety net. The codebase does use optional chaining (`?.`) extensively and correctly, but having this rule off means future contributors could introduce unsafe non-null assertions.

**Impact:** Potential type safety regression over time.

---

### L4. `SyncOptions` Interface Is An Empty Extension

**File:** `/cli/src/commands/sync.ts` (line 17)

```typescript
export interface SyncOptions extends SharedSyncOptions {}
```

**File:** `/cli/src/commands/init.ts` (line 17)

```typescript
export interface InitOptions extends SharedSyncOptions {}
```

**Description:** Both `SyncOptions` and `InitOptions` are empty interfaces that extend `SharedSyncOptions` without adding any fields. They exist for future extensibility but currently add no value and create unnecessary indirection.

**Impact:** Trivial. Not a real problem, just adds indirection.

---

### L5. Lockfile Path Displayed Incorrectly in Sync Summary

**File:** `/cli/src/commands/shared.ts` (line 773)

**Description:** The lockfile path is displayed as `.agconf/agconf.lock` but the actual lockfile name is `lockfile.json` (per lockfile.ts:16). The summary line for markdown uses the correct path:

```typescript
const lockfilePath = formatPath(path.join(targetDir, ".agconf", "agconf.lock"));  // Wrong filename
// ...
summaryLines.push("- `.agconf/lockfile.json` (updated)");  // Correct filename
```

The console output shows the wrong path while the markdown summary shows the correct one.

**Impact:** User confusion. The console output does not match the actual file on disk.

---

### L6. `isCanonicalRepo()` Contains Redundant Outer Try-Catch

**File:** `/cli/src/core/source.ts` (lines 186-233)

**Description:** The function has an outer try-catch that wraps the entire function body, but every operation inside already has its own error handling (the `fs.stat().catch(() => null)`, `Promise.all` with catches, and the git try-catch). The outer catch at line 229 can never be reached in normal operation.

**Impact:** Trivial. Adds minor code noise.

---

### L7. Missing Test for `frontmatter.ts` Shared Module

**File:** `/cli/src/core/frontmatter.ts`

**Description:** While `frontmatter.ts` was created as the shared frontmatter parsing module (used by `rules.ts` and `skill-metadata.ts`), it has no dedicated test file. Its functions are only tested indirectly through `rules.test.ts` and `skill-metadata.test.ts`. Edge cases like malformed YAML, deeply nested objects, or unusual quoting may not be covered.

**Impact:** Low immediate risk, but as this is a shared module, bugs here could propagate to multiple features.

---

## Summary

- **Total issues:** 17
- **Critical:** 2 | **High:** 4 | **Medium:** 6 | **Low:** 7

### Positive Observations

The codebase demonstrates several strong practices:

1. **Strict TypeScript configuration** - `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, and `noUnusedParameters` are all enabled. This is an excellent set of compiler strictness settings.

2. **Zero `any` types** - No usage of `any` type was found anywhere in the source code. This is uncommon and commendable.

3. **Clean architecture boundaries** - Core modules (`cli/src/core/`) are free of `console.log` calls and `process.exit()` calls. Presentation logic is correctly confined to the command layer.

4. **Zod schema validation** - The lockfile and config schemas use Zod for runtime validation, providing type safety at boundaries (file reads, API responses for config).

5. **Consistent error pattern** - Error handling follows a "try file access, catch ENOENT, return null/empty" pattern consistently across the codebase.

6. **Good test coverage for core logic** - The check command, sync, markers, merge, lockfile, rules, agents, and skill-metadata all have dedicated unit tests. Integration tests exist for init and canonical workflows.

7. **No `@ts-ignore` usage** - Only one `@ts-expect-error` exists (for an untyped third-party module), and it is properly documented.

8. **ESM-only with `.js` extensions** - All imports use `.js` extensions consistently, which is correct for ESM with TypeScript's bundler module resolution.

### Recommended Priorities

1. **Remove duplication in `agents.ts`** (C1) - Refactor to import from `frontmatter.ts` like rules.ts and skill-metadata.ts already do.
2. **Add `cwd` parameter to `checkCommand`** (H3) - This is both a bug (wrong behavior in subdirectories) and a testability issue.
3. **Extract presentation logic from `performSync`** (H2/M3) - Create a dedicated summary formatter module.
4. **Replace dynamic imports with static imports in `sync.ts`** (H1) - Straightforward cleanup.
5. **Add tests for `source.ts`, `targets.ts`, and `frontmatter.ts`** (H4) - Fill the highest-risk test gaps.
