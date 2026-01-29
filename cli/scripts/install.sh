#!/usr/bin/env bash
set -euo pipefail

# agent-conf CLI installer
# Usage: curl -fsSL https://raw.githubusercontent.com/org/agent-conf/master/cli/scripts/install.sh | bash
#
# Environment variables:
#   AGENT_CONF_VERSION - Version to install (default: latest)
#                        Examples: "latest", "v1.2.0", "1.2.0", "master"

REPO="org/agent-conf"
REPO_URL="https://github.com/${REPO}.git"
CLI_NAME="agent-conf"
VERSION="${AGENT_CONF_VERSION:-latest}"

# Colors (disable if not a terminal or NO_COLOR is set)
if [[ -t 1 ]] && [[ -z "${NO_COLOR:-}" ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    NC='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    NC=''
fi

log_info() {
    printf "${BLUE}info${NC} %s\n" "$1"
}

log_success() {
    printf "${GREEN}success${NC} %s\n" "$1"
}

log_warn() {
    printf "${YELLOW}warn${NC} %s\n" "$1"
}

log_error() {
    printf "${RED}error${NC} %s\n" "$1" >&2
}

# Check for required commands
check_requirements() {
    local missing=""

    for cmd in git node npm curl; do
        if ! command -v "$cmd" > /dev/null 2>&1; then
            missing="$missing $cmd"
        fi
    done

    if [[ -n "$missing" ]]; then
        log_error "Missing required commands:$missing"
        if [[ "$missing" == *"node"* ]] || [[ "$missing" == *"npm"* ]]; then
            log_info "Install Node.js 20+ from https://nodejs.org/"
        fi
        exit 1
    fi

    # Check Node.js version
    local node_version
    node_version=$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1) || node_version="0"
    if [[ "$node_version" -lt 20 ]]; then
        log_error "Node.js 20+ is required. Current version: $(node -v 2>/dev/null || echo 'unknown')"
        exit 1
    fi
}

# Get npm package manager (prefer pnpm if available)
get_pm() {
    if command -v pnpm > /dev/null 2>&1; then
        echo "pnpm"
    else
        echo "npm"
    fi
}

# Get GitHub token for API authentication
# Tries: gh auth token, then GITHUB_TOKEN env var
get_github_token() {
    # Try gh CLI first (preferred)
    if command -v gh > /dev/null 2>&1; then
        local token
        token=$(gh auth token 2>/dev/null || echo "")
        if [[ -n "$token" ]]; then
            echo "$token"
            return 0
        fi
    fi

    # Fall back to environment variable
    if [[ -n "${GITHUB_TOKEN:-}" ]]; then
        echo "$GITHUB_TOKEN"
        return 0
    fi

    return 1
}

# Fetch latest release tag from GitHub API (with authentication)
fetch_latest_release() {
    local token latest_tag

    # Try to get token
    if token=$(get_github_token); then
        # Try gh api first if available
        if command -v gh > /dev/null 2>&1; then
            latest_tag=$(gh api "repos/${REPO}/releases/latest" --jq '.tag_name' 2>/dev/null || echo "")
            if [[ -n "$latest_tag" ]]; then
                echo "$latest_tag"
                return 0
            fi
        fi

        # Fall back to curl with token
        latest_tag=$(curl -fsSL -H "Authorization: token ${token}" "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null | grep '"tag_name"' | sed -E 's/.*"tag_name": "([^"]+)".*/\1/' || echo "")
        if [[ -n "$latest_tag" ]]; then
            echo "$latest_tag"
            return 0
        fi
    fi

    # No authentication available
    return 1
}

# Resolve version to a git ref
# "latest" -> fetches latest release tag
# "v1.2.0" or "1.2.0" -> uses that tag
# "master" or other -> uses as-is (branch)
resolve_version() {
    local version="$1"

    if [[ "$version" == "latest" ]]; then
        log_info "Fetching latest release..."

        local latest_tag
        if latest_tag=$(fetch_latest_release); then
            log_info "Latest release: $latest_tag"
            echo "$latest_tag"
        else
            log_error "Could not fetch latest release. GitHub authentication required."
            echo ""
            log_info "To fix this, do one of the following:"
            echo ""
            echo "  1. Install and authenticate GitHub CLI (recommended):"
            echo "     brew install gh"
            echo "     gh auth login"
            echo ""
            echo "  2. Set GITHUB_TOKEN environment variable:"
            echo "     export GITHUB_TOKEN=<your-personal-access-token>"
            echo ""
            echo "  3. Install a specific version directly:"
            echo "     AGENT_CONF_VERSION=v0.0.1 bash -c '\$(curl -fsSL ...)'"
            echo ""
            exit 1
        fi
    elif [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9] ]]; then
        # Version without v prefix, add it
        echo "v$version"
    else
        # Use as-is (tag with v prefix or branch name)
        echo "$version"
    fi
}

# Install from source by cloning and building
install_from_source() {
    local ref temp_dir pm

    # Resolve version to git ref
    ref=$(resolve_version "$VERSION")

    log_info "Cloning ${REPO}@${ref}..."

    # Create temp directory (works on both macOS and Linux)
    temp_dir=$(mktemp -d 2>/dev/null || mktemp -d -t 'agent-conf')
    trap 'rm -rf "$temp_dir"' EXIT

    git clone --depth 1 --branch "$ref" "$REPO_URL" "$temp_dir"

    cd "$temp_dir/cli"

    pm=$(get_pm)
    log_info "Using $pm..."

    log_info "Installing dependencies..."
    if [[ "$pm" == "pnpm" ]]; then
        $pm install --frozen-lockfile 2>/dev/null || $pm install
    else
        $pm install
    fi

    log_info "Building..."
    $pm run build

    log_info "Installing globally..."
    npm install -g .

    log_success "Installed ${CLI_NAME} globally"
    post_install_message "$ref"
}

# Post-install message
post_install_message() {
    local ref="${1:-}"
    echo ""

    # Verify installation
    if command -v "$CLI_NAME" > /dev/null 2>&1; then
        local version
        version=$("$CLI_NAME" --version 2>/dev/null || echo "unknown")
        log_success "${CLI_NAME} v${version} is ready"
        if [[ -n "$ref" ]] && [[ "$ref" != "master" ]]; then
            log_info "Installed from: $ref"
        fi
    else
        log_warn "${CLI_NAME} was installed but is not in PATH"
        echo ""
        echo "You may need to add npm's global bin directory to your PATH."
        echo "Run 'npm bin -g' to find the directory."
        echo ""
    fi

    echo ""
    echo "Get started:"
    echo ""
    echo "  cd your-project"
    echo "  agent-conf init --source <owner/content-repo>"
    echo ""
    echo "Replace <owner/content-repo> with your organization's content repository"
    echo "(e.g., acme/engineering-standards)"
    echo ""
}

# Main
main() {
    echo ""
    echo "agent-conf CLI installer"
    echo ""

    check_requirements
    install_from_source
}

main "$@"
