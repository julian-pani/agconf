# Module Organization Report

## Executive Summary

The agconf CLI has **significant naming and organizational issues** in its core modules. The most critical problems are: (1) `skill-metadata.ts` is a misnomer -- it is the central integrity-checking module for *all* content types, not just skills; (2) `agents.ts` fully duplicates the YAML parsing/serialization infrastructure already provided by `frontmatter.ts`; (3) hash computation is scattered across 5 files with 6 nearly-identical inline implementations; and (4) two `schema.ts` files in different directories serve confusingly distinct purposes.

---

## Naming Issues

| File | Current Name | Problem | Recommendation |
|------|-------------|---------|----------------|
| `cli/src/core/skill-metadata.ts` | `skill-metadata.ts` | Name says "skill" but the module is the central hub for checking/managing ALL content types: skills, rules, agents, and AGENTS.md. Contains `checkAllManagedFiles()`, `checkRuleFiles()`, `checkAgentFiles()`, `checkAgentsMd()`, `checkAgentsMdRulesSection()`, plus generic interfaces like `ManagedFileCheckResult`. | Rename to `managed-content.ts` or `integrity.ts` |
| `cli/src/core/schema.ts` | `schema.ts` | Confusingly shares its name with `cli/src/config/schema.ts`. Core `schema.ts` handles schema *version compatibility checking*, not schema definitions. Its sole export is `checkSchemaCompatibility()` and `SUPPORTED_SCHEMA_VERSION`. | Rename to `schema-compat.ts` or `schema-version.ts` |
| `cli/src/config/schema.ts` | `schema.ts` | Contains Zod schemas AND helper functions (`getMarkers()`, `getMetadataKeys()`) that are really marker/metadata logic, not schema definitions. These helpers are imported by `core/markers.ts` and `core/skill-metadata.ts`. | Keep name but extract `getMarkers()` and `getMetadataKeys()` to `core/markers.ts` and `core/skill-metadata.ts` respectively, or to a shared `core/config-helpers.ts` |
| `cli/src/core/agents.ts` | `agents.ts` | Name is accurate for its domain (agent file parsing) but it contains a **full copy** of the YAML parsing infrastructure (private `parseSimpleYaml`, `parseFrontmatter`, `serializeFrontmatter`, `needsQuoting`, `FRONTMATTER_REGEX`) that already exists in `frontmatter.ts`. This is not a naming issue per se, but it creates a module that is ~50% duplicated utility code. | Refactor to use `frontmatter.ts` like `rules.ts` and `skill-metadata.ts` do |
| `cli/src/core/version.ts` | `version.ts` | Mixes two concerns: GitHub release API operations (`getLatestRelease`, `getReleaseByTag`, `getGitHubToken`) and pure semver utilities (`parseVersion`, `formatTag`, `isVersionRef`, `compareVersions`). The GitHub API code includes authentication logic (reading GITHUB_TOKEN, calling `gh auth token`). | Split into `version-utils.ts` (pure semver) and `github-releases.ts` (API) |
| `cli/src/core/lockfile.ts` | `lockfile.ts` | Contains `getCliVersion()` and `checkCliVersionMismatch()` which are CLI version utilities, not lockfile operations. The `hashContent()` function is yet another hash implementation alongside those in `markers.ts` and `skill-metadata.ts`. | Extract `getCliVersion()` and `checkCliVersionMismatch()` to a separate module (e.g., `cli-version.ts`) |

---

## Misplaced Utilities

