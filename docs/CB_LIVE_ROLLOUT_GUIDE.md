# Circuit Breaker: Live Rollout Guide

**Purpose**: Step-by-step commands for executing a real production rollout  
**Prerequisites**: All code merged, tests passing, templates ready

---

## Setup: Generate Live Docs from Templates

```bash
# Set your details
DATE=$(date +%Y-%m-%d)
OWNER="<your-name>"
STAGING_BASE_URL="https://staging.example.com"
CANARY_URL="https://canary.example.com"
PROD_URL="https://prod.example.com"
P95_BUDGET_MS=150
THRESHOLD=50
WINDOW_MS=10000

# Generate live docs from templates
for f in STAGING_LOADTEST_TRANSCRIPT CANARY_25_MONITORING PROGRESSIVE_ROLLOUT CB_ROLLOUT_COMPLETE; do
  sed -e "s/{{DATE}}/$DATE/g" \
      -e "s/{{OWNER}}/$OWNER/g" \
      -e "s/{{P95_BUDGET_MS}}/$P95_BUDGET_MS/g" \
      -e "s/{{THRESHOLD}}/$THRESHOLD/g" \
      -e "s/{{WINDOW_MS}}/$WINDOW_MS/g" \
      -e "s/{{STAGING_BASE_URL}}/$STAGING_BASE_URL/g" \
      -e "s/{{CANARY_URL}}/$CANARY_URL/g" \
      -e "s/{{PROD_URL}}/$PROD_URL/g" \
    templates/rollout/${f}.template.md > docs/live/${f}.md
done

echo "✅ Live docs created in docs/live/"
```

---

## Step 0: Preflight (Run Once)

### 0.1 Generate Strong Secret

```bash
# Generate 64-hex secret (32 bytes)
export PRINCIPAL_HMAC_SECRET=$(openssl rand -hex 32)
echo "Generated secret: $PRINCIPAL_HMAC_SECRET"

# Store in secret manager (adjust to your infra)
# Example for Vault:
vault kv put secret/plot-engine PRINCIPAL_HMAC_SECRET="$PRINCIPAL_HMAC_SECRET"

# Example for Kubernetes:
kubectl create secret generic plot-engine-secrets \
  --from-literal=PRINCIPAL_HMAC_SECRET="$PRINCIPAL_HMAC_SECRET"
```

### 0.2 Configure Trust Proxy

```bash
# If behind LB/proxy:
export TRUST_PROXY=1
export TRUST_PROXY_HOPS=1

# Otherwise (default, safe):
export TRUST_PROXY=0
```

### 0.3 Run All Tests

```bash
# All tests (should be green)
npm test

# Alert rule validation
npm test -- tests/alert-rules.test.ts

# Secret strength guard
npm test -- tests/secret-strength-guard.test.ts

# Expected: All passing ✅
```

### 0.4 Import Dashboard

```bash
# Set Grafana API URL
GRAFANA_API="http://grafana:3000"
GRAFANA_TOKEN="<your-api-token>"

# Import dashboard
curl -s -X POST "$GRAFANA_API/api/dashboards/import" \
  -H "Authorization: Bearer $GRAFANA_TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @monitoring/dashboards/circuit_breaker.json

# Expected: {"status": "success", "uid": "..."}
```

### 0.5 Apply Prometheus Alerts

```bash
# Set Prometheus apply command (adjust to your infra)
# Example for Kubernetes:
PROM_APPLY_CMD="kubectl apply -f"

# Apply alerts
$PROM_APPLY_CMD monitoring/alerts/circuit-breaker.yaml

# Expected: prometheusrule.monitoring.coreos.com/circuit-breaker configured
```

**Record outputs in `docs/live/CB_ROLLOUT_COMPLETE.md`**

---

## Step 1: Staging Validation

### 1.1 Enable Breaker (Staging)

