# Complete CircleCI Docker Tag Sanitization Examples

This file contains complete, real-world examples of CircleCI configs before and after applying branch name sanitization.

## Example 1: AWS ECR with Orb Command (Real Production Config)

This example comes from an actual production repository using custom Python CI orbs.

### Before (Fails on branches with special characters)

```yaml
version: 2.1

orbs:
  python-ci:
    commands:
      toml-publish-docker:
        steps:
          - checkout
          - setup_remote_docker:
              docker_layer_caching: true
          - run:
              name: Build and push to AWS
              command: |
                docker login -u AWS -p $(aws ecr get-login-password) ${DOCKER_REGISTRY_URL}

                echo "Getting app version"
                APP_VERSION=$(grep 'version\s*=' pyproject.toml |  grep -E -o "[0-9]+?\.[0-9]+?\.[0-9]+?" | head -1)
                echo "App version: ${APP_VERSION}"

                ECR_NAME=${ECR_NAME_OVERRIDE:-"${CIRCLE_PROJECT_REPONAME}"}

                ## Build docker image, tagging with latest and version tag depending on branch
                if [[ "$CIRCLE_BRANCH" == "master" ]]
                then
                    VERSION_TAG=${APP_VERSION}"."${CIRCLE_BUILD_NUM}
                    echo "Publishing VERSION_TAG: ${VERSION_TAG}"
                    docker build -t "${DOCKER_REGISTRY_URL}/${ECR_NAME}:${VERSION_TAG}" -t "${DOCKER_REGISTRY_URL}/${ECR_NAME}:latest" --build-arg PIP_INDEX_URL .
                else
                    VERSION_TAG=${APP_VERSION}".dev.${CIRCLE_BRANCH}-${CIRCLE_BUILD_NUM}"
                    echo "Publishing VERSION_TAG: ${VERSION_TAG}"
                    docker build -t "${DOCKER_REGISTRY_URL}/${ECR_NAME}:${VERSION_TAG}" --build-arg PIP_INDEX_URL .
                fi

                ## Push to ecr
                aws ecr describe-repositories --repository-names $ECR_NAME >/dev/null || aws ecr create-repository --repository-name $ECR_NAME >/dev/null
                docker push "${DOCKER_REGISTRY_URL}/${ECR_NAME}" --all-tags

jobs:
  publish:
    docker:
      - image: cimg/python:3.12.5
    steps:
    - python-ci/toml-publish-docker

workflows:
  version: 2
  build-test-publish:
    jobs:
      - publish:
          context: AWS
```

### After (Works with all branch names)

```yaml
version: 2.1

orbs:
  python-ci:
    commands:
      toml-publish-docker:
        steps:
          - checkout
          - setup_remote_docker:
              docker_layer_caching: true
          - run:
              name: Build and push to AWS
              command: |
                docker login -u AWS -p $(aws ecr get-login-password) ${DOCKER_REGISTRY_URL}

                echo "Getting app version"
                APP_VERSION=$(grep 'version\s*=' pyproject.toml |  grep -E -o "[0-9]+?\.[0-9]+?\.[0-9]+?" | head -1)
                echo "App version: ${APP_VERSION}"

                ECR_NAME=${ECR_NAME_OVERRIDE:-"${CIRCLE_PROJECT_REPONAME}"}

                # Sanitize branch name for use in Docker tags
                # Docker tags must be lowercase, alphanumeric, underscores, periods, or hyphens only
                SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g' | sed 's/^[-.]*//' | sed 's/[-]*$//' | sed 's/-\{2,\}/-/g')
                echo "Original branch: ${CIRCLE_BRANCH}, Sanitized: ${SANITIZED_BRANCH}"

                ## Build docker image, tagging with latest and version tag depending on branch
                if [[ "$CIRCLE_BRANCH" == "master" ]]
                then
                    VERSION_TAG=${APP_VERSION}"."${CIRCLE_BUILD_NUM}
                    echo "Publishing VERSION_TAG: ${VERSION_TAG}"
                    docker build -t "${DOCKER_REGISTRY_URL}/${ECR_NAME}:${VERSION_TAG}" -t "${DOCKER_REGISTRY_URL}/${ECR_NAME}:latest" --build-arg PIP_INDEX_URL .
                else
                    VERSION_TAG=${APP_VERSION}".dev.${SANITIZED_BRANCH}-${CIRCLE_BUILD_NUM}"
                    echo "Publishing VERSION_TAG: ${VERSION_TAG}"
                    docker build -t "${DOCKER_REGISTRY_URL}/${ECR_NAME}:${VERSION_TAG}" --build-arg PIP_INDEX_URL .
                fi

                ## Push to ecr
                aws ecr describe-repositories --repository-names $ECR_NAME >/dev/null || aws ecr create-repository --repository-name $ECR_NAME >/dev/null
                docker push "${DOCKER_REGISTRY_URL}/${ECR_NAME}" --all-tags

jobs:
  publish:
    docker:
      - image: cimg/python:3.12.5
    steps:
    - python-ci/toml-publish-docker

workflows:
  version: 2
  build-test-publish:
    jobs:
      - publish:
          context: AWS
```

