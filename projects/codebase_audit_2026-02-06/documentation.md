# Documentation Audit Report

**Date:** 2026-02-06
**Project:** agconf CLI (v0.6.2)
**Scope:** All documentation files and source code JSDoc/TSDoc coverage

---

## Code Documentation

### Well-Documented

The following source files have strong inline documentation with JSDoc/TSDoc comments on most or all exported functions, interfaces, and types:

1. **`/cli/src/core/markers.ts`** -- Every exported function has a JSDoc comment explaining its purpose. Interfaces have field-level documentation. Functions like `computeGlobalBlockHash`, `parseAgentsMd`, `buildGlobalBlock`, `buildRepoBlock`, `hasGlobalBlockChanges`, `parseRulesSection`, `computeRulesSectionHash`, and `hasRulesSectionChanges` are all documented.

2. **`/cli/src/core/rules.ts`** -- All exported functions have detailed JSDoc with `@param` and `@returns` tags. The `adjustHeadingLevels` function has a particularly good doc block explaining rules about code block skipping and heading caps. Interfaces `RuleFrontmatter` and `Rule` have per-field documentation.

3. **`/cli/src/core/agents.ts`** -- Good coverage with JSDoc on all exported functions (`parseAgent`, `validateAgentFrontmatter`, `addAgentMetadata`). Interfaces `AgentFrontmatter` and `Agent` have field-level docs. The `addAgentMetadata` function includes a note about the difference from rules (flat files vs source_path).

4. **`/cli/src/core/frontmatter.ts`** -- Excellent documentation with module-level doc comment, JSDoc on all exported functions, `@example` blocks for `parseFrontmatter` and `serializeFrontmatter`, and explanation of supported YAML formats in `parseSimpleYaml`.

5. **`/cli/src/core/schema.ts`** -- Module-level documentation explaining the schema versioning strategy. The `checkSchemaCompatibility` function has a detailed JSDoc with `@param` and `@returns`. Compatibility rules are clearly documented.

6. **`/cli/src/core/version.ts`** -- Module-level documentation. All exported functions documented: `getLatestRelease`, `getReleaseByTag`, `parseVersion`, `formatTag`, `isVersionRef`, `compareVersions`. Internal functions like `getGitHubToken` and `getGitHubHeaders` also documented.

7. **`/cli/src/core/skill-metadata.ts`** -- Comprehensive JSDoc coverage on all exported functions and interfaces. `ManagedMetadata`, `MetadataOptions`, `SkillFileCheckResult`, `ManagedFileCheckResult`, `RuleFileCheckResult`, `AgentFileCheckResult` all have field-level docs.

8. **`/cli/src/core/hooks.ts`** -- Good documentation with JSDoc on `generatePreCommitHook`, `installPreCommitHook`, `getHookConfig`. Interfaces documented.

9. **`/cli/src/core/workflows.ts`** -- Module-level doc comment. All exported functions documented. Interfaces `WorkflowConfig`, `WorkflowSettings`, `WorkflowFile`, `WorkflowSyncResult` all have field-level documentation.

10. **`/cli/src/schemas/lockfile.ts`** -- Schema fields have inline comments. Module-level version bump guidelines documented.

11. **`/cli/src/config/schema.ts`** -- Zod schemas have good inline comments. Module-level sections clearly delineated. `CURRENT_CONFIG_VERSION` has version bump guidelines. `getMarkers` and `getMetadataKeys` documented.

12. **`/cli/src/config/loader.ts`** -- Both `loadCanonicalRepoConfig` and `loadDownstreamConfig` have JSDoc comments.

13. **`/cli/src/core/lockfile.ts`** -- Key functions `readLockfile`, `writeLockfile`, `checkCliVersionMismatch` all have JSDoc with behavioral documentation.

14. **`/cli/src/utils/git.ts`** -- All exported functions (`getGitRoot`, `getGitProjectName`, `isGitRoot`, `getGitOrganization`) have JSDoc comments.

### Needs Documentation

The following files have minimal or no JSDoc documentation on exported functions:

