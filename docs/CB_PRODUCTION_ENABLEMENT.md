# Circuit Breaker Production Enablement

**One-page guide for enabling circuit breaker in production**

**Status**: Ready for production deployment  
**Tests**: 37/37 passing ✅  
**Docs**: ALERT_RUNBOOK.md, LOADTEST_BREAKER.md, RELEASE_NOTES_v2.3.md

---

## Prerequisites

### 1. Secrets & Configuration

**Generate HMAC Secret (64-hex recommended):**
```bash
openssl rand -hex 32
# Example output: a1b2c3d4e5f6...
```

**Store in Vault:**
```bash
# Production
vault kv put secret/plot-engine/prod \
  PRINCIPAL_HMAC_SECRET="<64-hex-from-above>"

# Staging
vault kv put secret/plot-engine/staging \
  PRINCIPAL_HMAC_SECRET="<64-hex-from-above>"
```

**Environment Variables:**
```bash
# Required
PRINCIPAL_HMAC_SECRET="<64-hex>"  # From vault

# Proxy Configuration (if behind LB/proxy)
TRUST_PROXY=0                     # Default: OFF (safe)
TRUST_PROXY_HOPS=1                # Only if TRUST_PROXY=1

# Circuit Breaker (start disabled)
RL_CB_ENABLE=0                    # Start with metrics only

# Optional Tuning (use defaults first)
# RL_CB_FAILURE_THRESHOLD=50      # Default: 50
# RL_CB_WINDOW_MS=10000           # Default: 10s
# RL_CB_COOLDOWN_MS=30000         # Default: 30s
# RL_CB_HALF_OPEN_PROBES=3        # Default: 3
# RL_CB_HALF_OPEN_TIMEOUT_MS=60000 # Default: 60s
# RL_CB_MAX_PRINCIPALS=1000       # Default: 1000
```

---

## Stage 1: Staging Validation

### Deploy with Metrics Only

```bash
# Set environment
export RL_CB_ENABLE=0  # Metrics collection only
export PRINCIPAL_HMAC_SECRET="<from-vault>"
export TRUST_PROXY=0   # Unless behind trusted proxy

# Deploy to staging
# (Use your deployment process)
```

### Verify Health

```bash
# Check principal extraction
curl -s https://staging.example.com/v1/health | jq '.principal_extraction'
# Expected:
# {
#   "enabled": true,
#   "trust_proxy": false,
#   "hops": 1,
#   "mode": "fallback"
# }

# Check circuit breaker (should be null when disabled)
curl -s https://staging.example.com/v1/health | jq '.circuit_breaker'
# Expected: null (breaker disabled)

# Check metrics are collecting
curl -s https://staging.example.com/metrics | grep circuit_open_total
# Expected: metric exists (value 0)
```

### Run Load Test

```bash
# Follow docs/LOADTEST_BREAKER.md
# All 6 tests must pass
```

**Pass Criteria:**
- ✅ Health shows `principal_extraction.mode="fallback"`
- ✅ Metrics collecting (circuit_open_total exists)
- ✅ Load test: 6/6 tests pass
- ✅ No errors in logs
- ✅ Performance impact <1ms p95

---

## Stage 2: Canary Enable

### Enable on Canary Instances

```bash
# Enable breaker on canary only
export RL_CB_ENABLE=1

# Deploy to canary instances
# (Use your deployment process)
```

### Monitor for 1 Hour

**Dashboards to Watch:**
```promql
# Circuit opens (should be 0 or very low)
sum by (scope, reason) (increase(plot_engine_circuit_open_total[5m]))

# 429 rate baseline
sum by (route) (increase(plot_engine_rate_limit_429_total[5m]))

# Half-open timeouts (should be 0)
sum(increase(plot_engine_circuit_open_total{reason="half_open_timeout"}[15m]))
```

**Health Checks:**
```bash
# Every 5 minutes for 1 hour
curl -s https://canary.example.com/v1/health | jq '{
  principal_extraction: .principal_extraction.mode,
  global_state: .circuit_breaker.global.state,
  principals_open: .circuit_breaker.principals.open
}'

# Expected:
# {
#   "principal_extraction": "fallback",
#   "global_state": "closed",
#   "principals_open": 0
# }
```

**Pass Criteria:**
- ✅ No circuit opens (or <5 in 1 hour)
- ✅ 429 rate within baseline (±20%)
- ✅ No half-open timeouts
- ✅ p95 latency unchanged
- ✅ No errors in logs

**If Any Failures:**
- Rollback immediately (set `RL_CB_ENABLE=0`)
- Review ALERT_RUNBOOK.md for triage
- Do NOT proceed to production

---

## Stage 3: Progressive Rollout

### 25% Rollout

```bash
# Enable on 25% of instances
export RL_CB_ENABLE=1

# Deploy to 25% of fleet
# Monitor for 24 hours
```

**Monitor:**
- Circuit open events (should be rare)
- 429 rate (should be stable)
- p95 latency (should be unchanged)
- Error rate (should be unchanged)

**Pass Criteria:**
- ✅ Stable for 24 hours
- ✅ No incidents
- ✅ Metrics within expected ranges

---

### 50% Rollout

```bash
# Enable on 50% of instances
# Monitor for 24 hours
```

**Same monitoring as 25%**

---

### 100% Rollout

```bash
# Enable on all instances
# Monitor for 48 hours
```

