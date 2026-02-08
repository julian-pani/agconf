# agconf

[![npm version](https://img.shields.io/npm/v/agconf.svg)](https://www.npmjs.com/package/agconf)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

CLI to sync AI agent configurations across repositories.

## Documentation

- [Canonical Repository Setup](./docs/CANONICAL_REPOSITORY_SETUP.md) - Setting up a source repository
- [Downstream Repository Configuration](./docs/DOWNSTREAM_REPOSITORY_CONFIGURATION.md) - Customizing sync behavior
- [Versioning](./docs/VERSIONING.md) - How version management works
- [File Integrity Checking](./docs/CHECK_FILE_INTEGRITY.md) - How integrity is enforced
- [Contributing](./CONTRIBUTING.md) - Contributing guidelines

Full documentation available on GitHub: https://github.com/julian-pani/agconf

## Commands

| Command | Description | Example |
|---------|-------------|---------|
| `init` | Initialize repo from a canonical source | `agconf init --source org/standards` |
| `sync` | Sync content from canonical repo (fetches latest by default) | `agconf sync` or `agconf sync --pinned` |
| `check` | Verify managed files are unchanged | `agconf check` |
| `upgrade-cli` | Upgrade the CLI to latest version from npm | `agconf upgrade-cli` |
| `canonical init` | Scaffold a new canonical repository | `agconf canonical init` |
| `canonical update` | Update CLI version in workflow files | `agconf canonical update` |
| `config show` | Show current configuration | `agconf config show` |
| `completion install` | Install shell completions | `agconf completion install` |

For detailed command documentation, see the [Canonical Repository Setup](./docs/CANONICAL_REPOSITORY_SETUP.md) and [Versioning](./docs/VERSIONING.md) guides.


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

## CLAUDE.md Handling

During sync, agconf consolidates any existing `CLAUDE.md` files into `AGENTS.md` and creates `.claude/CLAUDE.md` with a reference to it. This ensures a single source of truth while maintaining compatibility with both Claude Code and GitHub Copilot.

## Rules

Rules are modular, topic-specific project instructions synced from your canonical repository. For Claude Code, they're placed in `.claude/rules/` as separate files. For GitHub Copilot, they're concatenated into AGENTS.md under a "Project Rules" section.

Rules support subdirectory nesting and can include `paths` frontmatter for conditional loading (Claude only).

**Configuration**: Add `rules_dir: "rules"` to your canonical `agconf.yaml`

For detailed information on rules setup, directory structure, and target-specific behavior, see the Rules section in [Canonical Repository Setup](./docs/CANONICAL_REPOSITORY_SETUP.md).

## Agents

Agents are Claude Code sub-agents (markdown files with YAML frontmatter) synced from your canonical repository. They define specialized AI assistants that can be invoked for specific tasks.

**Target-specific behavior:**
- **Claude Code**: Agents are copied to `.claude/agents/` as flat files with metadata for change tracking
- **GitHub Copilot**: Not supported (Copilot does not have sub-agents)

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
