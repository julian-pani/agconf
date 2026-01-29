# Troubleshooting Guide

Common issues when implementing branch name sanitization and how to fix them.

## Build Failures

### Issue: Build still fails with "invalid tag format"

**Symptoms:**
- Sanitization is in place
- Build still fails with Docker tag errors

**Diagnosis:**
```bash
# Check the CircleCI logs for the actual tag being used
# Look for the echo output: "Original branch: X, Sanitized: Y"
```

**Common causes:**

1. **Missed a tag variable:**
   ```yaml
   # You sanitized here
   TAG1="${SANITIZED_BRANCH}-latest"

   # But missed here
   TAG2="${CIRCLE_BRANCH}-${SHA}"  # Still using original!
   ```

   **Fix:** Replace all occurrences in tag contexts.

2. **Other variables contributing to tag:**
   ```bash
   # CIRCLE_PROJECT_REPONAME might also have invalid chars
   TAG="${CIRCLE_PROJECT_REPONAME}:${SANITIZED_BRANCH}"
   ```

   **Fix:** Sanitize other variables too if needed.

3. **Tag exceeds length limit (128 chars):**
   ```bash
   # Very long branch + version + SHA = too long
   TAG="${VERSION}.${SANITIZED_BRANCH}-${CIRCLE_BUILD_NUM}-${CIRCLE_SHA1}"
   ```

   **Fix:** Truncate the sanitized branch:
   ```bash
   SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g' | sed 's/^[-.]*//' | sed 's/[-]*$//' | sed 's/-\{2,\}/-/g' | cut -c 1-64)
   ```

### Issue: Build fails with YAML parsing error

**Symptoms:**
```
Error: Invalid config.yml
```

**Cause:** Special characters in the bash script broke YAML parsing

**Diagnosis:**
```bash
# Validate the config locally
circleci config validate
```

**Fix:** Ensure proper quoting in heredoc or multiline strings:
```yaml
# Good - proper YAML multiline string
command: |
  SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]')

# Bad - might break depending on content
command: SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]')
```

### Issue: Conditional branches not working

**Symptoms:**
- Master/main builds aren't getting "latest" tag
- Wrong tag strategy applied

**Cause:** Using sanitized branch in conditional

**Bad:**
```bash
if [[ "$SANITIZED_BRANCH" == "master" ]]; then  # Won't match!
```

**Good:**
```bash
if [[ "$CIRCLE_BRANCH" == "master" ]]; then  # Use original
```

## Tag Issues

### Issue: Tags are identical for different branches

**Symptoms:**
- `feature/add-auth` and `FEATURE/ADD-AUTH` produce same tag
- Newer build overwrites older build in registry

**Cause:** Both sanitize to `feature-add-auth`

**Solutions:**

1. **Include build number:**
   ```bash
   TAG="${SANITIZED_BRANCH}-${CIRCLE_BUILD_NUM}"
   # feature-add-auth-123 vs feature-add-auth-124
   ```

2. **Include commit SHA:**
   ```bash
   TAG="${SANITIZED_BRANCH}-${CIRCLE_SHA1:0:7}"
   # feature-add-auth-a1b2c3d vs feature-add-auth-e4f5g6h
   ```

3. **Include timestamp:**
   ```bash
   TAG="${SANITIZED_BRANCH}-$(date +%Y%m%d-%H%M%S)"
   ```

### Issue: Sanitization removes too much

**Symptoms:**
- Branch `feature/api_v2` becomes `feature-api-v2` but you wanted to keep the underscore

**Cause:** Regex is too aggressive

**Fix:** Adjust the character class if needed:
```bash
# Current: keeps a-z 0-9 . _ -
sed 's/[^a-z0-9._-]/-/g'

# If you need to keep something else, add to the character class
# Example: keep colons (some registries allow this)
sed 's/[^a-z0-9._:-]/-/g'
```

**Warning:** Check your Docker registry documentation first. Most registries only support the standard set.

### Issue: Leading/trailing hyphens remain

**Symptoms:**
- Tag becomes `-feature-add-auth-` or `feature-add-auth-`

**Cause:** Missing the cleanup steps

**Fix:** Include all cleanup steps:
```bash
SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | \
  tr '[:upper:]' '[:lower:]' | \
  sed 's/[^a-z0-9._-]/-/g' | \
  sed 's/^[-.]*//' | \        # Remove leading hyphens/periods
  sed 's/[-]*$//' | \          # Remove trailing hyphens
  sed 's/-\{2,\}/-/g')         # Collapse consecutive hyphens
```

## Debugging Tips

### Enable verbose logging

Add debug output to see what's happening:

```yaml
command: |
  set -x  # Enable bash debug mode

  echo "=== Debug Info ==="
  echo "CIRCLE_BRANCH: ${CIRCLE_BRANCH}"

  SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g' | sed 's/^[-.]*//' | sed 's/[-]*$//' | sed 's/-\{2,\}/-/g')

  echo "SANITIZED_BRANCH: ${SANITIZED_BRANCH}"
  echo "VERSION_TAG: ${VERSION_TAG}"
  echo "Final tag: ${REGISTRY}/${IMAGE}:${VERSION_TAG}"
  echo "=================="
```

### Test sanitization locally

Create a test script:

```bash
#!/bin/bash
# test-sanitization.sh

test_sanitization() {
  local input=$1
  local sanitized=$(echo "$input" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g' | sed 's/^[-.]*//' | sed 's/[-]*$//' | sed 's/-\{2,\}/-/g')
  echo "$input → $sanitized"
}

# Test cases
test_sanitization "feature/add-auth"
test_sanitization "Feature/Add-Auth"
test_sanitization "bugfix/issue#123"
test_sanitization "hotfix/URGENT!!"
test_sanitization "-leading-dash"
test_sanitization "trailing-dash-"
test_sanitization "double--dash"
```

