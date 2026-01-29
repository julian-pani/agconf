---
name: session-introspection
description: [DEPRECATED] Use submit-friction-logs instead. This skill has been replaced by the async friction log processing system.
deprecated: true
metadata:
---

# Session Introspection [DEPRECATED]

> **This skill is deprecated.** Use the new async friction log system instead:
> - `$submit-friction-logs` - Submit friction logs for async processing
> - `$process-friction-logs` - Process friction log issues (async)

## Why Deprecated

The synchronous introspection model had limitations:
1. Session agent lacked fbagents context for proper categorization
2. Processing blocked the user at end of session
3. No visibility into what was processed

## New Model

The new async friction log system:

1. **During session**: Write to `friction-logs.md` (not `learnings.md`)
2. **End of session**: Auto-submit via `$submit-friction-logs`
3. **Async processing**: Dedicated agent processes queue with full context

### Key Changes

| Old | New |
|-----|-----|
| `learnings.md` | `friction-logs.md` |
| Sync processing | Async via GitHub issues |
| `/session-introspection` | Auto-submit (no user prompt) |
| In-session categorization | Async categorization with full context |

### New Terminology

- **Friction logs**: Raw session events capturing friction points
- **Friction items**: Individual entries in a friction log
- **Improvements**: Processed actionable items (knowledge or environment)

## Migration

If you have existing `learnings.md` or `observations.md` files:
1. Rename to `friction-logs.md`
2. Run `$submit-friction-logs` to submit them
3. They'll be processed asynchronously

## See Also

- `$submit-friction-logs` - The replacement for this skill
- `$process-friction-logs` - Async processing of friction logs
- `instructions/AGENTS.md` - Updated documentation
