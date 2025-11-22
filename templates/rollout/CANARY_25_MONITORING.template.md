<!-- ⚠️ TEMPLATE (not a real deployment log). Replace placeholders during a live rollout. -->
<!-- File: templates/rollout/CANARY_25_MONITORING.template.md -->

# Canary 25% Monitoring Report — {{DATE}}

**Engineer**: {{OWNER}}  
**Duration**: 24 hours  
**Scope**: 25% of production fleet (canary pods)

---

## Flag Flip Command

```bash
# Enable RL_CB_ENABLE=1 on canary pods
# Example (adjust to your infrastructure):
{{CANARY_ENABLE_CMD}}

# Verify flag state
{{CANARY_VERIFY_CMD}}
# Expected: RL_CB_ENABLE=1
```

**Verification**:
```bash
$ curl -s {{CANARY_URL}}/v1/health | jq '.version.flags.RL_CB_ENABLE'
# PASTE OUTPUT HERE
```

---

## Monitoring Snapshots (Every 15 min for 24h)

### Hour 0 (Initial)

**Timestamp**: {{HOUR_0_TIMESTAMP}}

```promql
# Circuit opens by reason
sum by (scope, reason) (increase(plot_engine_circuit_open_total[5m]))
# Result: {{HOUR_0_CIRCUIT_OPENS}}

# 429 rate per route
sum by (route) (increase(plot_engine_rate_limit_429_total[5m]))
# Result: {{HOUR_0_429_RATE}}

# Half-open timeouts
sum(increase(plot_engine_circuit_open_total{reason="half_open_timeout"}[15m]))
# Result: {{HOUR_0_TIMEOUTS}}

# Principal capacity
plot_engine_circuit_breaker_principals_tracked / plot_engine_circuit_breaker_principals_capacity
# Result: {{HOUR_0_CAPACITY}}
```

**Health Check**:
```json
# PASTE HEALTH OUTPUT HERE
```

---

### Hour 6

**Timestamp**: {{HOUR_6_TIMESTAMP}}

```promql
# Circuit opens by reason
sum by (scope, reason) (increase(plot_engine_circuit_open_total[5m]))
# Result: {{HOUR_6_CIRCUIT_OPENS}}

# 429 rate per route
sum by (route) (increase(plot_engine_rate_limit_429_total[5m]))
# Result: {{HOUR_6_429_RATE}}

# Half-open timeouts
sum(increase(plot_engine_circuit_open_total{reason="half_open_timeout"}[15m]))
# Result: {{HOUR_6_TIMEOUTS}}

# Principal capacity
plot_engine_circuit_breaker_principals_tracked / plot_engine_circuit_breaker_principals_capacity
# Result: {{HOUR_6_CAPACITY}}
```

**Health Check**:
```json
# PASTE HEALTH OUTPUT HERE
```

---

### Hour 12

**Timestamp**: {{HOUR_12_TIMESTAMP}}

```promql
# Circuit opens by reason
sum by (scope, reason) (increase(plot_engine_circuit_open_total[5m]))
# Result: {{HOUR_12_CIRCUIT_OPENS}}

# 429 rate per route
sum by (route) (increase(plot_engine_rate_limit_429_total[5m]))
# Result: {{HOUR_12_429_RATE}}

# Half-open timeouts
sum(increase(plot_engine_circuit_open_total{reason="half_open_timeout"}[15m]))
# Result: {{HOUR_12_TIMEOUTS}}

# Principal capacity
plot_engine_circuit_breaker_principals_tracked / plot_engine_circuit_breaker_principals_capacity
# Result: {{HOUR_12_CAPACITY}}
```

**Health Check**:
```json
# PASTE HEALTH OUTPUT HERE
```

---

### Hour 18

**Timestamp**: {{HOUR_18_TIMESTAMP}}

```promql
# Circuit opens by reason
sum by (scope, reason) (increase(plot_engine_circuit_open_total[5m]))
# Result: {{HOUR_18_CIRCUIT_OPENS}}

# 429 rate per route
sum by (route) (increase(plot_engine_rate_limit_429_total[5m]))
# Result: {{HOUR_18_429_RATE}}

# Half-open timeouts
sum(increase(plot_engine_circuit_open_total{reason="half_open_timeout"}[15m]))
# Result: {{HOUR_18_TIMEOUTS}}

# Principal capacity
plot_engine_circuit_breaker_principals_tracked / plot_engine_circuit_breaker_principals_capacity
# Result: {{HOUR_18_CAPACITY}}
```

**Health Check**:
```json
# PASTE HEALTH OUTPUT HERE
```

---

### Hour 24 (Final)

**Timestamp**: {{HOUR_24_TIMESTAMP}}

```promql
# Circuit opens by reason
sum by (scope, reason) (increase(plot_engine_circuit_open_total[5m]))
# Result: {{HOUR_24_CIRCUIT_OPENS}}

# 429 rate per route
sum by (route) (increase(plot_engine_rate_limit_429_total[5m]))
# Result: {{HOUR_24_429_RATE}}

# Half-open timeouts
sum(increase(plot_engine_circuit_open_total{reason="half_open_timeout"}[15m]))
# Result: {{HOUR_24_TIMEOUTS}}

# Principal capacity
plot_engine_circuit_breaker_principals_tracked / plot_engine_circuit_breaker_principals_capacity
# Result: {{HOUR_24_CAPACITY}}
```

**Health Check**:
```json
# PASTE HEALTH OUTPUT HERE
```

---

## p95 Latency Monitoring

```promql
# p95 latency for breaker-covered routes
histogram_quantile(0.95, sum by (route, le) (rate(plot_engine_request_duration_ms_bucket{route=~"/v1/run|/v1/stream"}[5m])))
```

**Results**:
- Hour 0: {{HOUR_0_P95}}
- Hour 6: {{HOUR_6_P95}}
- Hour 12: {{HOUR_12_P95}}
- Hour 18: {{HOUR_18_P95}}
- Hour 24: {{HOUR_24_P95}}

**Average**: {{P95_AVG}} (budget: {{P95_BUDGET_MS}}ms)

---

## Alerts Triggered

{{ALERTS_TRIGGERED}}

---

## Pass Gates Validation

- [ ] **Zero P1 alerts** (no stuck open, no capacity full)
- [ ] **Trip rate stable** ({{TRIP_COUNT}} opens in 24h)
- [ ] **429 baseline unchanged** ({{RATE_429_VARIANCE}} variance, within ±20%)
- [ ] **p95 latency within budget** ({{P95_AVG}} < {{P95_BUDGET_MS}}ms)
- [ ] **No half-open timeouts** ({{TIMEOUT_COUNT}} in 24h)
- [ ] **Principal capacity healthy** ({{CAPACITY_MAX}} < 80% threshold)
- [ ] **No degraded mode** (mode="fallback" throughout)

---

## Unhappy Path (If Needed)

### Canary trips (reason="threshold")
```bash
# Confirm reason label
curl -s {{PROM_URL}}/api/v1/query?query='plot_engine_circuit_open_total' | jq '.data.result[] | select(.metric.reason=="threshold")'

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
# Redeploy canary

# Open follow-up ticket:
# "Add principal-creation rate limiting to prevent capacity exhaustion"
```

---

## Status

**Canary 25% (24h Soak)**: {{OVERALL_STATUS}}

**Ready for 50%**: {{READY_FOR_50}}

**Notes**:
{{NOTES}}

---

**Completed By**: {{OWNER}}  
**Date**: {{DATE}}
