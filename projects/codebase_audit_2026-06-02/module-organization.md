# Module Organization Report

**Date:** 2026-06-02
**Scope:** `cli/src/` — all TypeScript source modules (33 files, ~9,600 LOC)
**Previous audit:** 2026-02-12 (`projects/codebase_audit_2026-02-12/module-organization.md`)

---

## Executive Summary

The codebase grew significantly since the last audit (the `propose` feature added `core/propose.ts` at 993 lines and reshaped `sync.ts` to 1038 lines). The dependency graph remains acyclic and the layering (`commands → core → config/schemas`, `utils` as leaf) is intact. However, **most of the prior audit's recommendations were NOT applied** — only the `config/index.ts` deletion and `utils/prefix.ts` extraction (both from PR #38) landed. The renames (`core/schema.ts`, `commands/shared.ts`), the `core/skills.ts` extraction, the `sync-output.ts` extraction, and the `parseFrontmatter` aliasing fix are all still open and have now been compounded by new debt:

- A **third** `parseFrontmatter` alias was added (`managed-content.ts`), making the aliasing friction worse.
- New duplicate git/`gh`/fs helpers appeared in `propose.ts` that duplicate `source.ts` and `utils/fs.ts`.
- A new misleading alias `WorkflowConfig as WorkflowConfigSchema` was introduced in `workflows.ts`.
- `propose.ts` and `sync.ts` are now the two largest files and both hold 3+ distinct responsibilities.

### Status of prior-audit recommendations

| Prior recommendation | Status |
|----------------------|--------|
| Rename `core/schema.ts` → `schema-compat.ts` (Step 1) | **NOT done** — still `core/schema.ts:1` |
| Rename `commands/shared.ts` → `sync-shared.ts` (Step 2) | **NOT done** — still `commands/shared.ts` |
| Move `getMarkers` to `core/markers.ts` (Step 3) | **DONE** — now lives at `core/markers.ts:19`, alias gone |
| Move `getMetadataKeys` to `core/managed-content.ts` (Step 4) | **DONE** — now at `managed-content.ts:43`, no longer in `config/schema.ts` |
| Move `getCliVersion` out of `lockfile.ts` (Step 5) | **DONE** — `core/version.ts` now owns version logic (3 importers) |
| Create `core/skills.ts` (Step 6) | **NOT done** — skill logic still in `managed-content.ts:82–477` |
| Resolve `parseFrontmatter` aliasing (Step 7) | **NOT done, REGRESSED** — alias now in 3 files |
| Extract sync output rendering from `shared.ts` (Step 8) | **NOT done** — `performSync` is now 477 lines (`shared.ts:344–821`) |
| Consolidate `schemas/` into `config/` (Step 9) | **NOT done** — `schemas/lockfile.ts` still standalone |

---

## Naming Issues

| File | Problem | Recommendation |
|------|---------|----------------|
| `core/schema.ts` (`:1`) | Generic name for a module that contains ONLY schema **version-compatibility** logic (`SUPPORTED_SCHEMA_VERSION`, `checkSchemaCompatibility`). Collides conceptually with `config/schema.ts` (Zod config schemas) and `schemas/lockfile.ts` (Zod lockfile schemas). Three files about "schema" in three dirs. Only **1 importer** (`core/lockfile.ts:10`, imported as `./schema.js` within `core/`). | Rename to `core/schema-version.ts` (or `schema-compat.ts`). Single-importer rename — very low risk. **Re-flag from last audit (Step 1, not done).** |
| `commands/shared.ts` (821 lines) | Vague "shared" name; it is specifically the **sync workflow orchestration** layer shared by `init` and `sync` (version/source resolution, merge prompting, `performSync`). 2 importers (`init.ts`, `sync.ts`) + indirectly `cli.ts` via re-use. | Rename to `commands/sync-orchestration.ts` (or `sync-shared.ts`). **Re-flag (Step 2, not done).** Bundle with the SRP split below. |
| `core/workflows.ts:10` | New misleading alias `import type { WorkflowConfig as WorkflowConfigSchema }`. The imported symbol is the **inferred type** (`z.infer<…>`), not the Zod schema object — aliasing it to `…Schema` actively misleads readers into thinking it's a validator. | Drop the alias; import `WorkflowConfig` directly and use that name at `workflows.ts:34`. Cosmetic but a 1-line fix that removes active misinformation. |
| `core/managed-content.ts` (812 lines) | Name is correct for the generic operations (`computeContentHash`, `isManaged`, `addManagedMetadata`, `stripManagedMetadata`) but the module still owns **skill-specific** logic and **all four content types'** check functions (see SRP §1). The name undersells what it does. | Keep the name for the generic part; extract skill logic and reconsider whether the per-type `check*` functions belong here (see SRP §1). **Re-flag (not done).** |
| `schemas/` dir (only `lockfile.ts`) | A whole directory holding one Zod-schema file, while `config/schema.ts` ALSO holds Zod schemas. The split between `config/schema.ts` and `schemas/lockfile.ts` is arbitrary — both are serialized-data schemas. 5 importers of `schemas/lockfile.ts`. | Either merge `schemas/lockfile.ts` into `config/` as `config/lockfile-schema.ts`, or move `config/schema.ts` into `schemas/`. Consolidation only — defer unless touching these files. **Re-flag (Step 9, not done).** |

