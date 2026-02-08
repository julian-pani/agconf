---
layout: default
title: Security
nav_order: 6
---

# Security Policy

## Supported Versions

We release patches for security vulnerabilities for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.x.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly.

### How to Report

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via email to the maintainers or through GitHub's private vulnerability reporting feature:

1. Go to the [Security tab](https://github.com/julian-pani/agconf/security) of the repository
2. Click "Report a vulnerability"
3. Fill out the form with details about the vulnerability

### What to Include

When reporting a vulnerability, please include:

- Type of vulnerability (e.g., command injection, path traversal, etc.)
- Full paths of source file(s) related to the vulnerability
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact assessment and potential attack scenarios

### Response Timeline

- **Initial Response**: Within 48 hours of receiving your report
- **Status Update**: Within 7 days with our assessment
- **Resolution Target**: Within 30 days for critical vulnerabilities

### What to Expect

1. **Acknowledgment**: We will acknowledge receipt of your report
2. **Assessment**: We will investigate and assess the severity
3. **Communication**: We will keep you informed of our progress
4. **Fix**: We will develop and test a fix
5. **Disclosure**: We will coordinate with you on public disclosure timing
6. **Credit**: We will credit you in the security advisory (unless you prefer anonymity)

## Security Best Practices for Users

When using agconf:

1. **Keep Updated**: Always use the latest version of the CLI
2. **Review Sources**: Only sync from canonical repositories you trust
3. **Audit Changes**: Review changes before committing synced files
4. **Secure Tokens**: Keep GitHub tokens and npm tokens secure
5. **CI/CD Security**: Use repository secrets for sensitive values in workflows

## Scope

The following are in scope for security reports:

- The agconf CLI tool
- GitHub Actions workflows provided by agconf
- Documentation that could lead to insecure configurations

The following are out of scope:

- Issues in third-party dependencies (report to the respective projects)
- Social engineering attacks
- Denial of service attacks

Thank you for helping keep agconf secure!
