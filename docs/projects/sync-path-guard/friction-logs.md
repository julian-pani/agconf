# Friction logs — sync path guard

### An allowlist of "what this tool writes" must be enumerated from the writers in code, not from directory intuition

**What happened**: Asked to design a path allowlist bounding what `agconf sync` may change in a
downstream repo, I proposed one from memory of the repo layout: `AGENTS.md`, `CLAUDE.md`,
`.claude/**`, `.codex/**`, `.agents/**`, `.agconf/**`, plus agconf's own workflow files. The user
did not accept it at face value — they asked whether sync really never writes `.claude/settings.json`
("what if it's adding / changing hooks, etc?"). Grepping for the actual writers found
`installPreCommitHook` in the `sync` path, which in a repo using the pre-commit framework registers
an `agconf-check` hook in **`.pre-commit-config.yaml` at the repo root** — a tracked file outside
every directory I had listed. Shipping the proposed list would have hard-failed every scheduled sync
in those repos.

**Evidence**:
- Proposed list (pre-correction) omitted `.pre-commit-config.yaml`.
- `cli/src/commands/shared.ts` calls `installPreCommitHook(targetDir)` inside `performSync`.
- `cli/src/core/hooks.ts` `registerPreCommitHook` writes `.pre-commit-config.yaml` / `.yml`.
- `cli/src/commands/sync-output.ts` already reported that file in the sync summary — visible evidence
  I had not looked for.

**Impact**: A guard designed to build trust would instead have broken working repos on its first
scheduled run, and the failure would have looked like the guard catching a real problem. The general
lesson: when defining the authoritative set of paths a tool touches, enumerate the write sites
(`grep` for the file-writing and install functions reachable from the entry point) rather than
reasoning from the directory layout — the outliers are exactly the ones intuition misses, and an
allowlist is only as good as its least-obvious entry.

**Suggested type**: Knowledge

**Initiation**: User-requested

SUBMITTED: 2026-09-22
Issue: https://github.com/i-FeelBetter/fbagents/issues/271

---

### Don't trade an auditability requirement for testability — generated shell can be extracted from the artifact and executed in a test

**What happened**: When the check could live either in the agconf CLI or inline in the generated
GitHub Actions YAML, I argued for the CLI and against inline shell, on the grounds that "a bash
heredoc in a generated YAML string can't be covered by `pnpm test`" — treating testability as the
deciding constraint and the CLI as the only testable option. The user redirected: the point of the
guard is that someone who does not know agconf can read the workflow and see what a sync may write,
so hiding it behind an opaque CLI call defeats it. Both properties turned out to be available at
once: the test generates the workflow, parses the YAML, pulls the guard's `run:` script out of it,
and executes it with `bash -eo pipefail` against a real git repo per case. That test immediately
caught four real defects in the shipped shell — a `${{{` triple brace, a `\n` eaten by the
TypeScript template literal, allowlist ordering drift against the TS copy, and
`git status --porcelain` collapsing untracked directories to `dir/` (which would have *rejected* a
path a repo had explicitly allowed via `extra_allowed_paths`).

**Evidence**:
- My argument at design time: "Put the guard in the CLI, not in bash inside the YAML template. The
  repo rule is no manual tests; a heredoc in a generated template string can't be covered by
  `pnpm test`."
- User's correction: "Could we add this check to the github action code so it's easily visible and
  builds trust, even for someone that doesn't know agconf?"
- Resolution: `cli/tests/integration/sync-workflow-guard.test.ts` — extracts the step's `run` from
  the parsed YAML and executes it; also pins its allowlist array to `BASE_ALLOWED_PATHS` so the two
  implementations cannot drift.

**Impact**: I nearly traded away the feature's actual purpose (independent auditability by a
third party) to satisfy a process constraint, when the constraint was satisfiable a different way.
When a "we can't test that" objection points away from what the user asked for, the next question
should be how to test the thing they asked for — for generated artifacts (YAML, shell, config,
Dockerfiles), generate them in the test and exercise the real output, rather than testing a
substitute and shipping something unverified.

**Suggested type**: Knowledge

**Initiation**: User-requested

SUBMITTED: 2026-09-22
Issue: https://github.com/i-FeelBetter/fbagents/issues/272

---

### `submit-friction-issue.sh` fails against `i-FeelBetter/fbagents` whenever `GH_TOKEN` is set in the agent's environment

**What happened**: Submitting the two items above via `$submit-friction-logs` failed on the first
attempt. `gh auth status` showed two authenticated accounts: an active one backed by the `GH_TOKEN`
environment variable (a fine-grained PAT) and an inactive keyring account. The PAT cannot see the
canonical repo at all, so issue creation died with `GraphQL: Could not resolve to a Repository with
the name 'i-FeelBetter/fbagents'`. Re-running the identical command with the variable stripped
(`env -u GH_TOKEN -u GITHUB_TOKEN …`) succeeded immediately. The conversation upload step never
recovered: git is configured to rewrite SSH URLs to HTTPS and to authenticate through
`gh auth git-credential`, so the clone inherits the same token and returns
`403 Write access to repository not granted`, leaving every issue annotated
`(upload failed - conversation not attached)`.

