#!/usr/bin/env bash
# Circuit Breaker Load Test Script
# Implements 6 scenarios from docs/LOADTEST_BREAKER.md
#
# Usage:
#   ./scripts/loadtest_breaker.sh --base-url http://localhost:3000 --p95-budget-ms 150
#   ./scripts/loadtest_breaker.sh --base-url https://staging.example.com --threshold 50 --window-ms 10000
#
# Flags:
#   --base-url URL         Target server (default: http://localhost:3000)
#   --p95-budget-ms MS     Max p95 latency overhead (default: 150ms)
#   --threshold N          Failure threshold for testing (default: 10)
#   --window-ms MS         Window size for testing (default: 5000)
#
# Exit codes:
#   0 = All tests passed
#   1 = One or more tests failed

set -euo pipefail

# Defaults
BASE_URL="${BASE_URL:-http://localhost:3000}"
P95_BUDGET_MS=150
THRESHOLD=10
WINDOW_MS=5000

# Parse flags
while [[ $# -gt 0 ]]; do
  case $1 in
    --base-url)
      BASE_URL="$2"
      shift 2
      ;;
    --p95-budget-ms)
      P95_BUDGET_MS="$2"
      shift 2
      ;;
    --threshold)
      THRESHOLD="$2"
      shift 2
      ;;
    --window-ms)
      WINDOW_MS="$2"
      shift 2
      ;;
    *)
      echo "Unknown flag: $1"
      exit 1
      ;;
  esac
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test results
PASSED=0
FAILED=0

echo "=========================================="
echo "Circuit Breaker Load Test"
echo "=========================================="
echo "Base URL: $BASE_URL"
echo "P95 Budget: ${P95_BUDGET_MS}ms"
echo "Threshold: $THRESHOLD"
echo "Window: ${WINDOW_MS}ms"
echo "=========================================="
echo ""

# Helper: Check if jq is available
if ! command -v jq &> /dev/null; then
  echo -e "${RED}✗ FAIL${NC}: jq is required but not installed"
  exit 1
fi

# Helper: Make request and return status code
make_request() {
  local method="$1"
  local path="$2"
  local payload="${3:-}"
  
  if [[ -n "$payload" ]]; then
    curl -s -w "%{http_code}" -o /dev/null \
      -X "$method" \
      -H "Content-Type: application/json" \
      -d "$payload" \
      "${BASE_URL}${path}"
  else
    curl -s -w "%{http_code}" -o /dev/null \
      -X "$method" \
      "${BASE_URL}${path}"
  fi
}

# Helper: Get health data
get_health() {
  curl -s "${BASE_URL}/v1/health" | jq -r "$1"
}

# Helper: Record test result
record_result() {
  local test_name="$1"
  local passed="$2"
  
  if [[ "$passed" == "true" ]]; then
    echo -e "${GREEN}✓ PASS${NC}: $test_name"
    ((PASSED++))
  else
    echo -e "${RED}✗ FAIL${NC}: $test_name"
    ((FAILED++))
  fi
}

echo "Test 1: Burst Load (Trip Global Circuit)"
echo "------------------------------------------"

# Generate burst of invalid requests
BURST_SIZE=$((THRESHOLD + 5))
echo "Sending $BURST_SIZE invalid requests..."

for i in $(seq 1 $BURST_SIZE); do
  make_request POST /v1/run '{}' > /dev/null 2>&1 || true
done

sleep 2

# Check if circuit opened
GLOBAL_STATE=$(get_health '.circuit_breaker.global.state // "unknown"')
if [[ "$GLOBAL_STATE" == "open" ]]; then
  record_result "Burst load trips circuit" "true"
else
  record_result "Burst load trips circuit (got: $GLOBAL_STATE)" "false"
fi

echo ""

# ==========================================

echo "Test 2: Recovery Cycle (Half-Open → Closed)"
echo "------------------------------------------"

# Wait for cooldown
echo "Waiting 12s for cooldown..."
sleep 12

# Trigger half-open transition
make_request POST /v1/run '{"graph":{"nodes":[{"id":"A","label":"A"}],"edges":[]},"outcome_node":"A"}' > /dev/null 2>&1 || true

sleep 1

HALF_OPEN_STATE=$(get_health '.circuit_breaker.global.state // "unknown"')
if [[ "$HALF_OPEN_STATE" == "half_open" ]]; then
  echo "Circuit entered half-open state"
  
  # Send successful probes
  echo "Sending 3 successful probes..."
  for i in {1..3}; do
    make_request POST /v1/run '{"graph":{"nodes":[{"id":"A","label":"A"}],"edges":[]},"outcome_node":"A"}' > /dev/null 2>&1 || true
    sleep 1
  done
  
  sleep 1
  
  CLOSED_STATE=$(get_health '.circuit_breaker.global.state // "unknown"')
  if [[ "$CLOSED_STATE" == "closed" ]]; then
    record_result "Recovery cycle (half-open → closed)" "true"
  else
    record_result "Recovery cycle (got: $CLOSED_STATE)" "false"
  fi
else
  record_result "Recovery cycle (never reached half-open)" "false"
fi

echo ""

# ==========================================

echo "Test 3: Half-Open Timeout (No Probes)"
echo "------------------------------------------"

# Trip circuit again
echo "Tripping circuit..."
for i in $(seq 1 $((THRESHOLD + 5))); do
  make_request POST /v1/run '{}' > /dev/null 2>&1 || true
done

sleep 2

# Wait for cooldown
echo "Waiting 12s for cooldown..."
sleep 12

