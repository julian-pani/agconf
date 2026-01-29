---
name: git-conventions
description: High-level overview of git workflows and conventions. References detailed skills for commit messages (conventional-commits) and branch naming (git-branch-naming). Use this for quick guidance on git best practices, or as an entry point to dive into specific detailed skills when needed.
metadata:
---

# Git Conventions

This skill provides a high-level overview of git workflows and conventions. For detailed implementation guidance, reference the specific skills mentioned below.

## Purpose

Git conventions ensure consistent collaboration, clear project history, and seamless integration with automation tools. This skill serves as a quick reference and entry point to detailed git standards.

## When to Use This Skill

Use this skill when:
- You need a quick overview of git best practices
- You're unsure which detailed git skill to reference
- You're performing common git operations

**For detailed guidance**, reference the specific skills:
- **Commit messages**: Use `$conventional-commits` skill
- **Branch naming**: Use `$git-branch-naming` skill

## Quick Reference

### Commit Messages

Use **Conventional Commits** format: `<type>(<scope>): <description>`

**Common examples**:
```
feat(auth): add two-factor authentication
fix(api): handle rate limit errors
docs: update setup instructions
```

**For complete details**: Read the `$conventional-commits` skill.

### Branch Naming

Use **git flow** branching: `<type>/<description>`

**Common examples**:
```
feature/user-authentication
bugfix/fix-login-validation
hotfix/security-patch
release/1.5.0
```

**For complete details**: Read the `$git-branch-naming` skill.

## Common Workflows

### Feature Development
```bash
# Create branch (see $git-branch-naming for details)
git checkout -b feature/add-notifications

# Make commits (see $conventional-commits for details)
git commit -m "feat(notifications): add email system"

# Push and create PR
git push -u origin feature/add-notifications
```

### Bug Fix
```bash
git checkout -b bugfix/fix-session-timeout
git commit -m "fix(auth): resolve session timeout"
git push -u origin bugfix/fix-session-timeout
```

### Hotfix (Production)
```bash
git checkout -b hotfix/security-patch
git commit -m "fix(security): patch XSS vulnerability"
# Merge to both main and develop
```

## When to Reference Detailed Skills

### Use `$conventional-commits` when:
- Writing complex commit messages with body/footer
- Handling breaking changes
- Need examples of all commit types
- Reviewing commit message standards

### Use `$git-branch-naming` when:
- Need complete branch lifecycle workflows
- Setting up branching strategy
- Need detailed examples of all branch types
- Understanding git flow model

## Overriding Conventions

These are company-wide standards that apply to all repositories by default. Only follow different conventions if explicitly requested in repository-level instructions or project-specific documentation.

## Summary

**Quick checklist**:
1. Create branch: `<type>/<description>` (see `$git-branch-naming`)
2. Make commits: `<type>(<scope>): <description>` (see `$conventional-commits`)
3. Push and create PR with clear title and description

**For detailed guidance**: Reference `$conventional-commits` and `$git-branch-naming` skills.
