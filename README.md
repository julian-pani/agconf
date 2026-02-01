# agent-conf

[![npm version](https://img.shields.io/npm/v/agent-conf.svg)](https://www.npmjs.com/package/agent-conf)
[![CI](https://github.com/julian-pani/agent-conf/actions/workflows/ci.yml/badge.svg)](https://github.com/julian-pani/agent-conf/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

CLI utility to manage and sync AI agent configurations across repositories.

## Why agent-conf?

When you're using AI coding agents like Claude Code across multiple repositories, you quickly run into problems:

- **Configuration drift** — Each repo has slightly different AGENTS.md files, skills, and instructions
- **No single source of truth** — Updates to your engineering standards require manual changes across every repo
- **No version control for agent config** — You can't pin, audit, or roll back changes to your agent setup

**agent-conf solves this** by letting you maintain a canonical repository of standards and skills, then sync them to all your downstream repos with version pinning, integrity checks, and automated updates.

## How It Works

```
              ┌─────────────────────────────────┐
              │  your-org/engineering-standards │  ← Canonical repo
              │  ├── AGENTS.md                  │    (source of truth)
              │  └── skills/                    │
              └───────────────┬─────────────────┘
                              │
                              │ agent-conf sync
                    ┌─────────┴─────────┐
                    ▼                   ▼
┌─────────────────────────┐   ┌─────────────────────────┐
│  your-org/my-app        │   │  your-org/second-app    │
│  ├── AGENTS.md          │   │  ├── AGENTS.md          │  ← Downstream
│  ├── .claude/skills/    │   │  ├── .claude/skills/    │    repos
│  └── .agent-conf/       │   │  └── .agent-conf/       │
└─────────────────────────┘   └─────────────────────────┘
```

1. You maintain standards in one **canonical repository**
2. Run `agent-conf sync` in any downstream repo to pull the latest
3. Each repo gets pinned to a specific version with integrity checks

**Everything is managed in git.** No database. No infrastructure. Just repositories and a CLI.

## Installation

```bash
npm install -g agent-conf
```

### From source (SSH)

```bash
git clone --depth 1 git@github.com:your-org/agent-conf.git /tmp/agent-conf \
  && /tmp/agent-conf/cli/scripts/install_local.sh
```

To install a specific CLI version:

```bash
git clone --depth 1 --branch v1.2.0 git@github.com:your-org/agent-conf.git /tmp/agent-conf \
  && /tmp/agent-conf/cli/scripts/install_local.sh
```

### Using GitHub CLI

If you have `gh` CLI authenticated:

```bash
gh repo clone your-org/agent-conf /tmp/agent-conf -- --depth 1 \
  && /tmp/agent-conf/cli/scripts/install_local.sh
```

## Quick Start

### 1. Create a canonical repository

```bash
mkdir engineering-standards && cd engineering-standards
git init
agent-conf init-canonical-repo --name my-standards --org "My Org"
```

This scaffolds the structure for your standards. Edit `instructions/AGENTS.md` to add your engineering guidelines, then commit and push to GitHub.

### 2. Sync to your projects

```bash
cd your-project
agent-conf init --source your-org/engineering-standards
```

This will:
1. Fetch the latest release from your canonical repository
2. Create `AGENTS.md` with global engineering standards
3. Copy all skills to `.claude/skills/`
4. Create workflow files for CI integration
5. Pin everything to the release version

### 3. Set up automatic sync (optional)

GitHub Actions workflows are created automatically to keep downstream repos in sync. See [cli/docs/CANONICAL_REPOSITORY_SETUP.md](cli/docs/CANONICAL_REPOSITORY_SETUP.md) for detailed instructions on configuring automated updates.

## Commands

### `agent-conf init`

Initialize a repository with standards from a canonical repository.

```bash
# Initialize from a canonical repository (required for first-time setup)
agent-conf init --source your-org/engineering-standards

# Use a specific version
agent-conf init --source your-org/engineering-standards --ref v1.2.0

# Use a branch (for testing)
agent-conf init --source your-org/engineering-standards --ref develop

# Use a local canonical repository (development mode)
agent-conf init --local /path/to/canonical-repo
```

### `agent-conf sync`

Re-sync content from the canonical repository. Uses the source and version from the lockfile.

```bash
# Re-sync using pinned version (default)
agent-conf sync

# Update to a new version
agent-conf sync --ref v1.3.0

# Switch to a different canonical repository
agent-conf sync --source different-org/standards

# Use a local canonical repository (development mode)
agent-conf sync --local /path/to/canonical-repo
```

### `agent-conf status`

Show current sync status.

```bash
agent-conf status                  # Show status
agent-conf status --check          # Also check for modified files
```

### `agent-conf check`

Check if managed files have been modified.

```bash
agent-conf check                   # Show detailed check results
agent-conf check --quiet           # Exit code only (for scripts/CI)
```

Exit codes:
- `0` - All managed files unchanged (or not synced)
- `1` - One or more managed files have been modified

This command is used by the pre-commit hook and CI workflows to detect unauthorized modifications to agent-conf-managed files.

### `agent-conf update`

Check for and apply updates from the canonical repository.

```bash
agent-conf update                  # Check for updates and apply
agent-conf update --yes            # Non-interactive mode
```

The `update` command compares your pinned version against the latest release in the canonical repository. If a newer version is available, it syncs to that version.

### `agent-conf upgrade-cli`

Upgrade the CLI itself to the latest version.

```bash
# First time: specify the CLI repository
agent-conf upgrade-cli --repo your-org/agent-conf

# Subsequent times: uses saved config
agent-conf upgrade-cli

# Non-interactive mode
agent-conf upgrade-cli --yes
```

The CLI repository is saved to `~/.agent-conf/config.json` after the first use.

### `agent-conf init-canonical-repo`

Scaffold a new canonical repository structure.

```bash
# Interactive mode
agent-conf init-canonical-repo

# With options
agent-conf init-canonical-repo --name acme-standards --org "ACME Corp"

# Non-interactive with all defaults
agent-conf init-canonical-repo -y

# Skip example skill
agent-conf init-canonical-repo --no-examples

# Custom marker prefix
agent-conf init-canonical-repo --marker-prefix my-org
```

This creates the standard canonical repository structure:

```
<target>/
├── agent-conf.yaml          # Repository configuration
├── instructions/
│   └── AGENTS.md            # Global engineering standards
├── skills/
│   └── example-skill/       # Example skill (optional)
│       ├── SKILL.md
│       └── references/
└── .github/
    └── workflows/
        ├── sync-reusable.yml
        └── check-reusable.yml
```

### `agent-conf config`

Manage global CLI configuration.

```bash
agent-conf config                  # Show all config values
agent-conf config show             # Same as above
agent-conf config get cli-repo     # Get specific value
agent-conf config set cli-repo your-org/agent-conf  # Set value
```

**Available config keys:**
- `cli-repo` - The repository where the CLI is hosted (used by `upgrade-cli`)

## Versioning

agent-conf tracks **canonical content versions** independently from CLI versions:

| Component | Version Location | Updated By |
|-----------|------------------|------------|
| CLI | Installed binary | Reinstall from CLI repo |
| Canonical Content | `.agent-conf/lockfile.json` | `agent-conf sync --ref` or `agent-conf update` |
| Workflows | `.github/workflows/*.yml` | Automatically with canonical content |

**See [cli/docs/VERSIONING.md](cli/docs/VERSIONING.md) for detailed versioning documentation.**

### Version Strategies

| Strategy | Command | Use Case |
|----------|---------|----------|
| Pin to latest | `agent-conf init --source org/repo` | Initial setup |
| Update to latest | `agent-conf update` | Routine updates |
| Pin specific version | `agent-conf sync --ref v1.2.0` | Production stability |
| Development mode | `agent-conf init --local` | Testing changes |

## Files Created

| File | Purpose |
|------|---------|
| `AGENTS.md` | Global + repo-specific standards |
| `.claude/CLAUDE.md` | Reference to AGENTS.md |
| `.claude/skills/` | Skill definitions |
| `.agent-conf/lockfile.json` | Sync metadata |
| `.github/workflows/agent-conf-sync.yml` | Auto-sync workflow |
| `.github/workflows/agent-conf-check.yml` | File integrity check |

## AGENTS.md Structure

The CLI manages `AGENTS.md` with marked sections:

```markdown
<!-- agent-conf:global:start -->
[... global standards - DO NOT EDIT ...]
<!-- agent-conf:global:end -->

<!-- agent-conf:repo:start -->
[... your repo-specific content ...]
<!-- agent-conf:repo:end -->
```

- **Global block**: Automatically updated on each sync
- **Repo block**: Your content, preserved across syncs

## Git Hook Integration

The CLI automatically installs a pre-commit hook that prevents committing changes to agent-conf-managed files.

### Pre-commit Hook

When you run `agent-conf init` or `agent-conf sync`, a pre-commit hook is installed at `.git/hooks/pre-commit`. This hook:

1. Checks if the repository has been synced with agent-conf
2. Runs `agent-conf check --quiet` to detect modified managed files
3. Blocks the commit if modifications are detected

**If the hook blocks your commit:**

```bash
# Option 1: Discard your changes to managed files
git checkout -- <file>

# Option 2: Skip the check (not recommended for managed files)
git commit --no-verify

# Option 3: Restore managed files to expected state
agent-conf sync
```

**Note:** The hook only runs if the `agent-conf` CLI is installed and the repository has been synced. It will not interfere if either condition is not met.

**See [cli/docs/CHECK_FILE_INTEGRITY.md](cli/docs/CHECK_FILE_INTEGRITY.md) for detailed documentation on file integrity checking.**

## CI/CD Integration

The CLI creates GitHub Actions workflows that reference reusable workflows in your **canonical repository**:

- **agent-conf-sync.yml** - Scheduled sync (creates PRs for updates)
- **agent-conf-check.yml** - Checks for modified managed files on PRs

Both workflows use the `agent-conf check` command to verify file integrity. Workflows reference the same version as your lockfile, ensuring consistency.

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

### Why not just use user instructions like `~/.claude/CLAUDE.md`?

User-level instructions work for personal preferences, but fall short for team/org standards:

1. **Not git tracked** — You can't review changes, audit history, or roll back mistakes
2. **Easy to override by mistake** — A stray edit or tool update can wipe your config
3. **No separation between user and company standards** — Personal preferences get mixed with org policies, making it hard to enforce consistency

agent-conf keeps company standards in the repo (git tracked, reviewable) while letting users keep their personal config separate.

### Why not just use Claude Code plugins/extensions?

Plugins are great for adding capabilities, but don't solve the standards distribution problem:

1. **No support for injecting instructions** — Plugins can't modify CLAUDE.md, AGENTS.md, or rules that shape agent behavior
2. **No cross-tool support** — A Claude Code plugin doesn't help if you also use Codex, Goose, or other agents
3. **No tracking** — You can't see who uses which plugin, what version, or ensure everyone is up to date
4. **Hidden from view** — Plugin context is invisible; you can't see all the instructions the agent receives in one place

agent-conf makes all agent context explicit, version-controlled, and visible.

### Why not use a simple script?

You absolutely can start with a script — and you probably should! A simple `cp` or `rsync` script works fine initially.

But as you scale, you'll likely run into:
- Manual syncing whenever standards change
- No way to track what's installed or prevent accidental changes
- Team members forgetting to pull updates
- No version pinning or rollback capability
- Different scripts for different tools (Claude, Codex, etc.)
- No CI integration to catch drift

agent-conf is what you graduate to when the simple script becomes a maintenance burden.

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