---

## Misplaced Utilities

For each candidate, fan-in counted by grepping importers (tests excluded).

| Function | Current Location | Recommended Location | Importers / Duplication |
|----------|------------------|----------------------|-------------------------|
| `isGhAvailable()` | **Duplicated**: `core/source.ts:145` AND `core/propose.ts:885` | `utils/git.ts` (single shared impl) | Defined twice, byte-identical logic. Both probe `gh --version`. 2 definition sites → extract one. |
| `gh repo clone` → `git.clone` fallback | **Duplicated**: `source.ts:121` (`cloneRepository`) AND `propose.ts:856` (`cloneCanonical`) | `utils/git.ts` or `core/source.ts` (have `propose.ts` call into `source.ts`) | Two near-identical clone-with-gh-fallback routines. `source.ts` does `--depth 1`, `propose.ts` does full clone — parametrize depth. New duplication introduced by the propose feature. |
| `pathExists(p)` | `core/propose.ts:734` | `utils/fs.ts` (already has `fileExists:9` and `directoryExists:18`) | Reinvents existing `utils/fs.ts` helpers. 1 internal user, but the canonical helper already exists — should call `fileExists`/`directoryExists`. |
| `globFiles(cwd, pattern)` | `core/propose.ts:726` | `utils/fs.ts` if reused, else leave | Thin `fast-glob` wrapper. Currently only used inside `propose.ts` (fan-in 1) — leave for now, but if a 2nd consumer appears, hoist. |
| `slugifyTitle` / `generateBranchName` | `core/propose.ts:897,909` | OK where they are (propose-domain), but **exported with 0 external importers** | Export hygiene: only used inside `propose.ts` + its test. If only the test uses them externally, consider un-exporting (test can import via a test-only path) — low priority. |

**Not misplaced (verified):** `getMarkers` (`markers.ts:19`) and `getMetadataKeys` (`managed-content.ts:43`) were correctly relocated per last audit — the prior "misplaced helper in config/schema.ts" findings are RESOLVED.

---

## SRP Violations

### 1. `core/managed-content.ts` (812 lines) — generic ops + skill logic + 4-type check orchestration

Still the worst offender the last audit named, now larger (621 → 812 lines). It mixes:

| Responsibility | Lines | Belongs in |
|----------------|-------|-----------|
| Generic managed metadata (hash, strip, add, isManaged) | 123–331 | **stays** (this is what the name means) |
| Skill-specific validation | `SkillValidationError:82`, `validateSkillFrontmatter:92` | `core/skills.ts` (new) — parallels `rules.ts`/`agents.ts` validation |
| Skill file checking | `SkillFileCheckResult:403`, `checkSkillFiles:424` | `core/skills.ts` |
| Rule file checking | `checkRuleFiles:483`, `RuleFileCheckResult:569` | colocate in `rules.ts` |
| Agent file checking | `checkAgentFiles:598`, `AgentFileCheckResult:583` | colocate in `agents.ts` |
| AGENTS.md checking + orchestration | `checkAgentsMd:647`, `checkAllManagedFiles:700`, `checkAgentsMdRulesSection:774`, `getModifiedManagedFiles:805` | stays as the check-orchestration hub |

