#!/usr/bin/env bash
# CI guard: fail if any .js file in src/ has a sibling .ts file (stale compiled output).
# Usage:
#   bash scripts/check-no-stale-js.sh          # CI mode: fail if stale files found
#   bash scripts/check-no-stale-js.sh --clean  # Build mode: auto-remove stale files
set -euo pipefail

CLEAN=false
if [[ "${1:-}" == "--clean" ]]; then
  CLEAN=true
fi

stale=$(find src -name '*.js' -exec sh -c 'test -f "${1%.js}.ts" && echo "$1"' _ {} \;)

if [ -z "$stale" ]; then
  echo "OK: No stale .js files in src/"
  exit 0
fi

if $CLEAN; then
  count=0
  while IFS= read -r f; do
    rm "$f"
    count=$((count + 1))
  done <<< "$stale"
  echo "Cleaned $count stale .js files from src/"
  exit 0
fi

echo "ERROR: Stale .js files found alongside .ts sources:"
echo "$stale"
echo ""
echo "These compiled .js files shadow TypeScript imports. Delete them:"
echo "  find src -name '*.js' -exec sh -c 'test -f \"\${1%.js}.ts\" && rm \"\$1\"' _ {} \\;"
exit 1