**Changes made**:
1. Added sanitization script after ECR_NAME definition, before Docker commands
2. Replaced `${CIRCLE_BRANCH}` with `${SANITIZED_BRANCH}` in VERSION_TAG definition
3. Kept `${CIRCLE_BRANCH}` in the conditional check - important!
4. Added debug echo to show transformation

**Result**: Branch `feature/add-oauth` now creates tag like `1.2.3.dev.feature-add-oauth-456` instead of failing.

## Example 2: Simple Docker Hub Push

### Before

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
            echo "$DOCKER_PASSWORD" | docker login -u "$DOCKER_USERNAME" --password-stdin

            IMAGE_TAG="${CIRCLE_BRANCH}-${CIRCLE_SHA1:0:7}"

            docker build -t "myorg/myapp:${IMAGE_TAG}" .
            docker push "myorg/myapp:${IMAGE_TAG}"

workflows:
  version: 2
  main:
    jobs:
      - build-and-push
```

### After

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
            echo "$DOCKER_PASSWORD" | docker login -u "$DOCKER_USERNAME" --password-stdin

            # Sanitize branch name for Docker tags
            SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g' | sed 's/^[-.]*//' | sed 's/[-]*$//' | sed 's/-\{2,\}/-/g')
            echo "Branch: ${CIRCLE_BRANCH} → ${SANITIZED_BRANCH}"

            IMAGE_TAG="${SANITIZED_BRANCH}-${CIRCLE_SHA1:0:7}"

            docker build -t "myorg/myapp:${IMAGE_TAG}" .
            docker push "myorg/myapp:${IMAGE_TAG}"

workflows:
  version: 2
  main:
    jobs:
      - build-and-push
```

## Example 3: Multi-Environment with Different Tag Strategies

### Before

```yaml
version: 2.1

jobs:
  docker-build:
    docker:
      - image: cimg/base:stable
    steps:
      - checkout
      - setup_remote_docker
      - run:
          name: Build and tag
          command: |
            if [[ "$CIRCLE_BRANCH" == "main" ]]; then
              TAG="latest"
            elif [[ "$CIRCLE_BRANCH" == "develop" ]]; then
              TAG="develop"
            else
              TAG="${CIRCLE_BRANCH}-snapshot"
            fi

            docker build -t "registry.company.com/app:${TAG}" .
            docker push "registry.company.com/app:${TAG}"

workflows:
  version: 2
  build-deploy:
    jobs:
      - docker-build
```

### After

```yaml
version: 2.1

jobs:
  docker-build:
    docker:
      - image: cimg/base:stable
    steps:
      - checkout
      - setup_remote_docker
      - run:
          name: Build and tag
          command: |
            # Sanitize branch name early (even though main/develop won't change)
            SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g' | sed 's/^[-.]*//' | sed 's/[-]*$//' | sed 's/-\{2,\}/-/g')

            # Use original branch for conditionals, sanitized for tags
            if [[ "$CIRCLE_BRANCH" == "main" ]]; then
              TAG="latest"
            elif [[ "$CIRCLE_BRANCH" == "develop" ]]; then
              TAG="develop"
            else
              TAG="${SANITIZED_BRANCH}-snapshot"
            fi

            echo "Building tag: ${TAG}"
            docker build -t "registry.company.com/app:${TAG}" .
            docker push "registry.company.com/app:${TAG}"

workflows:
  version: 2
  build-deploy:
    jobs:
      - docker-build
```

