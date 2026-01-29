---
name: ci-cd-standards
description: CI/CD standards and best practices across platforms. Use when implementing or modifying CI/CD pipelines, working with CircleCI, GitHub Actions, or other CI systems.
license: Apache-2.0
metadata:
  author: platform-engineering
  version: 1.0
  tags: ci-cd, circleci, devops, automation
  policy: recommended
  scope: organization
---

# CI/CD Standards

Entry point for CI/CD standards and best practices across all platforms and tools.

## When to Use This Skill

- Implementing new CI/CD pipelines
- Modifying existing CI/CD configurations
- Debugging CI/CD failures
- Working with CircleCI, GitHub Actions, or other CI systems

## Overview

This skill acts as an index for CI/CD related standards. Refer to specific sub-skills for detailed guidance on particular tools or patterns.

## Platform-Specific Standards

### CircleCI

**Docker Tag Sanitization**: When building Docker images with branch names in tags, always apply comprehensive sanitization to prevent build failures.

See the `$circleci-docker-tag-sanitization` skill for:
- How to sanitize branch names for use in Docker tags
- Complete sanitization pattern (not just fixing specific characters)
- Implementation steps and examples
- Migration guides for existing pipelines

## Best Practices

### 1. Always Validate Changes Locally

Before pushing CI/CD configuration changes:
- Test build scripts locally when possible
- Validate YAML syntax with linters
- Review changes with team members
- Consider the impact on running pipelines

### 2. Use Explicit Versioning

For tools, Docker images, and dependencies in CI:
- Pin specific versions, not `latest`
- Document version upgrade decisions
- Test version changes before deploying to main branch

### 3. Fail Fast, Fail Clear

CI/CD pipelines should:
- Fail early when issues are detected
- Provide clear error messages
- Log relevant context for debugging
- Avoid masking underlying errors

### 4. Keep Secrets Secure

- Never commit secrets to version control
- Use platform-specific secret management (CircleCI contexts, GitHub secrets)
- Rotate secrets regularly
- Audit secret access periodically

## Related Skills

- `$circleci-docker-tag-sanitization` - Sanitize branch names for Docker tags in CircleCI

## Future Topics

As more CI/CD standards are documented, they will be added here:
- GitHub Actions best practices
- Deployment strategies
- Testing in CI/CD
- Artifact management
- Multi-stage pipelines
