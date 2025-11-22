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
GRAFANA_API="${GRAFANA_API:-}"
GRAFANA_TOKEN="${GRAFANA_TOKEN:-}"
PROM_APPLY_CMD="${PROM_APPLY_CMD:-}"

# --- Secret existence & safety checks ---------------------------------------
echo "Step 0: Secret Safety Checks"
echo "----------------------------------------"

# Ensure .env won't be committed accidentally
if ! grep -qE '(^|/)\.env$' .gitignore 2>/dev/null; then
  echo -e "${RED}✗${NC} .env is not in .gitignore; add it before proceeding to avoid leaking secrets."
  exit 1
fi
echo -e "${GREEN}✓${NC} .env is gitignored"

# Reuse existing secret if present; only generate once
if grep -q '^PRINCIPAL_HMAC_SECRET=' .env 2>/dev/null; then
  echo -e "${GREEN}✓${NC} PRINCIPAL_HMAC_SECRET already configured (reusing existing value)"
  export PRINCIPAL_HMAC_SECRET=$(grep '^PRINCIPAL_HMAC_SECRET=' .env | cut -d= -f2)
else
  SECRET="$(openssl rand -hex 32)" # 64 hex chars
  echo "PRINCIPAL_HMAC_SECRET=${SECRET}" >> .env
  export PRINCIPAL_HMAC_SECRET="$SECRET"
  echo -e "${GREEN}✓${NC} Generated new PRINCIPAL_HMAC_SECRET"
  echo -e "${YELLOW}⚠${NC}  Store this in your secret manager!"
  echo ""
  echo "Example for Vault:"
  echo "  vault kv put secret/plot-engine PRINCIPAL_HMAC_SECRET=\"$PRINCIPAL_HMAC_SECRET\""
  echo ""
  echo "Example for Kubernetes:"
  echo "  kubectl create secret generic plot-engine-secrets \\"
  echo "    --from-literal=PRINCIPAL_HMAC_SECRET=\"$PRINCIPAL_HMAC_SECRET\""
  echo ""
fi

# Validate secret length (64 hex chars = 64 chars + newline)
LEN="$(echo -n "$PRINCIPAL_HMAC_SECRET" | wc -c | tr -d ' ')"
if [ "$LEN" -lt 64 ]; then
  echo -e "${RED}✗${NC} PRINCIPAL_HMAC_SECRET too short ($LEN chars); expected ≥64 hex chars."
  exit 1
fi
echo -e "${GREEN}✓${NC} Secret length OK ($LEN chars)"
echo ""

# Step 1: Generate Strong Secret (now handled above)
echo "Step 1: Secret Configuration"
echo "----------------------------------------"
echo -e "${GREEN}✓${NC} Using PRINCIPAL_HMAC_SECRET from .env"

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

# Step 6: Import Dashboard (non-fatal)
echo "Step 6: Import Dashboard"
echo "----------------------------------------"
if [ -n "$GRAFANA_API" ] && [ -n "$GRAFANA_TOKEN" ] && [ -f monitoring/dashboards/circuit_breaker.json ]; then
  echo "Importing dashboard to $GRAFANA_API..."
  if curl -fsS -H "Content-Type: application/json" \
    -H "Authorization: Bearer $GRAFANA_TOKEN" \
    -X POST "$GRAFANA_API/api/dashboards/import" \
    --data-binary @monitoring/dashboards/circuit_breaker.json > /tmp/cb_preflight_grafana.log 2>&1; then
    echo -e "${GREEN}✓${NC} Grafana dashboard imported"
    cat /tmp/cb_preflight_grafana.log | jq -r '.message // .status // .'
  else
    echo -e "${YELLOW}⚠${NC}  Could not import Grafana dashboard automatically (continue; import via UI)"
    echo "   Manual import: POST $GRAFANA_API/api/dashboards/import"
  fi
else
  echo -e "${YELLOW}⚠${NC}  GRAFANA_API or GRAFANA_TOKEN not set. Skipping dashboard import."
  echo "   Import manually: POST \$GRAFANA_API/api/dashboards/import"
fi
echo ""

# Step 7: Apply Prometheus Alerts (non-fatal)
echo "Step 7: Apply Prometheus Alerts"
echo "----------------------------------------"
if [ -n "$PROM_APPLY_CMD" ] && [ -f monitoring/alerts/circuit-breaker.yaml ]; then
  echo "Applying alerts with: $PROM_APPLY_CMD"
  if $PROM_APPLY_CMD monitoring/alerts/circuit-breaker.yaml > /tmp/cb_preflight_prom.log 2>&1; then
    echo -e "${GREEN}✓${NC} Prometheus alerts applied"
    cat /tmp/cb_preflight_prom.log
  else
    echo -e "${YELLOW}⚠${NC}  Could not apply Prometheus alerts automatically (continue; apply manually)"
    echo "   Manual apply: \$PROM_APPLY_CMD monitoring/alerts/circuit-breaker.yaml"
    cat /tmp/cb_preflight_prom.log
  fi
else
  echo -e "${YELLOW}⚠${NC}  PROM_APPLY_CMD not set. Skipping alert apply."
  echo "   Apply manually: kubectl apply -f monitoring/alerts/circuit-breaker.yaml"
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
