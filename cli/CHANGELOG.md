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

## [0.1.0] - 2025-01-30

### Added

- **Core Commands**

  - `agent-conf init` - Initialize a repository with standards from a canonical repository
  - `agent-conf sync` - Re-sync content from the canonical repository
  - `agent-conf status` - Show current sync status
  - `agent-conf check` - Check if managed files have been modified
  - `agent-conf update` - Check for and apply updates from canonical repository

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
