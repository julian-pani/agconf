#!/bin/bash
# Finds the Claude Code session file containing a given marker.
#
# Usage: ./find-session-file.sh <marker>
# Output: JSON with session_id, session_file, and project_dir
#
# This is called AFTER the agent has output a unique marker to the conversation.

set -e

MARKER="$1"

if [ -z "$MARKER" ]; then
    echo '{"error": "No marker provided", "session_id": null, "session_file": null, "project_dir": null}'
    exit 1
fi

CLAUDE_PROJECTS_DIR="$HOME/.claude/projects"

if [ ! -d "$CLAUDE_PROJECTS_DIR" ]; then
    echo '{"error": "Claude Code projects directory not found", "session_id": null, "session_file": null, "project_dir": null}'
    exit 1
fi

# Find the file containing the marker
SESSION_FILE=$(grep -rl "$MARKER" "$CLAUDE_PROJECTS_DIR" 2>/dev/null | head -1)

if [ -z "$SESSION_FILE" ]; then
    echo '{"error": "Could not find session file with marker", "session_id": null, "session_file": null, "project_dir": null}'
    exit 1
fi

# Extract session ID from filename (filename is UUID.jsonl)
SESSION_ID=$(basename "$SESSION_FILE" .jsonl)

# Extract project directory from path
PROJECT_DIR=$(dirname "$SESSION_FILE")

# Output as JSON
cat << EOF
{
    "session_id": "$SESSION_ID",
    "session_file": "$SESSION_FILE",
    "project_dir": "$PROJECT_DIR"
}
EOF
