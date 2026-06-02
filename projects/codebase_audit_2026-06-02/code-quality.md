# Code Quality Report

Scope: `cli/src/` of the `agconf` TypeScript CLI. Standards checked against AGENTS.md
(Export Hygiene, Utility Reuse, Content Hash Consistency, Prefix normalization, CLI
Command Changes, Check Command Integrity) and `.claude/rules/{hash-and-prefix,cli-commands,testing}.md`.

Tooling baseline (all green):
- `pnpm typecheck` (tsc, strict) — passes, 0 errors.
- `pnpm check` (Biome) — passes, only a benign schema-version info notice (`biome.json` pins
  schema `2.3.13`, CLI is `2.4.2`).
- `pnpm test` — 716 passed, 2 skipped, 27 files.

Overall the code is in good shape: no `any`, no non-null assertions, no `@ts-ignore`,
no stray debug `console.log`/`console.debug`, no TODO/FIXME. Findings are concentrated in
(1) function complexity, (2) a missing-utility-reuse pattern for frontmatter metadata access,
and (3) test-coverage gaps for command files. The previous audit's `#38` fixes are intact —
no regressions found in the prefix-utility consolidation.

---

## Critical Issues

None.

---

## High Priority

### H1. `performSync` is ~478 lines — far over the 200-line guideline
- **`cli/src/commands/shared.ts:344-821`**
- **Impact:** A single function does orchestration, orphan-skill prompting/deletion, validation
  reporting, workflow sync, hook install, and a ~330-line console+markdown summary builder with
  per-target/per-content-type branches (skills, rules-claude, rules-codex, agents, workflows,
  lockfile, hook). It is the hardest function in the tree to read, test, and modify safely, and
  it grew again in #40 (CLAUDE.md) and #58 (`result.adopted`). The summary logic has no direct
  unit test (only exercised through e2e).
- **Fix:** Extract the summary builder into a pure function in `core/` or a new
  `commands/sync-summary.ts` that takes `SyncResult` + context and returns
  `{ consoleLines, summaryLines }` (no I/O), then unit-test it directly. Extract the
  orphan-handling block into a helper (`handleOrphanedSkills(...)`). This also makes the
  list-formatting closure (`formatChangeList`) testable in isolation.

### H2. Frontmatter metadata accessed via repeated `as Record<string,string>` casts instead of a type-safe accessor
- **`cli/src/core/managed-content.ts:192, 218, 269, 296, 319, 518`**;
  **`cli/src/commands/check.ts:126, 148, 218`**;
  **`cli/src/core/agents.ts:201`**; **`cli/src/core/rules.ts:338`**
- **Impact:** `frontmatter.metadata` is typed `unknown` (it comes from a hand-rolled YAML parser)
  and is cast to `Record<string,string>` in 11 sites before key lookup. Values can actually be
  arrays/objects/`undefined` (e.g. `paths:` on a rule), so the cast is unsound — a lookup like
  `metadata[keys.contentHash]` is typed `string` but could be `undefined` at runtime, defeating
  `noUncheckedIndexedAccess`. `check.ts` additionally reconstructs the key inline
  (`metadata?.[`${keyPrefix}content_hash`]`) instead of calling `getMetadataKeys()`, duplicating
  the prefix→key derivation that already lives in `managed-content.ts`.
- **Fix:** Add one shared accessor in `managed-content.ts`, e.g.
  `getManagedMetadata(content, prefix): { managed?: string; contentHash?: string; assetsHash?: string; sourcePath?: string }`
  that parses frontmatter, guards `typeof metadata === "object"`, and reads keys via
  `getMetadataKeys(prefix)`. Replace all 11 cast sites (including the three in `check.ts`) with it.
  This removes the unsound cast, centralizes the key derivation, and lets `check.ts` drop its
  inline `keyPrefix` string-building.

---

## Medium Priority

### M1. Inline `createHash` call sites bypass the canonical hash helpers
- **`cli/src/core/sync.ts:120` (`computeRulesHash`), `cli/src/core/sync.ts:231` (`computeAgentsHash`)**
- **`cli/src/core/rules.ts:231` (`generateRulesSection`)**
- **`cli/src/core/lockfile.ts:107` (`hashContent`)**
- **Impact:** `.claude/rules/hash-and-prefix.md` and AGENTS.md "Content Hash Consistency" say
  *"DO NOT create new `createHash("sha256")` call sites"* and to reuse
  `computeContentHash`/`computeGlobalBlockHash`/`computeRulesSectionHash`. These five sites each
  re-implement the exact `sha256:${hash.slice(0,12)}` shape. The most clear-cut is
  `rules.ts:231`, which hashes the (already-trimmed) Codex rules-section content — that is
  precisely what `computeRulesSectionHash()` does, so it should call it directly. The two in
  `sync.ts` are *aggregate* hashes over a sorted rule/agent list (lockfile-only, not file
  frontmatter) and `lockfile.ts:hashContent` is the AGENTS.md global-block lockfile hash; these
  are legitimately different inputs but still duplicate the format string. NOTE: all four predate
  the #38 remediation (blame: 2026-02-02/06) — pre-existing debt, not a regression. The format is
  currently consistent (all 12-hex), so this is maintainability, not a correctness bug.