| Function | Current Location | Recommended Location | Importers |
|----------|------------------|----------------------|-----------|
| `computeContentHash()` | `cli/src/core/skill-metadata.ts:111` | `cli/src/core/hashing.ts` (new) or `cli/src/core/frontmatter.ts` | `rules.ts` (aliased as `computeSkillContentHash`), `agents.ts` (aliased as `computeSkillContentHash`), `check.ts`, `skill-metadata.ts` (internal) |
| `computeGlobalBlockHash()` | `cli/src/core/markers.ts:87` | `cli/src/core/hashing.ts` (new) | `check.ts` |
| `computeRulesSectionHash()` | `cli/src/core/markers.ts:321` | `cli/src/core/hashing.ts` (new) | `check.ts` |
| `hashContent()` | `cli/src/core/lockfile.ts:106` | `cli/src/core/hashing.ts` (new) | `lockfile.ts` (internal only) |
| `getCliVersion()` | `cli/src/core/lockfile.ts:111` | `cli/src/core/cli-version.ts` (new) or inline in `cli.ts` | `cli.ts`, `commands/upgrade-cli.ts` |
| `checkCliVersionMismatch()` | `cli/src/core/lockfile.ts:128` | `cli/src/core/cli-version.ts` (new) | `cli.ts` |
| `getMarkers()` | `cli/src/config/schema.ts:178` | `cli/src/core/markers.ts` (it already has a thin re-export wrapper at line 21) | `core/markers.ts` (via alias `getMarkersFromConfig`) |
| `getMetadataKeys()` | `cli/src/config/schema.ts:191` | `cli/src/core/skill-metadata.ts` (it already has a thin re-export wrapper `getMetadataKeyNames` at line 31) | `core/skill-metadata.ts` |
| `parseFrontmatter()` (wrapper) | `cli/src/core/skill-metadata.ts:54` | Remove; callers should use `frontmatter.ts` directly | Internal to `skill-metadata.ts` |
| `stripManagedMetadata()` | `cli/src/core/skill-metadata.ts:121` | This is metadata-stripping logic, fine in `skill-metadata.ts` if renamed, but exported and used by `check.ts` -- the name `skill-metadata` is misleading since it handles all content types | Would be correctly placed in a renamed `managed-content.ts` |
| `isManaged()`, `hasManualChanges()` | `cli/src/core/skill-metadata.ts:218,195` | Generic managed-content functions that work on any frontmatter, not skill-specific | Would be correctly placed in a renamed `managed-content.ts` |
| `checkSkillFiles()`, `checkRuleFiles()`, `checkAgentFiles()`, `checkAgentsMd()`, `checkAgentsMdRulesSection()`, `checkAllManagedFiles()` | `cli/src/core/skill-metadata.ts:249-624` | These are the full integrity checking suite for *all* content types | Would be correctly placed in a renamed `managed-content.ts` or dedicated `check-integrity.ts` |
| `readFileIfExists()` | `cli/src/core/merge.ts:30` (private) | `cli/src/utils/fs.ts` -- this is a generic utility. `fileExists()` already exists in `utils/fs.ts` but returns boolean, not content. | Add to `utils/fs.ts` as a public utility |
| `directoryExistsForGit()` | `cli/src/utils/git.ts:8` (private) | Duplicate of `directoryExists()` in `cli/src/utils/fs.ts:18`. The git module created its own private copy. | Use `directoryExists` from `utils/fs.ts` |
| `escapeRegex()` | `cli/src/core/workflows.ts:500` (private) | `cli/src/utils/string.ts` (new) or inline | Only used in `workflows.ts`; low priority |

---

## SRP Violations

### 1. `cli/src/core/skill-metadata.ts` (637 lines) -- CRITICAL

**Actual responsibilities (5+):**
1. **Skill frontmatter validation** (`validateSkillFrontmatter`, `SkillValidationError`)
2. **Generic managed metadata operations** (`addManagedMetadata`, `stripManagedMetadata`, `isManaged`, `hasManualChanges`, `computeContentHash`)
3. **Skill file integrity checking** (`checkSkillFiles`, `SkillFileCheckResult`)
4. **Rule file integrity checking** (`checkRuleFiles`, `RuleFileCheckResult`)
5. **Agent file integrity checking** (`checkAgentFiles`, `AgentFileCheckResult`)
6. **AGENTS.md integrity checking** (`checkAgentsMd`, `checkAgentsMdRulesSection`)
7. **Orchestration of all integrity checks** (`checkAllManagedFiles`, `getModifiedManagedFiles`)

This is the worst SRP violation in the codebase. The file started as skill metadata handling but accumulated *all* integrity checking logic over time. The name "skill-metadata" has become actively misleading -- the AGENTS.md instructions even have to explicitly document that `computeContentHash` lives here for non-skill content types.

### 2. `cli/src/core/version.ts` (192 lines) -- MODERATE

**Actual responsibilities (3):**
1. **GitHub API authentication** (`getGitHubToken`, `getGitHubHeaders`)
2. **GitHub release API** (`getLatestRelease`, `getReleaseByTag`, `parseReleaseResponse`, `ReleaseInfo`)
3. **Semver utilities** (`parseVersion`, `formatTag`, `isVersionRef`, `compareVersions`)

The semver utilities are pure functions with no dependencies. The GitHub API code has network/auth dependencies. These are fundamentally different concerns.

### 3. `cli/src/core/lockfile.ts` (163 lines) -- MODERATE

