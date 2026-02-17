#!/usr/bin/env bash
# Verify and repair git hook configuration for plot-lite-service.
# This repo uses Husky v9 — hooks live in .husky/, not .git/hooks/.
#
# Usage: bash scripts/install-hooks.sh

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "Checking git hooks configuration..."
echo ""

# Verify Husky hooksPath
HOOKS_PATH="$(git config core.hooksPath 2>/dev/null || echo "")"
if [ "$HOOKS_PATH" != ".husky/_" ]; then
  echo "  Setting core.hooksPath to .husky/_"
  git config core.hooksPath .husky/_
else
  echo "  core.hooksPath = .husky/_ (correct)"
fi

# Verify required files exist and are executable
OK=true
for f in .husky/pre-push scripts/pre-push-validate.sh scripts/install-hooks.sh scripts/claude-pre-push-gate.sh; do
  if [ -f "$f" ]; then
    chmod +x "$f"
    echo "  $f — exists, executable"
  else
    echo "  $f — MISSING"
    OK=false
  fi
done

echo ""
if [ "$OK" = true ]; then
  echo "All hooks configured. Test with: bash scripts/pre-push-validate.sh"
else
  echo "WARNING: Some files are missing. Check the output above."
  exit 1
fi
