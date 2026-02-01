# AGENTS.md

This file provides guidance to coding agents - such as Claude Code, Codex, etc - when working with code in this repository.

## Project Overview

**agent-conf** is a CLI utility for managing and syncing AI agent configurations (AGENTS.md, skills, instructions) across repositories from a canonical source. It solves configuration drift for teams using AI coding agents like Claude Code.

## Repository Structure

This is a monorepo with the CLI package in `/cli`:
- Root: Git hooks setup (husky), workspace config
- `/cli`: The main npm package (published as `agent-conf`)

## Development Commands

All commands run from the `/cli` directory:

```bash
# Development
pnpm install              # Install dependencies
pnpm start -- <command>   # Run without building (e.g., pnpm start -- init --help)
pnpm dev                  # Watch mode

# Testing
pnpm test                 # Run tests
pnpm test:watch           # Watch mode
pnpm test:coverage        # With coverage

# Code Quality
pnpm check                # Lint + format check (Biome)
pnpm check:fix            # Auto-fix issues
pnpm typecheck            # TypeScript type check

# Build
pnpm build                # Build for distribution
pnpm install:global       # Build + install globally
```

## Architecture

### Core Modules (`cli/src/core/`)
- `sync.ts` - Main sync logic between canonical and downstream repos
- `lockfile.ts` - Version pinning and metadata tracking
- `markers.ts` - HTML comment markers for section separation in managed files
- `merge.ts` - AGENTS.md merge logic (preserves repo-specific content)
- `source.ts` - Resolves canonical repos (git or local paths)
- `workflows.ts` - GitHub Actions workflow generation
- `hooks.ts` - Pre-commit hook installation
- `targets.ts` - Multi-agent target support

### Plugin System (`cli/src/plugins/`)
- `targets/` - Agent implementations (Claude Code, GitHub Copilot)
- `providers/` - Content providers (GitHub API)

### Commands (`cli/src/commands/`)
10 commands: init, sync, status, check, update, upgrade-cli, init-canonical-repo, config, completion, shared

### Configuration (`cli/src/config/`)
- Zod schemas for canonical config (`agent-conf.yaml`) and lockfile validation

## Key Patterns

- **File markers**: HTML comments (`<!-- agent-conf:global:start -->`) separate global vs repo-specific content
- **Lockfile pinning**: `.agent-conf/lockfile.json` tracks sync state and versions
- **Merge strategy**: Global content updates while preserving repo-specific sections in AGENTS.md
- **Plugin architecture**: Targets and providers are extensible

## Commit Conventions

Uses Conventional Commits with commitlint enforcement:
```
<type>(<scope>): <description>
```
Types: feat, fix, docs, style, refactor, perf, test, chore

## CI/CD

- **ci.yml**: Lint, type check, test on Node 20/22
- **release.yml**: Semantic-release with automated npm publishing

### Release Behavior

- `fix:` commits → patch release (0.0.x)
- `feat:` commits → minor release (0.x.0)
- `BREAKING CHANGE:` → **blocked** (requires manual workflow trigger with `allow_major=true`)

Major releases are protected to prevent accidental breaking version bumps. See `cli/CONTRIBUTING.md` for full release docs.
