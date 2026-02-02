---
layout: default
title: agent-conf cli
nav_order: 8
---

# agent-conf

[![npm version](https://img.shields.io/npm/v/agent-conf.svg)](https://www.npmjs.com/package/agent-conf)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

CLI to sync AI agent configurations across repositories.

## Documentation

Full documentation, setup guides, and FAQ available on GitHub:

**https://github.com/julian-pani/agent-conf**

## Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize repo from a canonical source |
| `sync` | Sync content from canonical repo (fetches latest by default) |
| `status` | Show current sync status |
| `check` | Verify managed files are unchanged |
| `upgrade-cli` | Upgrade the CLI to latest version from npm |
| `canonical init` | Scaffold a new canonical repository |
| `canonical update` | Update CLI version in workflow files |
| `config show` | Show current configuration |
| `completion install` | Install shell completions |


## Quick Start

### 1. Create a canonical repository

```bash
mkdir engineering-standards && cd engineering-standards
git init
agent-conf canonical init --name my-standards --org "My Org"
```

This scaffolds the structure for your standards. Edit `instructions/AGENTS.md` to add your engineering guidelines, then commit and push to GitHub.

### 2. Sync to your projects

```bash
cd your-project
agent-conf init --source your-org/engineering-standards
```

## Rules

Rules are modular, topic-specific project instructions that live in `.claude/rules/` for Claude targets. They allow you to organize standards by topic (security, testing, code style) rather than putting everything in a single AGENTS.md file.

### Configuration

Add `rules_dir` to your canonical `agent-conf.yaml`:

```yaml
version: "1.0.0"
content:
  instructions: "instructions/AGENTS.md"
  skills_dir: "skills"
  rules_dir: "rules"  # Optional - path to rules directory
targets: ["claude", "codex"]
```

### Directory Structure

Rules support arbitrary subdirectory nesting:

```
canonical-repo/
├── agent-conf.yaml
├── instructions/
│   └── AGENTS.md
├── skills/
└── rules/
    ├── code-style.md
    ├── security/
    │   ├── api-auth.md
    │   └── data-handling.md
    └── testing/
        └── unit-tests.md
```

### Target-Specific Behavior

**Claude**: Rules are copied to `.claude/rules/` preserving the directory structure. Each rule file gets metadata added to track sync status.

```
downstream-repo/
└── .claude/
    └── rules/
        ├── code-style.md
        ├── security/
        │   └── api-auth.md
        └── testing/
            └── unit-tests.md
```

**Codex**: Rules are concatenated into AGENTS.md under a `# Project Rules` section. Heading levels are automatically adjusted (h1 becomes h2, etc.) to nest under the section header.

```markdown
<!-- agent-conf:rules:start -->
# Project Rules

<!-- Rule: code-style.md -->
## Code Style Guidelines
...

<!-- Rule: security/api-auth.md -->
## API Authentication
...
<!-- agent-conf:rules:end -->
```

### Path-Specific Rules

Rules can include `paths` frontmatter for conditional loading (a Claude feature):

```markdown
---
paths:
  - "src/api/**/*.ts"
  - "lib/api/**/*.ts"
---

# API Authentication Rules
...
```

For Claude targets, the `paths` frontmatter is preserved. For Codex targets (which don't support conditional loading), paths are included as comments in AGENTS.md:

```markdown
<!-- Rule: security/api-auth.md -->
<!-- Applies to: src/api/**/*.ts, lib/api/**/*.ts -->
## API Authentication Rules
```

### Backward Compatibility

The `rules_dir` configuration is optional. Existing canonical repositories without rules continue to work unchanged.

## License

MIT
