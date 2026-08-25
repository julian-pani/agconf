# Distribution Scopes — per-repo vs per-user vs plugin (design + status)

> Status: **implemented.** agconf supports three ways to deliver canonical
> content: **repo scope** (committed into each repo, the original model), **user
> scope** (`sync --scope user` — projected **once per machine** into `~/.claude`/
> `~/.codex` via a git-tracked `~/.agconf` store, kept fresh by `agconf autosync`),
> and **plugins** (`agconf compile`). This document is the design record and living
> spec: the analysis behind the split, the invariants (INV-1…INV-9), the
> acceptance criteria, and the per-feature status (F1–F7) below — including how a
> developer is stopped from loading the same content **twice** when a repo commits
> content *and* they also have it at user scope (see `agconf session-check`). For
> user-facing usage, see the [README](../../README.md#user-scope---scope-user).
>
> **Looking for "does feature X work in mode Y?"** → [§16 Feature × mode
> matrix](#16-feature--mode-matrix), with the remaining gaps called out in
> [§17](#17-known-gaps).

## 1. The problem

Today `agconf sync` writes a **full copy** of the canonical content into the
**git root of every downstream repo** and commits it: root `AGENTS.md` (global +
repo + rules markers), root `CLAUDE.md`, `.claude/skills/**`, `.claude/rules/**`,
`.claude/agents/**`, `.codex/skills/**`, plus `.agconf/lockfile.json` and the
generated CI workflows. The target directory is always `getGitRoot()` — there is
**no notion of a user-level install anywhere in the tool** (the only `homedir()`
uses are `~`-path expansion and shell-completion install paths).

Consequence: a developer with 20 repos has 20 byte-for-byte copies of the same
global instructions and skills. That is the duplication users are objecting to.
It is real, and it is the *identical* global block repeated everywhere — the
highest-value target for de-duplication.

## 2. Reframe: this is two orthogonal questions, not one

Both proposals ("base directory" and "plugins") conflate two independent axes.
Keeping them separate is what makes the design tractable:

- **Axis 1 — WHERE a developer's copy lives:** committed **per-repo** (today) vs
  **per-user** (harness home dir) vs **harness-managed plugin** (also per-user,
  but owned by the harness's plugin system).
- **Axis 2 — HOW it stays fresh:** manual `agconf sync`, the generated CI PR-bot,
  a **session-start hook**, or **plugin auto-update**.

And crucially, the answer differs **per content type**, because the two harnesses
give each type a different set of homes:

| Content type | Per-repo (today) | Per-user home | Plugin slot? |
|---|---|---|---|
| **Global instructions** (`AGENTS.md` global block / `CLAUDE.md`) | ✅ committed | ✅ `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md` | ❌ **no plugin slot in either tool** |
| **Rules** | ✅ `.claude/rules/**` (Claude) / AGENTS.md section (Codex) | ⚠️ user-level rules dir unclear for Claude; Codex → concatenate into `~/.codex/AGENTS.md` | ❌ **no plugin slot** |
| **Skills** | ✅ `.claude/skills`, `.codex/skills` | ✅ `~/.claude/skills`, `$HOME/.agents/skills` (Codex) | ✅ yes (both) |
| **Subagents** | ✅ `.claude/agents` (Claude only today) | ✅ `~/.claude/agents`, `~/.codex/agents` | ✅ Claude native; Codex **down-converts to a skill** |
| **MCP servers** | ❌ not synced today | ✅ `~/.claude` config, `~/.codex/config.toml` | ✅ yes (both) |

**The single most important fact in this table:** plugins have **no slot for
global instructions or rules**. `agconf compile` only ever reads
`skills/`, `agents/`, `mcps/`; it never touches the global `AGENTS.md` or
`rules/`. So *"just move everything to plugins"* is impossible — the biggest,
most-duplicated content (the instructions) literally cannot ride a plugin.
Plugins can only ever be **part** of the answer.

## 3. Important correction: "base directory" ≠ a parent folder you launch from

The proposed model — "put canonical in a base directory, launch all sessions from
there" — does **not** work the way it sounds, because of how both harnesses
discover instruction files:

- **Claude Code** loads `~/.claude/CLAUDE.md` (user scope) always, then walks
  **up from cwd to the *repository* root** loading every `CLAUDE.md`. The walk is
  anchored at the git/project root — it does **not** climb into an arbitrary
  ancestor "base folder" above a cloned repo once you `cd` into that repo.
- **Codex** reads `~/.codex/AGENTS.md` (global), then walks **down** from the
  repo root to cwd. Again anchored at the repo root; a parent folder above the
  repo is not read.

So a literal "launch from a parent directory" scheme is unreliable — nested git
repos ignore the ancestor. **The reliable per-user channel is the harness's own
user scope** (`~/.claude/…`, `~/.codex/…`, `~/.agents/…`). Read "base directory"
as **"install into user scope,"** and the idea becomes sound and simple: agconf
gains a `--scope user` install target that writes the canonical content into the
harness home dirs instead of a repo. No special launch directory required, and it
covers **every** content type (unlike plugins).

## 4. Option A — per-user (user-scope) install + session-start hook

**Mechanics.** `agconf sync --scope user` writes:
- global block → `~/.claude/CLAUDE.md` (as a marked block) and `~/.codex/AGENTS.md`
- skills → `~/.claude/skills`, `$HOME/.agents/skills` (Codex; **verify path** — see §8)
- subagents → `~/.claude/agents`, `~/.codex/agents`
- rules → Claude user rules (verify support) / concatenated into `~/.codex/AGENTS.md`
- tracked in a **user-level lockfile** at `~/.agconf/lockfile.json`

**Freshness** = a **SessionStart hook**. Both harnesses support it (verified
against Claude Code and Codex v0.147.0):
- Claude: a hook in `~/.claude/settings.json` fires for **every** project the dev
  opens and can run a command + inject stdout into context.
- Codex: a `SessionStart` hook in `~/.codex/hooks.json`. The `hooks` feature is
  **stable and enabled by default** (`codex features list` → `hooks stable true`);
  stdout is injected as developer context, exactly like Claude.

The hook runs `agconf check --scope user` (a cheap hash comparison against the
pinned canonical) and either warns ("your shared config is N versions behind — run
`agconf sync --scope user`") or auto-syncs. This is exactly the "warn/auto-update
at session start" behavior requested, and it is **agconf-controlled**, so it's the
most reliable freshness mechanism of any option here.

**Pros**
- Zero per-repo footprint; **one copy per machine**. Directly kills the complaint.
- Covers **all** content types, including the instructions/rules plugins can't carry.
- Works for both harnesses.
- Freshness is near-real-time and under agconf's control.

**Cons**
- New concept + code: a user-scope writer, per-harness home-dir resolution, a
  user-level lockfile, hook installation.
- **Scope bleed:** user-scope instructions apply to *every* repo the dev opens,
  including ones that shouldn't get them. Per-repo scoping is lost. (Mitigation:
  keep only the *repo-specific* section per repo; the global/standard content
  goes user-scope.)
- Not git-visible: a fresh clone / CI / a teammate who hasn't run the installer
  gets nothing. The repo no longer records "this project expects standard X."
- Codex specifics are newer/flakier: open bugs on `~/.codex/AGENTS.md` being read;
  hooks behind a feature flag.

## 5. Option B — plugins with auto-update

**Mechanics.** `agconf compile` already produces installable Claude/Codex plugins
+ marketplaces committed in the **canonical** repo. Devs install once
(`/plugin marketplace add owner/repo`, `codex plugin marketplace add owner/repo`),
per user, via the harness. Content lives once in `~/.claude/plugins` (etc.).

**Reality check on "auto-update turned on":**
- **Claude:** auto-update is **ON by default only for official Anthropic
  marketplaces**; for third-party marketplaces (yours) it is **OFF by default** —
  the user (or a committed `.claude/settings.json`) must enable it. Even enabled,
  it's a **background** refresh ~10 min after launch with a random delay; the
  running session keeps the version it launched with. So: *eventually* fresh, not
  instantly, and opt-in.
- **Codex:** **no auto-update at all** — updates require a manual
  `codex plugin marketplace upgrade` (+ `/reload-plugins`). "Bump the version and
  everyone is current" is simply false for Codex.
- **Version discipline:** agconf's freshness (`--check`) is *decoupled* from the
  version string — content can change without a version bump and `--check` still
  passes. Claude's update trigger is version-based, so you must **bump on every
  content change** or updates won't fire. Nothing enforces that today.

**Pros**
- Reuses a feature that already exists.
- Content lives once per machine; clean projection (no metadata injected).
- Repos can **declare** the dependency without committing content: a committed
  `.claude/settings.json` with `extraKnownMarketplaces` + `enabledPlugins` prompts
  teammates to install the plugin on entering the repo. This is the lowest-
  duplication path for skills/agents/MCP.

**Cons**
- **Cannot carry instructions or rules** — the core gap.
- Auto-update is uneven and weak (Claude: opt-in + delayed; Codex: manual).
- Requires disciplined per-release version bumping that agconf doesn't enforce.
- Codex subagents are down-converted to skills (loses parallel-spawn/model/effort/
  sandbox fidelity).
- Coarse versioning: any one-skill edit bumps the whole plugin's version.

## 6. The double-loading question (the crux)

> "If a repo has canonical committed per-repo, and the dev *also* has it at the
> user level (base dir or plugin), will the harness get everything twice? Can we
> block it?"

Answer: **it depends on content type, and the failure modes are different for the
two options.** Here is exactly what each harness does on overlap:

| Content type | User-scope (Option A) vs committed repo copy | Plugin (Option B) vs committed repo copy |
|---|---|---|
| **Instructions** (`CLAUDE.md`/`AGENTS.md`) | **DUPLICATES.** Both harnesses **concatenate all memory files with no deduplication.** `~/.claude/CLAUDE.md` + repo `CLAUDE.md`→`@AGENTS.md` both load; `~/.codex/AGENTS.md` + repo `AGENTS.md` both load. The model sees the global block twice. | N/A — plugins can't carry instructions, so this pair can't collide. |
| **Skills** | **SAFE (auto-dedup).** Claude precedence: personal `~/.claude/skills` **overrides** project `.claude/skills` for the same name — only one loads. Codex: nearest-scope wins (verify). | **DUPLICATES.** Plugin skills are **namespaced** (`/marketplace:skill`), so they do **not** dedupe against a synced project skill (`/skill`). **Both appear** as separate invokable skills — same capability under two names. |
| **Subagents** | **SAFE.** Precedence project > user > plugin; same name → one wins. | **SAFE-ish.** Plugin agents are lowest priority; a synced/project agent of the same name wins. Duplicate only if names differ. |
| **MCP** | Possible double-registration if both scopes define the same server (not synced today, so low priority now). | Same. |

**So, concretely:**
- The **instructions duplicate** in the user-scope option (memory concatenation,
  no dedup) — this is the main hazard of Option A.
- The **skills duplicate** in the plugin option because plugin skills are
  namespaced and coexist with synced skills — this is the main hazard of Option B.
- Subagents are basically safe in both (precedence dedup).

## 7. How to support **both** modes and **block** double-loading

The good news: agconf is unusually well-positioned to be the referee, because it
already tracks, per managed file, `{prefix}_managed` + a content hash +
`{prefix}_source_path` (the canonical origin). That means it can detect overlap
**by canonical identity**, not by fragile name matching.

Proposed design:

1. **Make scope a first-class, declared choice.** Extend downstream
   `.agconf/config.yaml`:
   ```yaml
   install:
     scope: repo            # repo (today's default) | user
     via_plugin: [names]    # skills/agents/mcp delivered by these installed plugins
   ```
   plus `agconf sync --scope user` and a `~/.agconf/lockfile.json`.

2. **Single-scope invariant, enforced by agconf.** For a given developer + repo,
   each canonical object is "active" in exactly one scope. Enforcement points:
   - In **user mode**, `agconf sync` for a repo **omits the global block** from the
     repo `AGENTS.md` (writes only the repo-specific section) and skips skills/
     agents that the user-scope or a declared plugin already provides. No committed
     duplicate is ever produced → no concatenation clash.
   - When skills/agents come from a **plugin**, the repo commits a
     `.claude/settings.json` (`extraKnownMarketplaces` + `enabledPlugins`) **instead
     of** the content. Same plugin the user already has → no second copy, and
     namespacing is a non-issue because there's only one source.

3. **A cross-scope guard in `check` + the session hook.** A new
   `agconf doctor`/extended `check` (run by the SessionStart hook) detects, by
   `source_path`, any canonical object that is active in **two** scopes for the
   current repo and reports precisely:
   > "Skill `react-review` is installed at user scope *and* committed in this repo
   > — Claude will show it twice (`/react-review` and `/acme:react-review`). Remove
   > the repo copy (this repo is covered by your user install)? [y/N]"
   For instructions it can compare the **global-block content hash** it already
   embeds in the markers: same hash present in both `~/.claude/CLAUDE.md` and the
   repo file → warn/offer to strip one. This reuses existing hashing machinery.

4. **A `sync` warning the other direction:** if a user-scope install of the same
   canonical exists and you run a plain repo `sync`, warn before writing the
   redundant copies.

Net effect: the two modes coexist, the developer (or team) picks per repo, and
agconf actively prevents the specific double-loads §6 identifies — instructions
via the single-scope invariant + hash check, skills via "declare-don't-commit" +
the doctor overlap report.

## 8. Recommendation

**Don't pick one — split by content type, because the harnesses force it:**

- **Instructions + rules → per-user (Option A).** They can't be plugins, and
  they're the bulk of the identical, repeated content users are complaining about.
  Deliver via user scope (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`) with a
  SessionStart hook for freshness. Keep only the *repo-specific* section per repo.
- **Skills + agents + MCP → plugins (Option B).** Reuse `agconf compile`; have
  repos **declare** the plugin in a committed `.claude/settings.json` rather than
  committing content. Accept Codex's manual `upgrade` for now.
- **Keep per-repo committed mode as the default** for teams that want git-visible,
  CI-friendly, zero-per-user-setup config. This is a real advantage (clone → it's
  there), not just legacy.
- **Make agconf scope-aware and the anti-duplication referee** (§7). This is the
  piece that makes "allow both" safe rather than a double-loading footgun.

Rationale: user scope attacks the actual complaint (identical instructions in
every repo) with the one mechanism that can carry instructions; plugins handle the
types they're actually good at; and the referee logic reuses machinery agconf
already has (managed metadata, content hashes, markers, `check`).

If you want the smallest first step: ship `agconf sync --scope user` for the
**global block only**, plus a SessionStart hook that warns on staleness and on
repo-vs-user global-block overlap. That single move removes the largest chunk of
duplication and validates the hook/freshness model before the fuller build-out.

## 9. Things to verify before building (fast-moving surfaces)

- **Codex now has skills and subagents.** This repo's `AGENTS.md` still asserts
  "Codex does not have sub-agents" and treats Codex skills as AGENTS.md
  concatenation only. Per current Codex docs, Codex supports **real skills**
  (`.agents/skills`, `$HOME/.agents/skills`) and **subagents** (`.codex/agents/*.toml`,
  default-on). If accurate, agconf could deliver Codex skills/agents as first-class
  files (user or repo scope) instead of only concatenating — worth revisiting
  independent of this RFC.
- **Codex skills path** discrepancy: `.agents/skills` (current docs) vs legacy
  `~/.codex/skills`. Confirm on the target Codex version before writing there.
- **Codex plugin/marketplace on-disk paths** (`~/.agents/plugins/...`) are
  third-party-sourced — verify.
- **Codex `features.hooks`** flag: ✅ resolved — `hooks` is **stable and on by
  default** as of Codex v0.147.0 (`codex features list`); a user-scope
  `~/.codex/hooks.json` SessionStart hook fires and completes. Historic bug
  openai/codex#17532 (SessionStart not firing) does **not** affect current Codex.
- **Codex global `~/.codex/AGENTS.md`** has open bug reports about not being read
  in some clients — verify reliability.
- **Claude plugin auto-update** for third-party marketplaces is opt-in + delayed;
  don't design as if version-bump ⇒ instant propagation.

---

# Part II — Consolidated design (build spec)

Part I is the analysis. This part is the **spec we build to**. It settles the
mechanics discussed after the analysis and states the **invariants**, the
**coexistence rules** with today's behavior, and the **acceptance criteria** for
each feature.

## 10. The model in one picture

Three delivery **tiers**, one per "who owns it", mapped onto harness scopes:

- **Company** (canonical, everyone) → agconf-managed **marker block** at user
  scope (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`) **or** per-repo (today).
- **Personal** (this dev) → `USER.md`, agconf-scaffolded but never overwritten,
  imported (Claude `@USER.md`) or inlined (Codex).
- **Per-repo** (one project) → the repo's own committed config (unchanged).

Two orthogonal knobs decide where each content type lands:

- **`scope`** (`repo` | `user`) — where a developer's copy of company canonical lives.
- **`delivery`** (`sync` | `plugin` | `off`, per **plugin-capable** type: skills,
  agents, mcps) — how those are delivered. Instructions and rules have no plugin
  slot, so they are not in the delivery map; their home is chosen by `scope`.

Canonical content types and their reachable homes:

| Type | `sync` (repo) | `sync` (user) | `plugin` |
|---|---|---|---|
| instructions | ✅ | ✅ | ❌ (no plugin slot) |
| rules | ✅ | ✅ (verify Claude `~/.claude/rules`) | ❌ |
| skills | ✅ | ✅ | ✅ |
| agents | ✅ | ✅ | ✅ (Claude native; Codex down-converts) |
| mcps | ❌ (not synced) | ❌ (deliberately plugin-only) | ✅ |

That is the **content** axis. For the **feature/command** axis — which agconf
commands and mechanisms work in which mode — see [§16](#16--feature--mode-matrix).

## 11. Feature set

- **F1 — Distribution scopes.** `--scope repo|user` on `sync`/`check`/`init`; a
  git-tracked **user store** at `~/.agconf/` that projects into the harness home dirs.
- **F2 — Per-type delivery map.** `delivery.{instructions,rules,skills,agents,mcps}`
  = `sync|plugin|off`, with orphan-cleanup on `sync`→`plugin`/`off` transitions.
- **F3 — USER.md personal layer.** Separate, never-overwritten personal file,
  imported/inlined per harness.
- **F4 — Backups + git store.** Git history for managed content; timestamped
  backups for drifted/unmanaged files before overwrite.
- **F5 — Cross-scope dedup + freshness hook.** `agconf session-check`, installed
  as a SessionStart hook at user scope; **presence-based** duplication detection.
- **F6 — Plugin auto-bump.** `agconf compile --bump=auto`, post-merge, per-plugin
  patch increment on content change.
- **F7 — Propose from user scope.** `agconf propose --scope user`, so the
  per-user projection is a two-way channel like a synced repo, without exposing
  the developer's personal content.

## 12. Invariants (must always hold)

- **INV-1 — Single delivering scope.** For a given developer in a given repo,
  agconf itself never *writes* the same canonical object into more than one scope.
  (Overlap can still arise from things agconf didn't write — that's what F5 detects.)
- **INV-2 — agconf touches only its own regions.** At every scope, agconf writes
  only inside its marker block / managed files. Content outside the markers is
  never modified (same guarantee as repo scope today, via `merge.ts`).
- **INV-3 — USER.md is sacred.** Created once if absent; never overwritten, never
  deleted, never hashed for drift.
- **INV-4 — No destructive write without a backup.** Before overwriting a
  user-scope file that is unmanaged or shows manual drift, agconf snapshots it to
  `~/.agconf/backups/<timestamp>/`. Managed, unmodified files rely on the store's
  git history.
- **INV-5 — Delivery transitions clean up.** Moving a type `sync`→`plugin`/`off`
  orphan-removes previously-synced managed files of that type, using the *existing*
  safety gate (managed AND (unmodified OR previously tracked)); user-edited files
  are preserved.
- **INV-6 — Duplication is detected by identity/presence, never by content
  equality.** The trigger is "agconf-managed content of a type present in ≥2
  scopes", matched by origin (lockfiles + `{prefix}_managed` + installed-marketplace
  identity). Content hash is an *annotation* (identical vs divergent), never the gate.
- **INV-7 — Versions only increase.** Auto-bump only ever increments semver;
  it never reuses or lowers a version. Compile still stamps versions verbatim.
- **INV-8 — Compiled output stays a pure projection.** Auto-bump changes only
  version fields in `agconf.yaml` (+ the re-stamp); it injects no managed metadata.
- **INV-9 — Silent back-compat.** With no new config, behavior is byte-identical
  to today: `scope` defaults to `repo`, `delivery` defaults to `sync` for every type.

## 13. Coexistence with existing features

- **Default path unchanged.** `scope: repo` + all-`sync` delivery reproduces
  today's behavior exactly; existing sync/check/compile tests pass unmodified.
- **Lockfile.** Repo lockfile stays `.agconf/lockfile.json`; the user store adds
  `~/.agconf/lockfile.json` (same `LockfileSchema`). A `scope` discriminator is
  added to content tracking; readers default missing values to `repo`.
- **markers / managed-content / hashing reused verbatim** at user scope — no new
  hash functions (honors the "Content Hash Consistency" rule).
- **`check` stays context-aware.** Canonical-plugins check and downstream repo
  check are unchanged; a user-scope check is added, and cross-scope duplication is
  reported as a **warning** by `session-check` (not a hard `check` failure), so CI
  semantics don't change.
- **`compile` / `plugins.ts` untouched by default.** Auto-bump is an additive
  `--bump` mode (default off); `compile` and `compile --check` keep current
  semantics and determinism.
- **Overwrite guard + orphan cleanup reused** for user scope and delivery transitions.
- **completion.ts + docs** updated for every new command/flag (honors the "CLI
  Command Changes" and "Documentation Synchronization" rules).

## 14. Acceptance criteria

**F1 — Scopes** ✅ *implemented*
- `agconf sync --scope user` projects the company content into per-user harness
  locations, preserving surrounding content, and writes `~/.agconf/lockfile.json`:
  - **instructions** — the global block into `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`;
  - **skills** — `~/.claude/skills`, `~/.agents/skills`;
  - **subagents** — `~/.claude/agents/*.md`, `~/.codex/agents/*.toml`;
  - **rules** — `~/.claude/rules/` files, and a rules section in `~/.codex/AGENTS.md`.
  - Each per-user path is `<homeDir>/<repo-relative path>`, so skills/agents/rules
    reuse the repo-scope sync functions with `targetDir = homeDir`. Content dropped
    from canonical is orphan-cleaned at user scope (auto — the store is backed up).
    MCPs are **not** projected to user scope (plugin-only).
- `--scope repo` (default) is a byte-for-byte regression match to prior behavior.
- `agconf check --scope user` verifies user-scope managed integrity (block + skills
  + rules + agents) and exits 1 on drift.
- Wired on `sync` and `check`; `init --scope user` is deferred — first-time
  projection is already covered by `sync --scope user`.

**F2 — Delivery map** ✅ *implemented*
- Config accepts `delivery.{skills,agents,mcps}` ∈ `{sync,plugin,off}` (the
  plugin-capable types only), defaulting to `sync`; invalid values are a
  validation error. Instructions/rules are not in the map (governed by `--scope`).
- With `skills: plugin`, `sync` writes no skill files and records none in the lockfile.
- Flipping `skills: sync`→`plugin` and re-syncing removes the previously-synced
  managed skills (and no others); a user-edited skill is preserved and reported.
- `check` does not report "missing" for a type whose delivery is not `sync`.

**F3 — USER.md** ✅ *implemented*
- First user-scope sync scaffolds `~/.agconf/USER.md` if absent; a subsequent sync
  never modifies it.
- Claude gets a native `@~/.agconf/USER.md` import beneath the block; Codex gets a
  plain read-note (full inlining deferred — it would fold the personal file's
  contents into the hashed block and make `check` flag benign USER.md edits).

**F4 — Backups + git store** ✅ *implemented*
- `~/.agconf/` is initialized as a git repo; each user-scope sync produces a commit
  (best-effort — a missing/misconfigured git is non-fatal). A store `.gitignore`
  keeps machine-local artifacts (`backups/`, `logs/`, `autosync-state.json`) out of
  that history, so the committed diff is just the company block + lockfile.
- Overwriting a drifted/unmanaged user-scope file first creates a copy under
  `~/.agconf/backups/<timestamp>/`; backups rotate to the last 10. This covers both
  the instruction files and the projected content (a divergent unmanaged skill,
  rule, or agent is detected by the repo-scope overwrite guard and backed up before
  the projection replaces it).

**F5 — Dedup + freshness hook** ✅ *implemented*
- `agconf session-check` prints/injects a warning when agconf-managed content of a
  type is present in ≥2 scopes (repo lockfile vs `~/.agconf` lockfile), naming type
  + scopes, annotating instructions as identical vs divergent — **and still firing
  when the two copies differ** (identity, not equality).
- It also reports user-scope **integrity** drift (via `checkUserScope`). Output
  goes to stdout so a SessionStart hook injects it into context; exits 0 always
  (advisory) and never throws. Every note is printed under one header telling the
  agent to **relay** it to the developer at the start of its next reply (and not to
  act on it) — the agent is the only channel to the human, so context-only framing
  means the developer never hears about it.
- `--hook` (written into the installed hook command) emits the notes as the
  SessionStart wire envelope `{hookSpecificOutput:{hookEventName,additionalContext}}` —
  **always**, even with nothing to report (an empty `additionalContext`), because
  empty stdout is not valid hook output either. Codex validates hook stdout against
  its `session-start.command.output` schema and fails the hook on anything else;
  Claude Code accepts the same envelope. Without the flag the command prints text:
  human-framed on a TTY, relay-framed otherwise (so a hook installed before the flag
  keeps working). `--quiet` suppresses the notes entirely.
- Hook entries are keyed by `sessionStartHookState`: `current` (carries `--hook`),
  `stale` (an agconf session-check command without it — runs, but Codex discards its
  output), or `absent`. `--install-hook` rewrites only the exact command agconf
  wrote (`upgradeLegacyHookCommands`), reports a customized `stale` command for the
  developer to fix by hand, and never adds a second entry beside one — that would
  double every note. `stale` also counts as not-installed for `findMissingHookTargets`,
  so the advisory nudge reaches developers whose hook predates the flag.
- `agconf session-check --install-hook` installs an idempotent SessionStart hook
  for each target the user store was synced to — Claude Code in
  `~/.claude/settings.json`, Codex in `~/.codex/hooks.json` — preserving existing
  settings/hooks. Codex ships `hooks` enabled by default; if a user explicitly
  disabled it, the installer warns with the exact `codex features enable hooks` fix.
- **Hook-coverage self-heal.** The install target list is only snapshotted at
  install time (`resolveHookTargets`), so a store that later gains a target (e.g. a
  Claude-only install, then `sync --scope user --target claude,codex`) is left with
  no hook for the new target and nothing re-reconciles. The advisory path closes
  this: `findMissingHookTargets` compares the store's targets against the hooks
  actually present in the two config files and nudges the developer to re-run
  `--install-hook`. It's cheap (at most two small JSON reads), never throws, and
  treats an unreadable/malformed config as "installed" so it never nags about a file
  `--install-hook` itself would refuse to touch.
- **Deferred:** plugin-scope detection (needs reading harness plugin state, which is
  version-specific). repo↔user — the main double-load hazard — is covered. (The
  "behind-canonical" freshness gap is now closed by F5b below.)

**F5b — User-scope auto-sync** ✅ *implemented*
- Keeps the per-user store current automatically (`agconf autosync`). Freshness is
  driven **entirely by the SessionStart hook — no OS scheduler** (no cron/launchd/
  systemd). This matches the ecosystem norm: Claude Code, Codex, gh, and rustup all
  check on invocation/startup rather than installing a scheduler; the tools that do
  install one (`brew autoupdate`, `topgrade`) are those with no natural invocation
  point, which agconf has. Dropping the scheduler also removes a class of macOS cron
  failures (deprecated/TCC Full-Disk-Access, minimal PATH, no keychain/token).
- **Opt-in, off by default until installed:** background sync runs only after
  `agconf autosync --install` / `--enable`, which installs the hook and writes
  `~/.agconf/config.yaml` — its **presence is the install marker** (`isAutosyncInstalled`).
  So upgrading a user who only had the F5 duplication hook never silently starts
  syncs or git commits. `--uninstall` / `--disable` set `autosync.enabled: false`
  (the shared SessionStart hook stays, as it also powers the duplication check).
- The hook launches the runner **detached** (`maybeStartBackgroundAutosync`) so the
  session never blocks; runs are throttled via `~/.agconf/autosync-state.json`
  (`last_attempt`, window = `interval_minutes`, default 10).
- Cheap when current: resolves the latest version first and **skips the clone/write**
  when the store is at/ahead (`runUserScopeSync({skipIfUpToDate})`); a resolution
  failure is caught + logged (`throwOnResolveError`, not `process.exit`), a held
  store lock logs `result=locked`. Every run appends to `~/.agconf/logs/autosync.log`
  (rotated). Always best-effort/exit-0.
- **In-session freshness (the startup-staleness answer):** memory/instructions load
  at launch, so a refresh applies to the *next* session. To avoid silent staleness,
  the SessionStart hook runs a cheap, bounded **freshness probe** (`probeUserScopeFreshness`
  — a version lookup against the latest release, **no clone**); if the store is behind,
  it prints a note recommending the developer **restart the session** (or run `sync
  --scope user`) to load the update, while the detached background sync makes that
  restart current. It never attempts an in-time synchronous apply (that would block
  startup on the network and still not reliably reload already-read context). The
  probe is bounded (abortable, ~3s) and throttled (skipped when a sync ran within
  `interval_minutes`, so it isn't a network call on *every* session start). It is a
  deliberate no-op — `behind:false`, never a false nudge — for a **local** canonical
  source, a repo with **no releases**, or when **no GitHub token** is available
  (private canonical + no `gh`/`GITHUB_TOKEN`); those setups get background freshness
  but no restart nudge.
- Config-vs-state kept clean: intent in `config.yaml`, throttle in `autosync-state.json`,
  sync record in the lockfile.

**F6 — Auto-bump** ✅ *implemented*
- `agconf compile --bump` (=`auto`≡patch; or `patch`/`minor`/`major`) bumps each
  plugin whose **version-independent content fingerprint** changed vs the
  fingerprints recorded at the last bump — a committed sidecar
  `.agconf/plugins-state.json`, kept **outside** `output_dir` so `--check` never
  sees it — then writes the new version(s) into `agconf.yaml` (formatting
  preserved) and recompiles.
- The first `--bump` records a baseline without bumping; unchanged plugins keep
  their version; versions only ever increase (INV-7).
- Plain `agconf compile` and `compile --check` are unchanged and never read/write
  the sidecar (INV-8 — published plugins stay pure projections).

**F7 — Propose from user scope** ✅ *implemented*
- `agconf propose --scope user` proposes edits made to the per-user projection,
  reusing repo-scope detection at `targetDir = homeDir` (skills incl. Codex
  `~/.agents/skills`, skill assets, rules, Claude agents) and the same three-way
  rebase against the store lockfile's `source.commit_sha`.
- The **instructions block** is read from each target's per-user file
  (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`) rather than `<dir>/AGENTS.md`, via
  `CheckManagedFilesOptions.instructionsFiles`; repo scope keeps its single
  `AGENTS.md` default byte-for-byte.
- The block exists once per target, so identical edits **collapse to one
  proposal** (Claude preferred, the rest reported as dropped) and divergent edits
  **abort** with `DivergentInstructionsError` instead of silently shipping one.
  `--files` selects a specific copy.
- `--new` at user scope **requires a path**: `~/.claude` also holds the
  developer's personal skills/agents/rules, which must never be proposed
  wholesale (this also bounds `--yes`).
- The PR body reports the `~/.agconf` store as the origin, never the home
  directory's own git repo (the dotfiles case).
- `~/.agconf/USER.md` is unreachable from every discovery path, and the personal
  line sits outside the managed block, so the personal layer can never be
  proposed (INV-3 holds without extra guards).

## 15. Build order

1. **F2 delivery map** (self-contained; unlocks the plugin flow) → 2. **F6
auto-bump** (independent; supports F2's plugin flow) → 3. **F1+F3+F4 user scope**
(the large one) → 4. **F5 hook** (depends on F1/F2 existing). Each lands as its
own tested slice; `pnpm test`, `pnpm typecheck`, `pnpm check` green before moving on.

---

# Part III — Feature coverage per mode

§2/§10 answer *where each content type can live*. This part answers the other
question a user actually asks: **which agconf features work in which mode**. Every
cell below was verified against the code (the file/symbol is named in the note),
not inferred from the design docs.

## 16. Feature × mode matrix

Legend: **✅ supported** · **⚠️ partial** · **❌ not supported** (a gap — could
exist, doesn't yet) · **➖ not applicable** (the mode has no such concept).

| Feature | Repo scope (`sync`) | User scope (`sync --scope user`) | Plugin (`compile` + harness install) |
|---|---|---|---|
| **Project content** | ✅ `sync`/`init` write into the git root (`commands/sync.ts`) | ✅ `syncCommand` branches at the top to `syncUserScopeCommand` (`commands/user-scope.ts`) | ➖ agconf only *publishes*; the harness installs. `sync` skips any type set to `delivery: plugin` |
| **First-time setup (`init`)** | ✅ `initCommand` → `resolveTargetDirectory` (git root) | ❌ no `--scope` on `init`; `sync --scope user` performs the first projection instead (deliberate, §14 F1) | ➖ `canonical init` scaffolds the `plugins` block canonical-side |
| **Integrity check** | ✅ `checkDownstream` — per-file hashes + lockfile reconciliation | ✅ `checkUserScope` — block + skills/rules/agents, absolute paths, ghosts/missing | ⚠️ canonical-side only: `check`/`compile --check` run `verifyPluginsFresh` on the *committed artifacts*. Nothing verifies an **installed** plugin on a developer machine |
| **Pre-commit verdict (`check --hook`)** | ✅ branch-aware exit (`printHookVerdict`) | ❌ flag ignored — `checkCommand` returns inside the `--scope user` branch **before** the hook verdict, so `--hook --scope user` just exits 1 on any drift | ➖ |
| **Propose managed edits upstream** | ✅ `detectProposedChanges` + three-way rebase onto canonical HEAD | ✅ `propose --scope user` — same detection and rebase against the store lockfile; see [§17.1](#171-propose-at-user-scope) | ❌ published plugin files are a pure projection with **no managed metadata**, so a local edit is undetectable and has no hash to reconcile |
| **Propose new content (`--new`)** | ✅ `detectNewContent` scans the repo's managed dirs | ⚠️ supported but **requires an explicit path** — `~/.claude` also holds the developer's personal content, which must never be swept up (§17.1) | ❌ same reason as above |
| **Compile plugins (`compile`, `--check`, `--bump`)** | ➖ | ➖ | ✅ `core/plugins.ts`; runs in the **canonical** repo, not downstream |
| **Automatic freshness** | ⚠️ no local auto-sync — freshness comes from the generated CI PR bot, so it lands as a PR to merge, not a live update | ✅ `agconf autosync` (SessionStart-driven, throttled, opt-in) | ⚠️ harness-owned and uneven: Claude auto-update is **opt-in + delayed** for third-party marketplaces, Codex requires a manual `marketplace upgrade` (§5) |
| **Cross-scope duplication warning** | ✅ repo half of the pair (repo lockfile) | ✅ user half (`~/.agconf` lockfile) | ❌ plugin-scope detection deferred — needs version-specific harness state (§14 F5) |
| **Orphan cleanup** (content dropped from canonical) | ✅ prompt, or auto with `--yes` (`resolveOrphans`) | ✅ automatic, no prompt — every deletion is backed up first and the store is git-tracked | ✅ `compilePlugins` cleans its managed roots before writing; a `sync`→`plugin` delivery flip orphan-removes the previously synced repo copies |
| **Overwrite guard for your own files** | ✅ **aborts** the whole sync on a divergent unmanaged file (`UnmanagedOverwriteError`) unless `--override` | ✅ same detector (`detectUnmanagedCollisions` at `targetDir = homeDir`) but **backs up and proceeds** — user scope runs unattended (INV-4) | ➖ output tree is regenerated from canonical |
| **Adopt an identical unmanaged file** | ✅ reported in `SyncResult.adopted` | ✅ same guard | ➖ |
| **Pre-commit hook install** | ✅ `installPreCommitHook` (standalone or pre-commit framework) — called only from `performSync` | ❌ nothing to gate; there is no commit | ➖ |
| **Generated CI workflows** | ✅ `syncWorkflows` writes the sync + check workflows (GitHub sources only) | ❌ the store is machine-local; there is no CI to run | ✅ `canonical init` scaffolds `agconf-ci.yml`, which runs `agconf check` as the plugin-freshness gate |
| **Lockfile + version pinning** | ✅ `.agconf/lockfile.json` | ✅ `~/.agconf/lockfile.json` (same `LockfileSchema`, same `source.commit_sha`) | ❌ no lockfile. A plugin carries a semver in its manifest, and `--check` freshness is **decoupled** from that string — hence `--bump` (F6) |
| **Per-type delivery map (`delivery.*`)** | ✅ downstream `.agconf/config.yaml` | ❌ the user projection is unconditional (`syncUserScope` takes no delivery map); MCPs are simply never projected | ✅ this map is what *selects* plugin delivery |
| **`USER.md` personal layer** | ➖ | ✅ scaffolded once, never overwritten (INV-3) | ➖ |
| **History of the local copy** | the repo's own git history | ✅ the `~/.agconf` git store + rotated `backups/` | ➖ the harness owns the installed tree |
| **Instructions + rules delivery** | ✅ | ✅ | ❌ **no plugin slot in either harness** — the structural fact behind the whole split (§2) |
| **MCP servers** | ❌ never synced into a repo | ❌ deliberately not projected (plugin-only) | ✅ `core/mcp.ts` → `.mcp.json` in the compiled plugin |

`upgrade-cli`, `completion` and `config` are **scope-independent** — they manage
the CLI itself, not content, and are omitted from the table (`agconf config`
currently exposes no keys at all).

## 17. Known gaps

Distinguishing "not yet supported" from "deliberately not applicable" — the ❌
cells above that are **gaps**, in rough priority order:

1. **Installed-plugin verification.** `check` verifies the *committed* plugin
   artifacts in canonical. There is no equivalent of "is the plugin I have
   installed the one canonical publishes", and `session-check` cannot see plugin
   scope, so a plugin-delivered skill can silently duplicate a synced one.
2. **`check --hook` at user scope** is accepted but ignored. It should either be
   rejected as an invalid combination or made a no-op with a message; today it
   silently degrades to a plain check that exits 1 on any drift.
3. **`init --scope user`** does not exist. Low priority — `sync --scope user`
   already covers first-time projection — but the asymmetry with `sync`/`check`/
   `propose` is a discoverability wart.
4. **No delivery map at user scope.** You cannot say "skills come from a plugin,
   instructions from user scope" at the per-user level the way a repo can.

Deliberately **not applicable** (do not file these as gaps): instructions/rules
via plugin (no slot exists in either harness), CI workflows or a pre-commit hook
at user scope (no repo, no commit), MCP servers at repo or user scope
(plugin-only by design), and `compile` anywhere but a canonical repo.

### 17.1 `propose` at user scope

`agconf propose --scope user` sends edits made to the **per-user projection**
back to canonical, so a developer whose only copy of the company content lives in
`~/.claude`/`~/.codex` is not a read-only consumer. See §14 F7 for the acceptance
criteria; this section is the *why* behind the design.

**Most of it is the repo-scope path, unchanged.** Because every per-user path is
exactly `<homeDir>/<the repo-scope relative path>` — the same property that let
`user-scope.ts` reuse the repo-scope sync functions — pointing detection at
`targetDir = homeDir` already yields correct proposals for **skills, skill
assets, rules and Claude agents**. The canonical path mapping needs no special
case (the `^\.[^/]+\/skills\/` rewrite handles Codex's `.agents/skills/` too), and
the full three-way rebase works because the store lockfile records
`source.commit_sha` exactly like a repo lockfile. So the flag is a target-dir
switch plus four scope-aware pieces:

1. **The instructions block lives somewhere else.** `checkAgentsMd` reads
   `<targetDir>/AGENTS.md`; at user scope the block is in `~/.claude/CLAUDE.md`
   and `~/.codex/AGENTS.md`. Left unhandled, editing the block yields **zero**
   proposed changes while `check --scope user` reports it as modified — drift the
   developer is told about but cannot propose. `CheckManagedFilesOptions.instructionsFiles`
   now carries the file list (defaulting to `["AGENTS.md"]`, so repo scope is
   untouched), resolved per target from `TARGET_CONFIGS[*].userInstructionsFile`.
   The block parses identically in either home — same markers, same metadata — so
   nothing downstream of detection changes.
2. **One block, two harness files.** User scope projects the same company block
   into every target, so editing it surfaces once per file.
   `collapseInstructionFiles` keeps a single proposal: identical edits collapse to
   the Claude copy (the others are reported in `ProposeResult.dropped`), while
   edits that *differ* raise `DivergentInstructionsError` rather than silently
   shipping one and discarding the other. `--files` is applied first, so selecting
   one copy explicitly is the escape hatch.
3. **`--new` must not sweep personal content.** At repo scope `.claude/skills` is
   a project directory; at user scope it is the developer's own, mixing company
   content with private skills. So `--new` at user scope **requires a path** —
   a blanket scan is refused with an explanatory error, which also bounds what
   `--yes` can select.
4. **Provenance comes from the store, not `~`.** Running git in the home
   directory is wrong: usually it isn't a repo, and for a developer whose `~` is a
   **dotfiles repo** it would name that repo, its HEAD and its author as the origin
   of a company-standards proposal. User scope reads the `~/.agconf` store instead
   and the PR body says so (`**Scope:** user`, `**Store commit:** …`).

**`USER.md` is safe by construction** — no code guards it and none is needed. It
lives in `~/.agconf/`, which no discovery path scans, and the personal-layer line
sits *outside* the marked block, so `buildProposedChange` (which extracts only
`parsed.globalBlock`) cannot pick it up. Worth preserving both properties.