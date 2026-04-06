#!/usr/bin/env bash
# Publish @razzgames/elizaos-plugin to npm and push to GitHub.
#
# Usage:
#   bash scripts/publish.sh              # dry-run (build + pack)
#   bash scripts/publish.sh --publish    # build + publish to npm
#   bash scripts/publish.sh --git-init   # init git repo + push to GitHub
#   bash scripts/publish.sh --all        # git init + push + npm publish

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$PLUGIN_ROOT/.env"

PUBLISH=false
GIT_INIT=false

for arg in "$@"; do
  case "$arg" in
    --publish) PUBLISH=true ;;
    --git-init) GIT_INIT=true ;;
    --all) PUBLISH=true; GIT_INIT=true ;;
    --dry-run) PUBLISH=false; GIT_INIT=false ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# Load tokens from .env
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE"
  set +a
else
  echo "ERROR: .env file not found at $ENV_FILE"
  echo "Create it with NPM_TOKEN and GITHUB_TOKEN"
  exit 1
fi

echo "=== @razzgames/elizaos-plugin - Publish Script ==="
echo "Root: $PLUGIN_ROOT"
echo ""

cd "$PLUGIN_ROOT"

# 1. Run tests
echo "Running tests..."
npm test
echo ""

# 2. Build
echo "Building..."
npm run build
echo ""

# 3. Verify package contents
echo "=== Package contents (npm pack --dry-run) ==="
npm pack --dry-run 2>&1
echo ""

# 4. Git init + push if requested
if [ "$GIT_INIT" = true ]; then
  if [ -z "${GITHUB_TOKEN:-}" ]; then
    echo "ERROR: GITHUB_TOKEN not set in .env"
    exit 1
  fi

  REMOTE_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/razz-games/razz-elizaos-plugin.git"

  if [ ! -d "$PLUGIN_ROOT/.git" ]; then
    echo "Initializing git repo..."
    git init
    git branch -M main
  fi

  # Set or update remote
  if git remote get-url origin &>/dev/null; then
    git remote set-url origin "$REMOTE_URL"
  else
    git remote add origin "$REMOTE_URL"
  fi

  git add -A
  git commit -m "Initial release v0.1.0 - ElizaOS plugin for Razz games" || echo "Nothing to commit"
  echo "Pushing to GitHub..."
  git push -u origin main
  echo "Pushed to GitHub!"
  echo ""
fi

# 5. Publish to npm if requested
if [ "$PUBLISH" = true ]; then
  if [ -z "${NPM_TOKEN:-}" ]; then
    echo "ERROR: NPM_TOKEN not set in .env"
    exit 1
  fi

  # Set npm token for this publish
  echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > "$PLUGIN_ROOT/.npmrc"
  echo "Publishing to npm..."
  npm publish --access public
  # Clean up local .npmrc (token stays in .env)
  rm -f "$PLUGIN_ROOT/.npmrc"
  echo ""
  echo "Published @razzgames/elizaos-plugin to npm!"
else
  echo "Dry-run complete. Use --publish to publish to npm, --git-init to push to GitHub, --all for both."
fi
