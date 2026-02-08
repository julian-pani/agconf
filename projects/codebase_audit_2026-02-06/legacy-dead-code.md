# Technical Debt Report

**Project:** agconf CLI
**Date:** 2026-02-06
**Scope:** `cli/src/` (30 source files)

---

## Dead Code

### Unused Exported Functions

1. **`getReleaseByTag()`** - `cli/src/core/version.ts:100`
   - Exported but never imported or called anywhere in the codebase (src or tests).
   - Only `getLatestRelease()` is used in practice (from `shared.ts`).
   - **Action:** Remove or mark as internal utility.

2. **`formatWorkflowRef()`** - `cli/src/core/workflows.ts:490`
   - Exported but only referenced in tests (`workflows.test.ts:342`), never called from production code.
   - The `performSync()` in `shared.ts` manually does the same logic inline (lines 441-443).
   - **Action:** Either use this function in `shared.ts` or remove it.

3. **`getCurrentWorkflowVersion()`** - `cli/src/core/workflows.ts:462`
   - Exported but only referenced in tests (`workflows.test.ts:465`), never called from production code.
   - **Action:** Remove if not needed for future features, or mark as public API if intentional.

4. **`updateWorkflowVersion()`** - `cli/src/core/workflows.ts:353`
   - Exported but never called from production code. The `syncWorkflows()` function handles version updates internally by comparing and rewriting files.
   - **Action:** Remove if not needed.

5. **`getModifiedAgentFiles()`** - `cli/src/core/skill-metadata.ts:462`
   - Exported but never imported or called anywhere (not even in tests).
   - **Action:** Remove.

6. **`buildMarkdownWithFrontmatter()`** - `cli/src/core/frontmatter.ts:258`
   - Exported but never imported or called anywhere (src or tests).
   - **Action:** Remove.

7. **`hasFrontmatter()`** - `cli/src/core/frontmatter.ts:272`
   - Exported but never imported or called anywhere (src or tests).
   - **Action:** Remove.

### Unused Exported Types/Interfaces

1. **`ConfigOptions`** - `cli/src/commands/config.ts:5`
   - `export type ConfigOptions = Record<string, never>` - Defined but never imported or used anywhere.
   - **Action:** Remove.

2. **`CheckResult`** - `cli/src/commands/check.ts:27`
   - Interface exported but never imported or used by any consumer. The `checkCommand` function returns `void`.
   - **Action:** Remove.

3. **`ManagedMetadata`** - `cli/src/core/skill-metadata.ts:42`
   - Interface exported but never imported as a type anywhere (only the pattern is used inline).
   - **Action:** Remove.

4. **`Content`** - `cli/src/schemas/lockfile.ts:70`
   - `export type Content = z.infer<typeof ContentSchema>` - Never imported by any file.
   - **Action:** Remove.

5. **`RulesContent`** - `cli/src/schemas/lockfile.ts:72`
   - Never imported directly. Only the schema (`RulesContentSchema`) is used in tests.
   - **Action:** Remove unless needed for public API consumers.

6. **`AgentsContent`** - `cli/src/schemas/lockfile.ts:73`
   - Never imported directly. Only the schema (`AgentsContentSchema`) is used internally.
   - **Action:** Remove unless needed for public API consumers.

7. **`CanonicalMeta`** - `cli/src/config/schema.ts:70`
   - Type alias never imported anywhere.
   - **Action:** Remove.

8. **`CanonicalPaths`** - `cli/src/config/schema.ts:71`
   - Type alias never imported anywhere (the schema `CanonicalPathsSchema` is used directly).
   - **Action:** Remove.

9. **`MarkersConfig`** - `cli/src/config/schema.ts:72`
   - Type alias never imported anywhere.
   - **Action:** Remove.

10. **`MergeConfig`** - `cli/src/config/schema.ts:73`
    - Type alias never imported anywhere.
    - **Action:** Remove.

11. **`SourceConfig`** - `cli/src/config/schema.ts:128`
    - Type alias never imported anywhere.
    - **Action:** Remove.

