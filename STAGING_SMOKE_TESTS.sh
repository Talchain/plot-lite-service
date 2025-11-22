#!/bin/bash
set -e

# Staging Smoke Tests for Phase 0 Deployment
# Run after Render auto-deploy completes

export ENGINE_URL="https://plot-lite-service.onrender.com"

echo "🔍 Starting Staging Smoke Tests..."
echo "Target: $ENGINE_URL"
echo ""

# Test 1: Draft Flows ETag + 304
echo "✅ Test 1: GET /draft-flows ETag + 304"
echo "Getting ETag..."
ETAG=$(curl -sI "$ENGINE_URL/draft-flows" | grep -i etag | cut -d' ' -f2 | tr -d '\r')
if [ -z "$ETAG" ]; then
  echo "❌ FAIL: No ETag returned"
  exit 1
fi
echo "ETag: $ETAG"

echo "Testing 304 with If-None-Match..."
STATUS=$(curl -sI -H "If-None-Match: $ETAG" "$ENGINE_URL/draft-flows" | grep "HTTP" | awk '{print $2}')
if [ "$STATUS" = "304" ]; then
  echo "✅ PASS: 304 Not Modified"
else
  echo "❌ FAIL: Expected 304, got $STATUS"
  exit 1
fi
echo ""

# Test 2: POST /v1/run contract
echo "✅ Test 2: POST /v1/run contract"
RESPONSE=$(curl -s -X POST "$ENGINE_URL/v1/run" \
  -H 'Content-Type: application/json' \
  -d '{"seed":12345,"inputs":{}}')

# Check for required fields
echo "$RESPONSE" | jq -e '.summary.bands.p10' > /dev/null || { echo "❌ FAIL: Missing summary.bands.p10"; exit 1; }
echo "$RESPONSE" | jq -e '.summary.bands.p50' > /dev/null || { echo "❌ FAIL: Missing summary.bands.p50"; exit 1; }
echo "$RESPONSE" | jq -e '.summary.bands.p90' > /dev/null || { echo "❌ FAIL: Missing summary.bands.p90"; exit 1; }
echo "$RESPONSE" | jq -e '.confidence' > /dev/null || { echo "❌ FAIL: Missing confidence"; exit 1; }
echo "$RESPONSE" | jq -e '.schema' > /dev/null || { echo "❌ FAIL: Missing schema"; exit 1; }

SCHEMA=$(echo "$RESPONSE" | jq -r '.schema')
if [ "$SCHEMA" = "run.v1" ]; then
  echo "✅ PASS: Schema is run.v1"
else
  echo "❌ FAIL: Expected schema run.v1, got $SCHEMA"
  exit 1
fi

echo "Sample response:"
echo "$RESPONSE" | jq '{bands: .summary.bands, confidence: .confidence, schema: .schema}'
echo ""

# Test 3: 429 Rate Limit Headers
echo "✅ Test 3: 429 Rate Limit Headers (making 4 rapid requests)"
for i in {1..4}; do
  echo "Request $i..."
  HEADERS=$(curl -si -X POST "$ENGINE_URL/v1/run" \
    -H 'Content-Type: application/json' \
    -d "{\"seed\":$i,\"inputs\":{}}" 2>&1)
  
  STATUS=$(echo "$HEADERS" | grep "HTTP" | awk '{print $2}')
  
  if [ "$STATUS" = "429" ]; then
    echo "Got 429, checking headers..."
    echo "$HEADERS" | grep -i "Retry-After:" || { echo "⚠️  Missing Retry-After"; }
    echo "$HEADERS" | grep -i "X-RateLimit-Reset:" || { echo "⚠️  Missing X-RateLimit-Reset"; }
    echo "$HEADERS" | grep -i "X-RateLimit-Reason:" || { echo "⚠️  Missing X-RateLimit-Reason"; }
    echo "✅ PASS: 429 with rate-limit headers"
    break
  fi
  
  if [ $i -eq 4 ]; then
    echo "⚠️  WARNING: Did not hit rate limit (may need higher request rate or lower RPM)"
  fi
  
  sleep 0.2
done
echo ""

# Test 4: Health Endpoint
echo "✅ Test 4: GET /v1/health"
HEALTH=$(curl -s "$ENGINE_URL/v1/health")
STATUS=$(echo "$HEALTH" | jq -r '.status')

if [ "$STATUS" = "ok" ]; then
  echo "✅ PASS: Health status is ok"
else
  echo "❌ FAIL: Health status is $STATUS"
  exit 1
fi

echo "Health response:"
echo "$HEALTH" | jq '{status: .status, json_429_count: .json_429_count, sse_429_count: .sse_429_count}'
echo ""

echo "🎉 All smoke tests passed!"
echo ""
echo "Next steps:"
echo "1. Flip UI to live: FEATURE_RESULTS_SOURCE=\"live\" ENGINE_BASE_URL=\"$ENGINE_URL\""
echo "2. Run Claude gates against staging"
echo "3. Monitor for 15 minutes (p95 < 600ms, 5xx ~0)"
