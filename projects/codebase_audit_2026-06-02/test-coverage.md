# Test Coverage Report

**Audit date:** 2026-06-02
**Test run:** `pnpm test:coverage` (vitest + @vitest/coverage-v8)
**Result:** 27 test files, 716 passed / 2 skipped (718 total), duration ~6.4s.
**Overall coverage:** 83.24% stmts / 85.20% branch / 87.78% funcs / 83.24% lines.
**Note:** No coverage thresholds are configured in `cli/vitest.config.ts` — coverage is reported but **not enforced** in CI.

## Coverage Metrics

Per-domain (rolled up from the v8 per-file report):

| Domain | Line % | Branch % | Function % |
|--------|--------|----------|------------|
| **All files** | 83.24 | 85.20 | 87.78 |
| `src/` (cli.ts) | 0 | 0 | 0 |
| `src/commands/` | 70.25 | 72.98 | 73.17 |
| `src/config/` | 100 | 100 | 100 |
| `src/core/` | 92.83 | 89.95 | 92.66 |
| `src/schemas/` | 100 | 100 | 100 |
| `src/utils/` | 87.73 | 86.04 | 84.61 |

Per-file (the gaps that matter):

| File | Line % | Branch % | Func % | Uncovered (key) |
|------|--------|----------|--------|-----------------|
| `commands/upgrade-cli.ts` | **0** | **0** | **0** | 1-170 (entire file) |
| `commands/config.ts` | **0** | **0** | **0** | 1-31 (entire file) |
| `commands/propose.ts` | **44.55** | 56.52 | 66.66 | 81-203, 213-303 |
| `commands/sync.ts` | 61.43 | **6.66** | 100 | 26-33, 72-119 |
| `commands/completion.ts` | 68.68 | 91.07 | 55.55 | 324-340, 347-380 |
| `commands/canonical.ts` | 81.62 | **32.25** | 66.66 | 733-734, 747-750 + branches |
| `commands/init.ts` | 81.81 | **16.66** | 100 | 35-41, 45-53, 86-87 |
| `commands/shared.ts` | 80.51 | 80.64 | 100 | 783-790, 794-817 |
| `commands/check.ts` | 89.10 | 85.91 | 100 | 78-81, 157-179 |
| `cli.ts` | 0 | 0 | 0 | 1-261 (command wiring; excluded `index.ts`) |
| `core/version.ts` | **58.33** | 96.66 | 55.55 | 60-65, 79-95, 100-109 |
| `core/lockfile.ts` | 77.16 | 72.72 | 83.33 | 51-52, 128-162 |
| `core/source.ts` | 73.50 | 94.73 | 62.5 | 224-225, 230-232 |
| `core/propose.ts` | 83.98 | 71.42 | 86.95 | 843-974, 979-993 |
| `utils/fs.ts` | 68.88 | 75 | 66.66 | 26-30, 32-38, 42-43 |
| `utils/logger.ts` | 78.18 | 75 | 75 | 39, 43-44, 52-53 |

High-coverage core (for completeness): `agents.ts`, `targets.ts`, `workflows.ts`, `rules.ts`, `merge.ts`, `markers.ts`, `managed-content.ts` (98%), `core/sync.ts` (96.62), and the entire `config/`/`schemas/` are at or near 100%.

## Coverage Gaps

### Untested Files

- **`cli/src/commands/upgrade-cli.ts` — 0% (170 lines).** No `upgrade-cli.test.ts` exists. This is the **carry-over High-Priority gap** from the 2026-02-12 audit, still open. The file has real, untested logic:
  - `--package-manager` flag validation (rejects invalid PM, exits 1) — `upgrade-cli.ts:79-83`.
  - Tool-manager shim detection added in commit `5f75480` (Volta/asdf/mise) — `upgrade-cli.ts:152-162`.
  - Up-to-date short-circuit (`upgrade-cli.ts:64-68`), fetch-failure path (`50-54`), install-failure path with manual-command hint (`118-126`), and post-install version-mismatch warning (`137-165`).
  - Its dependency `utils/package-manager.ts` IS well covered (92.8%), but the **command orchestration** around it is entirely unverified.
- **`cli/src/commands/config.ts` — 0% (31 lines).** No test references it. `configGetCommand`/`configSetCommand` both error + `process.exit(1)` on any key (`config.ts:19-31`); the error paths are trivial but per the AGENTS.md hard rule ("every command file MUST have a corresponding test file") this is an uncovered command file.
- **`cli/src/cli.ts` — 0% (261 lines).** Command/flag wiring (commander/clack setup). No test parses argv through `createCli()`. `index.ts` is intentionally excluded from coverage in vitest.config.ts.

