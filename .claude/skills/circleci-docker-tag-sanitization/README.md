# CircleCI Docker Tag Sanitization

## Overview

Ensures branch names are properly sanitized before use in Docker image tags within CircleCI workflows, preventing build failures from invalid tag characters.

## Problem

Docker tags have strict naming requirements:
- Must be lowercase
- Can only contain: `a-z`, `0-9`, `.`, `_`, `-`
- Cannot start with `.` or `-`

Git branch names often violate these rules:
- `feature/add-auth` (contains `/`)
- `Feature-Branch` (contains uppercase)
- `bugfix/issue#123` (contains `#`)

When CircleCI builds Docker images using unsanitized branch names in tags, builds fail with errors like:
```
invalid reference format
invalid tag format
```

## Solution

This skill provides a standardized approach to sanitize branch names in CircleCI configs before using them in Docker tags.

**Transformation examples**:
- `feature/add-auth` → `feature-add-auth`
- `Feature/Add-Auth` → `feature-add-auth`
- `bugfix/issue#123` → `bugfix-issue-123`
- `hotfix/URGENT!!` → `hotfix-urgent`

## When to Use

Apply this skill when:
- Setting up CircleCI pipelines that build Docker images
- Branch names are included in Docker image tags (common for dev/staging)
- Debugging CircleCI build failures related to invalid Docker tags
- Migrating existing CircleCI configs to handle non-standard branch names

## Quick Example

**Before** (fails on branches with `/` or special chars):
```yaml
- run:
    command: |
      VERSION_TAG="${APP_VERSION}.dev.${CIRCLE_BRANCH}-${CIRCLE_BUILD_NUM}"
      docker build -t "registry/app:${VERSION_TAG}"
```

**After** (works with all branch names):
```yaml
- run:
    command: |
      # Sanitize branch name for Docker tags
      SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g' | sed 's/^[-.]*//' | sed 's/[-]*$//' | sed 's/-\{2,\}/-/g')
      echo "Original branch: ${CIRCLE_BRANCH}, Sanitized: ${SANITIZED_BRANCH}"

      VERSION_TAG="${APP_VERSION}.dev.${SANITIZED_BRANCH}-${CIRCLE_BUILD_NUM}"
      docker build -t "registry/app:${VERSION_TAG}"
```

## Implementation

See [SKILL.md](SKILL.md) for complete step-by-step implementation instructions.

**Key steps**:
1. Locate Docker build commands in `.circleci/config.yml`
2. Add sanitization logic before Docker operations
3. Replace `${CIRCLE_BRANCH}` with `${SANITIZED_BRANCH}` in tag contexts
4. Keep original `${CIRCLE_BRANCH}` for branch conditionals
5. Test with feature branches

## Benefits

- ✅ Prevents build failures from invalid Docker tags
- ✅ Supports any branch naming convention
- ✅ No changes needed to branch naming policies
- ✅ Works with existing CircleCI workflows
- ✅ Easy to debug with logging output
- ✅ One-time fix applies to all future branches

## Status

- **Policy**: Recommended for all repositories using CircleCI with Docker
- **Scope**: Organization-wide
- **Version**: 1.0

## Resources

- **Implementation Guide**: [SKILL.md](SKILL.md)
- **Examples**: [references/complete-examples.md](references/complete-examples.md)
- **Docker Tag Spec**: [Docker documentation](https://docs.docker.com/engine/reference/commandline/tag/)

## Support

Questions or issues? Contact #platform-engineering on Slack.