**Actual responsibilities (3):**
1. **Lockfile I/O** (`readLockfile`, `writeLockfile`, `getLockfilePath`)
2. **Content hashing** (`hashContent`) -- yet another hash function
3. **CLI version management** (`getCliVersion`, `checkCliVersionMismatch`)

### 4. `cli/src/core/markers.ts` (352 lines) -- MODERATE

**Actual responsibilities (3):**
1. **Marker definition and AGENTS.md parsing** (lines 1-181)
2. **Global block hash computation and change detection** (lines 83-240)
3. **Rules section parsing, hashing, and change detection** (lines 242-352)

The rules section handling was appended to markers.ts as an extension, but it could be argued these are related enough to stay together.

### 5. `cli/src/config/schema.ts` (199 lines) -- MINOR

**Actual responsibilities (2):**
1. **Zod schema definitions** for canonical/downstream/resolved configs (lines 1-166)
2. **Runtime helper functions** (`getMarkers`, `getMetadataKeys`) at lines 178-198

The helpers generate runtime marker strings and metadata key names from config prefixes. They are consumed by `core/markers.ts` and `core/skill-metadata.ts` and create a reverse dependency from config -> core.

---

## Dependency Analysis

### High Fan-In Modules (imported by many)

| Module | Importer Count | Importers | Notes |
|--------|---------------|-----------|-------|
| `core/skill-metadata.ts` | 5 | `commands/check.ts`, `commands/shared.ts`, `core/sync.ts`, `core/rules.ts`, `core/agents.ts` | Central to the project but misleadingly named. Rules and agents import `computeContentHash` with the alias `computeSkillContentHash` -- a clear signal the function is misplaced. |
| `core/lockfile.ts` | 4 | `cli.ts`, `commands/check.ts`, `commands/shared.ts`, `core/sync.ts` | `cli.ts` and `commands/upgrade-cli.ts` only import `getCliVersion`/`checkCliVersionMismatch`, not lockfile ops |
| `core/markers.ts` | 3 | `commands/check.ts`, `core/skill-metadata.ts`, `core/merge.ts` | |
| `core/frontmatter.ts` | 2 | `core/skill-metadata.ts`, `core/rules.ts` | Should be 3 (agents.ts should use it too) |
| `core/targets.ts` | 2 | `commands/shared.ts`, `core/sync.ts` | Clean, well-scoped |
| `core/version.ts` | 2 | `commands/shared.ts`, `commands/upgrade-cli.ts` | `workflows.ts` also imports `formatTag` |
| `config/schema.ts` | 5 | `config/loader.ts`, `core/hooks.ts`, `core/workflows.ts`, `core/markers.ts`, `core/skill-metadata.ts` | Mix of Zod schema imports and runtime helper imports |
| `schemas/lockfile.ts` | 3 | `core/lockfile.ts`, `core/merge.ts`, `core/source.ts` | Clean type-only imports (except lockfile.ts) |
| `utils/logger.ts` | 5 | `commands/shared.ts`, `commands/sync.ts`, `commands/init.ts`, `commands/canonical.ts`, `commands/upgrade-cli.ts` | Clean utility |
| `utils/git.ts` | 3 | `cli.ts`, `commands/shared.ts`, `commands/canonical.ts` | Clean utility |
| `utils/fs.ts` | 2 | `commands/shared.ts`, `commands/canonical.ts` | Clean utility |

### Import Aliasing (Naming Confusion Signals)

| Import | Alias | File | Why It Signals a Problem |
|--------|-------|------|--------------------------|
| `computeContentHash` from `skill-metadata.ts` | `computeSkillContentHash` | `core/rules.ts:3` | The importer renames it to `computeSkillContentHash` because the generic name clashes or is misleading -- the function is NOT skill-specific but the source module name says "skill" |
| `computeContentHash` from `skill-metadata.ts` | `computeSkillContentHash` | `core/agents.ts:1` | Same as above -- agents.ts also aliases it to emphasize the source module, not the function's actual generic purpose |
| `parseFrontmatter` from `frontmatter.ts` | `parseFrontmatterShared` | `core/skill-metadata.ts:6`, `core/rules.ts:2` | These modules define their own `parseFrontmatter` wrappers, so they alias the import from the shared module. The wrapper in `skill-metadata.ts` just converts `null` to `{}`. |
| `getMarkers` from `config/schema.ts` | `getMarkersFromConfig` | `core/markers.ts:2` | `markers.ts` re-exports this under its original name, the alias exists only because both modules define `getMarkers` |
| `WorkflowConfig` from `config/schema.ts` | `WorkflowConfigSchema` | `core/workflows.ts:10` | `workflows.ts` defines its own `WorkflowConfig` interface, so it aliases the imported type to avoid collision |

