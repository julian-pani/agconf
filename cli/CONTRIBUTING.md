---
layout: default
title: Contributing
nav_order: 5
---

# Contributing to agconf

Thank you for your interest in contributing to agconf! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Code Style](#code-style)
- [Testing](#testing)
- [Commit Conventions](#commit-conventions)
- [Releases](#releases)
- [Pull Request Process](#pull-request-process)
- [Reporting Issues](#reporting-issues)

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork locally
3. Create a new branch for your contribution
4. Make your changes
5. Push to your fork and submit a pull request

## Development Setup

### Prerequisites

- Node.js 20 or higher
- pnpm (recommended) or npm
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/julian-pani/agconf.git
cd agconf/cli

# Install dependencies
pnpm install

# Build the project
pnpm build

# Run tests to verify setup
pnpm test
```

### Running Locally

```bash
# Run without building (uses tsx)
pnpm start -- <command>

# Example: run init command
pnpm start -- init --help

# Watch mode for development
pnpm dev
```

## Code Style

This project uses [Biome](https://biomejs.dev/) for linting and formatting. The configuration is in `biome.json`.

### Commands

```bash
# Check for issues (lint + format)
pnpm check

# Auto-fix issues
pnpm check:fix

# Lint only
pnpm lint

# Format only
pnpm format
```

### Key Style Guidelines

- Use TypeScript for all source files
- Use ES modules (`import`/`export`)
- Prefer `const` over `let`
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Keep functions small and focused

## Testing

We use [Vitest](https://vitest.dev/) for testing.

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage
```

### Writing Tests

- Place test files in `tests/` directory
- Use `.test.ts` extension for test files
- Group related tests with `describe` blocks
- Write descriptive test names
- Test both success and failure cases

### Check Command Integrity Requirement

**Critical:** When adding new content types to sync or modifying sync behavior, you MUST ensure the `check` command can verify the integrity of all synced content.

The `check` command (`agconf check`) verifies that managed files haven't been manually modified. This is essential for CI pipelines and maintaining sync integrity.

**Requirements:**

1. **Hash storage**: Every synced content type must store a content hash during sync
2. **Hash verification**: The `check` command must recompute and compare hashes
3. **Failure on modification**: Check must exit with code 1 if any content was modified
4. **Test coverage**: Write tests that verify:
   - Check passes immediately after sync (no false positives)
   - Check fails when content is manually modified (no false negatives)

**Example test pattern:**

```typescript
it("should pass check immediately after sync", async () => {
  // Sync content
  await syncCommand({ ... });

  // Check should pass - nothing was modified
  await checkCommand({});
  expect(mockExit).not.toHaveBeenCalled();
});

it("should detect modified content", async () => {
  // Create file with hash that won't match
  await fs.writeFile(path, contentWithWrongHash);

  // Check should fail
  await expect(checkCommand({})).rejects.toThrow();
  expect(mockExit).toHaveBeenCalledWith(1);
});
```

**Currently verified content types:**
- AGENTS.md global block (hash in `<!-- Content hash: ... -->` comment)
- AGENTS.md rules section for Codex (hash in rules section markers)
- Skill files (hash in `agconf_content_hash` frontmatter)
- Rule files for Claude (hash in `agconf_content_hash` frontmatter)
- Agent files for Claude (hash in `agconf_content_hash` frontmatter)

### Content Hash Consistency

**Critical:** All content hashes MUST use the same format to prevent check failures immediately after sync.

**Standard format:** `sha256:` prefix + 12 hex characters (e.g., `sha256:94ca9e76de02`)

**Reuse existing hash functions - DO NOT create new ones:**

```typescript
// For skill/rule file frontmatter metadata
import { computeContentHash } from "../core/managed-content.js";
const hash = computeContentHash(content, { metadataPrefix: "agconf" });

// For AGENTS.md global block
import { computeGlobalBlockHash } from "../core/markers.js";
const hash = computeGlobalBlockHash(content);

// For AGENTS.md rules section (Codex)
import { computeRulesSectionHash } from "../core/markers.js";
const hash = computeRulesSectionHash(content);
```

**Why this matters:** Previous bugs occurred when sync computed a hash with 16 chars but check expected 12 chars, causing check to always fail. By reusing the same functions, we guarantee consistency.

### Test Structure

```typescript
import { describe, it, expect } from 'vitest';

describe('featureName', () => {
  it('should do something specific', () => {
    // Arrange
    const input = 'test';

    // Act
    const result = someFunction(input);

    // Assert
    expect(result).toBe('expected');
  });
});
```

## Commit Conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages.

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that don't affect code meaning (formatting, etc.)
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `perf`: Performance improvement
- `test`: Adding or correcting tests
- `chore`: Changes to build process or auxiliary tools

### Examples

```
feat(init): add support for custom marker prefixes
fix(sync): handle empty skills directory gracefully
docs(readme): update installation instructions
test(check): add tests for modified file detection
```

## Releases

Releases are fully automated via [semantic-release](https://semantic-release.gitbook.io/) based on commit messages.

### Version Bumps

| Commit Type | Version Bump | Example |
|-------------|--------------|---------|
| `fix:` | Patch (0.0.x) | `0.1.0` → `0.1.1` |
| `feat:` | Minor (0.x.0) | `0.1.0` → `0.2.0` |
| `BREAKING CHANGE:` in footer | Major (x.0.0) | `0.2.0` → `1.0.0` |

### Major Release Protection

Major releases (breaking changes) are **blocked by default** to prevent accidental version bumps. When a commit with `BREAKING CHANGE:` is pushed, the release workflow will fail with:

```
❌ Major release blocked. Trigger workflow manually with allow_major=true to proceed.
```

### Releasing a Major Version

To release a major version:

1. Go to **Actions** → **Release** workflow
2. Click **Run workflow**
3. Check **"Allow major version release (breaking changes)"**
4. Click **Run workflow**

This ensures breaking changes are intentional and reviewed before release.

### What Triggers a Release

- Pushes to `master` branch automatically trigger the release workflow
- Only commits with `feat:`, `fix:`, or `BREAKING CHANGE:` create new releases
- Commits with `docs:`, `chore:`, `test:`, etc. do not trigger releases

## Pull Request Process

### Before Submitting

1. Ensure all tests pass: `pnpm test`
2. Ensure code passes linting: `pnpm check`
3. Ensure TypeScript compiles: `pnpm typecheck`
4. Update documentation if needed
5. Use [Conventional Commits](#commit-conventions) so semantic-release can determine version bumps automatically

### PR Guidelines

- Use a clear, descriptive title
- Reference any related issues
- Provide a summary of changes
- Include screenshots for UI changes
- Keep PRs focused and reasonably sized
- Respond to review feedback promptly

### Review Process

1. A maintainer will review your PR
2. Address any requested changes
3. Once approved, a maintainer will merge your PR
4. Your changes will be included in the next release

## Reporting Issues

### Bug Reports

When reporting bugs, please include:

- Node.js version (`node --version`)
- Operating system
- Steps to reproduce
- Expected behavior
- Actual behavior
- Error messages or logs

### Feature Requests

When requesting features, please include:

- Clear description of the feature
- Use case / motivation
- Proposed implementation (if any)
- Alternatives considered

## Questions?

If you have questions, feel free to:

- Open a [GitHub Discussion](https://github.com/julian-pani/agconf/discussions)
- Check existing issues and discussions

Thank you for contributing!
