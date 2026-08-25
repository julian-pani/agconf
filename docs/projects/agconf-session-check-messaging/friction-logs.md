# Friction logs — agconf session-check messaging

### Codex SessionStart hooks require the JSON envelope; plain stdout is silently dropped

**What happened**: `agconf session-check` printed human-readable text to stdout, which Claude Code
injects into context as-is. On Codex the identical hook ran (verified via a marker file and a `tee`
of its stdout) but Codex reported `hook: SessionStart Failed` and the text never reached the model —
so the Codex half of the feature had never worked since it shipped. Codex validates a SessionStart
hook's stdout against its embedded `session-start.command.output` JSON schema and requires
`{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<text>"}}`. Claude Code
accepts the same envelope, so one command can serve both harnesses.

**Evidence**:
- `hook: SessionStart Failed` in `codex exec` output while `$SCRATCH/hook-ran` existed and
  `$SCRATCH/hook-stdout.txt` held the full plain-text note.
- Schema extracted from the Codex binary: titles `session-start.command.input` /
  `session-start.command.output`, with `SessionStartHookSpecificOutputWire {hookEventName,
  additionalContext}`; error string `hook returned invalid session start JSON output`.
- Fix landed as `agconf session-check --hook` (`cli/src/commands/session-check.ts`), written into the
  hook command by `--install-hook` (`cli/src/core/session-check.ts`).

**Impact**: A shipped feature was inert on one of the two supported targets, undetected, because the
harness fails hooks silently. Cost roughly half the session to diagnose. Any future agconf output
consumed by a harness hook needs its per-harness wire format verified, not assumed.

**Suggested type**: Knowledge

**Initiation**: Agent-identified

---
SUBMITTED: 2026-08-25
Issue: https://github.com/i-FeelBetter/fbagents/issues/160
---

### submit-friction-issue.sh fails under the ambient GH_TOKEN, and the conversation upload can never succeed here

**What happened**: Running `scripts/submit-friction-issue.sh` failed with
`GraphQL: Could not resolve to a Repository with the name 'i-FeelBetter/fbagents'`. The environment
exports a fine-grained PAT as `GH_TOKEN`, which `gh` prefers over the keyring account; that PAT has no
access to `i-FeelBetter/fbagents`. Re-running as `env -u GH_TOKEN -u GITHUB_TOKEN
scripts/submit-friction-issue.sh …` succeeded immediately. Separately, the conversation upload fails
unconditionally on this machine: a global `url.https://github.com/.insteadOf git@github.com:` rewrite
turns every ssh clone into https, and the https credential path is non-interactive, so the clone dies.
Every issue this skill files here lands without its conversation link.

**Evidence**:
- `gh repo view i-FeelBetter/fbagents` → `Could not resolve to a Repository` with `GH_TOKEN` set;
  returns the repo JSON under `env -u GH_TOKEN -u GITHUB_TOKEN`.
- `gh auth status`: active account `julian-pani (GH_TOKEN)` is a `github_pat_11…` fine-grained PAT;
  the inactive `(keyring)` account holds the `repo`-scoped `gho_…` token that works.
- `WARNING: Failed to clone fbagents repository for conversation upload` on both runs;
  `"conversation_url": "(upload failed - conversation not attached)"` in the returned JSON.
- `git clone git@github.com:i-FeelBetter/fbagents.git` → `fatal: unable to access
  'https://github.com/i-FeelBetter/fbagents.git/': The requested URL returned error: 403`;
  `git config --global --get-regexp 'url\.'` shows the two `insteadOf` rewrites to https.
- `scripts/upload-conversation.sh:38-40` tries `git clone` then `gh repo clone`, both of which inherit
  the same broken auth.

**Impact**: The first submission attempt failed outright and needed manual diagnosis of `gh`'s token
precedence before any issue could be filed. The conversation link — the main context the async
processor uses — is missing from issue #160 and from every other issue filed from this machine.
The script should either unset `GH_TOKEN`/`GITHUB_TOKEN` itself (or pick the account that can reach
the repo) and surface an actionable message instead of a raw GraphQL error.

**Suggested type**: Environment

**Initiation**: Agent-identified

---
SUBMITTED: 2026-08-25
Issue: https://github.com/i-FeelBetter/fbagents/issues/161
---
