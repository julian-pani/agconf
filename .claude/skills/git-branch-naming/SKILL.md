---
name: git-branch-naming
description: This skill should be used when creating Git branches to ensure they follow git flow naming conventions. It provides guidance on branch naming patterns, types, and best practices for maintaining a clean and organized branch structure. Use when creating new branches or reviewing branch naming in repositories.
metadata:
---

# Git Branch Naming (Git Flow)

This skill provides guidance for naming Git branches following the git flow convention, a popular branching model that helps teams manage releases, features, and hotfixes.

## Purpose

Consistent branch naming conventions improve collaboration, make branch purposes immediately clear, and integrate well with automated tooling for CI/CD, release management, and project tracking.

## When to Use This Skill

Use this skill when:
- Creating new Git branches
- Reviewing branch names in pull requests
- Setting up repository branching strategies
- Establishing team conventions for branch management

## Branch Types

### Feature Branches

**Format:** `feature/<description>`

**Purpose:** New features and enhancements for upcoming releases

**Examples:**
```
feature/user-authentication
feature/add-payment-gateway
feature/dashboard-analytics
feature/JIRA-123-user-profile
```

**Guidelines:**
- Branch from: `develop` (or `main` if not using git flow)
- Merge back to: `develop`
- Used for: New functionality, enhancements, improvements

### Bugfix Branches

**Format:** `bugfix/<description>`

**Purpose:** Bug fixes that will be included in the next release

**Examples:**
```
bugfix/fix-login-validation
bugfix/correct-calculation-error
bugfix/resolve-memory-leak
bugfix/PROJ-456-null-pointer
```

**Guidelines:**
- Branch from: `develop` (or `main`)
- Merge back to: `develop`
- Used for: Non-critical bugs, issues found during development

### Hotfix Branches

**Format:** `hotfix/<description>` or `hotfix/<version>`

**Purpose:** Urgent fixes for production issues that can't wait for the next release

**Examples:**
```
hotfix/security-patch
hotfix/critical-data-loss
hotfix/payment-gateway-down
hotfix/1.2.1
```

**Guidelines:**
- Branch from: `main` or `master` (production branch)
- Merge back to: Both `main` and `develop`
- Used for: Critical production bugs, security vulnerabilities

### Release Branches

**Format:** `release/<version>`

**Purpose:** Prepare a new production release with final testing and version bumps

**Examples:**
```
release/1.2.0
release/2.0.0
release/1.5.0-beta
release/v3.0.0-rc1
```

**Guidelines:**
- Branch from: `develop`
- Merge back to: Both `main` and `develop`
- Used for: Release preparation, final bug fixes, version bumping
- Only bug fixes, documentation, and release-oriented tasks (no new features)

### Main Branches

**Format:** `main` or `master`, `develop`

**Purpose:** Long-lived branches for production code and integration

**Main/Master:**
- Always reflects production-ready state
- Protected branch (no direct commits)
- Accepts merges from: `release` and `hotfix` branches
- Tagged with version numbers

**Develop:**
- Integration branch for features
- Reflects latest delivered development changes
- Accepts merges from: `feature` and `bugfix` branches
- Source for `release` branches

## Naming Guidelines

### Format Rules

1. **Use lowercase** - All branch names should be lowercase
   ```
   ✅ feature/user-auth
   ❌ Feature/User-Auth
   ```

2. **Use hyphens for word separation** - No underscores or spaces
   ```
   ✅ feature/add-payment-method
   ❌ feature/add_payment_method
   ❌ feature/add payment method
   ```

3. **Use imperative mood** - Describe what the branch does, not what it did
   ```
   ✅ feature/add-user-dashboard
   ❌ feature/added-user-dashboard
   ❌ feature/adds-user-dashboard
   ```

4. **Keep descriptions concise** - Aim for 2-5 words that clearly convey purpose
   ```
   ✅ feature/oauth-integration
   ✅ bugfix/login-redirect-loop
   ❌ feature/this-branch-adds-a-new-feature-for-oauth
   ```