**Final Validation:**
```bash
# Check all instances
curl -s https://prod.example.com/v1/health | jq '.principal_extraction.mode'
# Expected: "fallback" (all instances)

# Check metrics
curl -s https://prod.example.com/metrics | grep circuit_open_total
# Should show low values
```

---

## Emergency Rollback

**Instant Disable (No Restart Required):**

```bash
# Set flag to 0
export RL_CB_ENABLE=0

# Redeploy (or use runtime config if available)
# Breaker disables immediately
# Metrics continue collecting
```

**Verify Rollback:**
```bash
curl -s https://prod.example.com/v1/health | jq '.circuit_breaker'
# Expected: null (breaker disabled)

curl -s https://prod.example.com/metrics | grep circuit_open_total
# Expected: metric still exists (collecting)
```

**No Service Restart Required** ✅

---

## Monitoring & Alerts

### Critical Alerts (P1 - Page Immediately)

**Global Circuit Open:**
```promql
increase(plot_engine_circuit_open_total{scope="global"}[5m]) > 0
```
**Action**: Follow ALERT_RUNBOOK.md "Global Circuit Open" playbook

---

### Warning Alerts (P2 - Investigate Within 1h)

**Half-Open Timeout Spike:**
```promql
sum(increase(plot_engine_circuit_open_total{reason="half_open_timeout"}[15m])) > 5
```
**Action**: Check probe success rate, consider timeout increase

**Degraded Mode:**
```promql
max_over_time(health.principal_extraction.mode[1m]) == "degraded"
```
**Action**: Set PRINCIPAL_HMAC_SECRET and redeploy

---

### Info Alerts (P3 - Review Daily)

**Principal Circuit Opens:**
```promql
max_over_time(health.circuit_breaker.principals.open[5m]) > 10
```
**Action**: Investigate offending principals, consider perimeter blocks

---

## Tuning (After 1 Week Baseline)

### Collect Baseline Metrics

```promql
# 429 rate p50/p95/p99 (1 week)
histogram_quantile(0.50, sum(rate(plot_engine_rate_limit_429_total[1w])))
histogram_quantile(0.95, sum(rate(plot_engine_rate_limit_429_total[1w])))
histogram_quantile(0.99, sum(rate(plot_engine_rate_limit_429_total[1w])))
```

### Adjust Thresholds

**If Too Sensitive (False Positives):**
```bash
# Increase threshold by 20%
export RL_CB_FAILURE_THRESHOLD=60  # was 50

# Or extend window
export RL_CB_WINDOW_MS=12000       # was 10000
```

**If Not Sensitive Enough (Late Detection):**
```bash
# Decrease threshold by 20%
export RL_CB_FAILURE_THRESHOLD=40  # was 50

# Or shorten window
export RL_CB_WINDOW_MS=8000        # was 10000
```

**Document All Changes** in RELEASE_NOTES and alert runbook

---

## Success Criteria

**After 1 Week in Production:**

- ✅ No unplanned circuit opens (global)
- ✅ <5 principal circuits open simultaneously
- ✅ No half-open timeout spikes
- ✅ p95 latency unchanged
- ✅ No degraded mode incidents
- ✅ Operators trained on runbook

**Sign-Off Required:**
- [ ] Engineering lead
- [ ] Operations lead
- [ ] Security review (PII guarantees)

---

## Rollback Plan

**Scenario 1: Unexpected Circuit Opens**
```bash
# Immediate: Disable breaker
export RL_CB_ENABLE=0
# Investigate: Review ALERT_RUNBOOK.md
# Fix: Adjust thresholds or fix upstream issue
# Re-enable: Follow canary process again
```

**Scenario 2: Performance Degradation**
```bash
# Immediate: Disable breaker
export RL_CB_ENABLE=0
# Investigate: Check principal churn, LRU eviction
# Fix: Increase RL_CB_MAX_PRINCIPALS or optimize
# Re-enable: Follow canary process again
```

**Scenario 3: Degraded Mode**
```bash
# Immediate: Set PRINCIPAL_HMAC_SECRET
# Redeploy: All instances
# Verify: Health shows mode="fallback"
# No rollback needed (forward fix)
```

---

## Contacts & Escalation

**Primary**: @eng-platform (Slack)  
**Secondary**: On-call engineer (PagerDuty)  
**Docs**: docs/ALERT_RUNBOOK.md, docs/LOADTEST_BREAKER.md  
**Runbook Drills**: Quarterly (see ALERT_RUNBOOK.md)

---

## Quick Reference

**Health Check:**
```bash
curl -s https://prod.example.com/v1/health | jq '{
  principal_extraction,
  circuit_breaker: {
    global: .circuit_breaker.global,
    principals: .circuit_breaker.principals
  }
}'
```

**Metrics Check:**
```bash
curl -s https://prod.example.com/metrics | grep -E 'circuit_open_total|rate_limit_429_total'
```

**Disable Breaker:**
```bash
export RL_CB_ENABLE=0
# Redeploy (no restart needed)
```

**Enable Breaker:**
```bash
export RL_CB_ENABLE=1
# Redeploy (no restart needed)
```

---

**Status**: ✅ Ready for Production  
**Confidence**: HIGH  
**Risk**: LOW (flag-gated, instant rollback)  
**Impact**: Prevents cascade failures, improves resilience
