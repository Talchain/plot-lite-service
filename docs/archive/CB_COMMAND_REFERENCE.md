# Circuit Breaker: Command Reference Card

**Quick reference for live rollout execution**

---

## Environment Setup

```bash
# Set these before starting
export DATE=$(date +%Y-%m-%d)
export OWNER="<your-name>"
export STAGING_BASE_URL="https://staging.example.com"
export CANARY_URL="https://canary.example.com"
export PROD_URL="https://prod.example.com"
export PROM_URL="http://prometheus:9090"
export GRAFANA_API="http://grafana:3000"
export GRAFANA_TOKEN="<your-api-token>"
export PROM_APPLY_CMD="kubectl apply -f"
export P95_BUDGET_MS=150
export THRESHOLD=50
export WINDOW_MS=10000
```

---

## Preflight

```bash
# Run preflight script
./scripts/cb_preflight.sh

# Or manually:
export PRINCIPAL_HMAC_SECRET=$(openssl rand -hex 32)
npm test
npm test -- tests/alert-rules.test.ts
curl -X POST "$GRAFANA_API/api/dashboards/import" \
  -H "Authorization: Bearer $GRAFANA_TOKEN" \
  --data-binary @monitoring/dashboards/circuit_breaker.json
$PROM_APPLY_CMD monitoring/alerts/circuit-breaker.yaml
```

---

## Generate Live Docs

```bash
mkdir -p docs/live
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
```

---

## Staging Validation

```bash
# Enable
make cb:enable

# Verify
make cb:version BASE_URL="$STAGING_BASE_URL"
make cb:health BASE_URL="$STAGING_BASE_URL"

# Load test
make cb:loadtest BASE_URL="$STAGING_BASE_URL" P95=$P95_BUDGET_MS THRESHOLD=$THRESHOLD WINDOW_MS=$WINDOW_MS

# Health snapshot
curl -s "$STAGING_BASE_URL/v1/health" | jq '{
  principal_extraction,
  circuit_breaker: {global: .circuit_breaker.global, principals: .circuit_breaker.principals}
}' | tee -a docs/live/STAGING_LOADTEST_TRANSCRIPT.md
```

---

## Canary 25%

```bash
# Enable (Kubernetes example)
CANARY_SELECTOR="app=plot-engine,tier=canary"
kubectl set env deployment/plot-engine -l $CANARY_SELECTOR RL_CB_ENABLE=1

# Verify
kubectl exec -it $(kubectl get pods -l $CANARY_SELECTOR -o name | head -1) -- env | grep RL_CB_ENABLE

# Monitor (run every 15 min for first hour, then hourly for 24h)
# Query 1: Circuit opens
curl -s "$PROM_URL/api/v1/query?query=sum%20by%20(scope%2C%20reason)%20(increase(plot_engine_circuit_open_total%5B5m%5D))" | jq '.data.result'

# Query 2: 429 rate
curl -s "$PROM_URL/api/v1/query?query=sum%20by%20(route)%20(increase(plot_engine_rate_limit_429_total%5B5m%5D))" | jq '.data.result'

# Query 3: Capacity
curl -s "$PROM_URL/api/v1/query?query=plot_engine_circuit_breaker_principals_tracked%20%2F%20plot_engine_circuit_breaker_principals_capacity" | jq '.data.result'

# Health
curl -s "$CANARY_URL/v1/health" | jq '{
  circuit_breaker: {global: .circuit_breaker.global, principals: .circuit_breaker.principals},
  principal_extraction: .principal_extraction.mode
}' | tee -a docs/live/CANARY_25_MONITORING.md
```

---

## 50% Rollout

```bash
# Enable (Kubernetes example)
PROD_SELECTOR_50="app=plot-engine,tier=prod,shard=even"
kubectl set env deployment/plot-engine -l $PROD_SELECTOR_50 RL_CB_ENABLE=1

# Verify
for pod in $(kubectl get pods -l $PROD_SELECTOR_50 -o name | head -10); do
  kubectl exec -it $pod -- env | grep RL_CB_ENABLE
done

# Monitor (same queries as canary, every hour for 8h)
# Record in docs/live/PROGRESSIVE_ROLLOUT.md
```