- **Fix:** Change `rules.ts:231-232` to `const contentHash = computeRulesSectionHash(contentForHash);`
  (import from `markers.ts`). For the three aggregate/lockfile hashes, extract a single private
  `shortSha256(input: string): string` helper (returns `sha256:${...slice(0,12)}`) and have all
  three call it, so the 12-char convention has exactly one definition.

### M2. Triplicated path-mapping/strip logic in `buildProposedChange`
- **`cli/src/core/propose.ts:283-321`** (and the rule/agent branches of `buildNewCandidate`,
  `cli/src/core/propose.ts:580-627`)
- **Impact:** The `skill`/`rule`/`agent` cases of the `switch` are byte-for-byte the same shape:
  read file → `stripManagedMetadata` → `file.path.replace(/^\.[^/]+\/<kind>\//, "<kind>/")`. The
  same three-way duplication recurs in `buildNewCandidate` (rule vs agent branches differ only in
  the subdir name and validator). New code from #56/#58, so this is fresh duplication.
- **Fix:** Drive the markdown cases with a small table
  `{ skill: "skills", rule: "rules", agent: "agents" }` and a single helper that takes the kind,
  reads, strips, and rewrites the prefix via one regex built from the kind. Collapses ~40 lines to ~12.

### M3. `commands/sync.ts`, `commands/config.ts`, `commands/upgrade-cli.ts` lack dedicated command tests
- **`cli/src/commands/sync.ts` (153 lines), `cli/src/commands/config.ts` (31 lines),
  `cli/src/commands/upgrade-cli.ts` (170 lines)**
- **Impact:** `.claude/rules/testing.md` and AGENTS.md require *"Every command file in
  `cli/src/commands/` must have a corresponding test file."* No test imports `syncCommand`,
  `configShow/Get/SetCommand`, or `upgradeCliCommand` (verified by grep). `upgrade-cli` was
  flagged High #10 in the *previous* audit and is **still open**. `sync` was Medium #20 previously
  and is **still open** (only exercised indirectly through `e2e-workflow.test.ts`). `sync` is also
  hard to test because `resolveTargetDirectory()` reads `process.cwd()`/git-root with no injection
  point (see L4).
- **Fix:** Add `tests/unit/upgrade-cli.test.ts` (flag validation incl. the `--package-manager`
  path at upgrade-cli.ts:74-83, already-up-to-date branch, error paths), a config-command test,
  and a `sync` command test that mocks the shared helpers / injects `cwd`.

### M4. `parseReleaseResponse` casts unvalidated GitHub JSON to typed fields
- **`cli/src/core/version.ts:93-108`**
- **Impact:** `data as Record<string,unknown>` then `data.tag_name as string`,
  `data.published_at as string`, etc. If the API omits a field (or returns null), `tag` is
  `undefined` typed as `string` and flows into `parseVersion(tag)` / the lockfile. The project
  already uses Zod for config/lockfile validation, so external HTTP input is the one place still
  trusting casts. Legacy, not a regression.
- **Fix:** Validate `data` with a small Zod schema (`{ tag_name: z.string(), target_commitish:
  z.string().optional(), published_at: z.string().optional(), tarball_url: z.string().optional() }`)
  and surface a clear error on shape mismatch instead of producing an `undefined` tag.

---

## Low Priority

### L1. Dead return fields and dead parameter left over from the CLAUDE.md refactor (#40)
- **`cli/src/core/merge.ts:71,138` (`mergedClaudeMdContent`)** — returned by `mergeAgentsMd`, never
  read in `src/` and not asserted in tests. Truly dead.
- **`cli/src/core/merge.ts:72,139` (`hadRootClaudeMd`)** — returned but never consumed in
  production (`src/core/sync.ts` ignores it); only asserted in `tests/unit/merge.test.ts`. Test-only
  field — keep the test or drop both.
