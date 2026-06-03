# Audit Consolidated Plan

**Date:** 2026-06-02
**Previous audit:** 2026-02-12 (remediated in `6ec53c0` / PR #38)
**Period covered:** ~16 commits since 2026-02-12 (propose feature #35/#56/#58, CLAUDE.md consolidation #40, upgrade-cli shim detection #37)

---

## Executive Summary

The `agconf` codebase is in **good health**. Tooling is fully green: `pnpm typecheck` (strict), `pnpm check` (Biome), and **716 tests pass** (2 intentionally skipped). There are **no critical code bugs**, no `any`, no non-null assertions, no `@ts-ignore`, no stray debug logging, and no TODO/FIXME/HACK markers. The prior audit's #38 fixes (prefix utilities, dead-code removal, deleted `config/index.ts` barrel, over-export trims in `source.ts`/`merge.ts`) all held with **no regressions**.

The new work is strong: the sync **overwrite guard** (`detectUnmanagedCollisions` / `UnmanagedOverwriteError`) and the **check** command are thoroughly tested (`sync-guard.test.ts`, `check.test.ts` across all 5 content types), and the new `propose.ts` is well-documented.

The findings are concentrated in five themes, none of them correctness bugs:

1. **Documentation drift** — the only *Critical*-severity items. Two READMEs and one docs guide now contradict the code after #40 and the unpinned-CLI change.
2. **Test-coverage gaps in command files** — `upgrade-cli.ts` (0%, **carry-over High from last audit, still open**), `config.ts` (0%), `commands/sync.ts` flag guards (6.66% branch), and the `propose` command + `--files` regex filter.
3. **Function complexity** — `performSync` is ~478 lines; `propose.ts`/`sync.ts` are 993/1038 lines.
4. **Duplication introduced by the propose feature** — clone/`gh` logic copied between `propose.ts` and `source.ts`; `pathExists` reinvents `utils/fs.ts`.
5. **Module organization** — `parseFrontmatter` alias regressed to 3 files; a new misleading `WorkflowConfigSchema` alias; standing SRP/rename items from the last audit (only 3 of 9 applied).

### Issue Counts by Audit Dimension

| Audit | Critical | High | Medium | Low |
|-------|----------|------|--------|-----|
| Code Quality | 0 | 2 | 4 | 6 |
| Dead Code / Tech Debt | 0 | 0 | 1 | ~46 over-exports (low) |
| Test Coverage | 0 | 3 | 3 | 2 |
| Documentation | 3 | 1 | 4 | 2 |
| Module Organization | 0 | 2 | 4 | 2 |

> **Process signal:** the `upgrade-cli.ts` test gap was flagged **High** in the last audit and is **still open** despite `.claude/rules/testing.md` existing. The testing rule isn't being enforced mechanically — see *Prevention* below.

---

## Critical Issues (Fix Immediately)

These are documentation statements that **actively contradict the code** — users following them will be misled.

### C1. Both READMEs claim sync creates `.claude/CLAUDE.md` (it now deletes it)
**Source:** Documentation
**Files:** [README.md:311](README.md), [cli/README.md:65](cli/README.md)
**Impact:** Since #40 (`merge.ts consolidateClaudeMd`), sync **keeps a root `CLAUDE.md`** with `@AGENTS.md` and **deletes** `.claude/CLAUDE.md`. The docs advertise a file sync actively removes.
**Fix:**
- `README.md:311` "Files Created" row → `` `CLAUDE.md` (root) | Reference to AGENTS.md (`@AGENTS.md`) ``.
- `cli/README.md:65` → "...creates/keeps a root `CLAUDE.md` containing `@AGENTS.md` and removes any legacy `.claude/CLAUDE.md`."

### C2. CANONICAL_REPOSITORY_SETUP.md contradicts VERSIONING.md on CLI version pinning
**Source:** Documentation (carry-over from 2026-02-12, still unfixed)
**Files:** [cli/docs/CANONICAL_REPOSITORY_SETUP.md:339-346](cli/docs/CANONICAL_REPOSITORY_SETUP.md), cross-check [cli/docs/VERSIONING.md:162-168](cli/docs/VERSIONING.md)
**Impact:** CANONICAL_REPOSITORY_SETUP shows `npm install -g agconf@1.2.0` and claims the version is auto-pinned; VERSIONING says workflows are unpinned. Ground truth: `canonical.ts:279,437` emit **unpinned** `npm install -g agconf`. CANONICAL_REPOSITORY_SETUP is wrong.
**Fix:** Edit lines 339-346 to unpinned `npm install -g agconf`; delete the `agconf@1.2.0` example and the "version is automatically set" sentence.

---

## High Priority (This Sprint)

### H1. Add `tests/unit/upgrade-cli.test.ts` — carry-over gap, still 0%
**Source:** Test Coverage / Code Quality M3
**File:** `cli/src/commands/upgrade-cli.ts` (170 lines, **0% coverage**)
**Impact:** Real untested logic: `--package-manager` validation (`:79-83`), Volta/asdf/mise shim detection from #37 (`:152-162`), up-to-date short-circuit (`:64-68`), fetch-failure (`:50-54`), install-failure hint (`:118-126`). Violates the AGENTS.md "every command file must have a test file" rule. **Flagged High in the last audit; never done.**
**Fix:** New test mocking `fetch`, `execSync`, and `fs.realpathSync`; cover each branch.

### H2. Cover the `propose` command + `--files` regex filter
**Source:** Test Coverage (the largest recent feature)
**Files:** `cli/src/commands/propose.ts` (44.55% — weakest command), `cli/src/core/propose.ts:119-130` (`--files` regex, **no direct test**)
**Impact:** `buildManagedProposeResult`, `selectNewCandidates` multiselect, and the full `runApply` flow (PR/push/local outcomes) are untested. The regex `--files` filter from #36 has zero test coverage (grep confirms no `files:` arg in any propose test).
**Fix:** Extend `propose-command.test.ts` for managed + apply branches (mock `applyProposedChanges`); add a `detectProposedChanges` test passing `files:` patterns.

### H3. Add `commands/sync.ts` flag-validation tests + a `cwd` injection point
**Source:** Test Coverage / Code Quality L4 (carry-over Medium)
**Files:** `cli/src/commands/sync.ts` (6.66% branch), `cli/src/commands/shared.ts:68-86` (`resolveTargetDirectory`)
**Impact:** The mutually-exclusive `--pinned`/`--ref`/`--local` guards (`sync.ts:26-33`) and version-comparison branches (`:72-119`) are unexercised. Tests can't run without monkey-patching `process.cwd` (e2e does this), violating the AGENTS.md testability rule.
**Fix:** Add a `cwd` option to `syncCommand`/`initCommand` (threaded through `resolveTargetDirectory`, mirroring `check`/`propose`), then add a `sync` flag-validation unit test.

### H4. Refactor `performSync` (~478 lines) — extract the summary renderer
**Source:** Code Quality H1 / Module Organization SRP §4
**File:** `cli/src/commands/shared.ts:344-821`
**Impact:** One function does orchestration, orphan prompting, validation display, workflow sync, hook install, AND a ~330-line console+markdown summary builder (59 log calls), with no direct unit test. Grew again in #40 and #58. Far over the 200-line guideline.
**Fix:** Extract a pure `renderSyncSummary(result, options) → { consoleLines, summaryLines }` into `commands/sync-output.ts` (no I/O, unit-testable); extract `handleOrphanedSkills(...)`. Shrinks `performSync` to its orchestration core.

### H5. Replace 11 unsound `frontmatter.metadata as Record<string,string>` casts with one accessor
**Source:** Code Quality H2
**Files:** `managed-content.ts:192,218,269,296,319,518`; `check.ts:126,148,218`; `agents.ts:201`; `rules.ts:338`
**Impact:** `metadata` is `unknown` from a hand-rolled YAML parser; values can be arrays/`undefined`, so the cast defeats `noUncheckedIndexedAccess` (a lookup typed `string` can be `undefined` at runtime). `check.ts` also rebuilds metadata keys inline instead of using `getMetadataKeys()`.
**Fix:** Add `getManagedMetadata(content, prefix)` in `managed-content.ts` that guards `typeof === "object"` and reads keys via `getMetadataKeys(prefix)`; replace all 11 sites. (Also collapses `check.ts`'s per-type blocks — see L-items.)

---

## Medium Priority (Backlog)

### M1. Extract duplicated clone/`gh` logic to `utils/git.ts` — highest-value cleanup
**Source:** Dead Code (Duplication #1) / Module Organization (Misplaced Utilities)
**Files:** `propose.ts:856-892` (`cloneCanonical` + `isGhAvailable`) duplicates `source.ts:121-153` (`cloneRepository` + `isGhAvailable`) near-verbatim.
**Fix:** Extract `cloneRepo(repository, ref, dir, { depth? })` and `isGhAvailable()` into `utils/git.ts`; have both modules call it (parametrize `--depth`: source uses 1, propose uses full). Removes ~40 lines and satisfies the AGENTS.md "Utility Reuse" rule.

### M2. Replace `propose.ts:734 pathExists` with `utils/fs.ts` helpers
**Source:** Module Organization (Misplaced Utilities)
**Fix:** Use existing `fileExists`/`directoryExists` from `utils/fs.ts` instead of reinventing.

### M3. Resolve the `parseFrontmatter` alias regression (now in 3 files)
**Source:** Module Organization (Naming / aliases) — carry-over, regressed
**Files:** `agents.ts:2`, `rules.ts:3`, `managed-content.ts:8` (all `parseFrontmatter as parseFrontmatterShared`)
**Fix:** Rename the shared export `frontmatter.ts:60` → `parseRawFrontmatter`; drop all 3 aliases so local wrappers keep the clean `parseFrontmatter` name.

### M4. Drop the misleading `WorkflowConfig as WorkflowConfigSchema` alias
**Source:** Module Organization (Naming) — new
**File:** `workflows.ts:10,34`
**Fix:** It aliases an inferred *type* to look like a Zod *schema*. Import `WorkflowConfig` directly. 2-line fix.

### M5. Add `tests/unit/config.test.ts`
**Source:** Test Coverage (AGENTS.md command-file rule)
**File:** `cli/src/commands/config.ts` (0%, 31 lines)
**Fix:** Assert `configGet/SetCommand` log the unknown-key error and exit 1; `configShow` prints the no-options notice. Small but required.

### M6. Cover `core/version.ts` fetch path + `lockfile.ts checkCliVersionMismatch`
**Source:** Test Coverage
**Files:** `version.ts:79-109` (58% — mock `fetch`: success/404/non-ok), `lockfile.ts:128-162` (newer/older/equal/missing branches)
**Fix:** Add mocked-`fetch` tests and a table-test for version mismatch.

### M7. Validate GitHub release JSON with Zod instead of casting
**Source:** Code Quality M4
**File:** `version.ts:93-108` (`parseReleaseResponse` casts unvalidated HTTP JSON)
**Fix:** Parse `data` with a small Zod schema; surface a clear error on shape mismatch instead of an `undefined` tag flowing into `parseVersion`.

### M8. Set coverage thresholds in `vitest.config.ts`
**Source:** Test Coverage
**Impact:** Coverage is reported (83% line / 85% branch) but **not enforced**, so it can silently regress — which is how the `upgrade-cli` gap survived.
**Fix:** Add a floor near current levels; consider a per-file floor for `src/commands/` once H1/H2/M5 land.

---

## Low Priority (Future)

### L1. Remove dead return fields / param left over from #40
`merge.ts:71,138` (`mergedClaudeMdContent`, never read), `merge.ts:156-158` (`_hadDotClaudeClaudeMd` param ignored; also drop the arg at `sync.ts:596`). Decide whether `hadRootClaudeMd` (test-only) stays.

### L2. Route the clear-cut inline hash through the canonical helper
`rules.ts:231` re-implements `sha256:${slice(0,12)}` over the Codex rules section — should call `computeRulesSectionHash()`. The aggregate hashes in `sync.ts:120,231` and `lockfile.ts:107` are different inputs; extract one private `shortSha256()` so the 12-char convention has a single definition. *(Maintainability — format is currently consistent, not a bug.)*

### L3. Export-hygiene sweep (per AGENTS.md "Export Hygiene")
Un-`export` the 8 internal-only functions in `managed-content.ts`/`lockfile.ts`/`workflows.ts` (`getMetadataKeys`, `checkSkillFiles`, `checkRuleFiles`, `checkAgentFiles`, `checkAgentsMd`, `checkAgentsMdRulesSection`, `getLockfilePath`, `ensureWorkflowsDir`) and the internal-only Zod sub-schemas (`CanonicalMetaSchema`, `MarkersConfigSchema`, `MergeConfigSchema`, `AgentsContentSchema`) — all grep-confirmed 0 external importers. Verify each isn't test-only first. Consider adding `knip`/`ts-prune` to CI to enforce this mechanically (tsc/Biome can't detect unused *exports*).

### L4. Update AGENTS.md "Core Modules" list
`AGENTS.md:42-51` omits `propose.ts`, `managed-content.ts`, `frontmatter.ts`. Add one line each.

### L5. Fix the `--files` JSDoc (glob → regex)
`propose.ts:46` says "glob patterns"; implementation (`:119`) is regex. Align with `cli.ts:134` and #36.

### L6. Triplicated path-mapping in `propose.ts buildProposedChange`
`propose.ts:283-321` (and `buildNewCandidate` `:580-627`) — the skill/rule/agent switch arms are the same shape. Drive with a `{skill:"skills",rule:"rules",agent:"agents"}` table. ~40 lines → ~12.

### L7. Larger SRP splits (only if a broad cleanup is greenlit)
Create `core/skills.ts` (move `validateSkillFrontmatter`/`SkillValidationError`/`checkSkillFiles` from `managed-content.ts` + skill sync from `sync.ts`); split `core/propose.ts` into detect/apply; co-locate `discoverRules`/`syncRules` into `rules.ts` and `discoverAgents`/`syncAgents` into `agents.ts`; rename `core/schema.ts → core/schema-version.ts`. **Per AGENTS.md "Check Command Integrity": any move of skill-check logic MUST update `check.ts` + the `managed-content.ts` check loop + `check.test.ts`.** Big diffs — schedule deliberately.

### L8. Docs polish
Complete root README `propose` section (`--title`/`--message`/`--files`); add `cli/docs/PROPOSING_CHANGES.md` + an overwrite-guard troubleshooting entry; add a one-line JSDoc on `proposeCommand`.

---

## Prevention Recommendations

| Finding | Root cause | Prevention |
|---------|-----------|------------|
| `upgrade-cli` test gap survived 2 audits (H1) | `.claude/rules/testing.md` exists but nothing enforces it | **M8**: add coverage thresholds in `vitest.config.ts` + per-file floor for `src/commands/`. Optionally a CI check that every `commands/*.ts` has a matching test file. |
| `.claude/CLAUDE.md` doc drift (C1) | Docs not updated alongside #40 behavior change | The AGENTS.md "Documentation Synchronization" rule covers this — but it missed the READMEs' "Files Created" tables. Add READMEs explicitly to the doc-sync checklist scope. |
| `parseFrontmatter` alias regressed; propose duplication (M1, M3) | New code didn't reuse existing utilities | The "Utility Reuse" rule exists; consider `knip` in CI to surface duplicate/dead exports (L3). |
| ~46 over-exports accumulate silently | tsc/Biome can't detect unused exports | Add `knip` or `ts-prune` (L3). |

---

## Recommended Order of Operations

1. **C1, C2** — fix documentation drift (READMEs + CANONICAL_REPOSITORY_SETUP). ~20 min. *Separate commit: `docs:`*
2. **M3, M4** — drop the `parseFrontmatter` aliases + `WorkflowConfigSchema` alias. ~15 min. *`refactor:`*
3. **M1, M2** — extract clone/`gh` to `utils/git.ts`; use `utils/fs.ts` in propose. ~30 min. *`refactor:`*
4. **H5** — shared `getManagedMetadata` accessor, replace 11 casts. ~45 min. *`refactor:`*
5. **H3** — add `cwd` injection, then `commands/sync.ts` flag tests. ~1 h. *`test:` (+ small `refactor:`)*
6. **H1, M5, H2** — `upgrade-cli.test.ts`, `config.test.ts`, propose command + `--files` tests. ~2-3 h. *`test:`*
7. **M6, M7** — version fetch / lockfile mismatch tests + Zod validation. ~1 h. *`test:`/`refactor:`*
8. **M8** — coverage thresholds. ~15 min. *`ci:`/`test:`*
9. **H4** — extract `renderSyncSummary` from `performSync`. ~1-2 h. *`refactor:`*
10. **L1, L2, L4, L5, L6** — small cleanups (dead fields, hash helper, AGENTS.md modules, JSDoc, path-map table). *grouped `refactor:`/`docs:` by type*
11. **L3** — export-hygiene sweep (+ optional `knip` in CI). *`refactor:`/`ci:`*
12. **L7** — defer SRP splits unless a broad refactor is greenlit (update check + tests when moving skill logic).

> **Commit strategy:** one commit per issue *type* (per AGENTS.md / the skill). Keep docs, refactor, and test changes in separate commits. Conventional Commits; **no `BREAKING CHANGE:`** (major releases are blocked). Update `progress.md` after each commit.
