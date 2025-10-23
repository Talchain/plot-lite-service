#!/bin/bash
set -euo pipefail

echo "==> P1: error.v1 Envelope Proofs"
echo

# Start server in background
PORT=3501 RATE_LIMIT_ENABLED=1 RATE_LIMIT_MAX=2 AUTH_ENABLED=0 node dist/main.js &
PID=$!
sleep 2

echo "1. Rate limit proof (RATE_LIMITED with retry_after and headers)"
echo "   Sending 3 requests to exhaust rate limit..."

for i in 1 2 3; do
  echo "   Request $i:"
  curl -s -i "http://localhost:3501/v1/run" \
    -H "Content-Type: application/json" \
    -d '{"template":"test","graph":{"nodes":[{"id":"1","label":"A"}],"edges":[]}}' \
    | grep -E "HTTP/|Retry-After|X-RateLimit|schema|code|retry_after" || true
  echo
done

echo
echo "2. Unit test results:"
npx vitest run tests/p1-error-envelope.unit.test.ts 2>&1 | grep -A5 "Test Files"

kill $PID 2>/dev/null || true
echo
echo "==> P1 Proofs complete"