1. **`/cli/src/core/sync.ts`** -- The main `sync()` function (line 408) has NO JSDoc comment. This is the primary orchestrator of the entire sync pipeline and arguably the most important exported function in the codebase. `getSyncStatus`, `findOrphanedSkills`, `deleteOrphanedSkills`, `findOrphanedAgents`, `deleteOrphanedAgents` have JSDoc, but `syncRules` and `syncAgents` have only basic one-line JSDoc comments that don't explain the full behavior. The private functions `discoverRules`, `computeRulesHash`, `discoverAgents`, `computeAgentsHash`, `syncSkillsToTarget`, `copySkillDirectory` have basic JSDoc or none. The exported interfaces `SyncOptions`, `RulesSyncOptions`, `RulesSyncResult`, `AgentsSyncOptions`, `AgentsSyncResult`, `SyncResult` lack field-level documentation on most fields.

2. **`/cli/src/core/merge.ts`** -- Only `consolidateClaudeMd` has a JSDoc comment. The main `mergeAgentsMd` function has NO documentation despite being a complex merge algorithm with multiple content sources (AGENTS.md, root CLAUDE.md, .claude/CLAUDE.md). `writeAgentsMd` has no JSDoc. Private functions `gatherExistingContent`, `stripAgentsReference`, `readFileIfExists` are undocumented.

3. **`/cli/src/core/source.ts`** -- `resolveLocalSource` and `resolveGithubSource` have NO JSDoc comments despite being key public API functions. `formatSourceString` has no JSDoc. Private functions `cloneRepository`, `findCanonicalRepo`, `isCanonicalRepo`, `validateCanonicalRepo` have basic one-liner JSDoc or none.

4. **`/cli/src/core/targets.ts`** -- No JSDoc on any exported functions (`isValidTarget`, `parseTargets`, `getTargetConfig`). Interfaces are minimally documented.

5. **`/cli/src/commands/init.ts`** -- No JSDoc on `initCommand`.

6. **`/cli/src/commands/sync.ts`** -- No JSDoc on `syncCommand`.

7. **`/cli/src/commands/check.ts`** -- `checkCommand` has a minimal one-line JSDoc. `ModifiedFileInfo` and `CheckResult` interfaces lack field-level docs.

8. **`/cli/src/commands/shared.ts`** -- `resolveVersion` has a good JSDoc with `@param` tag. However, `parseAndValidateTargets`, `resolveTargetDirectory`, `resolveSource`, `promptMergeOrOverride`, `performSync` lack JSDoc or have minimal docs. `SharedSyncOptions`, `CommandContext`, `ResolvedVersion`, `PerformSyncOptions` interfaces lack field-level documentation.

9. **`/cli/src/commands/canonical.ts`** -- `canonicalInitCommand` has no JSDoc. Private generators (`generateConfigYaml`, `generateAgentsMd`, `generateExampleSkillMd`, `generateSyncWorkflow`, `generateCheckWorkflow`) have one-liner JSDoc comments but lack parameter/return docs.

10. **`/cli/src/utils/fs.ts`** -- No JSDoc on any exported functions (`ensureDir`, `fileExists`, `directoryExists`, `createTempDir`, `removeTempDir`, `resolvePath`).

11. **`/cli/src/utils/logger.ts`** -- No JSDoc on `createLogger` or `formatPath`.

12. **`/cli/src/cli.ts`** -- Not read, but as the CLI entry point, likely minimal docs.

13. **`/cli/src/index.ts`** -- Not read, but as the package entry point, should have module-level documentation.

---

## API Documentation

### Status: Not applicable / Internal CLI

The project is a CLI tool, not a library. There is no programmatic API documentation (no TypeDoc, no API reference site). This is acceptable for the current scope. However:

- **Exported interfaces and types** from `cli/src/core/` modules could serve as an internal API surface for contributors. These are reasonably well-typed with Zod schemas and TypeScript interfaces, but lack a generated reference.
- **No `--help` documentation audit was performed**, but CLI commands appear to use commander.js or clack with structured options.

### Recommendation

No immediate action needed. If the project evolves into a library (importable modules), a generated API reference would be warranted.

---

## User Documentation

### Existing Guides