12. **`SkillFileCheckResult`** - `cli/src/core/skill-metadata.ts:234`
    - Only used internally within the same file. Not imported by any other file.
    - **Action:** Remove the `export` keyword (keep as internal type).

13. **`RuleFileCheckResult`** - `cli/src/core/skill-metadata.ts:384`
    - Only used internally within the same file. Not imported by any other file.
    - **Action:** Remove the `export` keyword (keep as internal type).

14. **`AgentFileCheckResult`** - `cli/src/core/skill-metadata.ts:398`
    - Only used internally within the same file. Not imported by any other file.
    - **Action:** Remove the `export` keyword (keep as internal type).

### Unused Exported Constants

1. **`FRONTMATTER_REGEX`** - `cli/src/core/frontmatter.ts:40`
   - Exported but never imported externally (only used within `frontmatter.ts`). The duplicate in `agents.ts` (line 74) is also only used internally.
   - **Action:** Remove the `export` keyword.

2. **`needsQuoting()`** - `cli/src/core/frontmatter.ts:236`
   - Exported but never imported externally (only used within `frontmatter.ts`). The duplicate in `agents.ts` (line 231) is private.
   - **Action:** Remove the `export` keyword.

3. **`parseSimpleYaml()`** - `cli/src/core/frontmatter.ts:89`
   - Exported but never imported externally (only used within `frontmatter.ts`). The duplicate in `agents.ts` (line 105) is private.
   - **Action:** Remove the `export` keyword.

### Non-existent Plugin System

The AGENTS.md documentation references a "Plugin System" with `cli/src/plugins/targets/` and `cli/src/plugins/providers/` directories. These directories do not exist. The actual target/provider logic is in `cli/src/core/targets.ts` and `cli/src/core/source.ts`.

- **Action:** Update AGENTS.md to remove the "Plugin System" reference or create the directories if plugin architecture is planned.

---

## Deprecated Patterns

### No Major Deprecated API Usage Found

The codebase is relatively new and uses modern Node.js APIs (ESM, `node:` protocol prefixes, `fs/promises`). No deprecated Node.js APIs were found.

### Minor Issues

1. **`execSync` usage in `version.ts:8` and `upgrade-cli.ts:1`**
   - Uses synchronous `execSync` for `gh auth token` and `npm install -g`. These block the event loop. Consider using `execAsync` (already available in `source.ts`) for consistency.
   - Files: `cli/src/core/version.ts:27`, `cli/src/commands/upgrade-cli.ts:85`

2. **Type assertions with `as unknown`**
   - Multiple places use `data as Record<string, unknown>` pattern for API responses (`version.ts:94`, `version.ts:117`). Consider using Zod for runtime validation of API responses.

3. **Overloaded function signature in `syncWorkflows()`** - `cli/src/core/workflows.ts:407-418`
   - The function accepts either `Partial<ResolvedConfig>` or `SyncWorkflowsOptions` via runtime type checking (`"resolvedConfig" in options`). This is a legacy adapter pattern that should be cleaned up to accept only `SyncWorkflowsOptions`.

---

## Duplicated Code

### Critical: Triple-duplicate YAML parser and serializer

The most significant code duplication in the codebase:

1. **`parseSimpleYaml()`** - Duplicated in THREE locations:
   - `cli/src/core/frontmatter.ts:89-177` (shared, exported)
   - `cli/src/core/agents.ts:105-191` (private copy)
   - Original implementation was consolidated into `frontmatter.ts`, but `agents.ts` still has its own private copy.
   - **Impact:** ~87 lines duplicated.

2. **`serializeFrontmatter()`** - Duplicated in TWO locations:
   - `cli/src/core/frontmatter.ts:199-229` (shared, exported)
   - `cli/src/core/agents.ts:196-226` (private copy)
   - **Impact:** ~30 lines duplicated.

3. **`needsQuoting()`** - Duplicated in TWO locations:
   - `cli/src/core/frontmatter.ts:236-245` (shared, exported)
   - `cli/src/core/agents.ts:231-240` (private copy)
   - **Impact:** ~10 lines duplicated.

4. **`FRONTMATTER_REGEX`** - Duplicated in TWO locations:
   - `cli/src/core/frontmatter.ts:40`
   - `cli/src/core/agents.ts:74`
   - **Impact:** Both are identical: `/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/`

