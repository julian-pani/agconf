# AGENTS.md

This file provides guidance to coding agents - such as Claude Code, Codex, etc - when working with code in this repository.

## Project Overview

**agconf** is a CLI utility for managing and syncing AI agent configurations (AGENTS.md, skills, instructions) across repositories from a canonical source. It solves configuration drift for teams using AI coding agents like Claude Code.

## Repository Structure

This is a monorepo with the CLI package in `/cli`:
- Root: Git hooks setup (husky), workspace config
- `/cli`: The main npm package (published as `agconf`)

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
- `merge.ts` - AGENTS.md merge logic (preserves repo-specific content). Also handles CLAUDE.md consolidation: merges content from both root and .claude/ locations into AGENTS.md, then keeps only .claude/CLAUDE.md with @../AGENTS.md reference
- `source.ts` - Resolves canonical repos (git or local paths)
- `workflows.ts` - GitHub Actions workflow generation
- `hooks.ts` - Pre-commit hook installation
- `targets.ts` - Multi-agent target support
- `rules.ts` - Sync modular rule files from canonical to downstream repos

### Commands (`cli/src/commands/`)
Commands: init, sync, check, upgrade-cli, canonical (init, update), config, completion

### Configuration (`cli/src/config/`)
- Zod schemas for canonical config (`agconf.yaml`) and lockfile validation

## Key Patterns

- **File markers**: HTML comments (`<!-- agconf:global:start -->`) separate global vs repo-specific content
- **Lockfile pinning**: `.agconf/lockfile.json` tracks sync state and versions
- **Merge strategy**: Global content updates while preserving repo-specific sections in AGENTS.md
- **Target support**: Multi-agent targets (Claude Code, Codex) defined in `cli/src/core/targets.ts`; source resolution (GitHub repos, local paths) in `cli/src/core/source.ts`
- **Downstream config**: `.agconf/config.yaml` in downstream repos for user preferences (workflow settings)

### Downstream Config

Downstream repositories can optionally create `.agconf/config.yaml` to customize sync behavior:
- **Location**: `.agconf/config.yaml` (NOT the root `agconf.yaml` which is for canonical repos)
- **Schema**: `DownstreamConfigSchema` in `cli/src/config/schema.ts`
- **Loader**: `loadDownstreamConfig()` in `cli/src/config/loader.ts`

Key distinction:
- **Canonical config (`agconf.yaml`)**: Defines content structure, targets, markers - what to sync
- **Downstream config (`.agconf/config.yaml`)**: User preferences for how sync operates - workflow settings

The `workflow` key in downstream config controls:
- `commit_strategy`: "pr" (default) or "direct"
- `pr_branch_prefix`, `pr_title`: PR-specific settings
- `commit_message`: Custom commit message
- `reviewers`: Comma-separated GitHub usernames

### Rules Sync

Rules are modular, topic-specific instruction files (e.g., `security/api-auth.md`) synced from a canonical repository. The `rules.ts` module handles discovery, parsing, and target-specific sync.

**Key functions in `cli/src/core/rules.ts`:**
- `adjustHeadingLevels(content, increment)` - Shifts markdown heading levels (respects code blocks, caps at h6)
- `parseRule(content, relativePath)` - Parses frontmatter and body using custom YAML parser
- `generateRulesSection(rules, markerPrefix)` - Concatenates rules into a marked section for Codex
- `syncRules(sourceDir, targetDir, options)` - Main entry point for rules sync

**Target-specific behavior:**
- **Claude**: Copies rule files to `.claude/rules/` preserving directory structure. Adds metadata frontmatter (`agconf_managed`, `agconf_content_hash`, `agconf_source_path`) for change tracking and orphan detection.
- **Codex**: Concatenates all rules into AGENTS.md under `<!-- {prefix}:rules:start/end -->` markers. Heading levels shift +1 to nest under "# Project Rules". Includes source attribution comments (`<!-- Rule: path/to/rule.md -->`).