`validateSkillFrontmatter` is imported by both `sync.ts:23` and `propose.ts:19` (fan-in 2) — it is genuinely skill-domain logic with no home module, the asymmetry the last audit called out (rules/agents have modules, skills don't). **Re-flag (Step 6, not done).** Highest-value structural move: create `core/skills.ts` to host `validateSkillFrontmatter`, `SkillValidationError`, `checkSkillFiles`, and ideally the skill copy/sync helpers currently in `sync.ts` (`syncSkillsToTarget:766`, `copySkillDirectory:842`).

### 2. `core/propose.ts` (993 lines) — three distinct responsibilities

This NEW file bundles three separable concerns:

| Responsibility | Functions / lines | Suggested module |
|----------------|-------------------|------------------|
| Detect **modified managed** content (diff downstream vs canonical) | `detectProposedChanges:94`, `detectSkillAssetChanges:181`, `diffSkillDir:202`, `buildProposedChange:275` | `core/propose-detect.ts` |
| Detect **new** content candidates (not yet upstream) | `detectNewContent:444`, `buildNewCandidate:540`, `discoverRawNewCandidates:642`, `buildNewSkillChanges:699`, `conflictWarning:630` | `core/propose-detect.ts` (with above) |
| **Apply** changes via git branch + `gh` PR | `applyProposedChanges:784`, `cloneCanonical:856`, `getDownstreamContext:916`, `buildPrBody:943`, `buildGhPrCommand:979`, `slugifyTitle:897`, `generateBranchName:909` | `core/propose-apply.ts` |
| Local fs/git glue (duplicates) | `pathExists:734`, `globFiles:726`, `isGhAvailable:885`, `cloneCanonicalForDetect:263` | extract to `utils/` (see Misplaced Utilities) |

The detection half (read-only, ~650 lines) and the apply half (mutating git/PR side-effects, ~250 lines) have **no shared state** beyond `Source` and the `ProposedChange[]` payload — a clean seam. Splitting into `propose-detect.ts` + `propose-apply.ts` (or detect/apply within a `core/propose/` folder) would make the apply side independently testable. Fan-in to `propose.ts` is only 1 (`cli.ts`), so the public surface to re-point is tiny.

### 3. `core/sync.ts` (1038 lines) — skills + rules + agents + orphans + collision guard

The largest file. It is effectively a top-level orchestrator but inlines per-content-type machinery:

| Responsibility | Lines |
|----------------|-------|
| Rules sync (discover/hash/sync) | `discoverRules:85`, `computeRulesHash:115`, `syncRules:130` |
| Agents sync (discover/hash/sync) | `discoverAgents:195`, `computeAgentsHash:226`, `syncAgents:239` |
| Orphan detection ×3 | `findOrphanedAgents:303`, `deleteOrphanedAgents:311`, `findOrphanedSkills:945`, `deleteOrphanedSkills:965` |
| Unmanaged-overwrite guard | `UnmanagedOverwriteError:432`, `detectUnmanagedCollisions:455` |
| Skill sync | `syncSkillsToTarget:766`, `copyTree:801`, `copySkillDirectory:842` |
| Top-level `sync()` orchestrator | `:552` |
| Status | `getSyncStatus:916` |

Note `discoverRules`/`syncRules` (sync.ts) and `parseRule`/`adjustHeadingLevels` (rules.ts) are split across two files for the *same* content type — the rules logic is already half in `rules.ts`. Moving `discoverRules`/`computeRulesHash`/`syncRules` into `rules.ts`, `discoverAgents`/`computeAgentsHash`/`syncAgents` into `agents.ts`, and skill sync into a new `skills.ts` would leave `sync.ts` as a ~400-line orchestrator + the collision guard. This is the single biggest readability win but also the biggest diff — recommend doing it alongside the `core/skills.ts` extraction so all three content types end up symmetric (each module owns parse + validate + sync + check).

### 4. `commands/shared.ts` (821 lines) — orchestration + 477-line render function

`performSync` (`:344–821`) is 477 lines / 58% of the file and contains 59 `console.log`/`logger.*` calls — it does sync execution, orphan prompting, validation-error display, workflow sync, hook install, AND all summary rendering. Extract the rendering into `commands/sync-output.ts` (`renderSyncSummary(result, options)`), shrinking `performSync` to its orchestration core (~250 lines). **Re-flag (Step 8, not done).**

---

## Dependency Analysis

### High fan-in modules (importers, tests excluded, schema/lockfile name-collisions disambiguated)

| Module | Importers | Who |
|--------|-----------|-----|
| `schemas/lockfile.ts` | **5** | `source.ts`, `propose.ts`, `merge.ts`, `lockfile.ts`, `sync.ts` |
| `config/schema.ts` | **5** (incl. loader) | `workflows.ts`, `hooks.ts`, `canonical.ts`, `config/loader.ts`, (+`lockfile.ts` via re-export chain) |
| `utils/prefix.ts` | **5** | `rules.ts`, `managed-content.ts`, `agents.ts`, `sync.ts`, `check.ts` |
| `core/managed-content.ts` | **6** | `agents.ts`, `rules.ts`, `propose.ts`, `sync.ts`, `commands/shared.ts`, `check.ts` |
| `utils/logger.ts` | **6** | `init.ts`, `canonical.ts`, `upgrade-cli.ts`, `config.ts`, `shared.ts`, `sync.ts` |
| `core/lockfile.ts` | **4** | `cli.ts`, `upgrade-cli.ts`, `commands/shared.ts`, `check.ts` |
| `core/markers.ts` | **4** | `propose.ts`, `managed-content.ts`, `merge.ts`, `check.ts` |
| `core/frontmatter.ts` | **3** | `agents.ts`, `managed-content.ts`, `rules.ts` |
| `core/version.ts` | **3** | `upgrade-cli.ts`, `commands/shared.ts`, `sync.ts` |
| `core/source.ts` | **3** | `sync.ts`, `commands/shared.ts`, `propose.ts` |
| `utils/git.ts` | **3** | `cli.ts`, `commands/shared.ts`, `canonical.ts` |
| `core/schema.ts` | **1** | `lockfile.ts` only |

**Assessment of the `managed-content.ts` hub (6 importers):** Healthy *if* it only exported generic ops. But it is imported by `agents.ts`, `rules.ts`, `propose.ts`, and `sync.ts` for a MIX of reasons — generic (`computeContentHash`, `isManaged`, `stripManagedMetadata`, `skillMatchesCanonical`) AND skill-specific (`validateSkillFrontmatter`). The skill-specific imports (`sync.ts:23`, `propose.ts:19`) would re-point to `core/skills.ts` after the SRP §1 split, lowering coupling-by-accident. The generic exports are correctly central — that fan-in is desirable.

**`utils/git.ts` is under-used (3 importers) while git logic is duplicated** in `source.ts` and `propose.ts` (clone, `isGhAvailable`). The shared clone/gh-probe helpers belong in `utils/git.ts`, which would raise its (legitimate) fan-in and kill the duplication.

**No circular dependencies.** Spot-checked the new edges (`propose.ts → source.ts`, `propose.ts → managed-content.ts`, `propose.ts → agents.ts`, `propose.ts → markers.ts`); all flow downward (`commands → core → config/schemas → utils`).

### Import-alias inventory (all `X as Y`, excluding `import * as`)

| Alias | File:line | Real problem? |
|-------|-----------|---------------|
| `parseFrontmatter as parseFrontmatterShared` | `core/agents.ts:2`, `core/rules.ts:3`, `core/managed-content.ts:8` | **Yes — regressed.** Last audit flagged this in 3 files (agents/rules + the suggested fix); it now appears in `managed-content.ts` too. Each module defines a thin local `parseFrontmatter` wrapper (`agents.ts:80`, `rules.ts:65`, `managed-content.ts:66`) that only adds a type-cast or null-coalescing. Fix per Step 7: rename the shared export in `frontmatter.ts:60` to `parseRawFrontmatter`, drop all three aliases. |
| `WorkflowConfig as WorkflowConfigSchema` | `core/workflows.ts:10` | **Yes — new, misleading.** Aliases an inferred *type* to look like a Zod *schema*. Drop alias (see Naming Issues). |
| `parse as parseYaml` | `config/loader.ts:3` | No — disambiguates the `yaml` library's generic `parse`. Idiomatic, keep. |
| `stringify as stringifyYaml` | `commands/canonical.ts:6` | No — same, idiomatic library disambiguation. Keep. |

---

## Refactoring Plan

Ordered by value/risk. Items marked ⟳ are re-flags from 2026-02-12 not yet applied.

### Priority 1 — Low-risk, high-clarity (do now)

1. ⟳ **Rename `core/schema.ts` → `core/schema-version.ts`.** Single importer (`lockfile.ts:10`). ~2-line diff.
2. **Drop `WorkflowConfig as WorkflowConfigSchema` alias** (`workflows.ts:10,34`). 2-line diff, removes active misinformation.
3. ⟳ **Resolve `parseFrontmatter` aliasing** (Step 7). Rename `frontmatter.ts:60` export to `parseRawFrontmatter`; remove the 3 aliases (`agents.ts:2`, `rules.ts:3`, `managed-content.ts:8`) and let the local wrappers keep the clean `parseFrontmatter` name.

### Priority 2 — Kill duplication introduced by `propose` (do now)

4. **Hoist `isGhAvailable` + clone-with-gh-fallback to `utils/git.ts`.** Have both `source.ts:121,145` and `propose.ts:856,885` call the shared impl (parametrize `--depth`). Removes ~40 duplicated lines.
5. **Replace `propose.ts:734 pathExists`** with `utils/fs.ts` `fileExists`/`directoryExists`.

### Priority 3 — SRP splits (schedule deliberately; larger diffs)

6. ⟳ **Create `core/skills.ts`** (Step 6). Move from `managed-content.ts`: `validateSkillFrontmatter:92`, `SkillValidationError:82`, `checkSkillFiles:424`, `SkillFileCheckResult:403`; and from `sync.ts`: `syncSkillsToTarget:766`, `copySkillDirectory:842`, orphan-skill helpers. Re-point `sync.ts:23` and `propose.ts:19`. Achieves rules/agents/skills symmetry. **Per AGENTS.md "Check Command Integrity": update `check.ts` + `managed-content.ts` check loop + add/keep `check.test.ts` coverage when moving `checkSkillFiles`.**
7. **Split `core/propose.ts`** into detect (read-only, ~650 lines) vs apply (git/PR side-effects, ~250 lines) — `core/propose-detect.ts` + `core/propose-apply.ts` (or a `core/propose/` folder). Only `cli.ts` imports it, so re-pointing is trivial; the win is testability of the apply path.
8. ⟳ **Extract sync rendering** (Step 8): `commands/sync-output.ts` `renderSyncSummary()` out of `performSync` (`shared.ts:344–821`), then ⟳ rename `commands/shared.ts → commands/sync-orchestration.ts` (Step 2). Do the two together so `init.ts`/`sync.ts` imports are re-pointed once.
9. **Co-locate per-content-type sync into its content module:** move `discoverRules/computeRulesHash/syncRules` (sync.ts:85–192) into `rules.ts`; `discoverAgents/computeAgentsHash/syncAgents` (sync.ts:195–301) into `agents.ts`. Leaves `sync.ts` as orchestrator + collision guard (~400 lines). Largest diff — only if a broader cleanup is greenlit.

### Priority 4 — Defer (cosmetic)

10. ⟳ **Consolidate `schemas/lockfile.ts` into `config/`** (Step 9). 5 import re-points for no behavior change; do only when next editing those files.
11. **Export hygiene sweep** (per AGENTS.md): `getMetadataKeys`, `hasModifiedAssets`, `checkSkillFiles`, `checkRuleFiles`, `checkAgentFiles`, `checkAgentsMd`, `checkAgentsMdRulesSection` show **0 external (non-test) importers** in `managed-content.ts`. Several are intentionally test-exercised; confirm per-symbol before un-exporting. `slugifyTitle`/`generateBranchName`/`buildGhPrCommand` in `propose.ts` similarly export only for tests — verify and trim.

---

## Positive Observations

1. **Prior `getMarkers`/`getMetadataKeys` misplacement is fully resolved** — they now live with their consumers (`markers.ts:19`, `managed-content.ts:43`) and the indirection alias is gone.
2. **`getCliVersion` relocation to `core/version.ts` landed** — `lockfile.ts` is no longer a version-utility grab-bag.
3. **No circular dependencies**, including across the new `propose.ts` edges. Layering holds.
4. **`frontmatter.ts` remains a clean shared parser** (3 consumers) — the only blemish is the alias friction, not the module itself.
5. **`rules.ts` / `agents.ts` continue to be well-structured** content modules; the plan above extends the same pattern to skills and to the sync halves currently stranded in `sync.ts`.

---

## Metrics Summary

| Metric | Value |
|--------|-------|
| Total source files | 33 |
| Total LOC (approx) | ~9,600 |
| Naming issues | 5 (1 new alias, 2 re-flags, 2 standing) |
| Misplaced / duplicated utilities | 5 (2 new duplications from `propose`) |
| SRP violations | 4 (`managed-content`, `propose` ⟵ new, `sync`, `shared`) |
| Modules with 3+ importers | 11 |
| Aliased imports suggesting friction | 2 of 4 (`parseFrontmatter` ×3, `WorkflowConfigSchema`) |
| Circular dependencies | 0 |
| Largest file | `core/sync.ts` (1038) |
| 2nd / 3rd largest | `core/propose.ts` (993), `commands/shared.ts` (821) |
| Prior recommendations applied | 3 of 9 |
