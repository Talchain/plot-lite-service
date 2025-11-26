#!/bin/bash
# Deployment Verification Script
# Tests critical API functionality against any environment
#
# Usage:
#   ./scripts/verify-deployment.sh                           # Test local (localhost:4311)
#   ./scripts/verify-deployment.sh https://example.com       # Test specific URL
#   BASE_URL=https://example.com ./scripts/verify-deployment.sh
#
# Exit codes:
#   0 - All checks passed
#   1 - One or more checks failed

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Base URL - default to local
BASE_URL="${1:-${BASE_URL:-http://localhost:4311}}"

echo "=============================================="
echo "PLoT Engine Deployment Verification"
echo "=============================================="
echo "Target: $BASE_URL"
echo ""

PASSED=0
FAILED=0

# Helper function for test results
pass() {
  echo -e "${GREEN}✓ PASS${NC}: $1"
  ((PASSED++))
}

fail() {
  echo -e "${RED}✗ FAIL${NC}: $1"
  echo "  Details: $2"
  ((FAILED++))
}

warn() {
  echo -e "${YELLOW}⚠ WARN${NC}: $1"
}

# Test 1: Health endpoint responds
echo "--- Test 1: Health Check ---"
HEALTH=$(curl -s -w "\n%{http_code}" "$BASE_URL/health" 2>/dev/null)
HEALTH_CODE=$(echo "$HEALTH" | tail -n1)
HEALTH_BODY=$(echo "$HEALTH" | sed '$d')

if [ "$HEALTH_CODE" = "200" ]; then
  pass "Health endpoint returns 200"
else
  fail "Health endpoint" "Expected 200, got $HEALTH_CODE"
fi

# Test 2: Version endpoint has capabilities
echo ""
echo "--- Test 2: Version & Capabilities ---"
VERSION=$(curl -s -w "\n%{http_code}" "$BASE_URL/version" 2>/dev/null)
VERSION_CODE=$(echo "$VERSION" | tail -n1)
VERSION_BODY=$(echo "$VERSION" | sed '$d')

if [ "$VERSION_CODE" = "200" ]; then
  pass "Version endpoint returns 200"

  # Check for capabilities field
  if echo "$VERSION_BODY" | grep -q '"capabilities"'; then
    pass "Version includes capabilities field"

    # Check for detail_level in capabilities
    if echo "$VERSION_BODY" | grep -q '"detail_level"'; then
      pass "Capabilities includes detail_level"
    else
      fail "Capabilities detail_level" "detail_level not found in capabilities"
    fi
  else
    warn "Version missing capabilities field (older deployment?)"
    echo "  Response: $VERSION_BODY"
  fi

  # Extract and display version info
  VERSION_NUM=$(echo "$VERSION_BODY" | grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4 || echo "unknown")
  BUILD=$(echo "$VERSION_BODY" | grep -o '"build"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4 || echo "unknown")
  echo "  Version: $VERSION_NUM, Build: $BUILD"
else
  fail "Version endpoint" "Expected 200, got $VERSION_CODE"
fi

# Test 3: /v1/run accepts detail_level
echo ""
echo "--- Test 3: /v1/run with detail_level ---"

# Minimal valid graph payload
PAYLOAD='{
  "graph": {
    "nodes": [
      {"id": "A", "label": "Node A"},
      {"id": "B", "label": "Node B"}
    ],
    "edges": [
      {"from": "A", "to": "B", "weight": 0.8}
    ]
  },
  "seed": 42,
  "detail_level": "quick"
}'

RUN_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-Request-Id: verify-deployment-$(date +%s)" \
  -d "$PAYLOAD" \
  "$BASE_URL/v1/run" 2>/dev/null)

RUN_CODE=$(echo "$RUN_RESPONSE" | tail -n1)
RUN_BODY=$(echo "$RUN_RESPONSE" | sed '$d')

if [ "$RUN_CODE" = "200" ]; then
  pass "/v1/run accepts detail_level: quick"

  # Check for trace_id passthrough
  if echo "$RUN_BODY" | grep -q '"trace_id"'; then
    pass "Response includes trace_id"
  fi

  # Check model_card has detail_level
  if echo "$RUN_BODY" | grep -q '"detail_level"'; then
    pass "model_card echoes detail_level"
  fi
elif [ "$RUN_CODE" = "400" ]; then
  # Check if it's the "Unknown field" error
  if echo "$RUN_BODY" | grep -q "Unknown field.*detail_level"; then
    fail "/v1/run detail_level" "Backend does not support detail_level (older deployment)"
    echo "  This is the CRITICAL issue - backend needs to be redeployed"
  else
    fail "/v1/run validation" "400 error: $(echo "$RUN_BODY" | head -c 200)"
  fi
elif [ "$RUN_CODE" = "504" ]; then
  warn "/v1/run returned 504 (Gateway Timeout)"
  echo "  This is expected if running through a proxy with short timeout"
  echo "  The request format is likely correct"
else
  fail "/v1/run request" "Expected 200, got $RUN_CODE"
  echo "  Response: $(echo "$RUN_BODY" | head -c 200)"
fi

# Test 4: HEAD /v1/run for UI probe compatibility
echo ""
echo "--- Test 4: HEAD /v1/run Probe ---"
HEAD_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X HEAD "$BASE_URL/v1/run" 2>/dev/null)

if [ "$HEAD_CODE" = "405" ]; then
  pass "HEAD /v1/run returns 405 (Method Not Allowed) as expected"
else
  fail "HEAD /v1/run" "Expected 405, got $HEAD_CODE"
fi

# Summary
echo ""
echo "=============================================="
echo "Summary"
echo "=============================================="
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo ""

if [ "$FAILED" -gt 0 ]; then
  echo -e "${RED}VERIFICATION FAILED${NC}"
  echo ""
  echo "Common issues:"
  echo "1. 'Unknown field: detail_level' -> Backend deployment is behind main branch"
  echo "2. 504 timeout -> Proxy timeout issue (not a backend bug)"
  echo "3. Missing capabilities -> Older backend version deployed"
  exit 1
else
  echo -e "${GREEN}ALL CHECKS PASSED${NC}"
  exit 0
fi