---

## Duplicated Code

### 1. YAML Parsing Infrastructure in `agents.ts` -- CRITICAL

`cli/src/core/agents.ts` contains **complete private copies** of:
- `FRONTMATTER_REGEX` (line 74) -- identical to `frontmatter.ts:40`
- `parseFrontmatter()` (lines 80-99) -- functionally identical to `frontmatter.ts:60`
- `parseSimpleYaml()` (lines 105-191) -- functionally identical to `frontmatter.ts:89`
- `serializeFrontmatter()` (lines 196-226) -- functionally identical to `frontmatter.ts:199`
- `needsQuoting()` (lines 231-240) -- identical to `frontmatter.ts:236`

This is ~130 lines of duplicated code. Both `rules.ts` and `skill-metadata.ts` correctly import from `frontmatter.ts`, but `agents.ts` does not.

### 2. Hash Computation Pattern -- MODERATE

Six separate inline hash computations exist across 5 files, all following the pattern `sha256:${createHash("sha256").update(X).digest("hex").slice(0, 12)}`:

| Location | Function | Input Processing |
|----------|----------|-----------------|
| `skill-metadata.ts:113` | `computeContentHash()` | Strips managed metadata first |
| `markers.ts:88` | `computeGlobalBlockHash()` | Trims content |
| `markers.ts:322` | `computeRulesSectionHash()` | Trims content |
| `lockfile.ts:107` | `hashContent()` | Raw content (no trimming) |
| `sync.ts:114` | `computeRulesHash()` (private) | Concatenates rule paths+bodies |
| `sync.ts:225` | `computeAgentsHash()` (private) | Concatenates agent paths+bodies |

While the pre-processing differs, the core `sha256:${hash.slice(0, 12)}` pattern is duplicated. A shared `computeHash(content: string): string` utility could be extracted.

### 3. `directoryExists` Duplication

`cli/src/utils/git.ts:8` defines a private `directoryExistsForGit()` that is functionally identical to the public `directoryExists()` in `cli/src/utils/fs.ts:18`.

---

## Refactoring Plan

### Phase 1: Fix Critical Naming (Low Risk)

**Step 1.1: Rename `skill-metadata.ts` to `managed-content.ts`**
- Rename file: `cli/src/core/skill-metadata.ts` -> `cli/src/core/managed-content.ts`
- Update imports in:
  - `cli/src/commands/check.ts` (line 20)
  - `cli/src/commands/shared.ts` (line 8)
  - `cli/src/core/sync.ts` (line 26)
  - `cli/src/core/rules.ts` (line 3)
  - `cli/src/core/agents.ts` (line 1)
- Update AGENTS.md/CLAUDE.md documentation references to `skill-metadata.ts`
- Remove import aliasing: `computeSkillContentHash` -> `computeContentHash` in rules.ts and agents.ts

**Step 1.2: Rename `core/schema.ts` to `core/schema-compat.ts`**
- Rename file: `cli/src/core/schema.ts` -> `cli/src/core/schema-compat.ts`
- Update imports in:
  - `cli/src/core/lockfile.ts` (line 10)

### Phase 2: Eliminate Code Duplication (Medium Risk)

**Step 2.1: Remove duplicated YAML infrastructure from `agents.ts`**
- Delete private functions from `cli/src/core/agents.ts`:
  - `FRONTMATTER_REGEX` (line 74)
  - `parseFrontmatter()` (lines 80-99)
  - `parseSimpleYaml()` (lines 105-191)
  - `serializeFrontmatter()` (lines 196-226)
  - `needsQuoting()` (lines 231-240)
- Import from `frontmatter.ts` instead (matching the pattern in `rules.ts`)
- Update `parseFrontmatter` calls to handle the `null` vs `{}` difference
- Lines saved: ~130

**Step 2.2: Remove `directoryExistsForGit` duplication**
- In `cli/src/utils/git.ts`: replace private `directoryExistsForGit()` with import of `directoryExists` from `../utils/fs.ts`
- Lines saved: ~8

### Phase 3: Extract Misplaced Utilities (Medium Risk)

**Step 3.1: Extract hash utilities to `core/hashing.ts`**
- Create `cli/src/core/hashing.ts` with:
  - `computeHash(content: string): string` -- the shared `sha256:${slice(0,12)}` pattern
  - Re-export specialized variants or have callers compose: e.g., `computeHash(stripped)` instead of `computeContentHash(content, options)`