5. **`parseFrontmatter()` wrapper** - Duplicated in TWO locations:
   - `cli/src/core/agents.ts:80-99` (private, uses local `parseSimpleYaml`)
   - `cli/src/core/rules.ts:64-73` (private, delegates to shared `parseFrontmatter`)
   - The `rules.ts` version correctly delegates to `frontmatter.ts`. The `agents.ts` version does not.
   - **Action:** Refactor `agents.ts` to use `parseFrontmatter` and `serializeFrontmatter` from `frontmatter.ts`, exactly as `rules.ts` already does.

### Moderate: `directoryExists` duplication

- `cli/src/utils/fs.ts:18` - `directoryExists()` (exported, used by `canonical.ts`)
- `cli/src/utils/git.ts:8` - `directoryExistsForGit()` (private, identical logic)
- **Action:** Have `git.ts` import and use `directoryExists` from `fs.ts`.

### Moderate: `getMarkers()` duplication

- `cli/src/config/schema.ts:178` - `getMarkers(prefix)` (original)
- `cli/src/core/markers.ts:21` - `getMarkers(prefix)` (wrapper that delegates to config version)
- The `markers.ts` version just calls the `config/schema.ts` version. This is an unnecessary indirection.
- **Action:** Have consumers import directly from `config/schema.ts`, or consolidate to one location.

### Moderate: Duplicate workflow generation

- `cli/src/commands/canonical.ts:163-371` - `generateSyncWorkflow()` and `generateCheckWorkflow()` for canonical repos (reusable workflows)
- `cli/src/core/workflows.ts:193-305` - `generateSyncWorkflow()` and `generateCheckWorkflow()` for downstream repos (caller workflows)
- These are semantically different (one generates reusable workflows, the other generates callers), so the naming collision is confusing but not true duplication. The function names are identical, which is misleading.
- **Action:** Rename the canonical versions to `generateReusableSyncWorkflow()` and `generateReusableCheckWorkflow()`.

### Minor: List formatting helpers in `shared.ts`

- `formatSkillList` (line 534), `formatRuleList` (line 606), `formatCodexRuleList` (line 655), `formatAgentList` (line 711) - These four inner functions in `performSync()` are nearly identical, differing only in the item path format.
- **Action:** Extract a generic `formatItemList()` helper.

---

## Unused Dependencies

### Production Dependencies - All Used

| Dependency | Used In |
|---|---|
| `@clack/prompts` | All command files (init, sync, check, canonical, config, completion, upgrade-cli) |
| `commander` | `cli.ts` |
| `fast-glob` | `sync.ts`, `skill-metadata.ts` |
| `ora` | `logger.ts` |
| `picocolors` | Multiple command and utility files |
| `simple-git` | `source.ts`, `git.ts` |
| `tabtab` | `completion.ts` |
| `yaml` | `loader.ts` (parse), `canonical.ts` (stringify) |
| `zod` | `schema.ts`, `lockfile.ts` |

**All production dependencies are used.** No unused dependencies found.

### Dev Dependencies - All Used

All dev dependencies serve the build, test, lint, or release pipeline. No unused dev dependencies found.

---

## Code Comments Inventory

### TODOs

**None found.** The codebase has zero TODO comments.

### FIXMEs

**None found.** The codebase has zero FIXME comments.

### HACKs

**None found.** The codebase has zero HACK comments.

### Noteworthy Inline Comments

1. `cli/src/commands/completion.ts:7` - `// @ts-expect-error - tabtab internal module not typed`
   - This is a legitimate workaround for untyped third-party module.

2. `cli/src/commands/canonical.ts:1` - `// biome-ignore-all lint/suspicious/noUselessEscapeInString: escaping $ is required in template literals that generate shell scripts`
   - File-level biome lint suppression for the entire canonical.ts file due to shell script generation.

3. `cli/src/core/sync.ts:516-521` - Comment about interactive mode for agents skipping:
   ```
   // Note: In interactive mode, the caller should prompt the user
   // For now, we just skip and set the flag
   ```
   - Suggests incomplete feature implementation.

