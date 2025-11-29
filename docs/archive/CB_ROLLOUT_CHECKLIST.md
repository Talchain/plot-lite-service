# Circuit Breaker Rollout Checklist

**Quick reference for production deployment**  
**Full guide**: [CB_PRODUCTION_ENABLEMENT.md](./CB_PRODUCTION_ENABLEMENT.md)

---

## Preflight (Before Deployment)

- [ ] **Secret strength verified**
  ```bash
  # Generate 64-hex secret (32 bytes)
  openssl rand -hex 32
  
  # Store in vault
  vault kv put secret/plot-engine PRINCIPAL_HMAC_SECRET="<64-hex>"
  ```

- [ ] **Trust proxy configured**
  ```bash
  # If behind LB/proxy
  export TRUST_PROXY=1
  export TRUST_PROXY_HOPS=1
  
  # Otherwise (default, safe)
  export TRUST_PROXY=0
  ```

- [ ] **Alerts wired**
  ```bash
  # Load alert rules
  promtool check rules monitoring/alerts/circuit-breaker.yaml
  
  # Apply to Prometheus
  # (deployment-specific command)
  ```

- [ ] **Dashboard imported**
  ```bash
  # Import monitoring/dashboards/circuit_breaker.json to Grafana
  # Verify panels render
  ```

- [ ] **Dry-run load test**
  ```bash
  make cb:loadtest BASE_URL=http://localhost:3000 P95=150
  # Expected: All 6 tests PASS
  ```

---

## Stage 1: Staging Validation

- [ ] **Enable breaker**
  ```bash
  export RL_CB_ENABLE=1
  export PRINCIPAL_HMAC_SECRET="<from-vault>"
  
  # Deploy to staging
  ```

- [ ] **Run load tests**
  ```bash
  make cb:loadtest BASE_URL="https://staging.example.com" P95=150 THRESHOLD=50 WINDOW_MS=10000
  ```

- [ ] **Gate: All tests PASS**
  - ✅ Threshold trips within ±10%
  - ✅ p95 latency within budget
  - ✅ Zero drip false positives
  - ✅ Per-principal isolation works
  - ✅ Recovery cycle completes

- [ ] **Verify health**
  ```bash
  make cb:health BASE_URL="https://staging.example.com"
  # Expected: principal_extraction.mode="fallback"
  # Expected: circuit_breaker.global.state="closed"
  ```

---

## Stage 2: Canary 25% (24h Soak)

- [ ] **Enable on canary**
  ```bash
  # Set RL_CB_ENABLE=1 on canary pods
  # (deployment-specific command)
  ```

- [ ] **Monitor dashboards** (every hour for 24h)
  ```promql
  # Circuit opens by reason
  sum by (scope, reason) (increase(plot_engine_circuit_open_total[5m]))
  
  # 429 rate per route
  sum by (route) (increase(plot_engine_rate_limit_429_total[5m]))
  
  # Half-open timeouts
  sum(increase(plot_engine_circuit_open_total{reason="half_open_timeout"}[15m]))
  ```

- [ ] **Health checks** (every 5 min for first hour, then hourly)
  ```bash
  make cb:health BASE_URL="https://canary.example.com"
  ```

- [ ] **Gate: 24h stable**
  - ✅ No circuit opens (or <5 in 24h)
  - ✅ 429 rate within baseline (±20%)
  - ✅ No half-open timeouts
  - ✅ p95 latency unchanged
  - ✅ No errors in logs
  - ✅ No P1/P2 alerts fired

- [ ] **Rollback ready** (if any gate fails)
  ```bash
  export RL_CB_ENABLE=0
  # Redeploy canary
  
  # Verify rollback
  make cb:version BASE_URL="https://canary.example.com"
  # Expected: RL_CB_ENABLE="0"
  ```

---

## Stage 3: Progressive Rollout

### 50% Rollout (8h soak)

- [ ] **Enable on 50% of fleet**
  ```bash
  # Set RL_CB_ENABLE=1 on 50% of pods
  # (deployment-specific command)
  ```

- [ ] **Monitor for 8h**
  - Same queries as canary
  - Same health checks
  - Same pass criteria

- [ ] **Gate: 8h stable**
  - ✅ All canary gates still met
  - ✅ No new incidents

### 100% Rollout (48h soak)

- [ ] **Enable on all instances**
  ```bash
  # Set RL_CB_ENABLE=1 on all pods
  # (deployment-specific command)
  ```

- [ ] **Monitor for 48h**
  - Same queries as canary
  - Same health checks
  - Same pass criteria

- [ ] **Final validation**
  ```bash
  # All instances show fallback mode
  curl -s https://prod.example.com/v1/health | jq '.principal_extraction.mode'
  # Expected: "fallback" (all instances)
  
  # Low circuit open count
  curl -s https://prod.example.com/metrics | grep circuit_open_total
  # Should show low values
  ```

---

## Instant Rollback (If Needed)

**No restart required:**