**Evidence**:
- First run: `{"error": "Failed to create issue: GraphQL: Could not resolve to a Repository with the name 'i-FeelBetter/fbagents'. (repository)", …, "status": "failed"}`
- `gh repo view i-FeelBetter/fbagents` fails with `GH_TOKEN` set, returns `{"name":"fbagents","visibility":"PRIVATE"}` with it unset.
- `git config --global`: `url.https://github.com/.insteadof git@github.com:` plus
  `credential.https://github.com.helper !/opt/homebrew/bin/gh auth git-credential` — so even an
  explicit `git@github.com:` clone goes out over HTTPS with the PAT and 403s.
- Both issues (271, 272) carry `(upload failed - conversation not attached)` instead of a
  conversation link.

**Impact**: The skill's own workflow is not runnable as written in an environment that exports
`GH_TOKEN`, and the failure mode is opaque — "could not resolve to a repository" reads like the repo
was renamed or deleted, not like an auth-scope problem, so the natural next step is to go looking
for the wrong thing. The conversation upload fails silently as a warning, degrading every submitted
issue. `scripts/submit-friction-issue.sh` should either select the account that can reach the repo
(e.g. `gh auth switch`, or clearing `GH_TOKEN`/`GITHUB_TOKEN` for its own `gh`/`git` invocations) or
detect the mismatch up front and say which credential it needs.

**Suggested type**: Environment

**Initiation**: Agent-identified

SUBMITTED: 2026-09-22
Issue: https://github.com/i-FeelBetter/fbagents/issues/273

---

### Backticks in generated shell are command substitution — Markdown decoration in an echo is a code-execution bug

**What happened**: To make the guard's CI failure render nicely in `$GITHUB_STEP_SUMMARY` I wrote
`echo "- \`$file\`"` in the bash emitted into `sync-reusable.yml`, intending Markdown code spans. The
`\`` escapes were for the TypeScript template literal; what reached the YAML was a bare backtick
inside a double-quoted shell string, which is command substitution. Running the generated script
showed bash executing the violating paths and the allowlist entries as commands — and the literal
`` `agconf sync` `` in my remedy text **re-invoked a full sync from inside the guard's failure
handler**. So the step that exists to contain a compromised canonical repo would execute filenames
that repo controls, in a job holding a token with `contents: write` and `workflows: write`.

**Evidence**:
- Reproduced directly: `guard.sh: line 77: evil.ts: command not found`, `line 82: AGENTS.md: command
  not found`, and `┌ agconf sync` / `warn This repository has not been synced yet` in the output.
- The violation list also rendered as empty `- ` bullets, so the report lost all diagnostic value.
- Fix: no backticks anywhere in the generated shell, plus a test asserting
  `expect(guardScript).not.toContain("\`")`.

**Impact**: I introduced a code-execution path into a security guard while making its error message
prettier. The general rule: text destined for a shell `echo` is shell, not Markdown — backticks,
`$(...)`, and `$` are all live there, and "it is only a log line" is not a reason to relax that.
When generating shell from a template literal, the escaping has two layers (TS, then bash) and only
executing the generated artifact tells you what the second layer sees.

**Suggested type**: Knowledge

**Initiation**: Agent-identified

---

### Asserting on `stdout + stderr` lets tests pass for the wrong reason

**What happened**: Every failure-path assertion in the guard's integration test was written as
`expect(result.stdout + result.stderr).toContain(<path>)`. While the backtick bug above was live and
the guard printed empty bullets, **16 of 17 tests still passed** — the expected strings appeared only
in bash's *own* error output on stderr (`src/index.ts: Permission denied`,
`.claude/**: No such file or directory`). The one test that asserted on a real output channel (the
job summary file) was the only one that caught it. Concatenating the two channels had quietly turned
"the guard reported this path" into "this path appeared somewhere, including in a crash".

**Evidence**:
- Suite result with the bug live: 16 passed, 1 failed — the failure was the job-summary test.
- Fix: assert on `result.stdout` alone (the guard writes its whole report there) and add
  `expect(result.stderr).toBe("")` to the failure cases, so a script that crashes its way to the
  right substring fails.

**Impact**: The tests were measuring the wrong thing in a way that inverted their value — they were
most likely to pass when the script was most broken. When testing a subprocess, assert on the
specific channel the program is contractually supposed to write to, and assert the other one is
empty. Combining them is almost always a false-confidence bug.

**Suggested type**: Knowledge

**Initiation**: Agent-identified