**Note**: Even though "main" and "develop" are already valid, we still sanitize for consistency and to handle the else case.

## Example 4: Multi-Stage Build with Multiple Tags

### Before

```yaml
version: 2.1

jobs:
  publish:
    docker:
      - image: cimg/base:stable
    steps:
      - checkout
      - setup_remote_docker
      - run:
          command: |
            VERSION=$(cat VERSION)
            BRANCH_TAG="${CIRCLE_BRANCH}"
            COMMIT_TAG="${CIRCLE_BRANCH}-${CIRCLE_SHA1:0:7}"
            LATEST_TAG="${CIRCLE_BRANCH}-latest"

            docker build \
              -t "gcr.io/project/app:${VERSION}" \
              -t "gcr.io/project/app:${BRANCH_TAG}" \
              -t "gcr.io/project/app:${COMMIT_TAG}" \
              -t "gcr.io/project/app:${LATEST_TAG}" \
              .

            docker push "gcr.io/project/app" --all-tags
```

### After

```yaml
version: 2.1

jobs:
  publish:
    docker:
      - image: cimg/base:stable
    steps:
      - checkout
      - setup_remote_docker
      - run:
          command: |
            # Sanitize branch name for all tag variants
            SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g' | sed 's/^[-.]*//' | sed 's/[-]*$//' | sed 's/-\{2,\}/-/g')

            VERSION=$(cat VERSION)
            BRANCH_TAG="${SANITIZED_BRANCH}"
            COMMIT_TAG="${SANITIZED_BRANCH}-${CIRCLE_SHA1:0:7}"
            LATEST_TAG="${SANITIZED_BRANCH}-latest"

            echo "Tags: ${VERSION}, ${BRANCH_TAG}, ${COMMIT_TAG}, ${LATEST_TAG}"

            docker build \
              -t "gcr.io/project/app:${VERSION}" \
              -t "gcr.io/project/app:${BRANCH_TAG}" \
              -t "gcr.io/project/app:${COMMIT_TAG}" \
              -t "gcr.io/project/app:${LATEST_TAG}" \
              .

            docker push "gcr.io/project/app" --all-tags
```

## Example 5: With Docker Compose

### Before

```yaml
version: 2.1

jobs:
  integration-test:
    machine:
      image: ubuntu-2204:current
    steps:
      - checkout
      - run:
          name: Build and test with docker-compose
          command: |
            export IMAGE_TAG="${CIRCLE_BRANCH}-test"
            docker-compose build
            docker-compose up -d
            docker-compose run tests
```

With `docker-compose.yml`:
```yaml
services:
  app:
    image: "registry/app:${IMAGE_TAG}"
    build: .
```

### After

```yaml
version: 2.1

jobs:
  integration-test:
    machine:
      image: ubuntu-2204:current
    steps:
      - checkout
      - run:
          name: Build and test with docker-compose
          command: |
            # Sanitize for docker-compose
            SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g' | sed 's/^[-.]*//' | sed 's/[-]*$//' | sed 's/-\{2,\}/-/g')

            export IMAGE_TAG="${SANITIZED_BRANCH}-test"
            echo "Using image tag: ${IMAGE_TAG}"

            docker-compose build
            docker-compose up -d
            docker-compose run tests
```

## Example 6: Conditional Building with BuildKit

### Before

```yaml
version: 2.1

jobs:
  build:
    docker:
      - image: cimg/base:stable
    steps:
      - checkout
      - setup_remote_docker
      - run:
          name: Build with BuildKit
          command: |
            export DOCKER_BUILDKIT=1

            if [[ "$CIRCLE_BRANCH" =~ ^release/.* ]]; then
              TAG="release-${CIRCLE_BRANCH#release/}"
            elif [[ "$CIRCLE_BRANCH" == "main" ]]; then
              TAG="production"
            else
              TAG="dev-${CIRCLE_BRANCH}"
            fi

            docker build \
              --tag "registry/app:${TAG}" \
              --build-arg BRANCH="${CIRCLE_BRANCH}" \
              .
            docker push "registry/app:${TAG}"
```

### After

