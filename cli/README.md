# agconf

[![npm version](https://img.shields.io/npm/v/agconf.svg)](https://www.npmjs.com/package/agconf)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

CLI to sync AI agent configurations across repositories.

## Documentation

Full documentation, setup guides, and FAQ available on GitHub:

**https://github.com/julian-pani/agconf**

## Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize repo from a canonical source |
| `sync` | Sync content from canonical repo (fetches latest by default) |
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
agconf canonical init --name my-standards --org "My Org"
```

This scaffolds the structure for your standards. Edit `instructions/AGENTS.md` to add your engineering guidelines, then commit and push to GitHub.

### 2. Sync to your projects

## CLAUDE.md Handling

During sync, agconf consolidates any existing `CLAUDE.md` files:

1. **Both locations checked**: Root `CLAUDE.md` and `.claude/CLAUDE.md`
2. **Content merged**: Content from both files (after stripping `@AGENTS.md` references) is merged into the AGENTS.md repo block
3. **Files consolidated**: Root `CLAUDE.md` is deleted, `.claude/CLAUDE.md` is created/updated with `@../AGENTS.md` reference

This happens regardless of target (Claude or Codex), ensuring:
- Existing CLAUDE.md instructions become available in AGENTS.md (which Codex reads directly)
- The repo is prepared for Claude usage (which reads `.claude/CLAUDE.md` and follows the reference)
- Single source of truth for all agent instructions

### Sync to your projects

```bash
cd your-project
agconf init --source your-org/engineering-standards
```

## Rules

Rules are modular, topic-specific project instructions that live in `.claude/rules/` for Claude targets. They allow you to organize standards by topic (security, testing, code style) rather than putting everything in a single AGENTS.md file.

### Configuration

Add `rules_dir` to your canonical `agconf.yaml`:

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
├── agconf.yaml
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
<!-- agconf:rules:start -->
# Project Rules

<!-- Rule: code-style.md -->
## Code Style Guidelines
...

<!-- Rule: security/api-auth.md -->
## API Authentication
...
<!-- agconf:rules:end -->
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

## Downstream Configuration

Each downstream repository can customize sync behavior by creating `.agconf/config.yaml`. This file is optional and is never overwritten by sync.

### Available Settings

```yaml
# .agconf/config.yaml - Downstream repo configuration

workflow:
  # Commit strategy: "pr" (default) creates a pull request, "direct" commits directly
  commit_strategy: direct

  # Custom commit message for sync commits
  commit_message: "chore: sync engineering standards"

  # PR-specific settings (only used when commit_strategy: pr)
  pr_branch_prefix: "agconf/sync"
  pr_title: "chore(agconf): sync agent configuration"

  # Comma-separated list of reviewers for PRs
  reviewers: "alice,bob"
```

### When to Use

- **`commit_strategy: direct`**: For repos where you want updates applied immediately without PR review
- **`commit_strategy: pr`** (default): For repos where you want to review changes before merging
- **`reviewers`**: Automatically request reviews from specific team members

This config is separate from the canonical config (`agconf.yaml`) - downstream config only contains user preferences for how sync operates.

## License

MIT
