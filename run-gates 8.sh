#!/bin/bash
# Quick gate validation script
# Usage: ./run-gates.sh <branch-name> <gate-letter>

set -e

BRANCH=${1:-main}
GATE=${2:-A}

echo "=== Running Gate $GATE on branch $BRANCH ==="

case $GATE in
  A)
    echo "Gate A: Repo Hygiene"
    git status --porcelain
    echo "Uncommitted files: $(git diff --name-only | wc -l)"
    echo "index.ts tracked: $(git ls-files src/routes/v1/index.ts | wc -l)"
    ;;
  B)
    echo "Gate B: Build + Test"
    git switch $BRANCH
    npm ci && npm run build
    npx vitest run | tee .ci-last.txt
    grep -E "Test Files:|Tests:" .ci-last.txt
    ;;
  D)
    echo "Gate D: Determinism 5×"
    PORT=3500 AUTH_ENABLED=0 node dist/main.js &
    PID=$!
    sleep 2
    node -e 'const f=async()=>{const r=await fetch("http://localhost:3500/v1/run?seed=1337");const j=await r.json();console.log(j.model_card?.response_hash)};(async()=>{for(let i=0;i<5;i++)await f()})()'
    kill $PID
    ;;
  E)
    echo "Gate E: Limits Caching"
    PORT=3500 AUTH_ENABLED=0 node dist/main.js &
    PID=$!
    sleep 2
    ETAG=$(curl -sD - http://localhost:3500/v1/limits -o /dev/null | awk -F': ' '/^ETag:/{print $2}' | tr -d '\r')
    echo "ETag: $ETAG"
    curl -s -o /dev/null -w "Status: %{http_code}\n" -H "If-None-Match: $ETAG" http://localhost:3500/v1/limits
    kill $PID
    ;;
  *)
    echo "Unknown gate: $GATE"
    echo "Available: A (hygiene), B (build+test), D (determinism), E (etag)"
    exit 1
    ;;
esac