```bash
# 1. Disable enforcement
export RL_CB_ENABLE=0

# 2. Redeploy (or use runtime config)
# (deployment-specific command)

# 3. Verify rollback
make cb:version BASE_URL="https://prod.example.com"
# Expected: RL_CB_ENABLE="0"

make cb:health BASE_URL="https://prod.example.com"
# Expected: circuit_breaker=null (disabled)

# 4. Metrics continue collecting
curl -s https://prod.example.com/metrics | grep circuit_open_total
# Metric still exists
```

**Rollback time**: <1 minute  
**Impact**: None (graceful degradation)

---

## Post-Deployment

### Immediate (Day 0)

- [ ] **Verify all instances**
  ```bash
  # Check each instance
  for instance in $(get_instances); do
    curl -s "https://$instance/v1/health" | jq '.principal_extraction.mode'
  done
  # All should return: "fallback"
  ```

- [ ] **Baseline metrics**
  ```bash
  # Capture baseline for tuning
  curl -s https://prod.example.com/metrics | grep -E 'circuit_open_total|rate_limit_429_total' > baseline.txt
  ```

- [ ] **Review logs**
  ```bash
  # Check for errors
  grep -i "circuit-breaker" logs/*.log | grep -i error
  # Should be empty
  ```

### Short-Term (Week 1)

- [ ] **Operator training**
  - 30-min walkthrough of [ALERT_RUNBOOK.md](./ALERT_RUNBOOK.md)
  - Practice one remediation scenario
  - Verify dashboard access

- [ ] **Create dashboards**
  - Import circuit_breaker.json to Grafana
  - Pin key panels to ops dashboard
  - Set up alert routing

- [ ] **Collect baseline**
  ```promql
  # 429 rate p50/p95/p99 (1 week)
  histogram_quantile(0.50, sum(rate(plot_engine_rate_limit_429_total[1w])))
  histogram_quantile(0.95, sum(rate(plot_engine_rate_limit_429_total[1w])))
  histogram_quantile(0.99, sum(rate(plot_engine_rate_limit_429_total[1w])))
  ```

- [ ] **Update release comms**
  - Circuit breaker enabled
  - Flag-gated (instantly reversible)
  - Link to runbook

### Long-Term (Month 1)

- [ ] **Quarterly drill scheduled**
  - Simulate canary enable
  - Simulate degraded mode recovery
  - Simulate load spike response
  - Record timings (<15 min target)

- [ ] **Alert rules validated**
  - P1 alerts configured
  - P2 alerts configured
  - P3 alerts configured
  - Test alert routing

- [ ] **Tuning adjustments** (if needed)
  - Review baseline metrics
  - Adjust thresholds if needed
  - Document changes in RELEASE_NOTES

- [ ] **Success criteria validated**
  - No unplanned circuit opens (global)
  - <5 principal circuits open simultaneously
  - No half-open timeout spikes
  - p95 latency unchanged
  - No degraded mode incidents

---

## Quick Reference

**Enable breaker:**
```bash
make cb:enable
```

**Disable breaker:**
```bash
make cb:disable
```

**Check health:**
```bash
make cb:health BASE_URL="https://prod.example.com"
```

**Run load tests:**
```bash
make cb:loadtest BASE_URL="https://staging.example.com" P95=150
```

**Key PromQL:**
```promql
# Circuit opens by reason
sum by (scope, reason) (increase(plot_engine_circuit_open_total[5m]))

# 429 rate per route
sum by (route) (increase(plot_engine_rate_limit_429_total[5m]))

# Half-open timeouts
sum(increase(plot_engine_circuit_open_total{reason="half_open_timeout"}[15m]))
```

---

## Troubleshooting

**Circuit doesn't trip in load test:**
- Check `RL_CB_FAILURE_THRESHOLD` (lower for testing)
- Verify failures are counted (check health)
- Ensure requests are within `RL_CB_WINDOW_MS`

**Degraded mode in production:**
- Check `PRINCIPAL_HMAC_SECRET` is set
- Verify secret length ≥64 hex chars
- Redeploy with correct secret
- Verify health shows `mode="fallback"`

**High half-open timeouts:**
- Check probe success rate
- Increase `RL_CB_HALF_OPEN_TIMEOUT_MS`
- Verify downstream health

**Principal capacity high:**
- Increase `RL_CB_MAX_PRINCIPALS`
- Investigate principal churn
- Check for bot activity

---

## Support

**Docs:**
- [ALERT_RUNBOOK.md](./ALERT_RUNBOOK.md) - Triage & remediation
- [LOADTEST_BREAKER.md](./LOADTEST_BREAKER.md) - Pre-prod validation
- [CB_PRODUCTION_ENABLEMENT.md](./CB_PRODUCTION_ENABLEMENT.md) - Full rollout guide
- [CB_GO_NOGO.md](./CB_GO_NOGO.md) - Decision document

**Contacts:**
- Primary: @eng-platform (Slack)
- Secondary: On-call engineer (PagerDuty)

**Runbook Drills:** Quarterly (see ALERT_RUNBOOK.md)

---

**Status**: ✅ Ready for production deployment  
**Last Updated**: 2025-10-18