Expected output:
```
feature/add-auth → feature-add-auth
Feature/Add-Auth → feature-add-auth
bugfix/issue#123 → bugfix-issue-123
hotfix/URGENT!! → hotfix-urgent
-leading-dash → leading-dash
trailing-dash- → trailing-dash
double--dash → double-dash
```

### Validate Docker tag manually

Test if a tag is valid:

```bash
# This should succeed if tag is valid
docker tag local-image:existing-tag registry/app:YOUR_SANITIZED_TAG

# If it fails, the tag format is invalid
```

## Performance Issues

### Issue: Build is slower after adding sanitization

**Cause:** Shell operations add minimal overhead, but repeated calls could add up

**Fix:** Sanitize once, reuse the variable:

**Bad (sanitizes multiple times):**
```bash
TAG1=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]' | sed ...)
TAG2=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]' | sed ...)
```

**Good (sanitize once):**
```bash
SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]' | sed ...)
TAG1="${SANITIZED_BRANCH}-latest"
TAG2="${SANITIZED_BRANCH}-${SHA}"
```

## Integration Issues

### Issue: Docker Compose not using sanitized tags

**Symptoms:**
- CircleCI config updated
- docker-compose.yml still using old format

**Fix:** Update environment variables passed to docker-compose:

```yaml
command: |
  SANITIZED_BRANCH=$(...)
  export IMAGE_TAG="${SANITIZED_BRANCH}-test"
  docker-compose build
```

And in `docker-compose.yml`:
```yaml
services:
  app:
    image: "registry/app:${IMAGE_TAG}"
```

### Issue: Caching issues after sanitization

**Symptoms:**
- Old tags still in cache
- Confusion about which image is which

**Fix:** Clear Docker cache:
```yaml
- run:
    name: Clear Docker cache
    command: docker system prune -af
```

**Or** use cache-busting in tag:
```bash
TAG="${SANITIZED_BRANCH}-${CIRCLE_BUILD_NUM}-$(date +%s)"
```

## Registry-Specific Issues

### AWS ECR

**Issue:** Tags not appearing in ECR console

**Diagnosis:**
```bash
aws ecr describe-images --repository-name YOUR_REPO --region YOUR_REGION
```

**Common causes:**
- Repository doesn't exist (auto-create failed)
- Permissions issue
- Tag is valid but push failed silently

**Fix:** Ensure repository exists:
```yaml
command: |
  aws ecr describe-repositories --repository-names $ECR_NAME || \
    aws ecr create-repository --repository-name $ECR_NAME
```

### Google Container Registry (GCR)

**Issue:** Tag format rejected by GCR

**Note:** GCR is more lenient than Docker Hub but still has limits

**Fix:** Same sanitization works for GCR

### Docker Hub

**Issue:** Tags rejected by Docker Hub

**Note:** Docker Hub is strict about tag formats

**Fix:** Standard sanitization should work. If issues persist, check tag length (max 128 chars).

## Edge Cases

### Very long branch names

**Issue:** Branch name > 128 characters causes tag to exceed limit

**Fix:** Truncate after sanitization:
```bash
SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | \
  tr '[:upper:]' '[:lower:]' | \
  sed 's/[^a-z0-9._-]/-/g' | \
  sed 's/^[-.]*//' | \
  sed 's/[-]*$//' | \
  sed 's/-\{2,\}/-/g' | \
  cut -c 1-64)
```

### Branch names with unicode characters

**Issue:** Branch name has emoji or non-ASCII chars

**Example:** `feature/add-🔥-feature`

**Fix:** The sanitization handles this - non-ASCII chars are replaced with `-`:
```bash
feature/add-🔥-feature → feature-add--feature → feature-add-feature
```

### Branch names starting with numbers

**Issue:** Branch `123-fix` - is this valid?

**Answer:** Yes, Docker tags can start with numbers. The sanitization preserves this:
```bash
123-fix → 123-fix  # No change, already valid
```

### Empty sanitized result

**Issue:** Branch name was all special characters

**Example:** `!!!` → empty string

**Fix:** Add fallback:
```bash
SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g' | sed 's/^[-.]*//' | sed 's/[-]*$//' | sed 's/-\{2,\}/-/g')

# Fallback if empty
if [ -z "$SANITIZED_BRANCH" ]; then
  SANITIZED_BRANCH="unknown-${CIRCLE_BUILD_NUM}"
fi
```

## Getting Help

If issues persist:

1. **Check CircleCI logs** for exact error messages
2. **Validate config locally**: `circleci config validate`
3. **Test sanitization script** in isolation
4. **Check Docker registry documentation** for tag requirements
5. **Review complete-examples.md** for similar patterns
6. **Contact #platform-engineering** on Slack with:
   - CircleCI config snippet
   - Error message
   - Branch name that's failing
   - Expected vs actual tag

## Quick Diagnostic Checklist

When troubleshooting, check:

- [ ] Sanitization script placed before Docker commands
- [ ] All tag variables use `${SANITIZED_BRANCH}`
- [ ] Conditionals use original `${CIRCLE_BRANCH}`
- [ ] Echo statement shows sanitization is working
- [ ] Config validates: `circleci config validate`
- [ ] No YAML syntax errors
- [ ] No missing quotes or braces
- [ ] Tag length under 128 characters
- [ ] No leading/trailing hyphens in final tag
- [ ] Docker registry supports the tag format