- Update all 6 hash call sites across `skill-metadata.ts`, `markers.ts`, `lockfile.ts`, `sync.ts`
- This consolidates the AGENTS.md instruction that warns "All content hashes MUST use the same format" into a single enforced implementation

**Step 3.2: Extract CLI version utilities from `lockfile.ts`**
- Create `cli/src/core/cli-version.ts` with:
  - `getCliVersion()` (from `lockfile.ts:111`)
  - `checkCliVersionMismatch()` (from `lockfile.ts:128`)
- Update imports in:
  - `cli/src/cli.ts` (line 10)
  - `cli/src/commands/upgrade-cli.ts` (line 4)

**Step 3.3: Move `getMarkers()` and `getMetadataKeys()` out of `config/schema.ts`**
- Move `getMarkers()` into `core/markers.ts` directly (it already re-exports it)
- Move `getMetadataKeys()` into `core/managed-content.ts` directly (it already wraps it via `getMetadataKeyNames`)
- Remove the thin re-export wrappers that currently exist
- Update imports in `config/schema.ts` to remove the functions

### Phase 4: Split Multi-Concern Modules (Higher Risk)

**Step 4.1: Split `version.ts`**
- Extract GitHub API code to `cli/src/core/github-releases.ts`:
  - `getGitHubToken()`, `getGitHubHeaders()` (private)
  - `getLatestRelease()`, `getReleaseByTag()`, `parseReleaseResponse()`, `ReleaseInfo`
- Keep semver utilities in `cli/src/core/version.ts`:
  - `parseVersion()`, `formatTag()`, `isVersionRef()`, `compareVersions()`
- Update imports in:
  - `cli/src/commands/shared.ts` (lines 13-18): split between both files
  - `cli/src/core/workflows.ts` (line 11): only uses `formatTag`, stays with `version.ts`
  - `cli/src/commands/upgrade-cli.ts` (line 5): only uses `compareVersions`, stays with `version.ts`

**Step 4.2: Consider splitting `managed-content.ts` (formerly `skill-metadata.ts`)**
- After renaming in Phase 1, evaluate splitting into:
  - `managed-content.ts` -- metadata operations: `addManagedMetadata`, `computeContentHash`, `stripManagedMetadata`, `isManaged`, `hasManualChanges`
  - `integrity-check.ts` -- file checking: `checkSkillFiles`, `checkRuleFiles`, `checkAgentFiles`, `checkAgentsMd`, `checkAllManagedFiles`, `getModifiedManagedFiles`
- This split would make the check command's imports cleaner and separate "write-time" from "read-time" operations

---

## Dependency Direction Issues

### Reverse Dependency: `config/schema.ts` -> `core/`

`config/schema.ts` exports `getMarkers()` and `getMetadataKeys()` which are runtime helper functions consumed by core modules. This creates a dependency from `config/` -> `core/` that feels backwards. Schema definition modules should define shapes; runtime marker generation belongs in core.

### Circular Potential: `skill-metadata.ts` <-> `markers.ts`

`skill-metadata.ts` imports 6 functions from `markers.ts` (line 7-15). `markers.ts` does not import from `skill-metadata.ts`. However, `skill-metadata.ts` orchestrates checking that involves both marker-based content (AGENTS.md) and frontmatter-based content (skills, rules, agents). If marker checking were ever moved into `markers.ts`, a circular dependency would form. The current architecture avoids this by centralizing all checking in `skill-metadata.ts`, but the module name obscures this design decision.

---

## Summary of Recommendations (Priority Order)

1. **Rename `skill-metadata.ts` to `managed-content.ts`** -- highest impact, fixes the most misleading name in the codebase and eliminates the need for import aliasing in `rules.ts` and `agents.ts`
2. **Remove duplicated YAML infrastructure from `agents.ts`** -- eliminates ~130 lines of copy-pasted code that will drift over time
3. **Extract `computeHash` to `core/hashing.ts`** -- consolidates the critical hash consistency requirement into a single source of truth
4. **Rename `core/schema.ts` to `core/schema-compat.ts`** -- eliminates confusion with `config/schema.ts`
5. **Extract CLI version utilities from `lockfile.ts`** -- clean SRP improvement
6. **Move `getMarkers`/`getMetadataKeys` from `config/schema.ts` to their consuming core modules** -- fixes reverse dependency direction
7. **Split `version.ts` into semver utilities and GitHub API** -- clean separation of concerns
8. **Remove `directoryExistsForGit` duplication in `git.ts`** -- trivial cleanup