**Configuration:**
- `rules_dir` in canonical `agconf.yaml` (optional) - path to rules directory
- Rules tracked in lockfile under `content.rules` with file list and content hash

### Agents Sync

Agents are Claude Code sub-agents (markdown files with YAML frontmatter) synced from a canonical repository. The `agents.ts` module handles discovery, parsing, and metadata.

**Key functions in `cli/src/core/agents.ts`:**
- `parseAgent(content, relativePath)` - Parses frontmatter and body
- `validateAgentFrontmatter(content, path)` - Validates required fields (name, description)
- `addAgentMetadata(agent, prefix)` - Adds `{prefix}_managed` and `{prefix}_content_hash` metadata

**Target-specific behavior:**
- **Claude**: Copies agent files to `.claude/agents/` as flat files. Adds metadata frontmatter for change tracking.
- **Codex**: **Not supported.** Codex does not have sub-agents. When agents exist in canonical but only Codex target is configured, a warning is displayed and agents are skipped.

**Configuration:**
- `agents_dir` in canonical `agconf.yaml` (optional) - path to agents directory
- Agents tracked in lockfile under `content.agents` with file list and content hash

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

## Important Guidelines

### CLI Command Changes
When adding or modifying CLI commands, always update the shell completions in `cli/src/commands/completion.ts` accordingly. The completions provide tab-completion for commands, subcommands, and options.

### Testing Requirements
**No manual tests.** All tests must be runnable programmatically via `pnpm test`. When implementing new features:
- Write comprehensive unit and integration tests
- Avoid any verification steps that require manual execution
- Use temp directories and mocks for file system and external dependencies
- For commands that use `process.cwd()`, add a `cwd` option for testability

### Check Command Integrity Requirement
**Critical:** The `check` command must verify the integrity of ALL synced content.

**IMPORTANT: When modifying sync behavior, you MUST also update AND TEST the check command.**

When adding new content types to sync or modifying sync behavior:
1. Update `sync.ts` to sync the new content with proper metadata/hashes
2. Update `managed-content.ts` to add checking functions for the new content type
3. Update `check.ts` to handle the new content type in the check loop
4. **Write tests in `check.test.ts`** that verify:
   - Check passes immediately after sync (hash consistency)
   - Check detects unmodified managed files
   - Check fails (exit code 1) when managed content is modified
   - Non-managed files of the same type are ignored
   - Output shows proper file paths and labels

Each synced content type needs:
- A content hash stored during sync (in file metadata or markers)
- Hash verification during check using the same hash function
- Proper type handling in `ManagedFileCheckResult` and `ModifiedFileInfo`

**Current content types verified by check:**
- AGENTS.md global block (`<!-- agconf:global:start/end -->`)
- AGENTS.md rules section for Codex (`<!-- agconf:rules:start/end -->`)
- Individual skill files (`.claude/skills/*/SKILL.md`) via frontmatter metadata
- Individual rule files for Claude (`.claude/rules/**/*.md`) via frontmatter metadata
- Individual agent files for Claude (`.claude/agents/*.md`) via frontmatter metadata

### Content Hash Consistency
**Critical:** All content hashes MUST use the same format: `sha256:` prefix + 12 hex characters.

**Reuse existing hash functions - DO NOT create new ones:**
- `computeContentHash()` from `cli/src/core/managed-content.ts` - for skill/rule file frontmatter
- `computeGlobalBlockHash()` from `cli/src/core/markers.ts` - for AGENTS.md global block
- `computeRulesSectionHash()` from `cli/src/core/markers.ts` - for AGENTS.md rules section

All these functions return `sha256:${hash.slice(0, 12)}` format. When adding new content types, import and use these existing functions rather than computing hashes inline. This prevents hash length mismatches (e.g., 12 vs 16 chars) that cause check to fail immediately after sync.

### Parallel Worktrees
When working on multiple tasks in parallel, create git worktrees in the `.worktrees/` directory inside the workspace (this directory is gitignored). For example:
```bash
git worktree add .worktrees/feat-foo -b feat/foo
```
