#!/bin/bash
# Uploads a conversation JSONL file to the fbagents repository's agent_conversations branch.
#
# Usage: ./upload-conversation.sh <session_file> <session_id> [issue_number]
# Output: JSON with upload_url and status
#
# The GitHub CLI doesn't support file attachments to issues, so this script
# uploads conversations to a dedicated branch as a workaround.

set -e

SESSION_FILE="$1"
SESSION_ID="$2"
ISSUE_NUMBER="${3:-unknown}"

if [ -z "$SESSION_FILE" ] || [ -z "$SESSION_ID" ]; then
    echo '{"error": "Usage: upload-conversation.sh <session_file> <session_id> [issue_number]", "upload_url": null, "status": "failed"}'
    exit 1
fi

if [ ! -f "$SESSION_FILE" ]; then
    echo "{\"error\": \"Session file not found: $SESSION_FILE\", \"upload_url\": null, \"status\": \"failed\"}"
    exit 1
fi

FBAGENTS_REPO="https://github.com/i-FeelBetter/fbagents.git"
BRANCH="agent_conversations"
TEMP_DIR=$(mktemp -d)

cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

cd "$TEMP_DIR"

# Clone fbagents repo (shallow clone for speed)
if ! git clone --depth 1 "$FBAGENTS_REPO" fbagents 2>/dev/null; then
    echo '{"error": "Failed to clone fbagents repository", "upload_url": null, "status": "failed"}'
    exit 1
fi

cd fbagents

# Fetch the conversations branch if it exists, or create it
if git ls-remote --heads origin "$BRANCH" | grep -q "$BRANCH"; then
    git fetch origin "$BRANCH" --depth 1
    git checkout "$BRANCH"
else
    git checkout -b "$BRANCH"
fi

# Create conversations directory if needed
mkdir -p conversations

# Copy the session file
DEST_FILE="conversations/${SESSION_ID}.jsonl"
cp "$SESSION_FILE" "$DEST_FILE"

# Check if file already exists with same content (idempotency)
if git diff --quiet "$DEST_FILE" 2>/dev/null; then
    UPLOAD_URL="https://github.com/i-FeelBetter/fbagents/blob/$BRANCH/conversations/${SESSION_ID}.jsonl"
    echo "{\"upload_url\": \"$UPLOAD_URL\", \"status\": \"already_exists\", \"error\": null}"
    exit 0
fi

# Commit and push
git add conversations/
git commit -m "Add conversation log ${SESSION_ID} for friction log issue #${ISSUE_NUMBER}" 2>/dev/null || {
    # If nothing to commit (file unchanged), still return success
    UPLOAD_URL="https://github.com/i-FeelBetter/fbagents/blob/$BRANCH/conversations/${SESSION_ID}.jsonl"
    echo "{\"upload_url\": \"$UPLOAD_URL\", \"status\": \"already_exists\", \"error\": null}"
    exit 0
}

if ! git push -u origin "$BRANCH" 2>/dev/null; then
    echo '{"error": "Failed to push to agent_conversations branch", "upload_url": null, "status": "failed"}'
    exit 1
fi

UPLOAD_URL="https://github.com/i-FeelBetter/fbagents/blob/$BRANCH/conversations/${SESSION_ID}.jsonl"
echo "{\"upload_url\": \"$UPLOAD_URL\", \"status\": \"success\", \"error\": null}"
