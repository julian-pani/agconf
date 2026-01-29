#!/bin/bash
# Discovers the current Claude Code session file by generating a unique marker
# and searching for it in the session logs.
#
# Usage: ./get-session-info.sh
# Output: JSON with session_id, session_file, and project_dir
#
# How it works:
# 1. Generate a unique marker (UUID)
# 2. Echo it (gets logged to the session JSONL)
# 3. Search for the marker in Claude Code project files
# 4. Extract session info from the found file

set -e

# Generate unique marker
MARKER="session-discovery-marker-$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || date +%s%N)"

# Echo the marker - this gets captured in the session log
echo "SESSION_DISCOVERY_MARKER: $MARKER" >&2

# Wait for file write
sleep 1

# Search for the marker in Claude Code session files
CLAUDE_PROJECTS_DIR="$HOME/.claude/projects"

if [ ! -d "$CLAUDE_PROJECTS_DIR" ]; then
    echo '{"error": "Claude Code projects directory not found", "session_id": null, "session_file": null, "project_dir": null}'
    exit 1
fi

# Find the file containing our marker
SESSION_FILE=$(grep -rl "$MARKER" "$CLAUDE_PROJECTS_DIR" 2>/dev/null | head -1)

if [ -z "$SESSION_FILE" ]; then
    # Retry after another second
    sleep 1
    SESSION_FILE=$(grep -rl "$MARKER" "$CLAUDE_PROJECTS_DIR" 2>/dev/null | head -1)
fi

if [ -z "$SESSION_FILE" ]; then
    echo '{"error": "Could not find session file", "session_id": null, "session_file": null, "project_dir": null}'
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
    "project_dir": "$PROJECT_DIR",
    "marker": "$MARKER"
}
EOF
