# Git Conventions Skill

A Claude Code skill that provides a high-level overview of git workflows and conventions, serving as an entry point to detailed git-related skills.

## Overview

This meta-skill provides quick reference for common git operations while directing agents to detailed skills when needed. It covers commit messages, branch naming, pull requests, and general git workflow best practices.

## What This Skill Provides

- **Quick reference**: High-level overview of git conventions
- **Workflow guidance**: Common git workflows for features, bugfixes, hotfixes, and releases
- **Best practices**: Dos and don'ts for commits, branches, and PRs
- **Navigation**: References to detailed skills for specific topics

## Modular Architecture

This skill uses a **modular approach** for maintainability and composability:

```
git-conventions (this skill)
├─ Overview of all git standards
├─ Quick reference for common operations
└─ References to detailed skills:
   ├─ conventional-commits (detailed commit message spec)
   └─ git-branch-naming (detailed branch naming and workflows)
```

### When to Use This Skill vs Detailed Skills

**Use `git-conventions`** for:
- Quick overview of git standards
- Simple, common git operations
- Understanding overall workflow
- Entry point when unsure which skill to use

**Use detailed skills** for:
- Complete specification and edge cases
- Complex scenarios requiring detailed guidance
- Setting up validation/automation
- Training and reference documentation

## When Agents Use This Skill

AI agents should invoke this skill when:
- Performing general git operations (commits, branches, PRs)
- Need quick guidance on git best practices
- Unsure which specific git skill to reference
- Want overview before diving into detailed skills

## Installation

This skill is installed as part of the company-wide engineering standards.

### Manual Installation

If you need to install this skill manually:

```bash
# Create symlink in your Claude config
ln -s /path/to/this/skill ~/.claude/skills/git-conventions
```

## Usage

Reference this skill in AGENTS.md or CLAUDE.md:

```markdown
### Git Conventions (RECOMMENDED)

**Policy**: All repositories SHOULD follow the `git-conventions` skill for git workflows.

**Agent instruction**: Read and follow the `$git-conventions` skill for overview of git standards. Reference detailed skills ($conventional-commits, $git-branch-naming) for specific guidance.
```

## Quick Examples

### Feature Development
```bash
# Branch naming (see $git-branch-naming for details)
git checkout -b feature/user-authentication

# Commits (see $conventional-commits for details)
git commit -m "feat(auth): add login endpoint"

# PR title
feat(auth): implement user authentication
```

### Bug Fix
```bash
git checkout -b bugfix/fix-session-timeout
git commit -m "fix(auth): resolve session timeout issue"
```

### Hotfix
```bash
git checkout -b hotfix/security-patch
git commit -m "fix(security): patch XSS vulnerability"
```

## Related Skills

- **`conventional-commits`** - Detailed commit message specification (types, scopes, body/footer)
- **`git-branch-naming`** - Detailed branch naming and git flow workflows
- (Future) Additional git-related skills will be referenced here

## Benefits of Modular Approach

1. **Focused skills**: Each skill handles one concern
2. **Maintainability**: Update one skill without affecting others
3. **Composability**: Combine skills for complex workflows
4. **Scalability**: Add new git skills without bloating existing ones
5. **Learning curve**: Start with overview, dive deeper as needed

## Integration Example

An agent working on a new feature would:

1. **Read `git-conventions`** - Understand overall workflow
2. **Create branch** - Use quick reference from `git-conventions`
3. **Make commits** - Reference `$conventional-commits` for detailed format
4. **Create PR** - Use PR guidelines from `git-conventions`

For complex scenarios (e.g., breaking changes, release workflows), the agent would dive into the detailed skills.

## Customization

These are company-wide standards. Only override if explicitly documented in repository-level instructions.

## Version

**Version**: 1.0
**Last Updated**: 2025-12-28
**Maintained By**: Platform Engineering Team
