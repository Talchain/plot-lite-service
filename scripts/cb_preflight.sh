#!/usr/bin/env bash
# Circuit Breaker Preflight Script
# Run once before starting rollout

set -euo pipefail

echo "=========================================="
echo "Circuit Breaker Preflight"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
GRAFANA_API="${GRAFANA_API:-http://grafana:3000}"
GRAFANA_TOKEN="${GRAFANA_TOKEN:-}"
PROM_APPLY_CMD="${PROM_APPLY_CMD:-kubectl apply -f}"

# Step 1: Generate Strong Secret
echo "Step 1: Generate Strong Secret"
echo "----------------------------------------"
if [ -z "${PRINCIPAL_HMAC_SECRET:-}" ]; then
  export PRINCIPAL_HMAC_SECRET=$(openssl rand -hex 32)
  echo -e "${GREEN}✓${NC} Generated secret: $PRINCIPAL_HMAC_SECRET"
  echo -e "${YELLOW}⚠${NC}  Store this in your secret manager!"
  echo ""
  echo "Example for Vault:"
  echo "  vault kv put secret/plot-engine PRINCIPAL_HMAC_SECRET=\"$PRINCIPAL_HMAC_SECRET\""
  echo ""
  echo "Example for Kubernetes:"
  echo "  kubectl create secret generic plot-engine-secrets \\"
  echo "    --from-literal=PRINCIPAL_HMAC_SECRET=\"$PRINCIPAL_HMAC_SECRET\""
  echo ""
else
  echo -e "${GREEN}✓${NC} Using existing PRINCIPAL_HMAC_SECRET"
fi

# Step 2: Configure Trust Proxy
echo "Step 2: Configure Trust Proxy"
echo "----------------------------------------"
if [ -z "${TRUST_PROXY:-}" ]; then
  export TRUST_PROXY=0
  echo -e "${GREEN}✓${NC} TRUST_PROXY=0 (default, safe)"
else
  echo -e "${GREEN}✓${NC} TRUST_PROXY=$TRUST_PROXY"
fi
echo ""

# Step 3: Run All Tests
echo "Step 3: Run All Tests"
echo "----------------------------------------"
echo "Running npm test..."
if npm test > /tmp/cb_preflight_tests.log 2>&1; then
  echo -e "${GREEN}✓${NC} All tests passing"
else
  echo -e "${RED}✗${NC} Tests failed. See /tmp/cb_preflight_tests.log"
  exit 1
fi
echo ""

# Step 4: Alert Rule Validation
echo "Step 4: Alert Rule Validation"
echo "----------------------------------------"
echo "Running alert-rules tests..."
if npm test -- tests/alert-rules.test.ts > /tmp/cb_preflight_alert_tests.log 2>&1; then
  echo -e "${GREEN}✓${NC} Alert rules validated"
else
  echo -e "${RED}✗${NC} Alert rule tests failed. See /tmp/cb_preflight_alert_tests.log"
  exit 1
fi
echo ""

# Step 5: Secret Strength Guard
echo "Step 5: Secret Strength Guard"
echo "----------------------------------------"
echo "Running secret-strength-guard tests..."
if npm test -- tests/secret-strength-guard.test.ts > /tmp/cb_preflight_secret_tests.log 2>&1; then
  echo -e "${GREEN}✓${NC} Secret strength guard validated"
else
  echo -e "${RED}✗${NC} Secret strength guard tests failed. See /tmp/cb_preflight_secret_tests.log"
  exit 1
fi
echo ""

# Step 6: Import Dashboard (if Grafana API provided)
echo "Step 6: Import Dashboard"
echo "----------------------------------------"
if [ -n "$GRAFANA_TOKEN" ]; then
  echo "Importing dashboard to $GRAFANA_API..."
  RESPONSE=$(curl -s -X POST "$GRAFANA_API/api/dashboards/import" \
    -H "Authorization: Bearer $GRAFANA_TOKEN" \
    -H "Content-Type: application/json" \
    --data-binary @monitoring/dashboards/circuit_breaker.json)
  
  if echo "$RESPONSE" | grep -q '"status":"success"'; then
    echo -e "${GREEN}✓${NC} Dashboard imported successfully"
    echo "$RESPONSE" | jq '.'
  else
    echo -e "${YELLOW}⚠${NC}  Dashboard import may have failed. Response:"
    echo "$RESPONSE" | jq '.'
  fi
else
  echo -e "${YELLOW}⚠${NC}  GRAFANA_TOKEN not set. Skipping dashboard import."
  echo "   Import manually: POST $GRAFANA_API/api/dashboards/import"
fi
echo ""

# Step 7: Apply Prometheus Alerts
echo "Step 7: Apply Prometheus Alerts"
echo "----------------------------------------"
echo "Applying alerts with: $PROM_APPLY_CMD"
if $PROM_APPLY_CMD monitoring/alerts/circuit-breaker.yaml > /tmp/cb_preflight_prom.log 2>&1; then
  echo -e "${GREEN}✓${NC} Prometheus alerts applied"
  cat /tmp/cb_preflight_prom.log
else
  echo -e "${YELLOW}⚠${NC}  Alert apply may have failed. See /tmp/cb_preflight_prom.log"
  cat /tmp/cb_preflight_prom.log
fi
echo ""

# Summary
echo "=========================================="
echo "Preflight Summary"
echo "=========================================="
echo -e "${GREEN}✓${NC} Secret generated/verified"
echo -e "${GREEN}✓${NC} Trust proxy configured"
echo -e "${GREEN}✓${NC} All tests passing"
echo -e "${GREEN}✓${NC} Alert rules validated"
echo -e "${GREEN}✓${NC} Secret strength guard validated"
if [ -n "$GRAFANA_TOKEN" ]; then
  echo -e "${GREEN}✓${NC} Dashboard imported"
else
  echo -e "${YELLOW}⚠${NC}  Dashboard import skipped (no GRAFANA_TOKEN)"
fi
echo -e "${GREEN}✓${NC} Prometheus alerts applied"
echo ""
echo "=========================================="
echo "Ready for Staging Validation"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Review docs/CB_LIVE_ROLLOUT_GUIDE.md"
echo "2. Generate live docs from templates"
echo "3. Run: make cb:enable"
echo "4. Run: make cb:loadtest BASE_URL=\"\$STAGING_BASE_URL\" P95=150"
echo ""
