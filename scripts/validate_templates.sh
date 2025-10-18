#!/usr/bin/env bash
# Validates that all {{PLACEHOLDERS}} are filled in for given Markdown files.
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <files...>"
  exit 2
fi

FAILED=0
for f in "$@"; do
  if ! [ -f "$f" ]; then
    echo "❌ not found: $f"
    FAILED=1
    continue
  fi
  # Find tokens like {{SOMETHING}}
  MISSING="$(grep -o '{{[^}]\+}}' "$f" | sort -u || true)"
  if [ -n "$MISSING" ]; then
    echo "❌ unfilled placeholders in $f:"
    echo "$MISSING" | sed 's/^/   - /'
    FAILED=1
  else
    echo "✓ $f has no unfilled placeholders"
  fi
done

exit "$FAILED"
