#!/bin/bash
set -e

export ENGINE_URL="https://plot-lite-service.onrender.com"

echo "🔍 Final Smoke Tests - Core Endpoints"
echo "Target: $ENGINE_URL"
echo ""

# Test 1: Root route (health check)
echo "✅ Test 1: GET / (root health check)"
ROOT=$(curl -s "$ENGINE_URL/")
STATUS=$(echo "$ROOT" | jq -r '.status')
if [ "$STATUS" = "ok" ]; then
  echo "✅ PASS: Root returns status ok"
  echo "$ROOT" | jq .
else
  echo "❌ FAIL: Root status is $STATUS"
  exit 1
fi
echo ""

# Test 2: V1 Health endpoint
echo "✅ Test 2: GET /v1/health"
HEALTH=$(curl -s "$ENGINE_URL/v1/health")
HEALTH_STATUS=$(echo "$HEALTH" | jq -r '.status')
if [ "$HEALTH_STATUS" = "ok" ]; then
  echo "✅ PASS: Health status is ok"
  echo "$HEALTH" | jq '{status, json_429_count, sse_429_count}'
else
  echo "❌ FAIL: Health status is $HEALTH_STATUS"
  exit 1
fi
echo ""

# Test 3: POST /v1/run (CRITICAL - UI endpoint)
echo "✅ Test 3: POST /v1/run (UI contract)"
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
echo "$RESPONSE" | jq '{bands: .summary.bands, confidence: .confidence, schema: .schema, meta: .meta}'
echo ""

# Test 4: Rate limiting (optional - may not trigger)
echo "✅ Test 4: Rate limiting check (making 4 rapid requests)"
RATE_LIMITED=false
for i in {1..4}; do
  HEADERS=$(curl -si -X POST "$ENGINE_URL/v1/run" \
    -H 'Content-Type: application/json' \
    -d "{\"seed\":$i,\"inputs\":{}}" 2>&1)
  
  STATUS=$(echo "$HEADERS" | grep "HTTP" | awk '{print $2}')
  
  if [ "$STATUS" = "429" ]; then
    echo "Got 429, checking headers..."
    echo "$HEADERS" | grep -i "Retry-After:" && echo "✅ Retry-After present"
    echo "$HEADERS" | grep -i "X-RateLimit-Reset:" && echo "✅ X-RateLimit-Reset present"
    echo "$HEADERS" | grep -i "X-RateLimit-Reason:" && echo "✅ X-RateLimit-Reason present"
    RATE_LIMITED=true
    break
  fi
  sleep 0.2
done

if [ "$RATE_LIMITED" = "false" ]; then
  echo "⚠️  INFO: Did not hit rate limit (RPM may be high or requests too slow)"
fi
echo ""

echo "🎉 All critical smoke tests passed!"
echo ""
echo "✅ Summary:"
echo "  - Root health check: OK"
echo "  - /v1/health: OK"
echo "  - POST /v1/run: OK (UI contract verified)"
echo "  - Rate limiting: $([ "$RATE_LIMITED" = "true" ] && echo "Verified" || echo "Not triggered")"
echo ""
echo "🚀 Service is LIVE and ready for UI integration!"
echo ""
echo "Next steps:"
echo "1. Flip UI to live: FEATURE_RESULTS_SOURCE=\"live\" ENGINE_BASE_URL=\"$ENGINE_URL\""
echo "2. Test UI integration"
echo "3. Monitor for 15 minutes"
