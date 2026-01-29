# Submit Friction Logs Skill

This skill enables AI agents to submit session friction logs for asynchronous processing.

## Overview

During work sessions, agents capture friction items about friction points, corrections, and improvement opportunities in `projects/<name>/friction-logs.md`. At the end of significant sessions, this skill submits those friction items as a GitHub issue to the fbagents repository, where they'll be processed asynchronously.

## How It Works

1. **During Session**: Agent writes friction items to `friction-logs.md`
2. **End of Session**: Agent runs this skill to submit friction logs
3. **Submission**: Creates a GitHub issue with context + friction items + conversation attachment
4. **Processing**: A separate agent processes the queue, creating improvements

## What Gets Submitted

- Session context (repo, branch, commit, session ID)
- All friction items from `friction-logs.md`
- Full conversation JSONL (attached for reference)

## Output Types

After processing, friction items become:

- **Knowledge Improvements**: PRs to fbagents (global) or source repo (local)
- **Environment Improvements**: Issues on source repo with actionable backlog items

## Usage

### Automatic

The agent should automatically suggest submission at end of significant sessions.

### Manual

```
/submit-friction-logs
```

## Files

```
submit-friction-logs/
├── SKILL.md                       # Agent instructions
├── README.md                      # This file
├── references/
│   ├── friction-log-format.md     # How to write friction log entries
│   ├── issue-format.md            # GitHub issue template
│   └── github-labels.md           # Label configuration
└── scripts/
    ├── find-session-file.sh       # Session discovery script
    └── upload-conversation.sh     # Upload conversation JSONL
```

## Prerequisites

- GitHub CLI (`gh`) authenticated
- Git repository with remote configured

## Related

- **Process Friction Logs**: The skill that processes submitted friction logs
- **Session Introspection** (deprecated): Previous synchronous approach