| Document | Location | Content Quality |
|----------|----------|-----------------|
| Root README | `/README.md` | **Excellent.** Comprehensive overview, installation, quick start, all commands documented with examples, versioning table, FAQ, CI/CD section, private repo setup. |
| CLI README | `/cli/README.md` | **Good.** Concise npm-oriented readme. Includes CLAUDE.md handling, rules, downstream config. Slightly duplicative with root README. |
| CONTRIBUTING | `/cli/CONTRIBUTING.md` | **Good.** Development setup, code style, testing, commit conventions, releases, PR process, issue reporting. |
| SECURITY | `/cli/SECURITY.md` | **Good.** Standard security policy with reporting process and response timelines. |
| Canonical Setup | `/cli/docs/CANONICAL_REPOSITORY_SETUP.md` | **Excellent.** Step-by-step guide with directory structure, config reference, skills creation, GitHub App and PAT authentication, cross-repo workflow setup, troubleshooting. |
| File Integrity | `/cli/docs/CHECK_FILE_INTEGRITY.md` | **Good but stale** (see Stale Documentation below). |
| Versioning | `/cli/docs/VERSIONING.md` | **Good.** Schema-based versioning, behavior matrix, lockfile structure, troubleshooting. |
| Downstream Config | `/cli/docs/DOWNSTREAM_REPOSITORY_CONFIGURATION.md` | **Good.** Clear settings reference, strategy comparison, generated workflow output example. |
| AGENTS.md | `/AGENTS.md` | **Excellent.** Comprehensive developer/agent guide. Architecture, key patterns, rules sync, agents sync, hash consistency, testing requirements, check command integrity. |

### Missing Guides

1. **Migration Guide** -- No documentation for users upgrading across breaking changes. The CHANGELOG notes the v2.0.0 breaking change (update -> sync consolidation) but there is no standalone migration guide. Version history shows jumps from v2.x.x to v0.x.x (version reset), which could confuse users.

2. **Multi-Target Configuration Guide** -- The docs mention Claude and Codex targets but there is no dedicated guide explaining how to configure and use multi-target sync (e.g., `--target claude,codex`), what files are created for each target, and the behavioral differences.

3. **Agents Feature Documentation** -- The agents sync feature (added in v0.6.0) is documented in AGENTS.md but NOT in the user-facing docs:
   - `/cli/docs/CANONICAL_REPOSITORY_SETUP.md` does not mention `agents_dir` configuration
   - `/cli/README.md` does not mention agents at all
   - `/README.md` does not document the agents feature
   - `/cli/docs/CHECK_FILE_INTEGRITY.md` does not mention agent files

4. **Troubleshooting Guide** -- Individual docs have troubleshooting sections, but there is no centralized troubleshooting guide. Common issues like authentication failures, hash mismatches, and workflow errors are scattered across multiple documents.

5. **Rules Feature in Root README** -- While `/cli/README.md` has a detailed rules section, the root `/README.md` does not mention rules or the `rules_dir` configuration at all. The "Files Created" table does not list `.claude/rules/`.

6. **`agconf config` detailed docs** -- Only the `cli-repo` config key is documented. No guide on how global config is used or stored.

7. **Shell Completions Setup Guide** -- The `completion install` command is listed in the commands table but there is no documentation on how to set up or use shell completions.

---

## Architecture Documentation

### Status: Good (in AGENTS.md)

The `/AGENTS.md` file serves as the primary architecture document and is **comprehensive**:

- Core modules listed with one-line descriptions
- Plugin system described (targets, providers)
- Commands enumerated
- Key patterns documented (markers, lockfile, merge strategy, downstream config)
- Rules sync documented with function signatures and target-specific behavior
- Agents sync documented similarly
- Check command integrity requirements detailed

### Issues

1. **Plugin System Reference is Stale**: AGENTS.md references `cli/src/plugins/targets/` and `cli/src/plugins/providers/` directories, but **these directories do not exist** in the codebase. The plugin system was apparently removed or never implemented. Targets are implemented directly in `cli/src/core/targets.ts` and providers (GitHub API) are in `cli/src/core/version.ts` and `cli/src/core/source.ts`.

2. **No Visual Architecture Diagram**: The root README has an ASCII diagram showing the canonical/downstream flow, which is good. However, there is no diagram of the internal module architecture or data flow during a sync operation.

3. **No ADR (Architecture Decision Records)**: No documentation of why certain architectural decisions were made (e.g., why custom YAML parser instead of a library, why schema-based versioning instead of CLI-based).

---

## README Assessment

### Root README (`/README.md`)

| Criteria | Status | Notes |
|----------|--------|-------|
| Project description | Present | Clear one-line + "Why agconf?" section |
| Installation instructions | Present | npm, source (SSH), gh CLI methods |
| Quick start | Present | 3-step guide |
| Command reference | Present | All commands with examples and flags |
| Configuration reference | Partial | Missing `rules_dir`, `agents_dir` from canonical config |
| Architecture overview | Present | ASCII diagram |
| Contributing reference | Partial | Development commands listed, links to CONTRIBUTING.md would be better |
| License | Present | MIT |
| Badges | Present | npm, CI, license |
| Requirements | Present | Node 20+, Git, pnpm |
| FAQ | Present | Three well-crafted entries |
| Files created table | Stale | Does not mention `.claude/rules/` or `.claude/agents/` |

