# Git Branch Naming Skill

A Claude Code skill that provides git flow branch naming conventions for consistent and organized branch management.

## Overview

This skill teaches AI agents to follow git flow branch naming conventions when creating and reviewing Git branches. It ensures consistency across repositories and improves collaboration through clear, standardized branch names.

## What This Skill Provides

- **Branch type patterns**: `feature/`, `bugfix/`, `hotfix/`, `release/`
- **Naming guidelines**: Lowercase, hyphens, imperative mood, concise descriptions
- **Ticket integration**: How to include issue tracker references in branch names
- **Workflow examples**: Complete git flow workflows for different branch types
- **Best practices**: Dos and don'ts for branch naming

## When Agents Use This Skill

AI agents should invoke this skill when:
- Creating new Git branches
- Suggesting branch names to users
- Reviewing branch naming in pull requests
- Setting up repository branching strategies

## Installation

This skill is installed as part of the company-wide engineering standards.

### Manual Installation

If you need to install this skill manually:

```bash
# Create symlink in your Claude config
ln -s /path/to/this/skill ~/.claude/skills/git-branch-naming
```

## Usage

Reference this skill in AGENTS.md or CLAUDE.md:

```markdown
### Git Branch Naming (RECOMMENDED)

**Policy**: All repositories SHOULD follow the `git-branch-naming` skill for branch naming.

**Agent instruction**: Read and follow the `$git-branch-naming` skill for branch naming patterns and conventions.
```

## Examples

### Feature Branch
```bash
git checkout -b feature/user-authentication
git checkout -b feature/JIRA-123-add-payment-gateway
```

### Bugfix Branch
```bash
git checkout -b bugfix/fix-login-validation
git checkout -b bugfix/GH-456-memory-leak
```

### Hotfix Branch
```bash
git checkout -b hotfix/security-patch
git checkout -b hotfix/1.2.1
```

### Release Branch
```bash
git checkout -b release/1.5.0
git checkout -b release/2.0.0-beta
```

## Branch Types

| Type | Purpose | Branch From | Merge To |
|------|---------|-------------|----------|
| `feature/` | New features | `develop` | `develop` |
| `bugfix/` | Bug fixes | `develop` | `develop` |
| `hotfix/` | Urgent production fixes | `main` | `main` + `develop` |
| `release/` | Release preparation | `develop` | `main` + `develop` |

## Integration with Conventional Commits

This skill works well with the `conventional-commits` skill:

- Branch: `feature/user-authentication`
- Commits: `feat(auth): add login endpoint`, `feat(auth): add JWT tokens`
- PR Title: `feat(auth): implement user authentication`

## Related Skills

- `conventional-commits` - Standardized commit message format
- (Future) `git-conventions` - Comprehensive git workflow guide

## Customization

These are company-wide standards. Only override if explicitly documented in repository-level instructions.

## References

- [Git Flow](https://nvie.com/posts/a-successful-git-branching-model/) - Original git flow branching model
- [GitHub Flow](https://guides.github.com/introduction/flow/) - Simplified workflow (alternative)
- [GitLab Flow](https://about.gitlab.com/topics/version-control/what-is-gitlab-flow/) - GitLab's branching strategy

## Version

**Version**: 1.0
**Last Updated**: 2025-12-28
**Maintained By**: Platform Engineering Team
