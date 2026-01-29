# Migration Guide

Guide for applying branch name sanitization to existing CircleCI configurations.

## For Existing Repositories

### Step 1: Audit Current Configuration

Find all CircleCI configs that need updating:

```bash
# Find all CircleCI configs in your repositories
find . -name "config.yml" -path "*/.circleci/*"

# Search for branch name usage in Docker contexts
grep -n "CIRCLE_BRANCH" .circleci/config.yml
```

### Step 2: Identify Docker-Related Usage

Look for `${CIRCLE_BRANCH}` in these contexts:
- ✅ Docker tag variables: `TAG="${CIRCLE_BRANCH}-${BUILD_NUM}"`
- ✅ Docker build commands: `docker build -t "registry/app:${TAG}"`
- ✅ Version strings that become tags: `VERSION_TAG="${APP_VERSION}.dev.${CIRCLE_BRANCH}"`
- ❌ Branch conditionals: `if [[ "$CIRCLE_BRANCH" == "master" ]]` (don't change these)
- ❌ Git operations: `git checkout $CIRCLE_BRANCH` (don't change these)
- ❌ Log messages: Can change but not required

### Step 3: Apply the Fix

Add sanitization before the first Docker command:

```yaml
- run:
    name: Build and push Docker image
    command: |
      # Existing setup code here...

      # Add this sanitization block
      SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g' | sed 's/^[-.]*//' | sed 's/[-]*$//' | sed 's/-\{2,\}/-/g')
      echo "Original branch: ${CIRCLE_BRANCH}, Sanitized: ${SANITIZED_BRANCH}"

      # Then update tag variables below to use SANITIZED_BRANCH
```

Replace all `${CIRCLE_BRANCH}` with `${SANITIZED_BRANCH}` in tag contexts.

### Step 4: Test Before Merging

**Critical:** Test on a feature branch before merging to master:

1. Create test branch with special characters:
   ```bash
   git checkout -b "test/verify-sanitization#123"
   ```

2. Push the CircleCI config changes:
   ```bash
   git add .circleci/config.yml
   git commit -m "fix: sanitize branch names for Docker tags"
   git push -u origin "test/verify-sanitization#123"
   ```

3. Verify in CircleCI:
   - Build succeeds
   - Check logs for sanitization output
   - Expected tag: `test-verify-sanitization-123`

4. Verify in Docker registry:
   - Tag exists with sanitized name
   - Tag is properly formatted

### Step 5: Deploy Gradually

For organizations with many repositories:

1. **Phase 1**: Apply to 1-2 test repositories
2. **Phase 2**: Apply to low-traffic repositories
3. **Phase 3**: Apply to high-traffic repositories
4. **Phase 4**: Make it part of your CircleCI config template

## For New Repositories

Include sanitization in your CircleCI config template from the start.

### Template for New Configs

```yaml
version: 2.1

jobs:
  build-and-push:
    docker:
      - image: cimg/base:stable
    steps:
      - checkout
      - setup_remote_docker
      - run:
          name: Build and push Docker image
          command: |
            # Standard sanitization (include this by default)
            SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g' | sed 's/^[-.]*//' | sed 's/[-]*$//' | sed 's/-\{2,\}/-/g')

            # Your build logic here using SANITIZED_BRANCH
            docker build -t "registry/app:${SANITIZED_BRANCH}-${CIRCLE_BUILD_NUM}" .
```

## Migration Patterns

### Pattern 1: Simple Tag Variable

**Before:**
```yaml
command: |
  TAG="${CIRCLE_BRANCH}-${CIRCLE_BUILD_NUM}"
  docker build -t "registry/app:${TAG}"
```

**After:**
```yaml
command: |
  SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g' | sed 's/^[-.]*//' | sed 's/[-]*$//' | sed 's/-\{2,\}/-/g')
  TAG="${SANITIZED_BRANCH}-${CIRCLE_BUILD_NUM}"
  docker build -t "registry/app:${TAG}"
```

### Pattern 2: Conditional with Master Branch

**Before:**
```yaml
command: |
  if [[ "$CIRCLE_BRANCH" == "master" ]]; then
    TAG="latest"
  else
    TAG="${CIRCLE_BRANCH}-snapshot"
  fi
  docker build -t "registry/app:${TAG}"
```

**After:**
```yaml
command: |
  SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g' | sed 's/^[-.]*//' | sed 's/[-]*$//' | sed 's/-\{2,\}/-/g')

  if [[ "$CIRCLE_BRANCH" == "master" ]]; then  # Keep original here
    TAG="latest"
  else
    TAG="${SANITIZED_BRANCH}-snapshot"  # Use sanitized here
  fi
  docker build -t "registry/app:${TAG}"
```

### Pattern 3: Multiple Tags

**Before:**
```yaml
command: |
  docker build \
    -t "registry/app:${CIRCLE_BRANCH}" \
    -t "registry/app:${CIRCLE_BRANCH}-${CIRCLE_SHA1:0:7}" \
    -t "registry/app:${CIRCLE_BRANCH}-latest" \
    .
```

**After:**
```yaml
command: |
  SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g' | sed 's/^[-.]*//' | sed 's/[-]*$//' | sed 's/-\{2,\}/-/g')

  docker build \
    -t "registry/app:${SANITIZED_BRANCH}" \
    -t "registry/app:${SANITIZED_BRANCH}-${CIRCLE_SHA1:0:7}" \
    -t "registry/app:${SANITIZED_BRANCH}-latest" \
    .
```

### Pattern 4: Custom Orb Command

**Before:**
```yaml
orbs:
  company-ci:
    commands:
      publish-docker:
        steps:
          - run:
              command: |
                VERSION_TAG="${APP_VERSION}.${CIRCLE_BRANCH}-${CIRCLE_BUILD_NUM}"
                docker build -t "${REGISTRY}/${IMAGE}:${VERSION_TAG}"
```

**After:**
```yaml
orbs:
  company-ci:
    commands:
      publish-docker:
        steps:
          - run:
              command: |
                SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g' | sed 's/^[-.]*//' | sed 's/[-]*$//' | sed 's/-\{2,\}/-/g')
                VERSION_TAG="${APP_VERSION}.${SANITIZED_BRANCH}-${CIRCLE_BUILD_NUM}"
                docker build -t "${REGISTRY}/${IMAGE}:${VERSION_TAG}"
```

## Batch Migration Script

For migrating multiple repositories at scale:

```bash
#!/bin/bash
# migrate-circleci-sanitization.sh

REPOS=(
  "repo1"
  "repo2"
  "repo3"
)

SANITIZATION_SNIPPET='SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '"'"'[:upper:]'"'"' '"'"'[:lower:]'"'"' | sed '"'"'s/[^a-z0-9._-]/-/g'"'"' | sed '"'"'s/^[-.]*//''"'"' | sed '"'"'s/[-]*$//''"'"' | sed '"'"'s/-\{2,\}/-/g'"'"')
echo "Original branch: ${CIRCLE_BRANCH}, Sanitized: ${SANITIZED_BRANCH}"'

for repo in "${REPOS[@]}"; do
  echo "Processing $repo..."

  cd "$repo" || continue

  # Create branch
  git checkout -b "fix/circleci-docker-tag-sanitization"

  # Manual review required - script can't safely modify all configs
  echo "Please manually update .circleci/config.yml for $repo"
  echo "Add this snippet before Docker commands:"
  echo "$SANITIZATION_SNIPPET"
  echo ""
  echo "Press enter when ready to continue to next repo..."
  read -r

  cd ..
done
```

**Note:** Automated migration is risky because CircleCI configs vary widely. Manual review is recommended.

## Validation Checklist

After migration, verify:

- [ ] Sanitization added before first Docker command
- [ ] All `${CIRCLE_BRANCH}` in tags replaced with `${SANITIZED_BRANCH}`
- [ ] Original `${CIRCLE_BRANCH}` kept in conditionals
- [ ] Debug echo statement included
- [ ] No duplicate sanitization blocks
- [ ] Config validated: `circleci config validate`
- [ ] Tested on feature branch with special characters
- [ ] Build succeeds in CircleCI
- [ ] Docker tags are properly formatted in registry
- [ ] No regression on master/main branch builds

## Rollback Plan

If issues occur after deployment:

1. **Quick revert:**
   ```bash
   git revert HEAD
   git push
   ```

2. **Identify issue:**
   - Check CircleCI build logs
   - Check Docker registry for malformed tags
   - Review sanitization logic

3. **Fix and redeploy:**
   - Adjust sanitization if needed
   - Test thoroughly
   - Redeploy

## Common Migration Issues

### Issue: Config becomes invalid YAML

**Cause:** Special characters in bash script break YAML parsing

**Fix:** Ensure proper quoting in the sed commands:
```yaml
command: |
  SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g')
```

### Issue: Sanitization applied to wrong variable

**Cause:** Multiple branch-like variables in config

**Fix:** Only sanitize `CIRCLE_BRANCH`, not other variables like `GIT_BRANCH` or custom variables

### Issue: Master builds start failing

**Cause:** Accidentally changed conditional logic

**Fix:** Revert conditionals to use original `${CIRCLE_BRANCH}`:
```bash
if [[ "$CIRCLE_BRANCH" == "master" ]]; then  # Must use original
```

## Best Practices for Migration

1. **Start small**: Migrate one repository first
2. **Test thoroughly**: Use feature branches with problematic names
3. **Document changes**: Add comments explaining the sanitization
4. **Update templates**: Make it standard for new projects
5. **Monitor**: Watch first few builds after migration
6. **Communicate**: Inform team about the change

## Timeline Recommendation

For a company with multiple repositories:

- **Week 1**: Migrate and test 1 pilot repository
- **Week 2**: Apply to 5-10 repositories, monitor
- **Week 3**: Apply to remaining repositories
- **Week 4**: Update templates and documentation

Adjust based on your organization's size and risk tolerance.
