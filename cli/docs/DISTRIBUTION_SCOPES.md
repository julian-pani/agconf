# Distribution Scopes — per-repo vs per-user vs plugin (analysis / RFC)

> Status: **analysis, not yet implemented.** This document evaluates moving agconf
> beyond its current "sync a copy into every repo" model, toward optionally
> managing canonical content **once per developer**. It covers both proposed
> mechanisms (a per-user "base directory" and plugins), how to support both, and
> — the hard part — how to stop a developer from getting the same instructions
> and skills loaded **twice** when a repo carries committed content *and* the dev
> also has it installed at the user level.

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

**Freshness** = a **SessionStart hook**. Both harnesses support it:
- Claude: a hook in `~/.claude/settings.json` fires for **every** project the dev
  opens and can run a command + inject stdout into context.
- Codex: `SessionStart` lifecycle hook (behind the `features.hooks` flag — verify).

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
- **Codex `features.hooks`** flag: confirm SessionStart hooks are available/on.
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
| mcps | (not synced today) | ✅ | ✅ |

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
  (best-effort — a missing/misconfigured git is non-fatal).
- Overwriting a drifted/unmanaged user-scope file first creates a copy under
  `~/.agconf/backups/<timestamp>/`; backups rotate to the last 10.

**F5 — Dedup + freshness hook** ✅ *implemented*
- `agconf session-check` prints/injects a warning when agconf-managed content of a
  type is present in ≥2 scopes (repo lockfile vs `~/.agconf` lockfile), naming type
  + scopes, annotating instructions as identical vs divergent — **and still firing
  when the two copies differ** (identity, not equality).
- It also reports user-scope **integrity** drift (via `checkUserScope`). Output
  goes to stdout so a SessionStart hook injects it into context; exits 0 always
  (advisory) and never throws.
- `agconf session-check --install-hook` installs an idempotent Claude Code
  SessionStart hook in `~/.claude/settings.json`, preserving existing settings/hooks.
- **Deferred:** plugin-scope detection (needs reading harness plugin state, which is
  version-specific) and network "behind-canonical" freshness (a session hook should
  stay fast/offline). Both noted as follow-ups; repo↔user — the main double-load
  hazard — is covered.

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

## 15. Build order

1. **F2 delivery map** (self-contained; unlocks the plugin flow) → 2. **F6
auto-bump** (independent; supports F2's plugin flow) → 3. **F1+F3+F4 user scope**
(the large one) → 4. **F5 hook** (depends on F1/F2 existing). Each lands as its
own tested slice; `pnpm test`, `pnpm typecheck`, `pnpm check` green before moving on.