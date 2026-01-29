#!/bin/bash
# agent-conf pre-commit hook
# Prevents committing changes to managed files (skills and AGENTS.md global block)
#
# Installation:
#   Copy this file to .git/hooks/pre-commit
#   Or run: agent-conf hooks install

set -e

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the repository root
REPO_ROOT=$(git rev-parse --show-toplevel)

# Check if agent-conf has been synced
if [ ! -f "$REPO_ROOT/.agent-conf/lockfile.json" ]; then
    # Not synced, nothing to check
    exit 0
fi

BLOCKED_FILES=""

# Check for staged AGENTS.md changes to the global block
if git diff --cached --name-only --diff-filter=M | grep -q '^AGENTS\.md$'; then
    # Check if the global block markers are present (indicating it's managed)
    if grep -q '<!-- agent-conf:global:start -->' "$REPO_ROOT/AGENTS.md" 2>/dev/null; then
        # Get the diff for AGENTS.md and check if it touches the global block
        # We check if the diff includes lines within the global block
        DIFF=$(git diff --cached "$REPO_ROOT/AGENTS.md" 2>/dev/null || true)
        if echo "$DIFF" | grep -q '<!-- agent-conf:global:'; then
            BLOCKED_FILES="$BLOCKED_FILES\n  - AGENTS.md (global block)"
        fi
    fi
fi

# Find all staged SKILL.md files in .claude/skills or .codex/skills
STAGED_SKILL_FILES=$(git diff --cached --name-only --diff-filter=M | grep -E '^\.(claude|codex)/skills/.*/SKILL\.md$' || true)

# Check each skill file for agent_conf_managed metadata
for file in $STAGED_SKILL_FILES; do
    full_path="$REPO_ROOT/$file"

    # Check if file contains agent_conf_managed: "true"
    if grep -q 'agent_conf_managed:.*"true"' "$full_path" 2>/dev/null; then
        BLOCKED_FILES="$BLOCKED_FILES\n  - $file"
    fi
done

if [ -n "$BLOCKED_FILES" ]; then
    echo -e "${RED}Error: Cannot commit changes to agent-conf-managed files${NC}"
    echo -e "${YELLOW}The following files are managed by agent-conf and should not be modified:${NC}"
    echo -e "$BLOCKED_FILES"
    echo ""
    echo "These files will be overwritten on the next 'agent-conf sync'."
    echo ""
    echo "Options:"
    echo "  1. Discard your changes: git checkout -- <file>"
    echo "  2. Skip this check: git commit --no-verify"
    echo "  3. For AGENTS.md: edit only the repo-specific block (between repo:start and repo:end)"
    echo "  4. For skills: create a new custom skill instead"
    echo ""
    exit 1
fi

exit 0