```bash
# Enable circuit breaker
make cb:enable

# Verify version
make cb:version BASE_URL="$STAGING_BASE_URL"
# Expected: RL_CB_ENABLE="1"

# Check health
make cb:health BASE_URL="$STAGING_BASE_URL"
# Expected: principal_extraction.mode="fallback", circuit_breaker.global.state="closed"
```

### 1.2 Run Load Tests

```bash
# Run all 6 scenarios
make cb:loadtest BASE_URL="$STAGING_BASE_URL" P95=$P95_BUDGET_MS THRESHOLD=$THRESHOLD WINDOW_MS=$WINDOW_MS

# Expected output: ✓ ALL TESTS PASSED (6/6)
```

### 1.3 Record Results

```bash
# Paste full transcript into docs/live/STAGING_LOADTEST_TRANSCRIPT.md

# Get health snapshot
curl -s "$STAGING_BASE_URL/v1/health" | jq '{
  principal_extraction,
  circuit_breaker: {
    global: .circuit_breaker.global,
    principals: .circuit_breaker.principals
  }
}' | tee -a docs/live/STAGING_LOADTEST_TRANSCRIPT.md
```

### 1.4 Validate Pass Gates

- [ ] 6/6 scenarios PASS
- [ ] p95 ≤ 150ms
- [ ] No drip false-positive trips
- [ ] principal_extraction.mode = "fallback"
- [ ] circuit_breaker.global.state = "closed"

**If any gate fails**: Run `make cb:disable`, investigate, fix, and retry.

---

## Step 2: Canary 25% (24h Soak)

### 2.1 Enable on Canary Pods

```bash
# Example for Kubernetes (adjust to your infra)
CANARY_SELECTOR="app=plot-engine,tier=canary"

kubectl set env deployment/plot-engine -l $CANARY_SELECTOR RL_CB_ENABLE=1

# Verify flag state
kubectl exec -it $(kubectl get pods -l $CANARY_SELECTOR -o name | head -1) -- env | grep RL_CB_ENABLE
# Expected: RL_CB_ENABLE=1
```

### 2.2 Monitor Every 15 Minutes (First Hour), Then Hourly

```bash
# Set Prometheus URL
PROM_URL="http://prometheus:9090"

# Query 1: Circuit opens by reason
curl -s "$PROM_URL/api/v1/query?query=sum%20by%20(scope%2C%20reason)%20(increase(plot_engine_circuit_open_total%5B5m%5D))" | jq '.data.result'

# Query 2: 429 rate per route
curl -s "$PROM_URL/api/v1/query?query=sum%20by%20(route)%20(increase(plot_engine_rate_limit_429_total%5B5m%5D))" | jq '.data.result'

# Query 3: Principal capacity
curl -s "$PROM_URL/api/v1/query?query=plot_engine_circuit_breaker_principals_tracked%20%2F%20plot_engine_circuit_breaker_principals_capacity" | jq '.data.result'

# Health check
curl -s "$CANARY_URL/v1/health" | jq '{
  circuit_breaker: {
    global: .circuit_breaker.global,
    principals: .circuit_breaker.principals
  },
  principal_extraction: .principal_extraction.mode
}'
```

**Record snapshots at**: Hour 0, 6, 12, 18, 24 in `docs/live/CANARY_25_MONITORING.md`

### 2.3 Validate Pass Gates (After 24h)

- [ ] Zero P1 alerts
- [ ] Trip rate stable (0 opens)
- [ ] 429 baseline unchanged (±20% variance)
- [ ] p95 latency within budget (<150ms)
- [ ] No half-open timeouts
- [ ] Principal capacity healthy (<80%)
- [ ] No degraded mode

**If any gate fails**: Run `make cb:disable` on canary, document triage notes, stop rollout.

---

## Step 3: 50% Rollout (8h Soak)

### 3.1 Enable on 50% of Fleet