### Commented-Out Code Blocks

**None found.** The codebase has no commented-out code blocks.

---

## Cleanup Recommendations

### Priority 1 - High Impact, Low Effort

1. **Remove dead exported functions** (5 functions, ~100 lines)
   - `getReleaseByTag()`, `getModifiedAgentFiles()`, `buildMarkdownWithFrontmatter()`, `hasFrontmatter()`, `formatWorkflowRef()`
   - Note: `getCurrentWorkflowVersion()` and `updateWorkflowVersion()` are tested but unused in production. Consider whether they're part of the public API before removing.

2. **Remove dead exported types** (14 types/interfaces)
   - `ConfigOptions`, `CheckResult`, `ManagedMetadata`, `Content`, `RulesContent`, `AgentsContent`, `CanonicalMeta`, `CanonicalPaths`, `MarkersConfig`, `MergeConfig`, `SourceConfig`
   - Make internal-only: `SkillFileCheckResult`, `RuleFileCheckResult`, `AgentFileCheckResult`

3. **De-export unnecessarily public symbols** (3 symbols)
   - `FRONTMATTER_REGEX`, `needsQuoting()`, `parseSimpleYaml()` in `frontmatter.ts`

### Priority 2 - High Impact, Medium Effort

4. **Eliminate agents.ts YAML duplication** (~130 lines saved)
   - Refactor `cli/src/core/agents.ts` to import and use `parseFrontmatter`, `serializeFrontmatter`, and `needsQuoting` from `cli/src/core/frontmatter.ts` instead of maintaining private copies.
   - This is exactly what `rules.ts` already does (see `rules.ts:2,68`).
   - Remove: private `parseSimpleYaml()`, `serializeFrontmatter()`, `needsQuoting()`, `FRONTMATTER_REGEX`, and `parseFrontmatter()` from `agents.ts`.

5. **Eliminate directoryExists duplication**
   - Have `cli/src/utils/git.ts` import `directoryExists` from `cli/src/utils/fs.ts` instead of defining its own `directoryExistsForGit`.

### Priority 3 - Medium Impact, Medium Effort

6. **Clean up `syncWorkflows()` overloaded signature**
   - `cli/src/core/workflows.ts:407-418` uses runtime type checking to support two different parameter shapes. Migrate all callers to use `SyncWorkflowsOptions` and remove the legacy `Partial<ResolvedConfig>` path.

7. **Extract generic list formatter in `shared.ts`**
   - The four nearly-identical `formatSkillList`, `formatRuleList`, `formatCodexRuleList`, `formatAgentList` functions (~120 lines) could be consolidated into one generic helper.

8. **Rename confusingly named functions in `canonical.ts`**
   - `generateSyncWorkflow()` and `generateCheckWorkflow()` in `canonical.ts` clash with identically named functions in `workflows.ts`. Rename to `generateReusableSyncWorkflow()` / `generateReusableCheckWorkflow()`.

9. **Update AGENTS.md to remove phantom Plugin System reference**
   - The "Plugin System" section references `cli/src/plugins/targets/` and `cli/src/plugins/providers/` which do not exist.

### Priority 4 - Low Impact, Low Effort

10. **Replace `execSync` in `version.ts` and `upgrade-cli.ts`**
    - Use `promisify(exec)` for consistency with the rest of the codebase.

11. **Simplify `getMarkers()` indirection**
    - Either consolidate `getMarkers()` to a single location or have `markers.ts` re-export from `config/schema.ts` without the wrapper function.

---

## Summary Statistics

| Category | Count |
|---|---|
| Dead exported functions | 5-7 |
| Dead exported types/interfaces | 14 |
| Unnecessarily exported symbols | 3 |
| Duplicated code blocks | 5 (largest: ~130 lines in agents.ts) |
| TODO/FIXME/HACK comments | 0 |
| Commented-out code blocks | 0 |
| Unused production dependencies | 0 |
| Unused dev dependencies | 0 |
| Non-existent referenced directories | 1 (plugins/) |

**Estimated cleanup effort:** 2-4 hours for Priority 1+2, additional 2-3 hours for Priority 3+4.
