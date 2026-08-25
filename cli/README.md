# agconf

[![npm version](https://img.shields.io/npm/v/agconf.svg)](https://www.npmjs.com/package/agconf)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

CLI to sync AI agent configurations across repositories.

## Documentation

- [Canonical Repository Setup](./docs/CANONICAL_REPOSITORY_SETUP.md) - Setting up a source repository
- [Downstream Repository Configuration](./docs/DOWNSTREAM_REPOSITORY_CONFIGURATION.md) - Customizing sync behavior
- [Versioning](./docs/VERSIONING.md) - How version management works
- [File Integrity Checking](./docs/CHECK_FILE_INTEGRITY.md) - How integrity is enforced
- [Distribution Scopes](./docs/DISTRIBUTION_SCOPES.md) - Repo scope vs user scope vs plugins, plus the [feature × mode matrix](./docs/DISTRIBUTION_SCOPES.md#16-feature--mode-matrix)
- [Contributing](./CONTRIBUTING.md) - Contributing guidelines

Full documentation available on GitHub: https://github.com/julian-pani/agconf

## Commands

| Command | Description | Example |
|---------|-------------|---------|
| `init` | Initialize repo from a canonical source | `agconf init --source org/standards` |
| `sync` | Sync content from canonical repo (fetches latest by default) | `agconf sync` or `agconf sync --pinned` |
| `check` | Verify managed files are unchanged (`--scope user` checks the per-user projection; in a canonical repo, verifies compiled plugin freshness) | `agconf check` or `agconf check --scope user` |
| `compile` | Compile installable Claude Code / Codex plugins + marketplace from canonical content | `agconf compile` or `agconf compile --check` |
| `init --scope user` | Guided one-shot user-scope setup: sync + SessionStart hook + auto-sync | `agconf init --scope user` |
| `sync --scope user` | Project the company instructions once per machine into `~/.claude`/`~/.codex` (git-tracked `~/.agconf` store) | `agconf sync --scope user --source org/standards` |
| `autosync` | Keep the per-user store fresh automatically (runs at session start; opt-in) | `agconf autosync --install` |
| `session-check` | Advisory cross-scope duplication + integrity check (SessionStart hook) | `agconf session-check --install-hook` |
| `propose` | Propose local changes to managed content back to the canonical repo (opens a PR), rebased onto canonical HEAD | `agconf propose` |
| `propose --scope user` | Propose edits made to the per-user projection (`~/.claude`, `~/.codex`) instead of a repo | `agconf propose --scope user` |
| `propose --new [path]` | Propose new (unmanaged) skills/rules/agents upstream; optional path filters discovery (**required** at user scope) | `agconf propose --new .claude/skills/my-skill` |
| `propose --override` | Resolve conflicts with canonical by taking the local copy instead of aborting | `agconf propose --override` |
| `upgrade-cli` | Upgrade the CLI to latest version (auto-detects package manager) | `agconf upgrade-cli` |
| `canonical init` | Scaffold a new canonical repository | `agconf canonical init` |
| `config show` | Show current configuration | `agconf config show` |
| `completion install` | Install shell completions | `agconf completion install` |

For detailed command documentation, see the [Canonical Repository Setup](./docs/CANONICAL_REPOSITORY_SETUP.md) and [Versioning](./docs/VERSIONING.md) guides. Which commands apply to which delivery mode (repo scope / user scope / plugin) is tabulated in [Distribution Scopes §16](./docs/DISTRIBUTION_SCOPES.md#16-feature--mode-matrix).


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

Or set the standards up **once per machine** instead of per repo — this walks you
through the source, the harnesses to project into, and background refresh:

```bash
agconf init --scope user
```

## Local edits & overwrite protection

`sync` will not silently overwrite a local skill/rule/agent that it does not manage:

- If a local **unmanaged** file is byte-identical to canonical, sync **adopts** it (adds tracking metadata) — this is how a file you authored and proposed upstream becomes managed after the PR merges; no need to re-run `propose --new`.
- If a local **unmanaged** file **differs** from canonical, sync **stops with an error** and writes nothing, listing the conflicting paths. Resolve by sending your change upstream (`agconf propose`), renaming the file, or overwriting with `--override`.

> **`--override` discards local changes.** It both replaces `AGENTS.md` (instead of merging) and overwrites divergent unmanaged files with canonical. CI sync jobs typically pass `--override` because the working tree is committed (git-recoverable); run plain `sync` locally to keep uncommitted work safe. Managed files are always overwritten by sync (canonical owns them; `check` reports local drift).

## CLAUDE.md Handling

During sync, agconf consolidates any existing `CLAUDE.md` files into `AGENTS.md`, then creates/keeps a root `CLAUDE.md` containing an `@AGENTS.md` reference and removes any legacy `.claude/CLAUDE.md`. This ensures a single source of truth while maintaining compatibility with both Claude Code and Codex (both read `AGENTS.md`).

## Rules

Rules are modular, topic-specific project instructions synced from your canonical repository. For Claude Code, they're placed in `.claude/rules/` as separate files. For Codex, they're concatenated into AGENTS.md under a "Project Rules" section.

Rules support subdirectory nesting and can include `paths` frontmatter for conditional loading (Claude only).

**Configuration**: Add `rules_dir: "rules"` to your canonical `agconf.yaml`

For detailed information on rules setup, directory structure, and target-specific behavior, see the Rules section in [Canonical Repository Setup](./docs/CANONICAL_REPOSITORY_SETUP.md).

## Agents

Agents are sub-agents (markdown files with YAML frontmatter) synced from your canonical repository. They define specialized AI assistants that can be invoked for specific tasks.

**Target-specific behavior:**
- **Claude Code**: Agents are copied to `.claude/agents/*.md` as flat files with metadata for change tracking
- **Codex**: Agents are emitted as Codex subagents at `.codex/agents/*.toml` (`name`/`description`/`developer_instructions`), with managed metadata in leading TOML comments

**Configuration**: Add `agents_dir: "agents"` to your canonical `agconf.yaml`

Each agent file requires frontmatter with `name` and `description` fields:

```markdown
---
name: code-reviewer
description: Reviews code changes for quality and best practices
---

# Code Reviewer Agent

## Instructions
...
```

For detailed information on agents setup and file format, see the Agents section in [Canonical Repository Setup](./docs/CANONICAL_REPOSITORY_SETUP.md).

## Downstream Configuration

Downstream repositories can optionally customize sync behavior by creating `.agconf/config.yaml`. This allows you to control commit strategy (direct commits vs pull requests), commit messages, and PR reviewers.

**Example**: Set direct commits instead of creating PRs:
```yaml
workflow:
  commit_strategy: direct
  commit_message: "chore: sync engineering standards"
```

For complete configuration reference and available settings, see [Downstream Repository Configuration](./docs/DOWNSTREAM_REPOSITORY_CONFIGURATION.md).

## License

MIT
