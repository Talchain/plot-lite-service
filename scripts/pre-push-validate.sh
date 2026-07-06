#!/usr/bin/env bash
# Pre-push validation gate for plot-lite-service.
# Runs 7 ordered checks before allowing a push. Any failure blocks the push.
#
# Usage:
#   bash scripts/pre-push-validate.sh          # manual run
#   (also invoked via .husky/pre-push and Claude Code PreToolUse hook)
#
# Bypass (emergency only):
#   git push --no-verify origin <branch>
#
# Exit codes:
#   0 = all checks passed
#   1 = one or more checks failed

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

# ---------------------------------------------------------------------------
# Hook-environment hygiene.
#
# git exports GIT_DIR (and friends) when it invokes a hook such as pre-push.
# Every git command below must resolve THIS worktree from the current
# directory, never an inherited GIT_DIR that points at some other worktree's
# gitdir — so unset them up front. Harmless for manual runs.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE 2>/dev/null || true

# Self-heal a provably-wrong `core.bare`.
#
# This repo has `extensions.worktreeConfig=true`, which makes `core.bare`
# worktree-scoped. A concurrent or interrupted git write (a killed process
# leaving a *.lock, parallel worktree ops) can leave `core.bare=true` in a
# worktree scope, overriding the correct shared `false`. When that happens,
# EVERY work-tree git command — starting with the `rev-parse --show-toplevel`
# below — dies with the opaque "fatal: this operation must be run in a work
# tree", silently blocking all pushes from that worktree until someone finds
# and clears it.
#
# We are standing in a checked-out worktree with source files, so a `bare`
# view is definitively a corruption, not a real bare repo. Detect it and
# correct it loudly (worktree-scoped when the extension is on), rather than
# failing with an inscrutable message.
if [ -f "package.json" ] && [ "$(git config --get core.bare 2>/dev/null || echo false)" = "true" ]; then
  echo -e "  ${YELLOW}WARN${NC} core.bare=true in a checked-out worktree — corruption (see extensions.worktreeConfig). Self-healing to false." >&2
  if [ "$(git config --get extensions.worktreeConfig 2>/dev/null || echo false)" = "true" ]; then
    git config --worktree core.bare false 2>/dev/null || git config core.bare false
  else
    git config core.bare false
  fi
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

FAILURES=0
CHECKS_RUN=0

pass() { echo -e "  ${GREEN}PASS${NC} [$1] $2"; }
fail() { echo -e "  ${RED}FAIL${NC} [$1] $2"; FAILURES=$((FAILURES + 1)); }
skip() { echo -e "  ${YELLOW}SKIP${NC} [$1] $2"; }

# ---------------------------------------------------------------------------
# Check 1: Branch guard
# Prevents: accidental production deployment by pushing directly to main.
# See CLAUDE.md incident log (2026-01-23) for why this matters.
# ---------------------------------------------------------------------------
run_check_1() {
  CHECKS_RUN=$((CHECKS_RUN + 1))
  local branch
  branch="$(git rev-parse --abbrev-ref HEAD)"
  if [ "$branch" = "main" ]; then
    fail "1/7" "Direct push to 'main' is blocked. Use a PR or push to 'staging'."
    echo "         See CLAUDE.md deployment safety rules."
    return 1
  fi
  pass "1/7" "Branch guard (current: $branch)"
}

# ---------------------------------------------------------------------------
# Check 2: TypeScript compilation
# Prevents: deploying code with type errors that would fail the Render build.
# ---------------------------------------------------------------------------
run_check_2() {
  CHECKS_RUN=$((CHECKS_RUN + 1))
  if ! command -v npx >/dev/null 2>&1; then
    fail "2/7" "npx not found. Install Node.js >= 20."
    return 1
  fi
  echo "    Running: npx tsc --noEmit ..."
  local tsc_output
  tsc_output="$(npx tsc --noEmit 2>&1)" || {
    echo "$tsc_output"
    fail "2/7" "TypeScript compilation failed. Run: npx tsc --noEmit"
    return 1
  }
  pass "2/7" "TypeScript compilation (tsc --noEmit)"
}