### CLI README (`/cli/README.md`)

| Criteria | Status | Notes |
|----------|--------|-------|
| npm description | Present | Brief with link to main docs |
| Commands table | Present | |
| Quick start | Present | But truncated/awkward -- "### 2. Sync to your projects" heading is at h3, then jumps to "## CLAUDE.md Handling" then back to "### Sync to your projects" |
| Rules docs | Present | Detailed |
| CLAUDE.md handling | Present | Good |
| Downstream config | Present | |

**Issue:** The CLI README has a structural problem where the Quick Start section (lines 30-60) is disjointed. Step 2 appears at line 43 as an h3, then CLAUDE.md Handling appears at line 43 as an h2, then "Sync to your projects" reappears at line 55 as an h3. This appears to be a copy-paste or merge error.

---

## Stale Documentation

### 1. CHECK_FILE_INTEGRITY.md -- Missing Rule, Agent, and Rules-Section Content Types

**File:** `/cli/docs/CHECK_FILE_INTEGRITY.md`

The overview section (line 12-17) states:
> agconf manages certain files in your repository:
> - AGENTS.md (global block)
> - Skill files (`.claude/skills/*/SKILL.md`)

This is incomplete. The check command currently verifies **five** content types (as documented in AGENTS.md and implemented in `cli/src/core/skill-metadata.ts`):
1. AGENTS.md global block
2. AGENTS.md rules section (for Codex)
3. Skill files (`.claude/skills/*/SKILL.md`)
4. Rule files (`.claude/rules/**/*.md`)
5. Agent files (`.claude/agents/*.md`)

The document does not mention rules, agents, or the rules-section content type anywhere. The CI workflow paths section (line 160-161) also only lists skills and AGENTS.md, missing `.claude/rules/**` and `.claude/agents/**`.

### 2. CHECK_FILE_INTEGRITY.md -- Check Workflow Missing Rule/Agent Paths

The example `agconf-check.yml` on lines 155-166 shows:
```yaml
paths:
  - 'AGENTS.md'
  - '.claude/skills/**'
```

But the actual generated workflow in `workflows.ts` (line 285-296) includes:
```yaml
paths:
  - '.claude/skills/**'
  - '.codex/skills/**'
  - 'AGENTS.md'
```

Neither version includes `.claude/rules/**` or `.claude/agents/**`. The generated workflow paths should be updated to trigger on rule and agent file changes.

### 3. AGENTS.md -- Plugin System Reference

**File:** `/AGENTS.md` (lines 53-55)

References:
> ### Plugin System (`cli/src/plugins/`)
> - `targets/` - Agent implementations (Claude Code, GitHub Copilot)
> - `providers/` - Content providers (GitHub API)

The `cli/src/plugins/` directory does **not exist**. Also references "GitHub Copilot" as a target implementation, but only Claude and Codex are supported targets (see `cli/src/core/targets.ts`).

### 4. SECURITY.md -- Version Support Table

**File:** `/cli/SECURITY.md` (line 12)

States `1.x.x` is the supported version, but the current version is `0.6.2`. The project went through a version reset from `2.x.x` to `0.x.x` (as visible in the CHANGELOG). The supported version claim is inaccurate.

### 5. VERSIONING.md -- Lockfile Structure Example

**File:** `/cli/docs/VERSIONING.md` (lines 190-212)

The example lockfile JSON does not include the `rules` or `agents` fields under `content`, which were added in v0.2.0 and v0.6.0 respectively. It also does not show the `marker_prefix` field. The example should be updated to reflect the current lockfile schema.

### 6. VERSIONING.md -- Canonical Repository Setup Section

**File:** `/cli/docs/VERSIONING.md` (lines 157-168)

States:
> Workflow files are generated without CLI version pinning

And shows:
```yaml
- name: Install agconf CLI
  run: npm install -g agconf  # Uses latest compatible version
```

But the `CANONICAL_REPOSITORY_SETUP.md` (lines 177-178) shows pinned version:
```yaml
- name: Install agconf CLI
  run: npm install -g agconf@1.2.0
```