```bash
# Example for Kubernetes (adjust to your infra)
PROD_SELECTOR_50="app=plot-engine,tier=prod,shard=even"

kubectl set env deployment/plot-engine -l $PROD_SELECTOR_50 RL_CB_ENABLE=1

# Verify flag state (sample pods)
for pod in $(kubectl get pods -l $PROD_SELECTOR_50 -o name | head -10); do
  kubectl exec -it $pod -- env | grep RL_CB_ENABLE
done
# Expected: ~50% show RL_CB_ENABLE=1
```

### 3.2 Monitor Every Hour for 8h

```bash
# Use same PromQL queries as canary
# Record snapshots at: Hour 0, 4, 8 in docs/live/PROGRESSIVE_ROLLOUT.md
```

### 3.3 Validate Pass Gates (After 8h)

- [ ] All canary gates still met
- [ ] No new incidents
- [ ] Stable for 8h

**If any gate fails**: Rollback 50%, document, stop.

---

## Step 4: 100% Rollout (48h Soak)

### 4.1 Enable on All Pods

```bash
# Example for Kubernetes (adjust to your infra)
PROD_SELECTOR_100="app=plot-engine,tier=prod"

kubectl set env deployment/plot-engine -l $PROD_SELECTOR_100 RL_CB_ENABLE=1

# Verify flag state (all pods)
kubectl get pods -l $PROD_SELECTOR_100 -o json | \
  jq -r '.items[].spec.containers[].env[] | select(.name=="RL_CB_ENABLE") | .value' | \
  sort | uniq -c
# Expected: All return "1"
```

### 4.2 Monitor Every 6h for 48h

```bash
# Use same PromQL queries as canary
# Record snapshots at: Hour 0, 12, 24, 36, 48 in docs/live/PROGRESSIVE_ROLLOUT.md
```

### 4.3 Final Validation

```bash
# All instances enabled
kubectl get pods -l app=plot-engine,tier=prod -o json | \
  jq -r '.items[].spec.containers[].env[] | select(.name=="RL_CB_ENABLE") | .value' | \
  sort | uniq -c

# Health check (sample)
curl -s "$PROD_URL/v1/health" | jq '{
  principal_extraction: .principal_extraction.mode,
  global_state: .circuit_breaker.global.state,
  principals_open: .circuit_breaker.principals.open,
  flag: .version.flags.RL_CB_ENABLE
}'
```

### 4.4 Validate Pass Gates (After 48h)

- [ ] All 50% gates still met
- [ ] No incidents for 48h
- [ ] Fleet-wide enablement confirmed
- [ ] Health nominal

**Complete `docs/live/CB_ROLLOUT_COMPLETE.md` with final metrics**

---

## Unhappy Path: Rollback Procedures

### Immediate Rollback (<1 min)

```bash
# Disable enforcement
make cb:disable

# Redeploy (adjust to your infra)
# Example for Kubernetes:
kubectl set env deployment/plot-engine -l app=plot-engine,tier=prod RL_CB_ENABLE=0

# Verify rollback
make cb:version BASE_URL="$PROD_URL"
# Expected: RL_CB_ENABLE="0"

make cb:health BASE_URL="$PROD_URL"
# Expected: circuit_breaker=null (disabled)

# Metrics continue collecting
curl -s "$PROD_URL/metrics" | grep circuit_open_total
# Metric still exists (data preserved)
```

### Staging p95 > 150ms

```bash
# Re-run with +20% threshold
THRESHOLD_PLUS_20=$((THRESHOLD + THRESHOLD * 20 / 100))
make cb:loadtest BASE_URL="$STAGING_BASE_URL" P95=$P95_BUDGET_MS THRESHOLD=$THRESHOLD_PLUS_20 WINDOW_MS=$WINDOW_MS

# If still > 150ms:
# 1. Abort rollout
# 2. File perf ticket
# 3. Investigate latency spike
```

### Canary Trips (reason="threshold")