---

## 100% Rollout

```bash
# Enable (Kubernetes example)
PROD_SELECTOR_100="app=plot-engine,tier=prod"
kubectl set env deployment/plot-engine -l $PROD_SELECTOR_100 RL_CB_ENABLE=1

# Verify all
kubectl get pods -l $PROD_SELECTOR_100 -o json | \
  jq -r '.items[].spec.containers[].env[] | select(.name=="RL_CB_ENABLE") | .value' | \
  sort | uniq -c

# Monitor (same queries, every 6h for 48h)
# Record in docs/live/PROGRESSIVE_ROLLOUT.md

# Final health
curl -s "$PROD_URL/v1/health" | jq '{
  principal_extraction: .principal_extraction.mode,
  global_state: .circuit_breaker.global.state,
  principals_open: .circuit_breaker.principals.open,
  flag: .version.flags.RL_CB_ENABLE
}' | tee -a docs/live/CB_ROLLOUT_COMPLETE.md
```

---

## Rollback (Emergency)

```bash
# Disable
make cb:disable

# Redeploy (Kubernetes example)
kubectl set env deployment/plot-engine -l app=plot-engine,tier=prod RL_CB_ENABLE=0

# Verify
make cb:version BASE_URL="$PROD_URL"  # Expected: RL_CB_ENABLE="0"
make cb:health BASE_URL="$PROD_URL"   # Expected: circuit_breaker=null

# Metrics still collecting
curl -s "$PROD_URL/metrics" | grep circuit_open_total
```

---

## PromQL Queries (Copy-Paste)

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

## Unhappy Path

### Staging p95 > 150ms

```bash
# Re-run with +20% threshold
THRESHOLD_PLUS_20=$((THRESHOLD + THRESHOLD * 20 / 100))
make cb:loadtest BASE_URL="$STAGING_BASE_URL" P95=$P95_BUDGET_MS THRESHOLD=$THRESHOLD_PLUS_20 WINDOW_MS=$WINDOW_MS

# If still > 150ms: abort, file perf ticket
```

### Canary trips (reason="threshold")

```bash
# Check reason
curl -s "$PROM_URL/api/v1/query?query=plot_engine_circuit_open_total" | \
  jq '.data.result[] | select(.metric.reason=="threshold")'

# If single route: raise threshold for that route (if justified)
# Otherwise: rollback canary
make cb:disable
kubectl set env deployment/plot-engine -l $CANARY_SELECTOR RL_CB_ENABLE=0
```

### Capacity > 80%

```bash
# Temporarily increase
export RL_CB_MAX_PRINCIPALS=2000
# Redeploy affected pods

# File ticket: "Add principal-creation rate limiting"
```

---

## Commit Live Docs

```bash
# After rollout complete
git add -f docs/live/STAGING_LOADTEST_TRANSCRIPT.md
git add -f docs/live/CANARY_25_MONITORING.md
git add -f docs/live/PROGRESSIVE_ROLLOUT.md
git add -f docs/live/CB_ROLLOUT_COMPLETE.md
git commit -m "ops(cb): live rollout complete - $(date +%Y-%m-%d)"
git push origin main
```

---

## Quick Checklist

- [ ] Preflight: `./scripts/cb_preflight.sh`
- [ ] Generate live docs from templates
- [ ] Staging: `make cb:loadtest` → 6/6 PASS
- [ ] Canary 25%: Enable → Monitor 24h → Gates pass
- [ ] 50%: Enable → Monitor 8h → Gates pass
- [ ] 100%: Enable → Monitor 48h → Gates pass
- [ ] Commit live docs
- [ ] Update release comms

---

**See also**: [CB_LIVE_ROLLOUT_GUIDE.md](./CB_LIVE_ROLLOUT_GUIDE.md) for detailed instructions
