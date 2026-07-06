#!/usr/bin/env bash
# Narrow file:-dependency policy (2026-07-05).
#
# Purpose of the original check: block file: references that work locally but
# fail on Render (paths outside the repo clone). An IN-REPO, git-tracked,
# sha256-manifested vendored tarball does not have that failure mode — it ships
# with the clone (the pattern CEE and DecisionGuideAI already deploy with).
#
# Allowed (exactly):   file:./vendor/talchain-schemas-<version>.tgz
#                      file:vendor/talchain-schemas-<version>.tgz   (lockfile form)
#   ... and only when the tarball exists, is git-tracked, and has a sibling
#   git-tracked "<name>.tgz.sha256" manifest whose hash matches the file.
#
# Still forbidden: file:../ anything, absolute paths, home-directory paths,
# any other file: dependency, untracked or unmanifested local artefacts.
#
# Usage: validate-file-deps.sh [dir]   (exit 0 = policy satisfied)
set -u

DIR="${1:-.}"
cd "$DIR" || { echo "POLICY: cannot cd to $DIR"; exit 1; }

ALLOWED_RE='^file:(\./)?vendor/talchain-schemas-[0-9][0-9A-Za-z.+-]*\.tgz$'
STATUS=0

note_fail() {
  echo "POLICY FAIL: $1"
  STATUS=1
}

check_specifier() {
  local spec="$1" origin="$2"
  if ! printf '%s' "$spec" | grep -qE "$ALLOWED_RE"; then
    note_fail "$origin: disallowed file: dependency '$spec' (only in-repo vendored talchain-schemas tarballs are permitted)"
    return
  fi
  local rel="${spec#file:}"
  rel="${rel#./}"
  if [ ! -f "$rel" ]; then
    note_fail "$origin: '$spec' allowed by pattern but tarball '$rel' does not exist"
    return
  fi
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    if ! git ls-files --error-unmatch "$rel" >/dev/null 2>&1; then
      note_fail "$origin: tarball '$rel' is not git-tracked (untracked local artefacts are forbidden)"
    fi
    if ! git ls-files --error-unmatch "$rel.sha256" >/dev/null 2>&1; then
      note_fail "$origin: sha256 manifest '$rel.sha256' is not git-tracked"
    fi
  fi
  if [ ! -f "$rel.sha256" ]; then
    note_fail "$origin: missing sha256 manifest '$rel.sha256' (integrity evidence required)"
    return
  fi
  local expected actual
  expected="$(awk '{print $1; exit}' "$rel.sha256")"
  actual="$(shasum -a 256 "$rel" | awk '{print $1}')"
  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
    note_fail "$origin: sha256 mismatch for '$rel' (manifest=$expected actual=$actual)"
  fi
}

# --- package.json: every "file:..." specifier must satisfy the policy -------
if [ -f package.json ]; then
  while IFS= read -r spec; do
    [ -n "$spec" ] && check_specifier "$spec" "package.json"
  done < <(grep -oE '"file:[^"]*"' package.json 2>/dev/null | tr -d '"')
fi

# --- lockfile: every file: occurrence must satisfy the policy ---------------
LOCKFILE=""
if [ -f pnpm-lock.yaml ]; then
  LOCKFILE="pnpm-lock.yaml"
elif [ -f package-lock.json ]; then
  LOCKFILE="package-lock.json"
fi
if [ -n "$LOCKFILE" ]; then
  while IFS= read -r spec; do
    [ -n "$spec" ] && check_specifier "$spec" "$LOCKFILE"
  done < <(grep -oE 'file:[^",[:space:]]*' "$LOCKFILE" 2>/dev/null | sort -u)
fi

if [ "$STATUS" -eq 0 ]; then
  echo "POLICY OK: file: dependencies (if any) are in-repo, git-tracked, sha256-manifested talchain-schemas tarballs"
fi
exit "$STATUS"
