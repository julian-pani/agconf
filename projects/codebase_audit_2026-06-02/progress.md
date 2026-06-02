# Audit Progress — 2026-06-02

## Phase 1: Analysis (COMPLETE)

- [x] Gather commit history since last audit (2026-02-12) → `commit-history.md`
- [x] Code Quality audit → `code-quality.md` (0 Critical, 2 High, 4 Medium, 6 Low)
- [x] Legacy & Dead Code audit → `legacy-dead-code.md` (no dead code; 1 notable dup; ~46 over-exports)
- [x] Test Coverage audit → `test-coverage.md` (83% line / 85% branch; command-file gaps)
- [x] Documentation audit → `documentation.md` (3 Critical drift, 1 High carry-over)
- [x] Module Organization audit → `module-organization.md` (3 of 9 prior recs applied; new dup)
- [x] Consolidated plan → `consolidated-plan.md`

## Phase 2: Remediation — Critical + High (COMPLETE)

User selected **Critical + High**. All committed one-per-issue-type on branch
`jp/adoring-gould-117d67`. Final state: `pnpm typecheck` clean, `pnpm check` (Biome)
clean, **746 tests pass** (was 716), 20/20 stress runs green after the flake fix.

### Critical
- [x] C1 — Fixed `.claude/CLAUDE.md` drift in README.md:311 + cli/README.md:65 — `7c9f8cd`
- [x] C2 — Fixed CLI-pinning contradiction in CANONICAL_REPOSITORY_SETUP.md — `7c9f8cd`

### High
- [x] H5 — Shared `getManagedMetadata`/`readManagedMetadata` accessor (replaced 11 casts) — `ffc2e9e`
- [x] H4 — Extracted pure `renderSyncSummary` into `commands/sync-output.ts` + test — `555627d`
- [x] H3 — `cwd` injection in `resolveTargetDirectory` — `188bffc`; sync command tests — `cc0ad56`
- [x] H1 — Added `tests/unit/upgrade-cli.test.ts` (0% → 88%, 9 tests) — `3329e1d`
- [x] H2 — Covered propose command apply flow + `--files` regex filter — `3d72e7f`

### Bonus (surfaced during H2)
- [x] Fixed latent concurrency bug: `propose` clone dirs used `Date.now()` →
  switched to `fs.mkdtemp` (atomic unique dir). Was an intermittent test flake. — `f723a1f`

## Phase 3: Remaining (NOT STARTED — deferred per user scope)

### Medium
- [ ] M1 — Extract clone/`gh` to `utils/git.ts`
- [ ] M2 — Use `utils/fs.ts` in `propose.ts pathExists`
- [ ] M3 — Resolve `parseFrontmatter` alias (3 files)
- [ ] M4 — Drop `WorkflowConfigSchema` alias
- [ ] M5 — Add `config.test.ts`
- [ ] M6 — version fetch + lockfile mismatch tests
- [ ] M7 — Zod-validate GitHub release JSON
- [ ] M8 — Coverage thresholds in vitest.config.ts

### Low
- [ ] L1–L8 — see consolidated-plan.md