- **`cli/src/core/merge.ts:156-158` (`_hadDotClaudeClaudeMd` param)** — `consolidateClaudeMd`
  accepts a 2nd parameter (fed `mergeResult.hadDotClaudeClaudeMd` at `sync.ts:596`) but ignores it
  entirely; the function always attempts the `.claude/CLAUDE.md` unlink.
- **Impact:** Violates "Export Hygiene". Misleads readers into thinking the consolidation depends
  on the flag.
- **Fix:** Drop `mergedClaudeMdContent` and the unused `_hadDotClaudeClaudeMd` parameter (and the
  argument at `sync.ts:596`). Decide whether `hadRootClaudeMd` is worth keeping for the test; if
  not, remove it too.

### L2. `checkCommand` has 5 near-identical per-type blocks (~265 lines)
- **`cli/src/commands/check.ts:97-236`**
- **Impact:** The `skill`/`rule`/`agent` branches (check.ts:118-141, 142-190, 212-234) differ only
  in `type` and the optional `rulePath`/`agentPath`; the `agents`/`rules-section` branches share
  the read→parse→strip→hash shape. Over the 200-line guideline and grows whenever a content type is
  added. Resolving H2 (shared metadata accessor) removes most of the per-branch boilerplate.
- **Fix:** After H2, fold the three file-backed branches into one helper
  `buildModifiedInfo(file, targetDir, prefix)` keyed on `file.type`.

### L3. Domain-specific `.replace(/-/g, "_")` in workflows.ts could compose the prefix utility
- **`cli/src/core/workflows.ts:74` (`secretPrefix`), `cli/src/core/workflows.ts:251`
  (`repository_dispatch` type)**
- **Impact:** These are NOT the marker↔metadata conversion (`workflows.ts` is not in the
  `hash-and-prefix.md` paths list) — line 74 uppercases then replaces (`AGCONF_`) and line 251
  builds a GitHub event type. So they are legitimate transforms, but the AGENTS.md "Prefix
  normalization" guideline asks that dash→underscore go through `toMetadataPrefix()`. Informational.
- **Fix:** Optional — `secretPrefix = toMetadataPrefix(markerPrefix).toUpperCase()` and
  `${toMetadataPrefix(workflowPrefix)}-release` make the intent explicit and keep a single
  dash→underscore implementation.

### L4. `resolveTargetDirectory()` hard-codes `process.cwd()` with no injection point
- **`cli/src/commands/shared.ts:68-86`**
- **Impact:** Blocks unit-testing `commands/sync.ts`/`init.ts` without spawning a process or
  chdir-ing (testing guideline asks commands that use `process.cwd()` to expose a `cwd` option).
  Directly contributes to M3.
- **Fix:** Add an optional `cwd` parameter (default `process.cwd()`) and thread it from the command
  options, mirroring how `check`/`propose` already accept `cwd`.

### L5. `options.packageManager as PackageManager` cast precedes its own validation
- **`cli/src/commands/upgrade-cli.ts:78-83`**
- **Impact:** The cast asserts the type and the very next line validates it with
  `validPms.includes(pmName)`. Safe in practice but backwards (assert-then-check). Minor.
- **Fix:** Validate the raw string first, then narrow:
  `if (!validPms.includes(options.packageManager as PackageManager)) { ...exit }` or use a type
  guard `isPackageManager(s): s is PackageManager`.

### L6. Sequential file reads in propose discovery loops
- **`cli/src/core/propose.ts:130-135` (`buildProposedChange` loop), `:650-690`
  (`discoverRawNewCandidates`)**
- **Impact:** Per-file `await fs.readFile` runs strictly sequentially. Fine for small repos;
  marginally slower for large skill/rule sets. Not a correctness issue.
- **Fix:** Optional — `Promise.all(filesToPropose.map(buildProposedChange))` (changes preserve the
  input order so ordering is unaffected) once the loop bodies are side-effect-free.

---

## Summary

Recently-touched hotspots (`propose.ts`, `sync.ts`, `managed-content.ts`, `shared.ts`,
`frontmatter.ts`, `check.ts`) are well-typed and well-tested at the unit level. The standout
issues are `performSync`'s size (H1), the unsound-and-duplicated frontmatter-metadata cast
pattern (H2), and command-test coverage gaps (M3, with `upgrade-cli` carried over from the
previous audit). No regressions of the #38 fixes; the hash format is currently consistent, and
the inline `createHash`/key-construction sites are pre-existing legacy debt rather than new
violations.

- Total issues: 12 | Critical: 0 | High: 2 | Medium: 4 | Low: 6