This is contradictory. Checking the canonical.ts source, the generated workflows use `npm install -g agconf` (unpinned), so VERSIONING.md is correct and CANONICAL_REPOSITORY_SETUP.md is misleading (it shows what a user might customize, not what is generated).

### 7. CHANGELOG.md -- Duplicate and Inconsistent Entries

**File:** `/cli/CHANGELOG.md`

The changelog has multiple issues:
- Version `0.2.0` appears **four times** (lines 96, 104, 112, 119) with slightly different content
- A manual "Unreleased" section appears twice (lines 224 and 286), with identical content about the `update` -> `sync` consolidation
- Old manual changelog entries at the bottom (lines 257-295) from the pre-automated era overlap with automated entries
- Jekyll frontmatter (`layout: default`, `title: Changelog`, `nav_order: 7`) is embedded mid-file (line 219), suggesting the automated semantic-release appended to a file that had manual content

### 8. CONTRIBUTING.md -- Changeset Reference

**File:** `/cli/CONTRIBUTING.md` (lines 296-302)

References `pnpm changeset` for creating changesets, but the project uses semantic-release (not changesets). This appears to be a leftover from an earlier tooling setup.

### 9. Root README -- `status` Command Reference in CHANGELOG

**File:** `/cli/CHANGELOG.md` (line 305)

The initial 0.1.0 changelog entry lists `agconf status` as a core command, and the same changelog mentions `agconf init-canonical-repo`. Both commands have been removed (`status` was removed in v0.4.0, and `init-canonical-repo` was replaced by `canonical init`). This is stale but acceptable since it is historical changelog content.

### 10. Root README -- "Files Created" Table

**File:** `/README.md` (lines 285-295)

The table does not include:
- `.claude/rules/` (added in v0.2.0)
- `.claude/agents/` (added in v0.6.0)

---

## Recommendations

### Priority 1 -- Fix Stale Documentation (Accuracy)

1. **Update `/cli/docs/CHECK_FILE_INTEGRITY.md`** to include all five verified content types: AGENTS.md global block, AGENTS.md rules section, skill files, rule files, and agent files. Update the CI workflow example paths.

2. **Fix AGENTS.md plugin system reference** -- Remove or rewrite the "Plugin System" section to accurately reflect the current architecture (targets in `cli/src/core/targets.ts`, GitHub API in `cli/src/core/version.ts` and `cli/src/core/source.ts`). Change "GitHub Copilot" to "Codex".

3. **Fix SECURITY.md version table** -- Change supported version from `1.x.x` to `0.x.x` (or list the actual supported range).

4. **Fix CONTRIBUTING.md changeset reference** -- Remove the `pnpm changeset` section since the project uses semantic-release.

5. **Fix CLI README structure** -- Resolve the duplicate/disjointed Quick Start section in `/cli/README.md`.

### Priority 2 -- Document New Features

6. **Document agents feature in user-facing docs** -- Add `agents_dir` to CANONICAL_REPOSITORY_SETUP.md, update the README "Files Created" table, and mention agents in CHECK_FILE_INTEGRITY.md.

7. **Update README "Files Created" table** -- Add `.claude/rules/` and `.claude/agents/`.

8. **Update VERSIONING.md lockfile example** -- Add `rules`, `agents`, and `marker_prefix` fields.

### Priority 3 -- Add Missing Documentation

9. **Add JSDoc to `sync()` function** -- The main sync orchestrator function is the most important function in the codebase and has no documentation.

10. **Add JSDoc to `mergeAgentsMd()`** -- The merge algorithm is complex and handles multiple content sources.

11. **Add JSDoc to `resolveLocalSource()` and `resolveGithubSource()`** -- Key public functions with no documentation.

12. **Add JSDoc to utility functions in `cli/src/utils/fs.ts`** -- Simple but worth documenting for consistency.

### Priority 4 -- Clean Up

13. **Clean up CHANGELOG.md** -- Remove duplicate 0.2.0 entries, remove mid-file frontmatter, consolidate duplicate "Unreleased" sections.

14. **Add migration notes** -- For the v2.x -> v0.x version reset and the `update` -> `sync` command consolidation.

15. **Consider a centralized troubleshooting guide** -- Consolidate the troubleshooting sections from individual docs.

### Priority 5 -- Nice to Have

16. **Generate API reference** -- If the project expands, consider TypeDoc for internal module documentation.

17. **Add architecture diagram** -- A Mermaid or ASCII diagram showing the data flow during `sync` operations.

18. **Document shell completions setup** -- Add instructions for the `completion install` command.
