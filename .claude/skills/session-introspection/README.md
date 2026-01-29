# Session Introspection Skill

Process learnings captured during work sessions into permanent documentation.

## Overview

This skill helps AI agents convert implicit session knowledge into explicit, reusable documentation. It reads learnings from project files, categorizes them by scope and format, and writes them to appropriate destinations.

## Quick Start

1. During a work session, learnings are captured to `projects/<name>/learnings.md`
2. At end of session, invoke introspection: `/session-introspection`
3. Review and approve the categorization plan
4. Learnings are written to their destinations

## How It Works

```
Session Work
    ↓
Capture learnings to projects/<name>/learnings.md
    ↓
Invoke /session-introspection
    ↓
Categorize by scope (global/repo-local/project-local)
    ↓
Categorize by format (AGENTS.md/skill/CLAUDE.md)
    ↓
Present plan for user approval
    ↓
Write to destinations
    ↓
Mark learnings as processed
```

## Destinations

| Scope + Format | Destination |
|----------------|-------------|
| Global + simple | `fbagents/AGENTS.md` |
| Global + complex | `fbagents/skills/<name>/` |
| Repo-local + simple | `repo/.claude/CLAUDE.md` |
| Repo-local + complex | `repo/.claude/skills/<name>/` |
| Project-local | Stays in `projects/<name>/learnings.md` |

## Related Documentation

- [Capturing Learnings](../../AGENTS.md#capturing-learnings-during-sessions) - How to capture learnings during sessions
- [categorization.md](references/categorization.md) - Detailed categorization guidance
- [storage-guide.md](references/storage-guide.md) - Where different learnings go

## Prerequisites

Learnings should be captured following the guidelines in AGENTS.md:
- Write to `projects/<project-name>/learnings.md`
- Each entry must be self-contained
- Include: what was learned, context/evidence, why it matters
