#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
echo "🔍 Smoke Test - $BASE_URL"

# Health & Limits
echo "→ /v1/health"
curl -sf "$BASE_URL/v1/health" | jq -e '.json_429_count >= 0 and .sse_429_count >= 0' > /dev/null
echo "→ /v1/limits"
curl -sf "$BASE_URL/v1/limits" | jq -e '.nodes.max == 200 and .edges.max == 500' > /dev/null

# SSE (no 429)
echo "→ /v1/stream (SSE bypass)"
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "$BASE_URL/v1/stream?sleepMs=0")
[[ "$STATUS" == "200" ]] || { echo "❌ SSE got $STATUS"; exit 1; }

# /v1/run normal
echo "→ /v1/run (normal)"
curl -sf -X POST "$BASE_URL/v1/run" \
  -H "Content-Type: application/json" \
  -d '{"graph":{"nodes":[{"id":"a"}],"edges":[]},"seed":4242}' \
  | jq -e '.schema and .result.response_hash' > /dev/null

# Oversized (413 > 429)
echo "→ /v1/run (oversized → 413)"
PAYLOAD=$(printf '{"graph":{"nodes":[{"id":"a","data":"%2000000s"}],"edges":[]}}' "x")
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/v1/run" \
  -H "Content-Type: application/json" -d "$PAYLOAD" || echo "413")
[[ "$STATUS" == "413" ]] || { echo "❌ Oversize got $STATUS"; exit 1; }

# Bad param (400 > 429)
echo "→ /v1/run (bad param → 400)"
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/v1/run" \
  -H "Content-Type: application/json" -d '{"graph":{"nodes":[],"edges":[]},"k_samples":-1}' || echo "400")
[[ "$STATUS" == "400" ]] || { echo "❌ Bad param got $STATUS"; exit 1; }

# Headers check (GET success)
echo "→ GET /v1/limits (X-RateLimit-* headers)"
HEADERS=$(curl -sf -I "$BASE_URL/v1/limits")
echo "$HEADERS" | grep -q "X-RateLimit-Limit:" || { echo "❌ Missing X-RateLimit-Limit"; exit 1; }
echo "$HEADERS" | grep -q "X-RateLimit-Remaining:" || { echo "❌ Missing X-RateLimit-Remaining"; exit 1; }
echo "$HEADERS" | grep -q "X-RateLimit-Reset:" || { echo "❌ Missing X-RateLimit-Reset"; exit 1; }

echo "✅ All smoke tests passed"