### Untested Functions

- **`commands/propose.ts` — managed-detect + apply flows untested.** Lines 81-203 and 213-303 are uncovered. `propose-command.test.ts` (94 lines, 2 tests) only exercises `--new` dry-run auto-select and the nothing-to-propose path. Specifically uncovered:
  - `buildManagedProposeResult` (`propose.ts:67-93`) — the entire `propose` (managed-changes) path, including its detect-failure exit and no-changes outro.
  - `selectNewCandidates` multiselect path and `--yes` select-all path (`propose.ts:182-203`).
  - `runApply` in full (`propose.ts:213-303`): title/message prompting + required-title exit, apply-failure exit, and all three success outcomes (pushed+PR, pushed-but-no-PR, local-no-PR).
- **`core/version.ts:79-95, 100-109` — GitHub release fetch untested.** `getLatestRelease` / `parseReleaseResponse` / `getGitHubHeaders` (the network path, including the 404 "No releases found" branch) have no test with a mocked `fetch`. Pure helpers (`parseVersion`, `compareVersions`, `formatTag`, `isVersionRef`) are covered by `version.test.ts`.
- **`core/lockfile.ts:128-162` — `checkCliVersionMismatch` untested.** Reads lockfile and compares CLI vs lockfile semver; none of the newer/older/equal/missing branches are exercised.
- **`core/propose.ts:843-974, 979-993` — apply/PR-building helpers under-covered.** `getDownstreamContext`, `buildPrBody`, and `buildGhPrCommand` (which does shell-quote escaping at `992` — a correctness-sensitive path) are not directly asserted. `propose-roundtrip.test.ts` drives adoption via `sync` but does not assert on the generated PR command/body.

### `--files` regex filter (commit `58afa0d`) — NOT directly tested

`detectProposedChanges` compiles `options.files` into `RegExp`s and filters (`core/propose.ts:119-130`). **No test passes a `files:` option** to `detectProposedChanges` or to `proposeCommand`. The regex-matching behavior introduced by `58afa0d` ("use regex matching for `propose --files` filter") and its skill-dir interaction are unverified. Grep confirms no `files:` argument appears in any propose test.

## Missing Test Types

### Unit Tests Needed

1. **`tests/unit/upgrade-cli.test.ts` (NEW)** — highest priority. Mock `fetch` (latest-version), `execSync` (install + `agconf --version` verify), and `process.argv[1]`/`fs.realpathSync` for shim detection. Cover: invalid `--package-manager` exit, up-to-date short-circuit, fetch failure, install failure hint, and each of Volta/asdf/mise/unknown shim branches (`upgrade-cli.ts:152-162`).
2. **`tests/unit/config.test.ts` (NEW)** — assert `configGetCommand`/`configSetCommand` log the unknown-key error and exit 1; `configShowCommand` prints the no-options notice. Small but satisfies the AGENTS.md command-file rule.
3. **`commands/sync.ts` flag validation (carry-over Medium gap)** — a dedicated unit test (or expand e2e) for the mutually-exclusive guards: `--pinned` + `--ref` and `--pinned` + `--local` both exit 1 (`sync.ts:26-33`), plus the up-to-date/update-available version-comparison branches (`sync.ts:72-119`). Branch coverage here is **6.66%** — only the happy local path runs via e2e. No dedicated `commands/sync.test.ts` exists.
4. **`commands/propose.ts` managed + apply flows** — extend `propose-command.test.ts` to cover `buildManagedProposeResult`, `--yes` select-all, missing-title exit, and `runApply` success/failure branches (mock `applyProposedChanges`).
5. **`--files` regex filtering** — add a `detectProposedChanges` test passing `files: ["skills/foo"]` and a regex pattern, asserting only matching modified files are proposed.
6. **`core/version.ts` fetch path** — mock `fetch` to cover `getLatestRelease` success, 404, and non-ok branches.
7. **`core/lockfile.ts` `checkCliVersionMismatch`** — table-test the newer/older/equal/missing-version cases.

### Integration Tests Needed

