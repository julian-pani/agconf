---
name: circleci-docker-tag-sanitization
description: Sanitize branch names in CircleCI configs for valid Docker tags. Use when working with CircleCI Docker builds that include branch names in image tags to prevent build failures from invalid tag characters.
license: Apache-2.0
metadata:
  author: platform-engineering
  version: 1.0
  tags: circleci, docker, ci-cd, devops
  policy: recommended
  scope: organization
---

# CircleCI Docker Tag Sanitization

Ensures branch names are sanitized before use in Docker image tags within CircleCI workflows.

## The Issue

Docker tags have strict requirements: lowercase alphanumeric, underscores, periods, and hyphens only. Branch names often violate these rules:

- `feature/add-auth` → contains `/` (invalid)
- `Feature-Branch` → contains uppercase (invalid)
- `bugfix/issue#123` → contains `#` (invalid)

When CircleCI builds Docker images using unsanitized branch names in tags, builds fail with:
```
invalid reference format
invalid tag format
```

## The Fix

**IMPORTANT**: Always apply the FULL sanitization pattern below. Do NOT just fix the specific invalid character you encountered (like just replacing slashes). Incomplete sanitization will cause failures with different branch names later.

Add comprehensive sanitization before using branch names in Docker tags:

```bash
# ALWAYS use FULL sanitization - not just for the character causing the current error
SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g' | sed 's/^[-.]*//' | sed 's/[-]*$//' | sed 's/-\{2,\}/-/g')
echo "Original branch: ${CIRCLE_BRANCH}, Sanitized: ${SANITIZED_BRANCH}"

# Use sanitized version in tags
VERSION_TAG="${APP_VERSION}.dev.${SANITIZED_BRANCH}-${CIRCLE_BUILD_NUM}"
docker build -t "${REGISTRY}/${IMAGE}:${VERSION_TAG}"
```

**Why FULL sanitization matters**:
- Fixing only `/` works today but breaks when someone uses `#`, `!`, `@`, etc.
- The complete pattern handles ALL invalid characters at once
- Prevents future surprises and repeated fixes

**Transformations:**
- `feature/add-auth` → `feature-add-auth`
- `Feature/Add-Auth` → `feature-add-auth`
- `bugfix/issue#123` → `bugfix-issue-123`
- `hotfix/URGENT!!` → `hotfix-urgent`

## How to Identify This Issue

### Symptoms
- CircleCI builds fail with "invalid reference format" or "invalid tag format"
- Builds succeed on `master`/`main` but fail on feature branches
- Error occurs during `docker build -t` or `docker push` steps

### Find Affected Configs
```bash
# Search for branch names used in Docker contexts
grep -n "CIRCLE_BRANCH" .circleci/config.yml
```

Look for `${CIRCLE_BRANCH}` used in:
- Docker tag variables: `TAG="${CIRCLE_BRANCH}-${BUILD_NUM}"`
- Docker build commands: `docker build -t "registry/app:${TAG}"`
- Version strings that become tags

## Implementation Steps

### 1. Locate the Docker Build Section

Find where Docker images are built in `.circleci/config.yml`:
- Look for `docker build -t` commands
- Check custom orb commands (under `orbs:` section)
- Find where `VERSION_TAG` or similar variables are defined

### 2. Add Sanitization Script

Place the sanitization **before** any Docker commands, typically right after version/tag variable initialization:

```yaml
- run:
    name: Build and push Docker image
    command: |
      # ... other setup (version extraction, registry login, etc.)

      # Add sanitization here
      SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g' | sed 's/^[-.]*//' | sed 's/[-]*$//' | sed 's/-\{2,\}/-/g')
      echo "Original branch: ${CIRCLE_BRANCH}, Sanitized: ${SANITIZED_BRANCH}"

      # Use SANITIZED_BRANCH in tags below
```

### 3. Replace Branch Variable in Tags

Replace `${CIRCLE_BRANCH}` with `${SANITIZED_BRANCH}` **only in Docker tag contexts**:

**Before:**
```bash
VERSION_TAG="${APP_VERSION}.dev.${CIRCLE_BRANCH}-${CIRCLE_BUILD_NUM}"
```

**After:**
```bash
VERSION_TAG="${APP_VERSION}.dev.${SANITIZED_BRANCH}-${CIRCLE_BUILD_NUM}"
```

