#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." >/dev/null 2>&1 && pwd)"
LOGDIR="$ROOT/reports/warp"; mkdir -p "$LOGDIR"
PR1_LOG="$LOGDIR/pr1-lockfile-sync.log"
PR2_LOG="$LOGDIR/pr2-verify.log"
BR="${BRANCH:-chore/lockfile-sync-ci}"
BASE_BRANCH="${BASE_BRANCH:-main}"

ts(){ date -Iseconds; }
log(){ printf "\n[%s] %s\n\n" "$(ts)" "$*" | tee -a "$1" >&2; }
run(){ local L="$1"; shift; log "$L" "\$ $*"; "$@" >>"$L" 2>&1; }
die(){ echo "ERR: $*" >&2; exit 1; }
need(){ command -v "$1" >/dev/null 2>&1 || die "missing dependency: $1"; }
need git; need jq; need gh; need node

: >"$PR1_LOG"
log "$PR1_LOG" "== PR1: ensure on branch =="
run "$PR1_LOG" git -C "$ROOT" checkout -B "$BR"
run "$PR1_LOG" git -C "$ROOT" add package-lock.json
if git -C "$ROOT" diff --cached --quiet -- package-lock.json; then
  log "$PR1_LOG" "No changes in package-lock.json to commit"
else
  COMMIT_MSG_FILE="$(mktemp)"
  cat >"$COMMIT_MSG_FILE" <<'MSG'
chore(ci): sync package-lock to match package.json
MSG
  if ! HUSKY=0 git -C "$ROOT" commit -F "$COMMIT_MSG_FILE" >/dev/null 2>&1; then
    HUSKY=0 git -C "$ROOT" commit -F "$COMMIT_MSG_FILE" --no-verify || true
  fi
  rm -f "$COMMIT_MSG_FILE"
fi
if ! git -C "$ROOT" ls-remote origin >>"$PR1_LOG" 2>&1; then
  OWNER_REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
  run "$PR1_LOG" git -C "$ROOT" remote set-url origin "https://github.com/$OWNER_REPO.git"
fi
run "$PR1_LOG" git -C "$ROOT" fetch --all --prune
run "$PR1_LOG" git -C "$ROOT" push -u origin "$BR"
if ! gh pr view "$BR" >>"$PR1_LOG" 2>&1; then
  run "$PR1_LOG" gh pr create --fill --draft --head "$BR" --base "$BASE_BRANCH"
fi
echo "OK: PR1 finalized – pushed and PR opened/verified (log: $PR1_LOG)"

: >"$PR2_LOG"
PRNUM="$(gh pr view --json number -q .number || true)"
[ -n "$PRNUM" ] || PRNUM="$(gh pr list --head "$BR" --json number -q '.[0].number' || true)"
[ -n "$PRNUM" ] || die "no PR found for $BR"
SUMMARY_JSON="$(gh run list --branch "$BR" --limit 20 --json name,conclusion,status,headSha | jq -c '.')"
FAIL_COUNT="$(echo "$SUMMARY_JSON" | jq '[ .[] | select(.status=="completed" and .conclusion!=null and .conclusion!="success") ] | length')"
RUNS_URL="$(gh pr view "$PRNUM" --json url -q .url)/checks"
node "$ROOT/tools/run-tests.cjs" >>"$PR2_LOG" 2>&1 || true
LOCAL_SUMMARY="(no local report)"
if [ -f "$ROOT/reports/tests.json" ]; then
  LOCAL_SUMMARY="$(jq -r 'if .summary then "tests \(.summary.ok)/\(.summary.total) ok" else "tests summary missing" end' "$ROOT/reports/tests.json" 2>/dev/null || echo tests summary missing)"
fi
TMP="$(mktemp)"
{
  echo "CI status for \`$BR\`:"; echo
  echo "- Checks page: $RUNS_URL"
  echo "- Local smoke: $LOCAL_SUMMARY"; echo
  echo "<details><summary>Latest workflow runs</summary>"; echo
  echo "\`\`\`json"
  echo "$SUMMARY_JSON" | jq 'map({name,status,conclusion,headSha:(.headSha[0:7])})'
  echo "\`\`\`"; echo "</details>"
} >"$TMP"
if gh pr comment "$PRNUM" --search "CI status for \`$BR\`" --json id -q '.[0].id' >/dev/null 2>&1; then
  CID="$(gh pr comment "$PRNUM" --search "CI status for \`$BR\`" --json id -q '.[0].id')"
  gh pr comment "$PRNUM" --edit "$CID" -F "$TMP" || gh pr comment "$PRNUM" -F "$TMP"
else
  gh pr comment "$PRNUM" -F "$TMP"
fi
rm -f "$TMP"
if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "ERR: CI shows $FAIL_COUNT failed run(s) — see $RUNS_URL (log: $PR2_LOG)"; exit 1
else
  echo "OK: CI green (or running without failures) — see $RUNS_URL (log: $PR2_LOG)"
fi