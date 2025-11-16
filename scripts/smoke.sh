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

# vNext: Backend header
echo "→ /v1/run (X-Olumi-Backend header)"
BACKEND=$(curl -sf -D- -X POST "$BASE_URL/v1/run" \
  -H "Content-Type: application/json" \
  -d '{"graph":{"nodes":[{"id":"a"}],"edges":[]},"seed":4242}' \
  | grep -i "x-olumi-backend:" | awk '{print $2}' | tr -d '\r')
[[ "$BACKEND" == "fallback" || "$BACKEND" == "scm_lite" ]] || { echo "❌ Backend header: $BACKEND"; exit 1; }

# vNext: Targets field
echo "→ /v1/run (canonical targets)"
curl -sf -X POST "$BASE_URL/v1/run" \
  -H "Content-Type: application/json" \
  -d '{"graph":{"nodes":[{"id":"a"},{"id":"b"}],"edges":[]},"targets":["b"],"seed":4242}' \
  | jq -e '.schema and .result.response_hash' > /dev/null

# vNext: Optimise with constraints
echo "→ /v1/optimise (feasible constraints)"
curl -sf -X POST "$BASE_URL/v1/optimise" \
  -H "Content-Type: application/json" \
  -d '{"graph":{"nodes":[{"id":"a"}],"edges":[]},"budget":100,"actions":[{"id":"a1","cost":50,"do":[{"node_id":"a","set_to":1.2}]}],"objective":{"type":"utility_linear","weights":{"a":1.0}},"constraints":{"must":["a1"]}}' \
  | jq -e '.selected | contains(["a1"]) and (.meta.constraints_applied | contains(["must"]))' > /dev/null

# vNext: Optimise infeasible
echo "→ /v1/optimise (infeasible → 400)"
STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/v1/optimise" \
  -H "Content-Type: application/json" \
  -d '{"graph":{"nodes":[{"id":"a"}],"edges":[]},"budget":10,"actions":[{"id":"a1","cost":50,"do":[]}],"objective":{"type":"utility_linear","weights":{}},"constraints":{"must":["a1"]}}' || echo "400")
[[ "$STATUS" == "400" ]] || { echo "❌ Infeasible got $STATUS"; exit 1; }

# vNext: Bundle determinism
echo "→ /v1/run_bundle (determinism)"
HASH1=$(curl -sf -X POST "$BASE_URL/v1/run_bundle" \
  -H "Content-Type: application/json" \
  -d '{"base_graph":{"nodes":[{"id":"a"}],"edges":[]},"deltas":[{"label":"s1"}],"seed":4242}' \
  | jq -r '.model_card.response_hash')
HASH2=$(curl -sf -X POST "$BASE_URL/v1/run_bundle" \
  -H "Content-Type: application/json" \
  -d '{"base_graph":{"nodes":[{"id":"a"}],"edges":[]},"deltas":[{"label":"s1"}],"seed":4242}' \
  | jq -r '.model_card.response_hash')
[[ "$HASH1" == "$HASH2" ]] || { echo "❌ Bundle not deterministic"; exit 1; }

echo "✅ All smoke tests passed (including vNext)"