```yaml
version: 2.1

jobs:
  build:
    docker:
      - image: cimg/base:stable
    steps:
      - checkout
      - setup_remote_docker
      - run:
          name: Build with BuildKit
          command: |
            export DOCKER_BUILDKIT=1

            # Sanitize branch name
            SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g' | sed 's/^[-.]*//' | sed 's/[-]*$//' | sed 's/-\{2,\}/-/g')

            # Use original branch for pattern matching, sanitized for tags
            if [[ "$CIRCLE_BRANCH" =~ ^release/.* ]]; then
              TAG="release-${SANITIZED_BRANCH#release-}"
            elif [[ "$CIRCLE_BRANCH" == "main" ]]; then
              TAG="production"
            else
              TAG="dev-${SANITIZED_BRANCH}"
            fi

            echo "Building tag: ${TAG} from branch: ${CIRCLE_BRANCH}"

            docker build \
              --tag "registry/app:${TAG}" \
              --build-arg BRANCH="${CIRCLE_BRANCH}" \
              .
            docker push "registry/app:${TAG}"
```

**Note**: We keep `BRANCH` build arg as original since it's used inside Dockerfile for logging/metadata, not for tagging.

## Common Patterns Summary

### Pattern 1: Sanitize Once, Use Everywhere
```bash
# Do this at the start
SANITIZED_BRANCH=$(echo "$CIRCLE_BRANCH" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g' | sed 's/^[-.]*//' | sed 's/[-]*$//' | sed 's/-\{2,\}/-/g')

# Then use throughout
TAG1="${SANITIZED_BRANCH}-latest"
TAG2="${SANITIZED_BRANCH}-${BUILD_NUM}"
```

### Pattern 2: Keep Original for Conditionals
```bash
# Use original for matching
if [[ "$CIRCLE_BRANCH" == "master" ]]; then
  # ...
fi

# Use sanitized for tags
docker build -t "app:${SANITIZED_BRANCH}"
```

### Pattern 3: Debug Echo
```bash
# Always helpful for debugging
echo "Original: ${CIRCLE_BRANCH}, Sanitized: ${SANITIZED_BRANCH}, Tag: ${VERSION_TAG}"
```

### Pattern 4: Combine with Other Variables
```bash
# Safe to combine with other components
TAG="${VERSION}.${SANITIZED_BRANCH}-${CIRCLE_BUILD_NUM}-${CIRCLE_SHA1:0:7}"
# Example: 1.2.3.feature-add-auth-456-a1b2c3d
```

## Testing Your Changes

Test the sanitization locally before pushing:

```bash
#!/bin/bash

# Test script - save as test_sanitization.sh
test_branch() {
  local branch=$1
  local sanitized=$(echo "$branch" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9._-]/-/g' | sed 's/^[-.]*//' | sed 's/[-]*$//' | sed 's/-\{2,\}/-/g')
  echo "$branch → $sanitized"
}

# Test cases
test_branch "feature/add-auth"
test_branch "Feature/Add-Auth"
test_branch "bugfix/issue#123"
test_branch "hotfix/URGENT!!"
test_branch "release/v1.5.0"
test_branch "develop"
test_branch "test/-leading-"
test_branch "feat/multi--dash"
```

Expected output:
```
feature/add-auth → feature-add-auth
Feature/Add-Auth → feature-add-auth
bugfix/issue#123 → bugfix-issue-123
hotfix/URGENT!! → hotfix-urgent
release/v1.5.0 → release-v1.5.0
develop → develop
test/-leading- → test-leading
feat/multi--dash → feat-multi-dash
```

## Migration Checklist

When applying to existing repositories:

- [ ] Read current `.circleci/config.yml`
- [ ] Find all `${CIRCLE_BRANCH}` uses in Docker contexts
- [ ] Add sanitization script before first Docker command
- [ ] Replace branch variable in all tag assignments
- [ ] Keep original branch in conditionals
- [ ] Add debug echo statements
- [ ] Test locally with the test script
- [ ] Push to feature branch with special characters (e.g., `test/verify-sanitization`)
- [ ] Verify CircleCI build succeeds
- [ ] Check Docker registry for properly formatted tags
- [ ] Merge to main branch
- [ ] Document in repository README if needed