# ---------------------------------------------------------------------------
# Check 3: Full test suite
# Prevents: deploying code with failing tests.
# Runs: node tools/run-all-tests.js (build + vitest + fixtures + loadcheck)
# ---------------------------------------------------------------------------
run_check_3() {
  CHECKS_RUN=$((CHECKS_RUN + 1))
  if ! command -v npm >/dev/null 2>&1; then
    fail "3/7" "npm not found. Install Node.js >= 20."
    return 1
  fi
  echo "    Running: npm test (this may take 60-90s) ..."
  local test_log
  test_log="$(mktemp)"
  if npm test > "$test_log" 2>&1; then
    # Extract pass/fail counts from vitest output
    local summary
    summary="$(grep -E 'Tests\s+[0-9]' "$test_log" | tail -1 || true)"
    rm -f "$test_log"
    pass "3/7" "Full test suite${summary:+ — $summary}"
  else
    echo "    --- test output (last 40 lines) ---"
    tail -40 "$test_log"
    echo "    --- end test output ---"
    echo "    Full log: $test_log"
    fail "3/7" "Test suite failed. Run: npm test"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Check 4: Stale .js detection
# Prevents: compiled .js files accidentally tracked by git alongside .ts sources.
# Node resolves the stale .js instead of the .ts, causing silent bugs.
# Uses git ls-files (not filesystem scan) because .gitignore excludes src/**/*.js —
# the ~249 local build artifacts are expected and invisible to this check.
# ---------------------------------------------------------------------------
run_check_4() {
  CHECKS_RUN=$((CHECKS_RUN + 1))
  local tracked_js
  tracked_js="$(git ls-files -- 'src/*.js' 'src/**/*.js' 2>/dev/null || true)"

  if [ -z "$tracked_js" ]; then
    pass "4/7" "No stale .js files tracked in src/"
    return 0
  fi

  # Filter: only flag .js files that have a co-located .ts file
  local stale_files=()
  while IFS= read -r jsfile; do
    [ -z "$jsfile" ] && continue
    local tsfile="${jsfile%.js}.ts"
    if [ -f "$tsfile" ]; then
      stale_files+=("$jsfile")
    fi
  done <<< "$tracked_js"

  if [ "${#stale_files[@]}" -eq 0 ]; then
    pass "4/7" "No stale .js files (tracked .js files have no co-located .ts)"
    return 0
  fi

  fail "4/7" "Found ${#stale_files[@]} stale compiled .js file(s) tracked by git:"
  for f in "${stale_files[@]}"; do
    echo "         $f"
  done
  echo "         Fix: git rm --cached <file(s)> — these should be in .gitignore"
  return 1
}

# ---------------------------------------------------------------------------
# Check 5: Dependency audit
# Prevents: file: references in package.json/lock that work locally but fail on Render.
# ---------------------------------------------------------------------------
run_check_5() {
  CHECKS_RUN=$((CHECKS_RUN + 1))
  local found=0

  if grep -qE '"file:' package.json 2>/dev/null; then
    fail "5/7" "package.json contains file: dependency references:"
    grep -nE '"file:' package.json | sed 's/^/         /'
    found=1
  fi

  # Check whichever lock file exists
  local lockfile=""
  if [ -f "pnpm-lock.yaml" ]; then
    lockfile="pnpm-lock.yaml"
  elif [ -f "package-lock.json" ]; then
    lockfile="package-lock.json"
  fi

  if [ -n "$lockfile" ] && grep -qE '"file:|file:' "$lockfile" 2>/dev/null; then
    fail "5/7" "$lockfile contains file: dependency references"
    found=1
  fi

  if [ "$found" -eq 0 ]; then
    pass "5/7" "No file: dependency references"
  fi
}

# ---------------------------------------------------------------------------
# Check 6: OpenAPI spec validation
# Validates contracts/openapi.yaml syntax and $ref resolution via Spectral.
# Catches: invalid YAML, unresolvable $ref, schema violations.
# ---------------------------------------------------------------------------
run_check_6() {
  CHECKS_RUN=$((CHECKS_RUN + 1))
  if ! command -v npx >/dev/null 2>&1; then
    fail "6/7" "npx not found. Install Node.js >= 20."
    return 1
  fi
  if [ ! -f contracts/openapi.yaml ]; then
    skip "6/7" "OpenAPI spec (contracts/openapi.yaml not found)"
    return 0
  fi
  echo "    Running: spectral lint contracts/openapi.yaml ..."
  local lint_output
  lint_output="$(npx spectral lint contracts/openapi.yaml --ruleset tools/spectral.rules.yaml 2>&1)" || {
    echo "$lint_output"
    fail "6/7" "OpenAPI spec validation failed. Run: npm run openapi:lint"
    return 1
  }
  pass "6/7" "OpenAPI spec validation (spectral lint)"
}

# ---------------------------------------------------------------------------
# Check 7: Summary
# ---------------------------------------------------------------------------
run_summary() {
  local branch
  branch="$(git rev-parse --abbrev-ref HEAD)"

  local compare_branch="origin/staging"
  if ! git rev-parse --verify "$compare_branch" >/dev/null 2>&1; then
    compare_branch="origin/main"
  fi

  local files_changed="?"
  files_changed="$(git diff --name-only "$compare_branch"...HEAD 2>/dev/null | wc -l | tr -d ' ')" || files_changed="?"

  echo ""
  echo "=========================================="
  echo "  Pre-push Validation Summary"
  echo "=========================================="
  echo "  Branch:         $branch"
  echo "  Files changed:  $files_changed (vs $compare_branch)"
  echo "  Checks run:     $CHECKS_RUN"
  echo "  Failures:       $FAILURES"
  echo ""

  if [ "$FAILURES" -gt 0 ]; then
    echo -e "  ${RED}${BOLD}Pre-push validation FAILED${NC} ($FAILURES check(s))"
    echo "  Push blocked. Fix the failures above and retry."
    echo "  Emergency bypass: git push --no-verify"
    echo "=========================================="
    return 1
  fi

  echo -e "  ${GREEN}${BOLD}Pre-push validation PASSED${NC}"
  echo "=========================================="
  return 0
}

# ===========================================================================
# Main
# ===========================================================================
echo "=========================================="
echo "  Pre-push Validation (plot-lite-service)"
echo "=========================================="
echo ""

run_check_1 || true
run_check_2 || true
run_check_3 || true
run_check_4 || true
run_check_5 || true
run_check_6 || true

# Summary determines the final exit code
run_summary
