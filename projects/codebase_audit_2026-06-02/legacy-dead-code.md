# Technical Debt Report

**Audit date:** 2026-06-02
**Scope:** `cli/src/**` and `cli/tests/**` (ESM TypeScript, Biome, strict mode)
**Method:** For every named `export` in `cli/src`, grepped the whole `cli/src` + `cli/tests`
tree for word-boundary references in files *other than* the defining file. Cross-checked
prior-audit (#38) remediations for regression. Ran `biome lint` (clean) and `tsc --noEmit`
(clean) to confirm no unused *imports* or *locals* — those tools do **not** detect unused
*exports* across files, which is why the Export Hygiene rule requires manual auditing.

**Note on `index.ts`:** `cli/src/index.ts` is only the CLI bin entrypoint (`createCli().parse()`).
The package publishes no library API surface and re-exports nothing. Therefore *every* `export`
must be justified by an actual cross-module import per the AGENTS.md "Export Hygiene" rule;
a symbol referenced only inside its own defining file is an over-export.

---

## Dead Code

### Truly unreferenced exports (zero references anywhere, including own file body)

None found. Every exported symbol is referenced at least within its own file (as an internal
call or as a signature type). There are no fully-orphaned exported functions/constants.

### Internal-only exported functions (over-exports — safe to un-`export`, no behavior change)

These exported functions are called **only from within their own defining file** (grep
confirms 0 importers across `cli/src` and `cli/tests`). They are dead *as public symbols*:
the `export` keyword can be removed.

| Symbol | Location | Verification |
|--------|----------|-------------|
| `getMetadataKeys` | `cli/src/core/managed-content.ts:43` | grep: only managed-content.ts references it (lines 193, 270, 297, 320). 0 external importers. |
| `checkSkillFiles` | `cli/src/core/managed-content.ts:424` | Only callsite is `checkAllManagedFiles` in same file (line 722). `check.ts` uses `checkAllManagedFiles` only. 0 external. |
| `checkRuleFiles` | `cli/src/core/managed-content.ts:483` | Only callsite line 738 in same file. 0 external. |
| `checkAgentFiles` | `cli/src/core/managed-content.ts:598` | Only callsite line 753 in same file. 0 external. |
| `checkAgentsMd` | `cli/src/core/managed-content.ts:647` | Only callsite line 710 in same file. 0 external. |
| `checkAgentsMdRulesSection` | `cli/src/core/managed-content.ts:774` | Only callsite line 716 in same file. 0 external. |
| `getLockfilePath` | `cli/src/core/lockfile.ts:18` | Only callsites lines 36, 79 in same file. 0 external. |
| `ensureWorkflowsDir` | `cli/src/core/workflows.ts:330` | Only callsite line 345 (`syncWorkflows`) in same file. 0 external. |

> These eight `check*Files` helpers are the granular building blocks of `checkAllManagedFiles`
> (the single function `check.ts` actually imports). They were likely exported speculatively /
> for testing, but `managed-content.test.ts` does not import them either (confirmed). The
> exported aggregate `checkAllManagedFiles` and the shared predicates `skillMatchesCanonical`,
> `fileMatchesCanonical`, `computeContentHash`, `isManaged`, `stripManagedMetadata`,
> `validateSkillFrontmatter`, `ManagedFileCheckResult`, `CheckManagedFilesOptions`,
> `getModifiedManagedFiles` ARE imported externally and must stay exported.

### Internal-only exported schema sub-objects (over-exports)

These Zod sub-schemas are composed into a larger exported schema **within the same file** and
are never imported elsewhere (grep confirms 0 external importers):

| Symbol | Location | Composed into | Verification |
|--------|----------|---------------|-------------|
| `CanonicalMetaSchema` | `cli/src/config/schema.ts:21` | `CanonicalRepoConfigSchema` | 0 external refs |
| `MarkersConfigSchema` | `cli/src/config/schema.ts:41` | `CanonicalRepoConfigSchema` / `ResolvedConfigSchema` | 0 external refs |
| `MergeConfigSchema` | `cli/src/config/schema.ts:50` | `CanonicalRepoConfigSchema` / `ResolvedConfigSchema` | 0 external refs |
| `AgentsContentSchema` | `cli/src/schemas/lockfile.ts:21` | `ContentSchema` | 0 external refs |
| `SourceSchema` | `cli/src/schemas/lockfile.ts:28` | `LockfileSchema` (+ exported `Source` type) | `SourceSchema` const itself: 0 external refs. NOTE: the derived `type Source` IS imported widely — keep the type export; only the `const` can be un-exported, but inferring `Source` requires the schema. Lowest priority / leave as-is. |

> Sibling sub-schemas that ARE consumed externally (do NOT touch): `CanonicalPathsSchema`,
> `WorkflowConfigSchema`, `DownstreamConfigSchema`, `ResolvedConfigSchema`,
> `CanonicalRepoConfigSchema`, `RulesContentSchema`, `ContentSchema`, `LockfileSchema` —
> all referenced from `config/loader.ts`, `core/workflows.ts`, or tests.

### Over-exported signature/option/result types (low severity)

These interfaces/types are used **only** as parameter or return types of functions within their
own file; no other module imports them by name. TypeScript infers them structurally at every
external call site, so the `export` keyword is unnecessary. Listed for completeness — each is a
minor Export Hygiene deviation, not a correctness issue:

| Symbol | Location |
|--------|----------|
| `ParsedAgentsMd`, `GlobalBlockMetadata`, `ParsedGlobalBlockMetadata`, `ParsedRulesSection`, `RulesSectionMetadata` | `cli/src/core/markers.ts:28,34,38,249,256` |
| `MetadataOptions` | `cli/src/core/managed-content.ts:27` |
| `AgentFrontmatter` | `cli/src/core/agents.ts:14` |
| `RuleFrontmatter` | `cli/src/core/rules.ts:13` |
| `ProposeOptions`, `DownstreamContext` | `cli/src/core/propose.ts:43,51` |
| `HookConfig`, `HookInstallResult` | `cli/src/core/hooks.ts:20,106` |
| `ParsedFrontmatter` | `cli/src/core/frontmatter.ts:15` (return type of `parseFrontmatter`; 0 external refs) |
| `ReadLockfileResult`, `WriteLockfileOptions`, `VersionMismatch` | `cli/src/core/lockfile.ts:22,55,115` |
| `RulesSyncOptions`, `RulesSyncResult`, `AgentsSyncOptions`, `AgentsSyncResult`, `TargetResult`, `SyncResult`, `SyncConflict`, `DeleteOrphanedSkillsOptions` | `cli/src/core/sync.ts:47,56,68,74,371,378,421,950` |
| `DetectionResult` | `cli/src/utils/package-manager.ts:6` |
| `Logger` | `cli/src/utils/logger.ts:4` (return type of `createLogger`; 0 external refs) |
| `UpgradeCliOptions` | `cli/src/commands/upgrade-cli.ts:16` |
| `InitOptions` | `cli/src/commands/init.ts:17` |
| `CanonicalInitOptions` | `cli/src/commands/canonical.ts:12` |
| `ProposeCommandOptions` | `cli/src/commands/propose.ts:15` |
| `CommandContext`, `PerformSyncOptions` | `cli/src/commands/shared.ts:43,327` |
| `CheckOptions`, `ModifiedFileInfo` | `cli/src/commands/check.ts:23,29` |

> These are signature types for *exported* functions (e.g. `SyncResult` is the resolved type of
> `sync()`, `CheckOptions` is the param of `checkCommand`). Exporting a function's own
> option/result type is a common and defensible convention. Recommend leaving the **command**
> option/result types as-is and, if pursuing strict hygiene, only un-exporting the purely-internal
> core types (`ParsedFrontmatter`, `Logger`, the `markers.ts` `Parsed*`/`*Metadata` set,
> `ReadLockfileResult`, `WriteLockfileOptions`). Mechanical, no runtime impact.

### Unreachable / no-op code

None found. No early-return-then-code, no constant-condition branches, no dead `switch` arms
(the `buildProposedChange` `default` arm at `cli/src/core/propose.ts:338-341` is reachable — it
handles the `rules-section` type).

### Unused files

None. All 34 source files are reachable from the `createCli` entrypoint or imported by another
module. All 33 test files are valid vitest suites.

---

## Deprecated Patterns

- **No `@deprecated` annotations, no legacy/superseded code paths.** Grep for
  `deprecated|WORKAROUND|legacy|superseded` across `cli/src` and `cli/tests`: 0 hits.
- **Prior-audit (#38) remediations held — no regressions:**
  - `updateWorkflowVersion`: absent (grep: 0 hits in src/tests). Still removed.
  - `config/index.ts` barrel: absent (`cli/src/config/` contains only `loader.ts`, `schema.ts`).
  - Over-exports previously flagged in `source.ts` (`resolveLocalSource`, `resolveGithubSource`,
    `formatSourceString`, `ResolvedSource`) and `merge.ts` (`mergeAgentsMd`, `writeAgentsMd`,
    `consolidateClaudeMd`) are now genuinely consumed by `commands/shared.ts`, `commands/propose.ts`,
    `core/sync.ts`, and tests. Fixed and still in use.
- **Only 2 lint-suppression directives, both justified:** `cli/src/commands/canonical.ts:1`
  (`biome-ignore-all noUselessEscapeInString` — needed for `$` in generated shell scripts) and
  `cli/src/commands/completion.ts:7` (`@ts-expect-error` — untyped `tabtab` internal module).
  No `as any` / `as unknown as` casts anywhere in `cli/src`.

---

## Duplicated Code

### 1. Canonical-repo clone logic duplicated between `propose.ts` and `source.ts` (notable)

`cli/src/core/propose.ts:856-892` defines private `cloneCanonical()` + `isGhAvailable()` that are a
near-verbatim copy of `cli/src/core/source.ts:121-153` (`cloneRepository()` + `isGhAvailable()`):
the same "try `gh repo clone` → fall back to `git clone` with `GITHUB_TOKEN` HTTPS URL" sequence,
the same `isGhAvailable()` (`gh --version`) probe, and the same token-URL construction
(`https://x-access-token:${token}@github.com/...`).

- propose.ts: `cli/src/core/propose.ts:856` (`cloneCanonical`), `:885` (`isGhAvailable`)
- source.ts: `cli/src/core/source.ts:121` (`cloneRepository`), `:145` (`isGhAvailable`)

Only meaningful difference: `source.ts` clones with `--depth 1` (read-only resolve), while
`propose.ts` clones full history (it needs to push a branch). This is the AGENTS.md "Utility Reuse"
rule's "pattern appears in 2+ locations → extract to `cli/src/utils/`" case. Recommend extracting a
shared `cloneRepo(repository, ref, dir, { depth?: number })` helper (e.g. into `cli/src/utils/git.ts`)
and an `isGhAvailable()` (also into `utils/git.ts`), then have both modules call it.

### 2. Temp-dir-then-clone scaffold duplicated within `propose.ts`

`cli/src/core/propose.ts:263-269` (`cloneCanonicalForDetect`) and `:796-801` (the inline `else`
branch of `applyProposedChanges`) build the same `TMPDIR/agconf-propose-<ts>/canonical` path and
call `cloneCanonical`. Minor — fold the inline block into a call to `cloneCanonicalForDetect`.

### 3. `buildGhPrCommand` called redundantly in `applyProposedChanges`

`cli/src/core/propose.ts:833` and `:845`/`:841` recompute the identical `gh pr create` string in
multiple branches. Minor; compute once. (Cleanliness, not a bug.)

### 4. Per-file fast-glob walk repeated across modules (acceptable)

The `await fg("**/*", { cwd, onlyFiles: true, dot: true })` directory walk recurs in
`managed-content.ts:149,339`, `propose.ts:211,707`, `sync.ts:489`. propose.ts already has a local
`globFiles()` wrapper (`cli/src/core/propose.ts:726`). Low value to consolidate further; noting only.

No copy-paste blocks found *between* `propose.ts` and `sync.ts` beyond the shared
`managed-content` predicates, which are correctly imported (not duplicated).

---

## Unused Dependencies

All 9 runtime `dependencies` in `cli/package.json` are imported in `cli/src` (verified by grep):

| Dependency | Importing files (count) | Status |
|-----------|------------------------|--------|
| `@clack/prompts` | 8 | used |
| `commander` | 1 (`cli.ts`) | used |
| `fast-glob` | 3 | used |
| `ora` | 1 | used |
| `picocolors` | 11 | used |
| `simple-git` | 3 (`source.ts`, `propose.ts`, `utils/git.ts`) | used |
| `tabtab` | 1 (`completion.ts`) | used |
| `yaml` | 2 | used |
| `zod` | 2 (`config/schema.ts`, `schemas/lockfile.ts`) | used |

**No unused dependencies.** devDependencies not audited for usage (build/test tooling).

---

## Code Comments Inventory

A whole-tree grep of `cli/src` and `cli/tests` for `TODO|FIXME|HACK|XXX` found **zero** actionable
debt markers. The only matches were the literal word "temporary" in benign code comments:

### TODOs
None.

### FIXMEs
None.

### HACKs
None.

### Other (informational)
- "temporary"/"temp" appears only in descriptive comments, not as debt markers:
  - `cli/src/core/propose.ts:760` — `/** Path to the temporary canonical clone */` (JSDoc)
  - `cli/tests/unit/check.test.ts:12`, `cli/tests/unit/sync.test.ts:50,55,308,317`,
    `cli/tests/unit/hooks.test.ts:15` — all "create/clean up temporary directory" test setup comments.
- No commented-out code blocks exist anywhere in `cli/src` (grep for line-comments starting with
  `const|let|function|return|if|for|import|export|await|class`: 0 hits).

---

## Cleanup Recommendations

Ordered by value-to-effort. None of these are correctness bugs; the codebase is clean.

1. **(Medium) Extract the duplicated clone logic.** Move `gh`/`git`-with-token clone + `isGhAvailable`
   out of both `propose.ts:856-892` and `source.ts:121-153` into `cli/src/utils/git.ts`, parameterizing
   `depth`. Removes ~35 lines of copy-paste and satisfies the AGENTS.md "Utility Reuse" rule. This is
   the single highest-value item.

2. **(Low) Un-`export` the 8 internal-only functions** in the "Dead Code → Internal-only exported
   functions" table (`getMetadataKeys`, the five `check*Files`/`checkAgentsMd*` helpers,
   `getLockfilePath`, `ensureWorkflowsDir`). Mechanical, zero runtime impact, tightens the public
   surface. Verify nothing breaks with `pnpm typecheck` + `pnpm test`.

3. **(Low) Un-`export` the internal-only Zod sub-schemas** `CanonicalMetaSchema`, `MarkersConfigSchema`,
   `MergeConfigSchema` (config/schema.ts) and `AgentsContentSchema` (schemas/lockfile.ts). Leave
   `SourceSchema` exported only if needed to infer the widely-used `Source` type — otherwise the
   `const` can be made local while keeping `export type Source`.

4. **(Low / optional) Un-`export` the purely-internal signature types** (`ParsedFrontmatter`,
   `Logger`, the `markers.ts` `Parsed*`/`*Metadata` set, `ReadLockfileResult`, `WriteLockfileOptions`).
   Leave command-level option/result interfaces (`SyncResult`, `CheckOptions`, `*CommandOptions`, etc.)
   exported — exporting a function's own signature type is a defensible convention.

5. **(Trivial) Dedupe `buildGhPrCommand` calls** in `applyProposedChanges` (propose.ts:833/841/845) and
   fold the inline temp-dir/clone block (propose.ts:796-801) into `cloneCanonicalForDetect`.

6. **(Out of audit scope, carry-over) Missing test files.** `cli/tests/unit/upgrade-cli.test.ts` and a
   dedicated `commands/sync.ts` flag-validation suite are still absent (flagged in commit-history.md).
   Not dead code, but the AGENTS.md "every command file must have a corresponding test file" rule is
   unmet for `upgrade-cli.ts` and `sync.ts`. Tracked elsewhere; noted for completeness.

**A note on the Export Hygiene rule:** the project's automated tooling (Biome + tsc) cannot detect
unused *exports*, so over-exports accumulate silently. Consider adding `knip` (or `ts-prune`) to CI as
a periodic check to enforce the rule mechanically rather than relying on manual audits.
