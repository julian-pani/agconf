# Documentation Audit Report

**Audit date:** 2026-06-02
**Scope:** Documentation drift introduced by recent changes (propose #35/#58, sync overwrite guard #58, CLAUDE.md consolidation #40), plus general doc health.
**Source of truth for commands/options:** `cli/src/cli.ts` (commander definitions), read in full.

## Summary of severity

- **Critical (docs contradict code):** 3 findings — stale `.claude/CLAUDE.md` in 2 READMEs, and an internal contradiction about CLI version pinning in workflow docs.
- **High:** 1 — stale `agconf@1.2.0` pinned-install example in CANONICAL_REPOSITORY_SETUP.md (the audit-flagged carry-over; still present).
- **Medium:** JSDoc regex/glob mismatch, root README `propose` option completeness, AGENTS.md Core Modules list omissions.
- **Phantom `canonical update`:** RESOLVED. Only appears in old `/projects/codebase_audit_*` reports, never in live docs.
- **Completion parity:** PASS. Every command/option in `cli.ts` is present in `completion.ts`.

---

## Code Documentation

### Well-Documented

- **`cli/src/core/propose.ts`** — All 5 exported functions (`detectProposedChanges:94`, `detectNewContent:444`, `applyProposedChanges:784`, `slugifyTitle:897`, `generateBranchName:909`) carry JSDoc. Public interfaces (`ProposedChange:25`, `ProposeOptions:43`, `DownstreamContext:50`, `ProposeResult:62`) are documented with field-level comments. Strong for a brand-new 993-line module.
- **`cli/src/core/sync.ts`** — The overwrite guard is well-documented: `SyncResult.adopted:417` has an explanatory comment, `UnmanagedOverwriteError:432` is clear, and `detectUnmanagedCollisions:455` has a precise JSDoc block (lines 449-454) describing the adopted/conflict classification. Matches the AGENTS.md prose exactly.
- **`cli/src/core/merge.ts`** — `consolidateClaudeMd:156` has accurate JSDoc (lines 149-155) describing the root-CLAUDE.md-kept / `.claude/CLAUDE.md`-deleted behavior introduced in #40.
- **`cli/src/commands/completion.ts`** — Exported helpers (`handleCompletion`, `detectShell`, `getShellConfigFile`, etc.) all have JSDoc.

### Needs Documentation

- **`cli/src/core/propose.ts:46`** — *Medium / accuracy.* JSDoc for `ProposeOptions.files` reads `Only propose specific files (glob patterns relative to cwd)`, but the implementation at `cli/src/core/propose.ts:119` is `(options.files ?? []).map((pattern) => new RegExp(pattern))` — **regex, not glob**. `cli/src/cli.ts:134` correctly documents `--files <patterns...>` as "regex patterns". Fix: change the JSDoc to "regex patterns matched against relative paths" to match the CLI help and `#36` (which switched this filter to regex).
- **`cli/src/commands/propose.ts`** — *Low.* Private helpers `buildManagedProposeResult:67`, `buildNewProposeResult:100`, `selectNewCandidates:172`, `candidateLabel:205`, `runApply:213` have no JSDoc. The exported `proposeCommand:31` also lacks a summary block. Not blocking (private orchestration), but a one-line summary on `proposeCommand` would help.

---

## API/CLI Documentation

Authoritative command/option list built from `cli/src/cli.ts`:

| Command | Options (cli.ts) |
|---------|------------------|
| `init` | `-s/--source`, `--local`, `-y/--yes`, `--override`, `--ref`, `-t/--target` |
| `sync` | `-s/--source`, `--local`, `-y/--yes`, `--override`, `--ref`, `--pinned`, `-t/--target`, `--summary-file`, `--expand-changes` |
| `check` | `-q/--quiet`, `--debug` |
| `propose` | `-n/--dry-run`, `-t/--title`, `-m/--message`, `--files`, `--new`, `-y/--yes` |
| `upgrade-cli` | `-y/--yes`, `-p/--package-manager` |
| `canonical init` | `-n/--name`, `-o/--org`, `-d/--dir`, `--marker-prefix`, `--no-examples`, `--rules-dir`, `-y/--yes` |
| `config` (show/get/set) | — |
| `completion` (install/uninstall) | — |

### Completion parity: PASS

`cli/src/commands/completion.ts` `COMMANDS` (lines 13-88) matches `cli.ts` exactly:
- `init` options (line 16) — match.
- `sync` options (lines 19-33) including `--override`, `--summary-file`, `--expand-changes` — match.
- `check` options (line 37): `--debug` present — match.
- `propose` options (lines 39-53): `-n`, `--dry-run`, `-t`, `--title`, `-m`, `--message`, `--files`, `--new`, `-y`, `--yes` — match. Correctly maps `-t` to `--title` for propose (vs `--target` for init/sync).
- `upgrade-cli` (line 60): `-p`, `--package-manager` present — match.
- `canonical init` (lines 66-81) including `--rules-dir`, `--no-examples` — match.

No phantom options, no missing options. The AGENTS.md "hard requirement" (completion must list every command/option) is satisfied.

### Phantom command check: RESOLVED

The previously-flagged phantom `canonical update` (last audit, #38 remediation) does **not** appear in any live doc surface. `grep` for "canonical update" only hits old reports under `projects/codebase_audit_2026-02-12/`, `projects/review_001/`, and `projects/multi-source-modules/` — historical, not user-facing. `CANONICAL_SUBCOMMANDS = ["init"]` (completion.ts:92) is correct.

---

## User Documentation

### Existing Guides (`cli/docs/`)

| Guide | Status |
|-------|--------|
| `CANONICAL_REPOSITORY_SETUP.md` | Comprehensive (646 lines), covers GitHub App + PAT auth, rules, agents. **Contains a stale pinned-version example — see Stale Documentation.** |
| `CHECK_FILE_INTEGRITY.md` | Accurate. Content types listed (lines 14-18) match `check.ts` and AGENTS.md. Pre-commit hook + CI workflow docs correct. |
| `VERSIONING.md` | Accurate, including "workflows generated without CLI version pinning / `npm install -g agconf`" (lines 162-168), which matches the actual templates in `canonical.ts:279,437`. |
| `DOWNSTREAM_REPOSITORY_CONFIGURATION.md` | Accurate. `workflow` keys (commit_strategy, pr_branch_prefix, pr_title, commit_message, reviewers) match `DownstreamConfigSchema`. |

### Missing Guides

- **No dedicated `propose` guide.** The headline feature of #35/#58 (propose changes upstream, `--new` for unmanaged content, the round-trip adoption flow) is only documented in README prose. Given its complexity (regex `--files`, `--new [path]` auto-select, dry-run, PR creation, round-trip adoption via sync), a `cli/docs/PROPOSING_CHANGES.md` is warranted. *Medium.*
- **No troubleshooting for the overwrite guard / `UnmanagedOverwriteError`.** When sync aborts with a conflict list, there's no guide entry explaining the three resolutions (propose, rename, `--override`). The cli/README "Local edits & overwrite protection" section (lines 54-61) is good but a docs/ entry would be discoverable from CI failures. *Low.*

---

## Architecture Documentation

`AGENTS.md` is largely accurate but the **Core Modules list (lines 42-51) is incomplete**:

- Lists: `sync.ts`, `lockfile.ts`, `markers.ts`, `merge.ts`, `source.ts`, `workflows.ts`, `hooks.ts`, `targets.ts`, `rules.ts`.
- **Omits** several core files that exist in `cli/src/core/`: `propose.ts` (993 lines, the new headline feature), `managed-content.ts` (812 lines, central to the guard and check), `agents.ts`, `frontmatter.ts`, `version.ts`, `schema.ts`. *Medium.* `propose.ts` and `managed-content.ts` are referenced in prose elsewhere in AGENTS.md but absent from the module index — a reader scanning the architecture section won't see them. (Note: there ARE dedicated "Rules Sync" and "Agents Sync" subsections that document `rules.ts`/`agents.ts` in depth, so `agents.ts` is partially covered; `propose.ts`/`managed-content.ts`/`frontmatter.ts` are the real gaps.)
- The overwrite-guard description (AGENTS.md:43) and the propose/Commands description (AGENTS.md:53-54) are **accurate** against the code.

`CLAUDE.md` (root) correctly contains only `@AGENTS.md` (1 line), consistent with the #40 consolidation model. No stale references in CLAUDE.md itself.

---

## README Assessment

**Root `README.md`** — Strong overall (commands table at 110-118 is accurate; `propose` row at 115 correctly mentions `--new`). Issues:
- **`README.md:311` (Critical):** "Files Created" table lists `` `.claude/CLAUDE.md` | Reference to AGENTS.md ``. Per `merge.ts consolidateClaudeMd` (#40), sync now **creates/keeps root `CLAUDE.md`** and **deletes `.claude/CLAUDE.md`**. The table is wrong — it advertises a file that sync actively removes. Fix: change row to `` `CLAUDE.md` (root) | Reference to AGENTS.md (`@AGENTS.md`) ``.
- **`README.md:190-208` (Medium):** The `propose` section documents `propose`, `--new`, `--new <path>`, `--dry-run` but omits `--title`, `--message`, and `--files`. Add these three for completeness (they ARE in the table indirectly and in completions).
- Architecture diagram (lines 33-38) shows `.agconf/` correctly. Sync overwrite behavior (lines 167-172) is accurate and well-written.

**`cli/README.md`** — Good command table (lines 18-32, lists `completion install`). Issues:
- **`cli/README.md:65` (Critical):** "CLAUDE.md Handling" section says: "During sync, agconf consolidates any existing `CLAUDE.md` files into `AGENTS.md` and **creates `.claude/CLAUDE.md` with a reference** to it." This contradicts #40 / `merge.ts`. Fix: "...creates/keeps a **root `CLAUDE.md`** with an `@AGENTS.md` reference and removes any `.claude/CLAUDE.md`."
- The "Local edits & overwrite protection" (lines 54-61) and Rules/Agents sections are accurate.

---

## Stale Documentation

1. **`README.md:311` (Critical)** — `.claude/CLAUDE.md` listed as a created file; code deletes it and keeps root `CLAUDE.md`. (#40)
2. **`cli/README.md:65` (Critical)** — "creates `.claude/CLAUDE.md` with a reference"; same #40 drift.
3. **`cli/docs/CANONICAL_REPOSITORY_SETUP.md:339-346` vs `cli/docs/VERSIONING.md:162-168` (Critical — internal contradiction):**
   - CANONICAL_REPOSITORY_SETUP.md claims generated workflows pin the CLI: `run: npm install -g agconf@1.2.0` and "The version is automatically set to the CLI version used when running `agconf canonical init`."
   - VERSIONING.md says the opposite: "Workflow files are generated without CLI version pinning" / `run: npm install -g agconf`.
   - **Ground truth:** `cli/src/commands/canonical.ts:279` and `:437` emit `run: npm install -g agconf` (**unpinned**). So VERSIONING.md is correct and **CANONICAL_REPOSITORY_SETUP.md is stale/wrong**. This is also the carry-over `agconf@1.2.0` example the audit brief flagged from the prior audit — still unfixed. Fix CANONICAL_REPOSITORY_SETUP.md lines 339-346 to show unpinned `npm install -g agconf` and delete the "version is automatically set" sentence.
4. **`cli/src/core/propose.ts:46` (Medium)** — JSDoc says `--files` is "glob patterns"; implementation (`:119`) is regex. (#36)

---

## Recommendations

Priority order (each with file:line + concrete fix):

1. **[Critical] Fix `.claude/CLAUDE.md` drift in both READMEs.**
   - `README.md:311`: replace row with `` | `CLAUDE.md` (root) | Reference to AGENTS.md (`@AGENTS.md`) | ``.
   - `cli/README.md:65`: rewrite to "creates/keeps a root `CLAUDE.md` containing `@AGENTS.md` and removes any legacy `.claude/CLAUDE.md`."
2. **[Critical] Resolve the CLI-pinning contradiction.** Edit `cli/docs/CANONICAL_REPOSITORY_SETUP.md:339-346` to show unpinned `npm install -g agconf` (matching `canonical.ts:279,437` and VERSIONING.md). Remove the `agconf@1.2.0` example and the "version is automatically set" claim.
3. **[Medium] Fix the regex JSDoc.** `cli/src/core/propose.ts:46`: change "glob patterns relative to cwd" to "regex patterns matched against relative paths".
4. **[Medium] Update AGENTS.md Core Modules list (lines 42-51)** to add `propose.ts`, `managed-content.ts`, and `frontmatter.ts` (at minimum the first two — the new feature's core files). One line each.
5. **[Medium] Complete the root README `propose` section (lines 190-208)** by documenting `--title`, `--message`, and `--files` (regex) flags.
6. **[Medium] Add `cli/docs/PROPOSING_CHANGES.md`** — a dedicated guide for the propose workflow (managed edits vs `--new`, regex `--files`, `--dry-run`, PR creation, and the sync-adoption round-trip). Link it from both READMEs and the docs index in `cli/README.md:8-14`.
7. **[Low] Add overwrite-guard troubleshooting** to CHECK_FILE_INTEGRITY.md or the new propose guide: what `UnmanagedOverwriteError` means and the three resolutions (propose / rename / `--override`).
8. **[Low] One-line JSDoc summary** on `proposeCommand` (`cli/src/commands/propose.ts:31`).
