#!/usr/bin/env bash
# Claude Code PreToolUse hook wrapper.
# Intercepts Bash tool calls and runs pre-push validation when a git push is detected.
#
# Protocol (Claude Code PreToolUse):
#   stdin:  JSON with tool_input.command
#   exit 0  → allow the tool call
#   exit 2  → block the tool call (validation failed)

set -euo pipefail

INPUT="$(cat)"

# Parse command from JSON using Node.js (guaranteed available in this project).
COMMAND="$(echo "$INPUT" | node -e "
  let d = '';
  process.stdin.on('data', c => d += c);
  process.stdin.on('end', () => {
    try { process.stdout.write(JSON.parse(d).tool_input?.command || ''); }
    catch { process.stdout.write(''); }
  });
")"

# Only gate git push commands. Match: git push, git -C <path> push, cmd && git push, etc.
if echo "$COMMAND" | grep -qE '(^|&&|\|\||;)[[:space:]]*git[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?push([[:space:]]|$)'; then
  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  if ! bash "$REPO_ROOT/scripts/pre-push-validate.sh"; then
    exit 2
  fi
fi

# Not a push command, or validation passed
exit 0
