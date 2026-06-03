# Commit History — Context for Audit 2026-06-02

**Audit date:** 2026-06-02
**Previous audit:** 2026-02-12 (remediated in commit `6ec53c0` / PR #38)
**Period covered:** Commits since 2026-02-12 (~16 commits, excluding release bot)

These commits are **hints** for prioritization. The audit covers the entire codebase,
but recently-touched files deserve extra scrutiny.

## Feature / Fix Commits Since Last Audit

| Commit | Type | Summary |
|--------|------|---------|
| `2041ffa` (#58) | feat | **propose new content upstream + guard sync from overwriting local edits** — large change. Touched `propose.ts` (core+command), `sync.ts`, `managed-content.ts`, `frontmatter.ts`, `shared.ts`, `cli.ts`, `completion.ts`. Added `propose-roundtrip.test.ts`, `sync-guard.test.ts`, `propose-command.test.ts`. |
| `23525cc` (#56) | fix | propose all files in managed skill dirs, not just SKILL.md. Touched `check.ts`, `managed-content.ts`, `propose.ts`, `sync.ts`. |
| `5cca9c9` (#40) | refactor | keep root CLAUDE.md instead of `.claude/CLAUDE.md`. Touched `shared.ts`, `merge.ts`, `sync.ts`. |
| `6ec53c0` (#38) | refactor | **previous audit remediation** + prevention rules (`.claude/rules/cli-commands.md`, `hash-and-prefix.md`, `testing.md`). Added `utils/prefix.ts`, deleted `config/index.ts`. |
| `5f75480` (#37) | fix | detect silent upgrade failure for Volta and similar tool managers. Touched `upgrade-cli.ts`. |
| `58afa0d` (#36) | fix | use regex matching for `propose --files` filter. Touched `cli.ts`, `propose.ts`. |
| `56e822d` (#35) | feat | **add propose command and smart pre-commit hook**. Added `commands/propose.ts`, `core/propose.ts`. Touched `cli.ts`, `check.ts`, `completion.ts`, `hooks.ts`. |
| `f295785` | feat | auto-detect package manager for upgrade-cli. Added `utils/package-manager.ts`. |

## Hotspots (most-changed files since last audit)

1. **`cli/src/core/propose.ts`** (993 lines) — brand new, large, central to the new feature. HIGH SCRUTINY.
2. **`cli/src/core/sync.ts`** (1038 lines) — repeatedly modified; added overwrite guard. HIGH SCRUTINY.
3. **`cli/src/core/managed-content.ts`** (812 lines) — modified for propose + skill dir handling.
4. **`cli/src/commands/propose.ts`** (303 lines) — new command.
5. **`cli/src/commands/shared.ts`** (821 lines) — modified for CLAUDE.md + propose.
6. **`cli/src/core/frontmatter.ts`** (286 lines) — modified for propose roundtrip.

## Carry-over items from previous audit (verify still open)

- **upgrade-cli.ts unit tests** — was High Priority #10. As of this audit: `tests/unit/upgrade-cli.test.ts` is **MISSING**.
- **commands/sync.ts flag-validation tests** — was Medium #20. No dedicated `commands/sync.ts` test file found.
- Previous prevention rules ARE present (`cli-commands.md`, `hash-and-prefix.md`, `testing.md`).

## What was already fixed in #38 (do NOT re-report as new)

The 2026-02-12 consolidated plan's critical/high items were largely addressed: check-command
fallback prefix bug, phantom `canonical update` docs, shared `utils/prefix.ts` conversions,
dead `updateWorkflowVersion`, over-exports in workflows.ts, deleted `config/index.ts` barrel.
Verify these are actually resolved; only flag regressions or genuinely new issues.
