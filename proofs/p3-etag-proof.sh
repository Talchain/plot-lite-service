#!/bin/bash
set -euo pipefail

echo "==> P3: ETag Caching — Proof"
echo

PORT=3502 AUTH_ENABLED=0 node dist/main.js &
PID=$!
sleep 2

echo "1. First request (200 + ETag):"
RESP1=$(curl -si "http://localhost:3502/v1/limits")
echo "$RESP1" | grep -E "HTTP/|ETag|Cache-Control|max_nodes"
ETAG=$(echo "$RESP1" | grep -i "etag:" | awk '{print $2}' | tr -d '\r')
echo "   ETag: $ETAG"
echo

echo "2. Second request with If-None-Match (304):"
curl -si "http://localhost:3502/v1/limits" -H "If-None-Match: $ETAG" | grep -E "HTTP/|ETag"
echo

echo "3. Test results:"
npx vitest run tests/p3-etag-caching.int.test.ts 2>&1 | grep -A3 "Test Files"

kill $PID 2>/dev/null || true
echo
echo "==> P3 complete"
