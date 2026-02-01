---
layout: default
title: Contributing
nav_order: 5
---

# Contributing to agent-conf

Thank you for your interest in contributing to agent-conf! This document provides guidelines and instructions for contributing.

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
git clone https://github.com/julian-pani/agent-conf.git
cd agent-conf/cli

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
5. Add a changeset if your change affects the public API

### Creating a Changeset

For changes that should be included in the changelog:

```bash
pnpm changeset
```

Follow the prompts to describe your changes. This creates a file in `.changeset/` that will be used to generate changelog entries.

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

- Open a [GitHub Discussion](https://github.com/julian-pani/agent-conf/discussions)
- Check existing issues and discussions

Thank you for contributing!