- **`commands/canonical.ts` branch coverage is 32.25%.** `canonical.test.ts` (27 tests) covers workflow content generation well but misses option branches: rules-dir vs no-rules-dir "Next steps" output (`canonical.ts:732-737`) and the catch/`process.exit(1)` failure path (`canonical.ts:747-750`). Add cases that drive these branches.
- **`commands/init.ts` branch coverage is 16.66%.** Exercised only on the happy local-sync path via e2e. Add integration cases for its early-exit / error branches (`init.ts:35-53, 86-87`).
- **`propose` apply with a local canonical that has a git remote stub** — to exercise `core/propose.ts` apply/branch/PR-command construction (`843-993`) end-to-end rather than only the adoption round-trip.

### E2E Tests Needed

- **`cli.ts` argv parsing (261 lines, 0%).** No end-to-end test runs the built binary / `createCli().parse(argv)`. An e2e that invokes the CLI entrypoint for 2-3 commands would catch wiring/option-registration regressions that unit tests on command functions cannot (e.g., a flag defined in `cli.ts` but not threaded into the command). `index.ts` is excluded from coverage by design; `cli.ts` is not and should be reached.

## Test Quality Issues

- **`syncCommand` and `initCommand` lack a `cwd` option**, violating the AGENTS.md testability rule ("commands that use `process.cwd()` must accept a `cwd` option"). `e2e-workflow.test.ts` works around this by monkey-patching `process.cwd = () => targetDir` (e2e-workflow.test.ts `runInit`/`runSync`/`runCheck`). `proposeCommand` and `checkCommand` already accept `cwd` (good); `sync.ts:36` calls `resolveTargetDirectory()` with no override. This global-mutation pattern is brittle and order-sensitive across the suite.
- **`propose-command.test.ts` is thin (2 tests, 94 lines)** for a 303-line command — assertions are limited to "resolves undefined" + one `output().toContain(...)`. The dominant managed and apply paths are untested (see above).
- **2 skipped tests, both intentional/justified:** `source.test.ts:567` (`it.skip`, requires network — covered via integration) and `lockfile.test.ts:225` (`it.skipIf(!existsSync("./dist/index.js"))`, depends on a build artifact). The latter silently no-ops on a clean checkout where `dist/` is absent — acceptable but worth noting it provides no coverage in normal `pnpm test` runs.
- **Strong spots to preserve:** `sync-guard.test.ts` (288 lines) thoroughly covers the overwrite guard — adopt / abort / `--override` branches for skills, rules, AND agents, plus asset-divergence, sync atomicity (one conflict aborts siblings), frontmatter-faithfulness false-adopt protection, and post-adopt `check`. `check.test.ts` (1340 lines, 38 it-blocks) covers all five content types with the full pass-after-sync / detect-unmodified / fail-on-modified / ignore-non-managed matrix. These satisfy the AGENTS.md "Check Command Integrity" and overwrite-guard requirements.

## Recommendations

Priority order:

1. **Add `tests/unit/upgrade-cli.test.ts`** — closes the long-standing carry-over High-Priority gap (0% on a 170-line command with real flag-validation and shim-detection logic). Mock `fetch`/`execSync`/`fs.realpathSync`.
2. **Add `commands/sync.ts` flag-validation tests** (carry-over Medium) — its 6.66% branch coverage leaves the mutually-exclusive flag guards and version-comparison logic unverified. Refactor `syncCommand` to accept a `cwd` option while doing this, to remove the `process.cwd` monkey-patch.
3. **Cover `propose --files` regex filtering** (`core/propose.ts:119`) and the **`proposeCommand` managed + apply flows** (`commands/propose.ts:67-303`) — the largest hotspot of the recent `2041ffa`/`58afa0d`/`56e822d` feature work, currently the weakest command file at 44.55%.
4. **Add `tests/unit/config.test.ts`** — trivial, but required by the AGENTS.md "every command file must have a test file" rule (config.ts is at 0%).
5. **Mock the GitHub fetch path** in `core/version.ts` (`getLatestRelease`) and cover `core/lockfile.ts:checkCliVersionMismatch` — these version/remote functions are the lowest-covered non-command core code (58% and 77%).
6. **Raise `canonical.ts` (32% branch) and `init.ts` (16% branch)** by adding error/option branch cases to their integration tests.
7. **Set coverage thresholds in `vitest.config.ts`** (e.g., a floor at the current ~83% lines / 85% branch) so coverage cannot silently regress; consider a per-file floor for `src/commands/` once items 1-4 land.
8. **Consider one CLI-entrypoint e2e** to bring `cli.ts` (currently 0%) under test and catch flag-wiring regressions.