5. **Use only alphanumeric and hyphens** - Avoid special characters except forward slash
   ```
   ✅ feature/api-v2
   ❌ feature/api_v2.0
   ❌ feature/api@v2
   ```

### Including Ticket/Issue Numbers

When working with issue trackers, include the ticket number in the branch name:

**Format:** `<type>/<ticket>-<description>`

**Examples:**
```
feature/JIRA-123-user-authentication
bugfix/GH-456-fix-memory-leak
hotfix/PROJ-789-security-patch
feature/issue-42-add-search
```

**Benefits:**
- Easy to trace branches to requirements
- Automatic linking in project management tools
- Clear context for reviewers

### Description Best Practices

**Do:**
- ✅ Be specific and descriptive
- ✅ Focus on what the branch accomplishes
- ✅ Use domain language familiar to the team
- ✅ Keep it short but meaningful

**Don't:**
- ❌ Use vague descriptions ("updates", "fixes", "changes")
- ❌ Include your name or date
- ❌ Use abbreviations that aren't well-known
- ❌ Include version numbers (except for release branches)

**Good examples:**
```
feature/stripe-payment-integration
feature/add-dark-mode
bugfix/fix-csv-export-encoding
bugfix/resolve-race-condition
hotfix/patch-sql-injection
```

**Bad examples:**
```
feature/new-stuff
bugfix/fix
feature/johns-branch
feature/updates-2024
bugfix/temp-fix
```

## Complete Workflow Examples

### Feature Development

```bash
# Create feature branch from develop
git checkout develop
git pull origin develop
git checkout -b feature/add-user-notifications

# ... work on feature ...

# Merge back to develop via pull request
```

### Hotfix for Production

```bash
# Create hotfix branch from main
git checkout main
git pull origin main
git checkout -b hotfix/fix-payment-error

# ... fix the critical bug ...

# Merge to both main and develop
# Usually via pull requests
```

### Release Preparation

```bash
# Create release branch from develop
git checkout develop
git pull origin develop
git checkout -b release/1.5.0

# ... bump versions, update changelog, final testing ...

# Merge to main (for production) and develop (to keep changes)
```

## Branch Lifecycle

### Feature/Bugfix Branches
1. Create from `develop`
2. Regular commits during development
3. Pull request to `develop`
4. Delete after merge

### Hotfix Branches
1. Create from `main`
2. Fix applied and tested
3. Pull request to `main` (and `develop`)
4. Tag `main` with new version
5. Delete after merge

### Release Branches
1. Create from `develop` when ready for release
2. Only bug fixes and release prep
3. Pull request to `main` for production
4. Pull request to `develop` to merge back changes
5. Tag `main` with version number
6. Delete after merge

## Additional Branch Types

Some teams may use additional branch types for specific purposes:

**Common variations:**
- `chore/` - Maintenance tasks, dependency updates, tooling changes
- `docs/` - Documentation-only changes
- `test/` - Test-only changes
- `refactor/` - Code refactoring without behavior changes
- `perf/` - Performance improvements
- `ci/` - CI/CD configuration changes

These follow the same naming rules as feature branches but provide more specific categorization.

## Overriding Conventions

These are company-wide standards that apply to all repositories by default. Only follow different conventions if explicitly requested in repository-level instructions or project-specific documentation.

## Summary

**Branch naming formula:**
```
<type>/<description>
<type>/<ticket>-<description>
```

**Quick reference:**
- `feature/` - New features (from develop)
- `bugfix/` - Bug fixes for next release (from develop)
- `hotfix/` - Urgent production fixes (from main)
- `release/` - Release preparation (from develop)
- `main`/`master` - Production-ready code
- `develop` - Integration branch for features

**Key principles:**
- Lowercase with hyphens
- Imperative mood
- Clear and concise
- Include ticket numbers when applicable
- Apply company-wide standards unless repository explicitly overrides