# Trigger half-open
make_request POST /v1/run '{"graph":{"nodes":[{"id":"A","label":"A"}],"edges":[]},"outcome_node":"A"}' > /dev/null 2>&1 || true

sleep 1

# Wait for timeout (16s > 15s default)
echo "Waiting 16s for half-open timeout..."
sleep 16

# Next request should see reopened circuit
STATUS=$(make_request POST /v1/run '{"graph":{"nodes":[{"id":"A","label":"A"}],"edges":[]},"outcome_node":"A"}')

if [[ "$STATUS" == "503" ]]; then
  record_result "Half-open timeout reopens circuit" "true"
else
  record_result "Half-open timeout (got status: $STATUS)" "false"
fi

echo ""

# ==========================================

echo "Test 4: Drip Load (Should NOT Trip)"
echo "------------------------------------------"

# Reset circuit first
echo "Resetting circuit..."
sleep 12
for i in {1..3}; do
  make_request POST /v1/run '{"graph":{"nodes":[{"id":"A","label":"A"}],"edges":[]},"outcome_node":"A"}' > /dev/null 2>&1 || true
  sleep 1
done

sleep 2

# Send drip load (below threshold)
DRIP_SIZE=$((THRESHOLD / 2))
echo "Sending $DRIP_SIZE requests over 10s (drip)..."

for i in $(seq 1 $DRIP_SIZE); do
  make_request POST /v1/run '{}' > /dev/null 2>&1 || true
  sleep 2
done

sleep 1

DRIP_STATE=$(get_health '.circuit_breaker.global.state // "unknown"')
if [[ "$DRIP_STATE" == "closed" ]]; then
  record_result "Drip load does not trip circuit" "true"
else
  record_result "Drip load (got: $DRIP_STATE)" "false"
fi

echo ""

# ==========================================

echo "Test 5: Per-Principal Isolation"
echo "------------------------------------------"

# Reset circuit
echo "Resetting circuit..."
sleep 12
for i in {1..3}; do
  make_request POST /v1/run '{"graph":{"nodes":[{"id":"A","label":"A"}],"edges":[]},"outcome_node":"A"}' > /dev/null 2>&1 || true
  sleep 1
done

sleep 2

# Check if principal extraction is enabled
PE_MODE=$(get_health '.principal_extraction.mode // "unknown"')

if [[ "$PE_MODE" == "fallback" ]]; then
  echo "Principal extraction enabled (mode: fallback)"
  
  # Trip principal A
  echo "Tripping principal A..."
  for i in $(seq 1 $((THRESHOLD + 5))); do
    curl -s -o /dev/null \
      -X POST \
      -H "Content-Type: application/json" \
      -H "User-Agent: ClientA" \
      -d '{}' \
      "${BASE_URL}/v1/run" || true
  done
  
  sleep 2
  
  # Check principal B can still succeed
  STATUS_B=$(curl -s -w "%{http_code}" -o /dev/null \
    -X POST \
    -H "Content-Type: application/json" \
    -H "User-Agent: ClientB" \
    -d '{"graph":{"nodes":[{"id":"A","label":"A"}],"edges":[]},"outcome_node":"A"}' \
    "${BASE_URL}/v1/run")
  
  if [[ "$STATUS_B" == "200" ]]; then
    record_result "Per-principal isolation" "true"
  else
    record_result "Per-principal isolation (principal B got: $STATUS_B)" "false"
  fi
else
  echo -e "${YELLOW}⊘ SKIP${NC}: Per-principal isolation (degraded mode: $PE_MODE)"
fi

echo ""

# ==========================================

echo "Test 6: Performance Impact"
echo "------------------------------------------"

# Reset circuit
echo "Resetting circuit..."
sleep 12
for i in {1..3}; do
  make_request POST /v1/run '{"graph":{"nodes":[{"id":"A","label":"A"}],"edges":[]},"outcome_node":"A"}' > /dev/null 2>&1 || true
  sleep 1
done

sleep 2

# Measure latency (10 requests)
echo "Measuring p95 latency (10 requests)..."

LATENCIES=()
for i in {1..10}; do
  LATENCY=$(curl -s -w "%{time_total}" -o /dev/null \
    -X POST \
    -H "Content-Type: application/json" \
    -d '{"graph":{"nodes":[{"id":"A","label":"A"}],"edges":[]},"outcome_node":"A"}' \
    "${BASE_URL}/v1/run")
  
  # Convert to milliseconds
  LATENCY_MS=$(echo "$LATENCY * 1000" | bc)
  LATENCIES+=("$LATENCY_MS")
done

# Calculate p95 (9th value when sorted)
IFS=$'\n' SORTED=($(sort -n <<<"${LATENCIES[*]}"))
P95="${SORTED[8]}"

echo "p95 latency: ${P95}ms (budget: ${P95_BUDGET_MS}ms)"

# Check if within budget
if (( $(echo "$P95 <= $P95_BUDGET_MS" | bc -l) )); then
  record_result "Performance impact within budget" "true"
else
  record_result "Performance impact (p95: ${P95}ms > ${P95_BUDGET_MS}ms)" "false"
fi

echo ""

# ==========================================

echo "=========================================="
echo "Summary"
echo "=========================================="
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo "=========================================="

if [[ $FAILED -eq 0 ]]; then
  echo -e "${GREEN}✓ ALL TESTS PASSED${NC}"
  exit 0
else
  echo -e "${RED}✗ SOME TESTS FAILED${NC}"
  exit 1
fi
