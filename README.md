# agconf

[![npm version](https://img.shields.io/npm/v/agconf.svg)](https://www.npmjs.com/package/agconf)
[![CI](https://github.com/julian-pani/agconf/actions/workflows/ci.yml/badge.svg)](https://github.com/julian-pani/agconf/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

CLI utility to manage and sync AI agent configurations across repositories.

## Why agconf?

When you're using AI coding agents like Claude Code across multiple repositories, you quickly run into problems:

- **Configuration drift** — Each repo has slightly different AGENTS.md files, skills, and instructions
- **No single source of truth** — Updates to your engineering standards require manual changes across every repo
- **No version control for agent config** — You can't pin, audit, or roll back changes to your agent setup

**agconf solves this** by letting you maintain a canonical repository of standards and skills, then sync them to all your downstream repos with version pinning, integrity checks, and automated updates.

## How It Works

```
              ┌─────────────────────────────────┐
              │  your-org/engineering-standards │  ← Canonical repo
              │  ├── AGENTS.md                  │    (source of truth)
              │  ├── skills/                    │
              │  ├── rules/                     │
              │  └── agents/                    │
              └───────────────┬─────────────────┘
                              │
                              │ agconf sync
                    ┌─────────┴─────────┐
                    ▼                   ▼
┌─────────────────────────┐   ┌─────────────────────────┐
│  your-org/my-app        │   │  your-org/second-app    │
│  ├── AGENTS.md          │   │  ├── AGENTS.md          │  ← Downstream
│  ├── .claude/skills/    │   │  ├── .claude/skills/    │    repos
│  └── .agconf/       │   │  └── .agconf/       │
└─────────────────────────┘   └─────────────────────────┘
```

1. You maintain standards in one **canonical repository**
2. Run `agconf sync` in any downstream repo to pull the latest
3. Each repo gets pinned to a specific version with integrity checks

**Everything is managed in git.** No database. No infrastructure. Just repositories and a CLI.

## Installation

```bash
npm install -g agconf
```

### From source (SSH)

```bash
git clone --depth 1 git@github.com:your-org/agconf.git /tmp/agconf \
  && /tmp/agconf/cli/scripts/install_local.sh
```

To install a specific CLI version:

```bash
git clone --depth 1 --branch v1.2.0 git@github.com:your-org/agconf.git /tmp/agconf \
  && /tmp/agconf/cli/scripts/install_local.sh
```

### Using GitHub CLI

If you have `gh` CLI authenticated:

```bash
gh repo clone your-org/agconf /tmp/agconf -- --depth 1 \
  && /tmp/agconf/cli/scripts/install_local.sh
```

## Quick Start

### 1. Create a canonical repository

```bash
mkdir engineering-standards && cd engineering-standards
git init
agconf canonical init --name my-standards --org "My Org"
```

This scaffolds the structure for your standards. Edit `instructions/AGENTS.md` to add your engineering guidelines, then commit and push to GitHub.

### 2. Sync to your projects

```bash
cd your-project
agconf init --source your-org/engineering-standards
```

This will:
1. Fetch the latest release from your canonical repository
2. Create `AGENTS.md` with global engineering standards
3. Copy all skills to `.claude/skills/`
4. Copy all rules to `.claude/rules/` (if configured, Claude targets)
5. Copy all agents to `.claude/agents/` (if configured, Claude targets)
6. Create workflow files for CI integration
7. Pin everything to the release version

### 3. Set up automatic sync (optional)

GitHub Actions workflows are created automatically to keep downstream repos in sync. See [cli/docs/CANONICAL_REPOSITORY_SETUP.md](cli/docs/CANONICAL_REPOSITORY_SETUP.md) for detailed instructions on configuring automated updates.

## Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize repo from a canonical source |
| `init --scope user` | Guided one-shot setup of **user scope**: sync, session hook and auto-sync in one command ([details](#user-scope---scope-user)) |
| `sync` | Sync content from canonical repo (fetches latest by default) |
| `sync --scope user` | Project company standards **once per machine** into `~/.claude`/`~/.codex` instead of committing them per repo ([details](#user-scope---scope-user)) |
| `check` | Verify managed files are unchanged (`--scope user` verifies the per-user projection; in a canonical repo, verifies compiled plugin freshness) |
| `autosync` | Keep the per-user store fresh automatically (runs at session start; opt-in) |
| `session-check` | Advisory cross-scope duplication + integrity check, run at session start |
| `compile` | Compile installable Claude Code / Codex plugins + marketplace from canonical content (canonical repos) |
| `propose` | Propose local changes (or new skills/rules/agents via `--new`) back to canonical as a PR (`--scope user` proposes from the per-user projection) |
| `upgrade-cli` | Upgrade the CLI to latest version (auto-detects package manager, incl. volta/asdf/mise) |
| `canonical init` | Scaffold a new canonical repository |
| `config` | Manage global CLI configuration |

Not every command applies to every delivery mode. For the full picture of which
feature works in repo scope, user scope, and plugin delivery — and which
combinations are gaps rather than intentional omissions — see the
[feature × mode matrix](cli/docs/DISTRIBUTION_SCOPES.md#16-feature--mode-matrix).

### `agconf init`

Initialize a repository with standards from a canonical repository.

```bash
# Initialize from a canonical repository (required for first-time setup)
agconf init --source your-org/engineering-standards

# Use a specific version
agconf init --source your-org/engineering-standards --ref v1.2.0

# Use a branch (for testing)
agconf init --source your-org/engineering-standards --ref develop

# Use a local canonical repository (development mode)
agconf init --local /path/to/canonical-repo

# Set up user scope instead of a repository (see below)
agconf init --scope user --source your-org/engineering-standards
```

### `agconf sync`

Sync content from the canonical repository. By default, fetches the latest release and applies it.

```bash
# Sync to latest release (default)
agconf sync

# Use pinned version from lockfile (no network fetch)
agconf sync --pinned

# Sync to a specific version
agconf sync --ref v1.3.0

# Switch to a different canonical repository
agconf sync --source different-org/standards

# Use a local canonical repository (development mode)
agconf sync --local /path/to/canonical-repo

# Non-interactive mode
agconf sync --yes

# Write sync summary to file (markdown format, useful for CI)
agconf sync --summary-file sync-report.md

# Show all changed items in output (default shows first 5)
agconf sync --expand-changes

# Force canonical to win: replace AGENTS.md (instead of merging) AND overwrite
# divergent local unmanaged skills/rules/agents. Discards local changes.
agconf sync --override
```

By default `sync` will **not** silently overwrite a local skill/rule/agent it does not manage. If a local **unmanaged** file is identical to canonical it is **adopted** (gains tracking metadata); if it **differs**, sync stops with an error and writes nothing. Use `agconf propose` to send the change upstream, or `--override` to discard it. CI sync jobs typically pass `--override` (the working tree is committed, so overwrites are git-recoverable).

#### User scope (`--scope user`)

Instead of committing the company standards into every repo, project them **once per machine** into your per-user harness files:

```bash
# First time: guided setup — asks for the source, the harnesses to project
# into, and whether to keep it fresh automatically, then does the whole setup
# (sync + session hook + auto-sync) in one go.
agconf init --scope user

# Non-interactive equivalent (for dotfile bootstrap scripts):
agconf init --scope user --source your-org/standards --target claude codex --yes
# ...and add --no-autosync to skip enabling background auto-sync.

# Later: re-sync (source is remembered in ~/.agconf/lockfile.json)
agconf sync --scope user
```

`init --scope user` is the discoverable front door; `sync --scope user` is the
scriptable one and can also do the first sync on its own
(`agconf sync --scope user --source your-org/standards`, or `--local
/path/to/canonical`), leaving the hook and auto-sync for you to set up
separately. Both are idempotent, so re-running `init` is an update flow — it
remembers your source and targets, and it will not switch auto-sync back on if
you turned it off.

This projects the company standards into your per-user harness locations, preserving your own content: the **global instructions block** into `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`, plus **skills** (`~/.claude/skills`, `~/.agents/skills`), **subagents** (`~/.claude/agents`, `~/.codex/agents`), and **rules** (`~/.claude/rules`; a rules section in `~/.codex/AGENTS.md`). It's all tracked in a git store at `~/.agconf/` (run `git -C ~/.agconf log` to see diffs). Your personal instructions go in the never-overwritten `~/.agconf/USER.md` (Claude imports it automatically; on Codex it's referenced by a note). Any pre-existing file that would be overwritten is backed up under `~/.agconf/backups/` first. (MCP servers are delivered via plugins, not user scope.)

**Keep it fresh automatically.** `init --scope user` offers this during setup; `agconf autosync --install` turns it on at any time, so you don't have to sync by hand — it refreshes the store in the background at session start (throttled, and only when you're actually behind canonical), the same check-on-startup approach Claude Code and Codex use for their own updates. No cron or other background scheduler is installed. If a new version landed after your session started, agconf tells you to restart to pick it up. Auto-sync is opt-in (nothing runs until you `--install` it or accept it during `init --scope user`); once installed it's on by default (safe: git-tracked store + backups). Runs are logged to `~/.agconf/logs/autosync.log`.

```bash
agconf autosync --install     # install the SessionStart hook + enable auto-sync
agconf autosync               # run once now (throttled; --force to bypass)
agconf autosync --disable     # turn off (or --uninstall); --enable to turn back on
```

**Sending changes back.** Edits you make to the projected files can be proposed
to canonical with [`agconf propose --scope user`](#proposing-from-user-scope).

**What user scope doesn't do.** Generated CI workflows and the pre-commit hook
are repo-only (there's no repo and no commit to gate), and MCP servers are
delivered via plugins rather than user scope. See the
[feature × mode matrix](cli/docs/DISTRIBUTION_SCOPES.md#16-feature--mode-matrix)
and the [gap list](cli/docs/DISTRIBUTION_SCOPES.md#17-known-gaps).

### `agconf check`

Check if managed files have been modified.

```bash
agconf check                   # Show detailed check results
agconf check --quiet           # Exit code only (for scripts/CI)
agconf check --debug           # Show hash computation details
agconf check --scope user      # Verify the per-user ~/.claude, ~/.codex projection
```

Exit codes:
- `0` - All managed files unchanged (or not synced)
- `1` - One or more managed files have been modified

In a **canonical** repo (one with a `plugins` block in `agconf.yaml`), `check`
instead verifies that the committed plugin/marketplace artifacts are in sync
with the canonical source.

### `agconf session-check`

Advisory check for **cross-scope duplication** — meant to run automatically at the
start of every session. If you use user scope (`sync --scope user`) *and* a repo
you're working in also commits agconf-managed content, the same standards can load
twice; `session-check` warns you (and, for instructions, notes whether the two
copies are identical or divergent). Instructions are flagged whenever both scopes
carry the block; skills/rules/agents are flagged only for the specific objects
present in **both** scopes (a repo skill and a different user skill is not a
collision). The warning is framed as a note for you, not a task for the agent. It
always exits 0 and never disrupts a session.

It also nudges you to re-run `--install-hook` if your user store later gained a
target that never got its hook (e.g. you installed the hook while synced for Claude
only, then re-synced with `--target claude,codex`) — the hook is otherwise only
wired up for whatever targets existed when you last installed it.

```bash
# Install it as a SessionStart hook for the targets your user store was synced to
# (Claude → ~/.claude/settings.json, Codex → ~/.codex/hooks.json)
agconf session-check --install-hook

# Run it directly (what the hook runs)
agconf session-check
```

> On Codex the `hooks` feature is stable and enabled by default. If you've turned
> it off, `--install-hook` warns you to re-enable it with `codex features enable hooks`.

### `agconf compile`

Compile installable Claude Code / Codex plugins and a marketplace index from a
canonical repo's skills, agents, and MCP servers, so they can be installed
directly over git without `agconf sync`. Run inside a canonical repo.

```bash
agconf compile                 # (re)write plugin + marketplace artifacts
agconf compile --check         # verify committed artifacts match source (CI gate)
agconf compile --bump          # bump version of plugins whose content changed, then compile
agconf compile --bump=minor    # force a minor bump for changed plugins
agconf compile --target claude # compile a single target
agconf compile --out dist      # override the output directory
```

Install the result with `/plugin marketplace add <repo>` (Claude) or
`codex plugin marketplace add <repo>` (Codex). See
[cli/docs/PLUGINS.md](cli/docs/PLUGINS.md) for the full guide.

This command is used by the pre-commit hook and CI workflows to detect unauthorized modifications to agconf-managed files.

### `agconf propose`

Send local changes to managed content back to the canonical repository as a pull request — the reverse of `sync`.

```bash
# Propose edits you made to existing managed skills/rules/agents
agconf propose

# Propose NEW (unmanaged) content you authored locally
agconf propose --new

# Restrict discovery of new content to a path (a single match is auto-selected)
agconf propose --new .claude/skills/my-new-skill

# Preview without opening a PR
agconf propose --dry-run
```

Once a proposed item is merged into canonical, the next `agconf sync` adopts your local copy as managed automatically — no need to re-run `propose --new`.

#### Proposing from user scope

If your copy of the company content lives in `~/.claude` / `~/.codex` (see [user scope](#user-scope---scope-user)) rather than in a repo, propose from there:

```bash
# Edits you made to the projected skills, rules, agents, or the company block
agconf propose --scope user

# New content you authored — a path is required at user scope
agconf propose --scope user --new ~/.claude/skills/my-new-skill
```

It reads the `~/.agconf` store lockfile and behaves exactly like the repo flow, with three user-scope specifics:

- **`--new` requires a path.** `~/.claude` also holds your *personal* skills, agents and rules; agconf will not offer them to the company repo wholesale.
- **The company block exists once per harness** (`~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`). An identical edit in both is proposed once; if they've drifted apart, propose stops and asks you to reconcile (or pick one with `--files`).
- **Your personal layer is never proposed.** `~/.agconf/USER.md` and anything outside the managed block stay local.

#### Rebasing onto canonical

Your local copy was synced from a particular canonical commit, and canonical may
have moved since. Rather than overwriting whatever is upstream now, `propose`
reconciles every file against that sync-time base:

- **Canonical untouched** — your local copy is proposed as-is.
- **Both sides changed, different regions** — the two are merged and the merged
  result is proposed. The PR body and the file list mark it as merged onto
  canonical HEAD, since it is not what your working tree holds.
- **Both sides changed, overlapping** — the propose is aborted, listing the
  conflicting files. To resolve: commit or stash them, `agconf sync` to take
  canonical's version, then re-apply your edits and propose again. (Sync
  **overwrites** managed files — canonical owns them — so save your work first.)
- **Only canonical changed** — nothing is proposed for that file, and it's
  reported as already up to date. Without this, a stale local copy would silently
  revert the upstream change.

Three narrower cases also abort: canonical **deleted** the file after your sync,
canonical **added** a different file at the same path, and **binary** content
that changed on both sides (binary can't be merged textually).

Nothing is proposed piecemeal: if any file conflicts the whole propose stops, so
a PR never looks complete while quietly dropping part of your change. Pass
`--override` to resolve those conflicts by taking your local copy — note this
discards canonical's version *of the conflicting files only*; files that merge
cleanly are still merged, and files you never touched are still left alone.

#### When one canonical file has two local copies

A skill synced to several targets is written once per target —
`.claude/skills/X/…` for Claude and `.agents/skills/X/…` for Codex — but it has a
single home in canonical. Editing one copy is the normal case, and the copies are
collapsed into one proposal. Editing **both differently** has no correct answer,
so the propose stops and lists each copy alongside the canonical path they share.

`--override` does **not** resolve this one. It decides between your copy and
canonical's, and here both candidates are yours. Either make the copies match, or
select one with `--files` — and note `--files` narrows the *whole* propose, so
anything it excludes is left out of the PR too.

When the sync-time commit can't be resolved — a local canonical outside git, a
force-push, a sync from another ref — there is no base to merge against. In that
case propose falls back to the hash each managed file recorded at sync time: if
it proves canonical has moved, the propose aborts rather than guessing.

### `agconf upgrade-cli`

Upgrade the CLI itself to the latest version. The command automatically detects which package manager was used to install agconf (npm, pnpm, yarn, bun, or volta) and uses it for the upgrade.

```bash
# Upgrade to latest version (auto-detect package manager)
agconf upgrade-cli

# Non-interactive mode (skip confirmation)
agconf upgrade-cli --yes

# Explicit package manager override
agconf upgrade-cli --package-manager pnpm
agconf upgrade-cli -p yarn
agconf upgrade-cli -p volta
```

Detection covers `npm`, `pnpm`, `yarn`, `bun` and `volta`. When the binary is
shimmed by `asdf` or `mise`, the underlying package manager is used for the
install and the shims are rebuilt afterwards (`asdf reshim` / `mise reshim`),
after which every command that will run is listed before the confirmation
prompt.

### `agconf canonical init`

Scaffold a new canonical repository structure.

```bash
# Interactive mode
agconf canonical init

# With options
agconf canonical init --name acme-standards --org "ACME Corp"

# Non-interactive with all defaults
agconf canonical init -y

# Skip example skill
agconf canonical init --no-examples

# Skip plugin compilation scaffolding (plugins config, CI, initial compile)
agconf canonical init --no-plugins

# Custom marker prefix
agconf canonical init --marker-prefix my-org
```

This creates the standard canonical repository structure:

```
<target>/
├── agconf.yaml          # Repository configuration
├── instructions/
│   └── AGENTS.md            # Global engineering standards
├── skills/
│   └── example-skill/       # Example skill (optional)
│       ├── SKILL.md
│       └── references/
├── rules/                   # Modular rule files (optional)
│   └── code-style.md
├── agents/                  # Sub-agent definitions (optional)
│   └── reviewer.md
├── mcps/                    # MCP server definitions (optional, for plugins)
│   └── figma.json
├── plugins/                 # Compiled plugins (generated by `agconf compile`)
├── .claude-plugin/
│   └── marketplace.json     # Claude marketplace index (generated)
├── .agents/plugins/
│   └── marketplace.json     # Codex marketplace index (generated)
└── .github/
    └── workflows/
        ├── sync-reusable.yml
        ├── check-reusable.yml
        └── agconf-ci.yml        # Verifies compiled plugin freshness
```

Plugin compilation is scaffolded by default (pass `--no-plugins` to skip). See
[cli/docs/PLUGINS.md](cli/docs/PLUGINS.md).

### `agconf config`

Manage global CLI configuration.

```bash
agconf config                  # Show all config values
agconf config show             # Same as above
agconf config get cli-repo     # Get specific value
agconf config set cli-repo your-org/agconf  # Set value
```

**Available config keys:**
- `cli-repo` - The repository where the CLI is hosted (used by `upgrade-cli`)

## Versioning

agconf tracks **canonical content versions** independently from CLI versions:

| Component | Version Location | Updated By |
|-----------|------------------|------------|
| CLI | Installed binary | Reinstall from CLI repo |
| Canonical Content | `.agconf/lockfile.json` | `agconf sync` |
| Workflows | `.github/workflows/*.yml` | Automatically with canonical content |

**See [cli/docs/VERSIONING.md](cli/docs/VERSIONING.md) for detailed versioning documentation.**

### Version Strategies

| Strategy | Command | Use Case |
|----------|---------|----------|
| Pin to latest | `agconf init --source org/repo` | Initial setup |
| Update to latest | `agconf sync` | Routine updates |
| Re-sync pinned version | `agconf sync --pinned` | Restore modified files |
| Pin specific version | `agconf sync --ref v1.2.0` | Production stability |
| Development mode | `agconf init --local` | Testing changes |

## Files Created in Downstream Repos

When you run `agconf init` or `agconf sync` in a downstream repository:

| File | Purpose |
|------|---------|
| `AGENTS.md` | Global + repo-specific standards |
| `CLAUDE.md` (root) | Reference to AGENTS.md (`@AGENTS.md`) |
| `.claude/skills/` | Skill definitions |
| `.claude/rules/` | Modular, topic-specific instructions (Claude targets) |
| `.claude/agents/` | Sub-agent definitions (Claude targets) |
| `.agconf/lockfile.json` | Sync metadata |
| `.github/workflows/agconf-sync.yml` | Auto-sync workflow (calls canonical's `sync-reusable.yml`) |
| `.github/workflows/agconf-check.yml` | File integrity check (calls canonical's `check-reusable.yml`) |

## AGENTS.md Structure

The CLI manages `AGENTS.md` with marked sections:

```markdown
<!-- agconf:global:start -->
[... global standards - DO NOT EDIT ...]
<!-- agconf:global:end -->

<!-- agconf:repo:start -->
[... your repo-specific content ...]
<!-- agconf:repo:end -->
```

- **Global block**: Automatically updated on each sync
- **Repo block**: Your content, preserved across syncs

## Git Hook Integration

The CLI automatically installs a pre-commit hook that prevents committing changes to agconf-managed files.

### Pre-commit Hook

When you run `agconf init` or `agconf sync`, a pre-commit hook is installed at `.git/hooks/pre-commit`. This hook:

1. Checks if the repository has been synced with agconf
2. Runs `agconf check --quiet` to detect modified managed files
3. Blocks the commit if modifications are detected

**If the hook blocks your commit:**

```bash
# Option 1: Discard your changes to managed files
git checkout -- <file>

# Option 2: Skip the check (not recommended for managed files)
git commit --no-verify

# Option 3: Restore managed files to expected state
agconf sync
```

**Note:** The hook only runs if the `agconf` CLI is installed and the repository has been synced. It will not interfere if either condition is not met.

### Using the pre-commit framework

If your repository uses the [pre-commit framework](https://pre-commit.com) (a `.pre-commit-config.yaml` is present, or `.git/hooks/pre-commit` was generated by pre-commit), agconf does **not** write its own `.git/hooks/pre-commit` — appending to pre-commit's launcher would be unreachable. Instead, `agconf sync` registers a managed `agconf-check` hook in your `.pre-commit-config.yaml`:

```yaml
- repo: local
  hooks:
    - id: agconf-check
      name: agconf check
      entry: agconf check --hook
      language: system
      pass_filenames: false
      always_run: true
      verbose: true
```

The entry runs `agconf check --hook`, which keeps the same branch-aware behavior (block on `master`/`main`, warn on feature branches). The block is updated idempotently on each sync. If pre-commit isn't installed yet, run `pre-commit install`. To bypass the check for a single commit, use `SKIP=agconf-check git commit` (or `git commit --no-verify`).

**See [cli/docs/CHECK_FILE_INTEGRITY.md](cli/docs/CHECK_FILE_INTEGRITY.md) for detailed documentation on file integrity checking.**

## CI/CD Integration

The architecture uses GitHub's reusable workflows:

**Canonical repository** (created by `canonical init`):
- `sync-reusable.yml` - Reusable workflow for syncing
- `check-reusable.yml` - Reusable workflow for checking

**Downstream repositories** (created by `init` or `sync`):
- `agconf-sync.yml` - Scheduled sync (calls canonical's reusable workflow)
- `agconf-check.yml` - Checks for modified managed files on PRs

Both downstream workflows use the `agconf check` command to verify file integrity. Workflows reference the same version as your lockfile, ensuring consistency.

**For detailed setup instructions including GitHub App configuration for cross-repository access, see [cli/docs/CANONICAL_REPOSITORY_SETUP.md](cli/docs/CANONICAL_REPOSITORY_SETUP.md).**

### Prerequisites for Private Canonical Repositories

If your canonical repository is **private**, you must configure it to allow other repositories to use its reusable workflows.

**Configure the canonical repository:**

1. Go to your canonical repository on GitHub
2. Navigate to **Settings** → **Actions** → **General**
3. Scroll to the **"Access"** section
4. Change from "Not accessible" to:
   - **"Accessible from repositories in the 'OWNER' organization"** (for org repos), or
   - **"Accessible from repositories owned by the user 'OWNER'"** (for personal repos)

Without this setting, you'll see this error when workflows run:

```
error parsing called workflow: workflow was not found
```

**Why is this needed?**

GitHub validates the `uses:` reference for reusable workflows during workflow parsing, before any secrets are available. This validation uses GitHub's internal access controls, not your PAT token.

See: [GitHub Docs: Sharing actions and workflows from your private repository](https://docs.github.com/en/actions/creating-actions/sharing-actions-and-workflows-from-your-private-repository)

## FAQ

### Why not just hand-edit user instructions like `~/.claude/CLAUDE.md`?

Hand-editing that file works for personal preferences, but falls short for team/org standards:

1. **Not git tracked** — You can't review changes, audit history, or roll back mistakes
2. **Easy to override by mistake** — A stray edit or tool update can wipe your config
3. **No separation between user and company standards** — Personal preferences get mixed with org policies, making it hard to enforce consistency

agconf solves all three either way you deliver standards. Committed **repo scope** keeps them git-tracked and reviewable in each repo. And if you want them once-per-machine, **[user scope](#user-scope---scope-user)** (`sync --scope user`) is the *managed* way to write `~/.claude/CLAUDE.md`: the company block is version-controlled in the `~/.agconf` git store (1), overwrite-protected via backups + `check --scope user` (2), and kept strictly separate from your personal `~/.agconf/USER.md`, which agconf never touches (3). So you get the convenience of user-level instructions without the drift.

### Why not just use Claude Code plugins/extensions?

Plugins are great for adding capabilities, but don't solve the standards distribution problem:

1. **No support for injecting instructions** — Plugins can't modify CLAUDE.md, AGENTS.md, or rules that shape agent behavior
2. **No cross-tool support** — A Claude Code plugin doesn't help if you also use Codex, Goose, or other agents
3. **No tracking** — You can't see who uses which plugin, what version, or ensure everyone is up to date
4. **Hidden from view** — Plugin context is invisible; you can't see all the instructions the agent receives in one place

agconf makes all agent context explicit, version-controlled, and visible.

### Why not use a simple script?

You absolutely can start with a script — and you probably should! A simple `cp` or `rsync` script works fine initially.

But as you scale, you'll likely run into:
- Manual syncing whenever standards change
- No way to track what's installed or prevent accidental changes
- Team members forgetting to pull updates
- No version pinning or rollback capability
- Different scripts for different tools (Claude, Codex, etc.)
- No CI integration to catch drift

agconf is what you graduate to when the simple script becomes a maintenance burden.

## Development

```bash
cd cli
pnpm install          # Install dependencies
pnpm start -- init    # Run without build (tsx)
pnpm build            # Build for distribution
pnpm test             # Run tests
pnpm check            # Lint and format check
pnpm check:fix        # Auto-fix issues
```

## Requirements

- Node.js 20+
- Git
- pnpm (recommended) or npm

## License

MIT
