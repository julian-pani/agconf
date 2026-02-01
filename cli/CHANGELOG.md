## [2.1.1](https://github.com/julian-pani/agent-conf/compare/v2.1.0...v2.1.1) (2026-02-01)

### Bug Fixes

* **lockfile:** inject CLI version from package.json at build time ([9b308e0](https://github.com/julian-pani/agent-conf/commit/9b308e0fd96e0ef435980419a0be0b8c8488faa4))

## [2.1.0](https://github.com/julian-pani/agent-conf/compare/v2.0.4...v2.1.0) (2026-02-01)

### Features

* **markers:** wire custom marker prefix through entire sync pipeline ([3c7b76b](https://github.com/julian-pani/agent-conf/commit/3c7b76b06c0540427a4f54a4a0ca93cf71ed0e26))

## [2.0.4](https://github.com/julian-pani/agent-conf/compare/v2.0.3...v2.0.4) (2026-02-01)

### Bug Fixes

* **workflows:** ignore lockfile when detecting meaningful changes in sync workflow ([fa70eff](https://github.com/julian-pani/agent-conf/commit/fa70effe3ca2044ffe5cdfc492a771775e663e09))

## [2.0.3](https://github.com/julian-pani/agent-conf/compare/v2.0.2...v2.0.3) (2026-02-01)

### Bug Fixes

* **source:** use gh CLI for authenticated git clone in CI ([2404eac](https://github.com/julian-pani/agent-conf/commit/2404eacab568a27cea2ebf2742c9809174f78b0d))

## [2.0.2](https://github.com/julian-pani/agent-conf/compare/v2.0.1...v2.0.2) (2026-02-01)

### Bug Fixes

* **workflows:** use default github.token for downstream repo operations ([2f12f45](https://github.com/julian-pani/agent-conf/commit/2f12f4590125f1183bea7c1fc50621e464d0b9e2))

## [2.0.1](https://github.com/julian-pani/agent-conf/compare/v2.0.0...v2.0.1) (2026-02-01)

### Bug Fixes

* **tests:** handle global git config in getGitOrganization test ([9333213](https://github.com/julian-pani/agent-conf/commit/93332137b1753dc75213379bd0a26137e8978846))

## [2.0.0](https://github.com/julian-pani/agent-conf/compare/v1.0.2...v2.0.0) (2026-02-01)

### ⚠ BREAKING CHANGES

* **cli:** The `update` command has been removed. The `sync` command
now fetches the latest release by default (like `update` did).

- `sync` without flags now fetches latest and syncs (was: use lockfile version)
- `sync --pinned` uses lockfile version without fetching (old `sync` behavior)
- `sync --ref <version>` pins to specific version (unchanged)

Migration:
- `agent-conf update` → `agent-conf sync`
- `agent-conf sync` (old) → `agent-conf sync --pinned`

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>

### Bug Fixes

* **cli:** consolidate update command into sync ([7b156ec](https://github.com/julian-pani/agent-conf/commit/7b156ec2b80a4b536d0cb24ace915eb29bd2b597))

---
layout: default
title: Changelog
nav_order: 7
---

## [Unreleased]

### Changed

- **BREAKING**: Consolidated `update` command into `sync`. The `sync` command now fetches the latest release by default (like `update` did). Use `--pinned` to sync using the lockfile version without fetching.

### Removed

- `update` command (functionality merged into `sync`)

## [1.0.2](https://github.com/julian-pani/agent-conf/compare/v1.0.1...v1.0.2) (2026-02-01)

### Bug Fixes

* bump version ([41c3ccf](https://github.com/julian-pani/agent-conf/commit/41c3ccf34746ba358e676b577cba9be8f8bf65f7))

## [1.0.1](https://github.com/julian-pani/agent-conf/compare/v1.0.0...v1.0.1) (2026-02-01)

### Bug Fixes

* **cli:** use full GitHub URLs for documentation references ([5b623a5](https://github.com/julian-pani/agent-conf/commit/5b623a5993c45cf88becfd5989e0ac7b49ad7906))

## 1.0.0 (2026-02-01)

### Features

* agent-conf CLI, initial work, partial MVP ([bbb9472](https://github.com/julian-pani/agent-conf/commit/bbb9472f0f5fb1aa092fd63e91187adb3bb0d6b9))
* prepare CLI for npm publishing ([a151423](https://github.com/julian-pani/agent-conf/commit/a151423ff4c76e1a82dbcb2461bca5d341df3522))

### Bug Fixes

* **release:** fixing the release from github ([e5d4628](https://github.com/julian-pani/agent-conf/commit/e5d462836cb5cc615705b42c91b120105b8db789))

# Changelog

## 0.1.2

### Patch Changes

- Cleaned up history

## 0.1.1

### Patch Changes

- 0d90f29: Fix changeset publishing

## 0.1.0

### Minor Changes

- 46abea1: Initial release, MVP

### Patch Changes

- 46abea1: Improve npm readme

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **BREAKING**: Consolidated `update` command into `sync`. The `sync` command now fetches the latest release by default (like `update` did). Use `--pinned` to sync using the lockfile version without fetching.

### Removed

- `update` command (functionality merged into `sync`)

## [0.1.0] - 2025-01-30

### Added

- **Core Commands**

  - `agent-conf init` - Initialize a repository with standards from a canonical repository
  - `agent-conf sync` - Sync content from the canonical repository (fetches latest by default)
  - `agent-conf status` - Show current sync status
  - `agent-conf check` - Check if managed files have been modified

- **Repository Management**

  - `agent-conf init-canonical-repo` - Scaffold a new canonical repository structure
  - `agent-conf upgrade-cli` - Upgrade the CLI itself to the latest version
  - `agent-conf config` - Manage global CLI configuration

- **Architecture**

  - 3-repository model: CLI, Canonical, and Downstream repositories
  - Independent versioning of CLI and canonical content
  - Plugin system with providers (GitHub, Local) and targets (Claude, Codex)
  - Configurable marker prefixes for multi-org support

- **File Management**

  - AGENTS.md with managed global and repo-specific sections
  - Skills directory sync (`.claude/skills/`)
  - GitHub Actions workflows for auto-sync and integrity checks
  - Lockfile tracking (`.agent-conf/lockfile.json`)

- **Developer Experience**

  - Pre-commit hook integration for file integrity
  - Support for local canonical repositories (development mode)
  - Shell completion support via tabtab

- **CI/CD Integration**
  - Reusable GitHub Actions workflows
  - `agent-conf-sync.yml` for scheduled syncing
  - `agent-conf-check.yml` for PR validation

[Unreleased]: https://github.com/julian-pani/agent-conf/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/julian-pani/agent-conf/releases/tag/v0.1.0