### 4. Keep Original for Conditionals

**Important:** Use original `${CIRCLE_BRANCH}` for branch matching:

```bash
# Keep original branch for conditionals
if [[ "$CIRCLE_BRANCH" == "master" ]]; then
    VERSION_TAG="${APP_VERSION}.${CIRCLE_BUILD_NUM}"
else
    # Use sanitized branch for tags
    VERSION_TAG="${APP_VERSION}.dev.${SANITIZED_BRANCH}-${CIRCLE_BUILD_NUM}"
fi
```

### 5. Test

Create a test branch with special characters and verify the build succeeds:
```bash
git checkout -b "test/verify-fix"
git push
# Check CircleCI build passes and tags are valid
```

## Quick Example

**Before (fails on feature branches):**
```yaml
command: |
  VERSION_TAG="${APP_VERSION}.dev.${CIRCLE_BRANCH}-${CIRCLE_BUILD_NUM}"
  docker build -t "${REGISTRY}/${IMAGE}:${VERSION_TAG}"
  docker push "${REGISTRY}/${IMAGE}:${VERSION_TAG}"
```

**After (works with all branches):**
```yaml
command: |
  SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g' | sed 's/^[-.]*//' | sed 's/[-]*$//' | sed 's/-\{2,\}/-/g')
  echo "Original branch: ${CIRCLE_BRANCH}, Sanitized: ${SANITIZED_BRANCH}"

  VERSION_TAG="${APP_VERSION}.dev.${SANITIZED_BRANCH}-${CIRCLE_BUILD_NUM}"
  docker build -t "${REGISTRY}/${IMAGE}:${VERSION_TAG}"
  docker push "${REGISTRY}/${IMAGE}:${VERSION_TAG}"
```

## What the Sanitization Does

The script performs these transformations in order:
1. Convert to lowercase: `Feature` → `feature`
2. Replace invalid chars with hyphens: `/`, `#`, `!` → `-`
3. Remove leading hyphens/periods: `-feat` → `feat`
4. Remove trailing hyphens: `feat-` → `feat`
5. Collapse multiple hyphens: `feat--fix` → `feat-fix`

## Best Practices

1. **Use FULL sanitization always** - Apply the complete pattern, not just a partial fix for one character
2. **Sanitize once** - Define `SANITIZED_BRANCH` once at the top, reuse throughout
3. **Keep original for conditionals** - Use `$CIRCLE_BRANCH` for branch matching
4. **Always log** - Include the echo statement for debugging
5. **Apply consistently** - If you sanitize in one place, do it everywhere

## Common Pitfalls

❌ **Don't use partial sanitization:**
```bash
# BAD - Only fixes slashes, will break with other special chars
SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | sed 's/\//-/g')

# GOOD - Comprehensive sanitization
SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g' | sed 's/^[-.]*//' | sed 's/[-]*$//' | sed 's/-\{2,\}/-/g')
```

❌ **Don't replace in conditionals:**
```bash
if [[ "$SANITIZED_BRANCH" == "master" ]]; then  # Wrong! Won't match
```

❌ **Don't forget to replace all tag usages:**
```bash
TAG1="${SANITIZED_BRANCH}-latest"  # Good
TAG2="${CIRCLE_BRANCH}-${SHA}"     # Bad - inconsistent
```

✅ **Do sanitize early and use consistently:**
```bash
SANITIZED_BRANCH=$(...)
TAG1="${SANITIZED_BRANCH}-latest"
TAG2="${SANITIZED_BRANCH}-${SHA}"
```

## Detailed Resources

For complete examples, migration guides, and troubleshooting:
- **Real-world examples**: See [references/complete-examples.md](references/complete-examples.md)
- **Migration guide**: See [references/migration-guide.md](references/migration-guide.md)
- **Troubleshooting**: See [references/troubleshooting.md](references/troubleshooting.md)

## Summary

**Quick checklist:**
1. ✅ Find `${CIRCLE_BRANCH}` in Docker tag contexts
2. ✅ Add sanitization script before Docker commands
3. ✅ Replace `${CIRCLE_BRANCH}` with `${SANITIZED_BRANCH}` in tags only
4. ✅ Keep original `${CIRCLE_BRANCH}` for conditionals
5. ✅ Test with a feature branch containing special characters