```bash
# Confirm reason label
curl -s "$PROM_URL/api/v1/query?query=plot_engine_circuit_open_total" | \
  jq '.data.result[] | select(.metric.reason=="threshold")'

# If single route causing trips:
# 1. Identify route from metric labels
# 2. Raise threshold for that route only (if justified)
# 3. Document in notes

# Otherwise:
make cb:disable  # Rollback canary
# Document triage notes
```

### Capacity > 80%

```bash
# Temporarily increase capacity
export RL_CB_MAX_PRINCIPALS=2000
# Redeploy affected pods

# Open follow-up ticket:
# "Add principal-creation rate limiting to prevent capacity exhaustion"
```

---

## Post-Rollout Checklist

- [ ] Commit all live docs to repo
- [ ] Update release comms (circuit breaker enabled)
- [ ] Schedule operator training (30-min walkthrough)
- [ ] Verify dashboard access for on-call
- [ ] Configure alert routing
- [ ] Collect baseline metrics (1 week)
- [ ] Schedule quarterly drill

---

## One-Page Live Checklist (Copy-Paste for Operators)

```bash
# 1. Preflight
npm test                                      # All green ✅
npm test -- tests/alert-rules.test.ts        # Alert validation ✅
export PRINCIPAL_HMAC_SECRET=$(openssl rand -hex 32)
# Store secret in vault/k8s
curl -X POST "$GRAFANA_API/api/dashboards/import" --data-binary @monitoring/dashboards/circuit_breaker.json
$PROM_APPLY_CMD monitoring/alerts/circuit-breaker.yaml

# 2. Staging
make cb:enable
make cb:loadtest BASE_URL="$STAGING_BASE_URL" P95=150
# Expected: 6/6 PASS, p95 ≤ 150ms ✅

# 3. Canary 25% (24h)
kubectl set env deployment/plot-engine -l $CANARY_SELECTOR RL_CB_ENABLE=1
# Monitor every 15 min (first hour), then hourly
# Expected: No P1, p95 on budget ✅

# 4. 50% (8h)
kubectl set env deployment/plot-engine -l $PROD_SELECTOR_50 RL_CB_ENABLE=1
# Monitor every hour
# Expected: Gates pass ✅

# 5. 100% (48h)
kubectl set env deployment/plot-engine -l $PROD_SELECTOR_100 RL_CB_ENABLE=1
# Monitor every 6h
# Expected: Gates pass ✅

# 6. Rollback (if needed)
make cb:disable
kubectl set env deployment/plot-engine -l app=plot-engine,tier=prod RL_CB_ENABLE=0
# Verified: <1 min ✅

# 7. Commit
git add docs/live/*.md
git commit -m "ops(cb): live rollout complete"
```

---

## Key PromQL Queries (Pin to Dashboard)

```promql
# Circuit opens by reason (5m)
sum by (scope, reason) (increase(plot_engine_circuit_open_total[5m]))

# 429 rate per route (5m)
sum by (route) (increase(plot_engine_rate_limit_429_total[5m]))

# Half-open timeouts (15m)
sum(increase(plot_engine_circuit_open_total{reason="half_open_timeout"}[15m]))

# Principal capacity utilization
plot_engine_circuit_breaker_principals_tracked / plot_engine_circuit_breaker_principals_capacity

# p95 latency (breaker-covered routes)
histogram_quantile(0.95, sum by (route, le) (rate(plot_engine_request_duration_ms_bucket{route=~"/v1/run|/v1/stream"}[5m])))
```

---

## Support

**Docs**:
- [CB_OPERATOR_HANDOFF.md](./CB_OPERATOR_HANDOFF.md) - Quick start
- [CB_ROLLOUT_CHECKLIST.md](./CB_ROLLOUT_CHECKLIST.md) - Deployment checklist
- [ALERT_RUNBOOK.md](./ALERT_RUNBOOK.md) - Triage & remediation

**Templates**: `templates/rollout/*.template.md`

**Contacts**:
- Primary: @eng-platform (Slack)
- Secondary: On-call engineer (PagerDuty)

---

**Ready to execute**: Follow this guide step-by-step during the live rollout window.
