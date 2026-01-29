---
name: submit-friction-logs
description: Submit a friction log item to the fbagents queue for async processing. Creates a GitHub issue with the friction item, context, and conversation reference. Use IMMEDIATELY after identifying each friction item - do not batch.
context: fork
agent: general-purpose
metadata:
---

# Submit Friction Logs

You are a subagent responsible for submitting friction log items to the fbagents repository as GitHub issues.

## Arguments

You will receive the project name as an argument: `$ARGUMENTS`

## Your Task

1. Read the friction logs from `projects/$ARGUMENTS/friction-logs.md`
2. Find any unsubmitted friction items (items without a "SUBMITTED" marker)
3. Create a GitHub issue for each unsubmitted item
4. Mark items as submitted in the friction logs file

## Prerequisites

- Git repository with remote configured
- GitHub CLI (`gh`) authenticated

## Workflow

### Step 1: Discover Session

First, discover the current session to enable conversation attachment.

1. Output a unique marker in your response:
   ```
   SESSION_DISCOVERY_MARKER: <unique-uuid>
   ```

2. Run the session finder script:
   ```bash
   ./skills/submit-friction-logs/scripts/find-session-file.sh "<marker>"
   ```

3. Store the session info for later use:
   - `session_id`: The session UUID
   - `session_file`: Full path to the conversation JSONL

### Step 2: Gather Context

Collect all necessary context for the friction log issue:

```bash
# Repository info
REPO_URL=$(git remote get-url origin)
REPO_NAME=$(basename -s .git "$REPO_URL" | sed 's/.*[:/]//')
ORG_NAME=$(git remote get-url origin | sed -n 's/.*[:/]\([^/]*\)\/[^/]*$/\1/p')

# Branch and commit
BRANCH=$(git branch --show-current)
COMMIT_SHA=$(git rev-parse HEAD)

# Date
DATE=$(date -u +"%Y-%m-%d")
```

### Step 3: Read Friction Logs

1. Find the friction logs file: `projects/<project-name>/friction-logs.md`
2. If no project context, check for any `projects/*/friction-logs.md`
3. Parse friction log entries (see format in references/friction-log-format.md)
4. Validate each has required fields

### Step 4: Upload Conversation to Repository

The GitHub CLI doesn't support file attachments to issues. Instead, upload the conversation JSONL to the `agent_conversations` branch in fbagents using the upload script.

**This step must happen BEFORE creating the issue** so the conversation URL can be included in the issue body.

```bash
# Upload conversation and get URL (pass "pending" as issue number since it doesn't exist yet)
UPLOAD_RESULT=$(./skills/submit-friction-logs/scripts/upload-conversation.sh "$SESSION_FILE" "$SESSION_ID" "pending")
CONVERSATION_URL=$(echo "$UPLOAD_RESULT" | jq -r '.upload_url')
```

The script:
- Clones fbagents to a temp directory
- Checks out or creates the `agent_conversations` branch
- Copies the conversation file to `conversations/<session-id>.jsonl`
- Commits and pushes
- Returns JSON with `upload_url`, `status`, and `error`

### Step 5: Create GitHub Issue

Create an issue on the fbagents repository, including the conversation URL from Step 4:

```bash
gh issue create \
  --repo i-FeelBetter/fbagents \
  --title "[Friction Log] Session in $ORG_NAME/$REPO_NAME" \
  --label "friction-log,pending" \
  --body "$(cat <<EOF
## Session Context

| Field | Value |
|-------|-------|
| Source Repository | \`$ORG_NAME/$REPO_NAME\` |
| Repository URL | $REPO_URL |
| Branch | \`$BRANCH\` |
| Commit SHA | \`$COMMIT_SHA\` |
| Session Date | $DATE |
| Session ID | \`$SESSION_ID\` |

---

## Friction Items

[Formatted friction items from friction-logs.md]

---

## Conversation Reference

Full conversation JSONL file:
$CONVERSATION_URL
EOF
)"
```

### Step 6: Mark Friction Logs as Submitted

Update the local friction logs file to indicate submission:

```markdown
---
SUBMITTED: 2026-01-07
Issue: https://github.com/i-FeelBetter/fbagents/issues/XX
---

[Original friction items remain for local reference]
```

### Step 7: Confirm to User

Output confirmation:
```
Friction item submitted to fbagents queue.
Issue: https://github.com/i-FeelBetter/fbagents/issues/XX

This will be processed asynchronously. You'll see:
- PRs for knowledge improvements
- Issues for environment improvements
```

## Issue Format

See `references/issue-format.md` for the complete issue template.

Key sections:
- **Session Context**: Repo, branch, commit, session ID
- **Friction Items**: Formatted entries from friction-logs.md
- **Conversation Reference**: Attached JSONL file

## Friction Log Entry Format

Each friction item in `friction-logs.md` should include:

```markdown
### [Brief title describing what happened]

**What happened**: [Factual description of the event]

**Evidence**:
- [Specific quotes, file paths, line numbers]
- [User corrections or feedback]

**Impact**: [How this affected the work]

**Suggested type**: [Knowledge | Environment]
```

See `references/friction-log-format.md` for detailed guidance.

## Error Handling

| Error | Action |
|-------|--------|
| No friction-logs.md found | Inform user, offer to create one |
| gh not authenticated | Prompt user to run `gh auth login` |
| Conversation upload fails | Proceed without link, note in issue that conversation couldn't be attached |
| Issue creation fails | Output the formatted content for manual submission |
| Conversation file too large | Compress or excerpt relevant portions |

## Example

```
Agent: Friction item identified - type errors not being caught. Submitting for processing...

SESSION_DISCOVERY_MARKER: abc123-unique-marker

[Runs find-session-file.sh]
[Gathers repo context]
[Uploads conversation to agent_conversations branch]
[Creates GitHub issue with conversation link]

Friction item submitted to fbagents queue.
Issue: https://github.com/i-FeelBetter/fbagents/issues/42
Conversation: https://github.com/i-FeelBetter/fbagents/blob/agent_conversations/conversations/abc123.jsonl

Friction item: Type errors not caught - suggested as Environment improvement

This will be processed asynchronously to create improvements.
```

Note: Each friction item is submitted immediately and separately. If you identify 3 friction items during a session, you'll create 3 separate GitHub issues.

## Reference Documents

- `references/friction-log-format.md` - How to write good friction log entries
- `references/issue-format.md` - GitHub issue template
- `scripts/find-session-file.sh` - Session discovery script
- `scripts/upload-conversation.sh` - Upload conversation JSONL to repository
