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
| `canonical init` | Scaffold a new canonical repository |
| `canonical update` | Update CLI version in workflow files |


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

## License

MIT
