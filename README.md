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
| `sync` | Sync content from canonical repo (fetches latest by default) |
| `check` | Verify managed files are unchanged |
| `upgrade-cli` | Upgrade the CLI to the latest version |
| `canonical init` | Scaffold a new canonical repository |
| `canonical update` | Update CLI version in workflow files |
| `config` | Manage global CLI configuration |

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
```

### `agconf check`

Check if managed files have been modified.

```bash
agconf check                   # Show detailed check results
agconf check --quiet           # Exit code only (for scripts/CI)
```

Exit codes:
- `0` - All managed files unchanged (or not synced)
- `1` - One or more managed files have been modified

This command is used by the pre-commit hook and CI workflows to detect unauthorized modifications to agconf-managed files.

### `agconf upgrade-cli`

Upgrade the CLI itself to the latest version from npm.

```bash
# Upgrade to latest version
agconf upgrade-cli

# Non-interactive mode (skip confirmation)
agconf upgrade-cli --yes
```

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

# Custom marker prefix
agconf canonical init --marker-prefix my-org

# Pin specific CLI version in workflows
agconf canonical init --cli-version 1.2.0
```

### `agconf canonical update`

Update CLI version in workflow files of a canonical repository.

```bash
# Update to current CLI version
agconf canonical update

# Update to specific version
agconf canonical update --cli-version 2.0.0

# Non-interactive mode
agconf canonical update -y
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
└── .github/
    └── workflows/
        ├── sync-reusable.yml
        └── check-reusable.yml
```

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
| `.claude/CLAUDE.md` | Reference to AGENTS.md |
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

### Why not just use user instructions like `~/.claude/CLAUDE.md`?

User-level instructions work for personal preferences, but fall short for team/org standards:

1. **Not git tracked** — You can't review changes, audit history, or roll back mistakes
2. **Easy to override by mistake** — A stray edit or tool update can wipe your config
3. **No separation between user and company standards** — Personal preferences get mixed with org policies, making it hard to enforce consistency

agconf keeps company standards in the repo (git tracked, reviewable) while letting users keep their personal config separate.

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
