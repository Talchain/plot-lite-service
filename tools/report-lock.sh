#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
LR="$ROOT/reports/warp/lock-report-v13.log"
MD="$ROOT/docs/lock-report-v1.3.md"
mkdir -p "$ROOT/docs" "$(dirname "$LR")"

{
  printf "# Lock Report v1.3\n\n"
  printf "**Branch:** %s  \n" "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo n/a)"
  printf "**Node:** %s  \n" "$(node -v 2>/dev/null || echo n/a)"
  printf "**HEAD:** %s  \n\n" "$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo n/a)"
  printf "## Log excerpt\n\n"
  printf "```text\n"
  if [ -f "$LR" ]; then
    sed -n "1,200p" "$LR" || true
  else
    echo "(no lock-report log found at $LR)"
  fi
  printf "\n```\n"
} > "$MD"

BR="rc/lock-report-v1.3"
if git -C "$ROOT" show-ref --verify --quiet "refs/heads/$BR"; then
  git -C "$ROOT" checkout "$BR"
else
  git -C "$ROOT" checkout -b "$BR"
fi

git -C "$ROOT" add "$MD"
HUSKY=0 git -C "$ROOT" commit -m "docs(report): refresh Lock Report v1.3 summary" || true

git -C "$ROOT" push -u origin "$BR" || true

if command -v gh >/dev/null 2>&1; then
  OWNER_REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
  if gh pr view >/dev/null 2>&1; then
    PRNUM="$(gh pr view --json number -q .number)"
  else
    gh pr create --fill --title "Lock Report v1.3" --base main --head "$BR" || true
    PRNUM="$(gh pr view --json number -q .number)"
  fi

  BODY="<!-- lock-report-v1.3 -->
Lock Report v1.3: regenerated summary. See \`docs/lock-report-v1.3.md\`.

\`\`\`text
$(if [ -f "$LR" ]; then sed -n "1,40p" "$LR"; else echo "(no lock-report log found)"; fi)
\`\`\`
"

  EXIST="$(gh api "repos/${OWNER_REPO}/issues/${PRNUM}/comments" --jq '.[] | select(.body|contains("<!-- lock-report-v1.3 -->")) | .id' | head -n1 || true)"
  if [ -n "${EXIST:-}" ]; then
    gh api --method PATCH "repos/${OWNER_REPO}/issues/comments/${EXIST}" --raw-field "body=$BODY"
  else
    gh api --method POST "repos/${OWNER_REPO}/issues/${PRNUM}/comments" --raw-field "body=$BODY"
  fi
fi

echo "OK: Lock Report regenerated -> $MD"
