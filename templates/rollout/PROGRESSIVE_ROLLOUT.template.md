<!-- ⚠️ TEMPLATE (not a real deployment log). Replace placeholders during a live rollout. -->
<!-- File: templates/rollout/PROGRESSIVE_ROLLOUT.template.md -->

# Progressive Rollout: 50% → 100% — {{DATE}}

**Engineer**: {{OWNER}}  
**Scope**: Production fleet progressive enablement

---

## 50% Rollout (8h Soak)

### Flag Flip Command

**Timestamp**: {{ROLLOUT_50_TIMESTAMP}}

```bash
# Enable RL_CB_ENABLE=1 on 50% of production fleet
# Example (adjust to your infrastructure):
{{PROD_50_ENABLE_CMD}}

# Verify flag state (sample pods)
{{PROD_50_VERIFY_CMD}}
# Expected: ~50% show RL_CB_ENABLE=1
```

**Verification**:
```bash
# PASTE VERIFICATION OUTPUT HERE
```

---

### Monitoring Snapshots (Every Hour for 8h)

#### Hour 0 (Initial)

**Timestamp**: {{HOUR_0_TIMESTAMP}}

```promql
# Circuit opens by reason
sum by (scope, reason) (increase(plot_engine_circuit_open_total[5m]))
# Result: {{HOUR_0_CIRCUIT_OPENS}}

# 429 rate per route
sum by (route) (increase(plot_engine_rate_limit_429_total[5m]))
# Result: {{HOUR_0_429_RATE}}

# Principal capacity (aggregated across 50% of fleet)
avg(plot_engine_circuit_breaker_principals_tracked / plot_engine_circuit_breaker_principals_capacity)
# Result: {{HOUR_0_CAPACITY}}
```

---

#### Hour 4

**Timestamp**: {{HOUR_4_TIMESTAMP}}

```promql
# Circuit opens by reason
sum by (scope, reason) (increase(plot_engine_circuit_open_total[5m]))
# Result: {{HOUR_4_CIRCUIT_OPENS}}

# 429 rate per route
sum by (route) (increase(plot_engine_rate_limit_429_total[5m]))
# Result: {{HOUR_4_429_RATE}}

# Principal capacity
avg(plot_engine_circuit_breaker_principals_tracked / plot_engine_circuit_breaker_principals_capacity)
# Result: {{HOUR_4_CAPACITY}}
```

---

#### Hour 8 (Final)

**Timestamp**: {{HOUR_8_TIMESTAMP}}

```promql
# Circuit opens by reason
sum by (scope, reason) (increase(plot_engine_circuit_open_total[5m]))
# Result: {{HOUR_8_CIRCUIT_OPENS}}

# 429 rate per route
sum by (route) (increase(plot_engine_rate_limit_429_total[5m]))
# Result: {{HOUR_8_429_RATE}}

# Principal capacity
avg(plot_engine_circuit_breaker_principals_tracked / plot_engine_circuit_breaker_principals_capacity)
# Result: {{HOUR_8_CAPACITY}}
```

**p95 Latency**:
```promql
histogram_quantile(0.95, sum by (route, le) (rate(plot_engine_request_duration_ms_bucket{route=~"/v1/run|/v1/stream"}[5m])))
# Result: {{HOUR_8_P95}}
```

---

### 50% Pass Gates

- [ ] **Zero P1 alerts** (8h)
- [ ] **Trip rate stable** ({{TRIP_COUNT_50}} opens)
- [ ] **429 baseline unchanged** ({{RATE_429_VARIANCE_50}} variance)
- [ ] **p95 latency within budget** ({{P95_AVG_50}} < {{P95_BUDGET_MS}}ms)
- [ ] **No half-open timeouts**
- [ ] **Principal capacity healthy** ({{CAPACITY_MAX_50}} < 80%)

**Status**: {{STATUS_50}} - Ready for 100%: {{READY_FOR_100}}

---

## 100% Rollout (48h Soak)

### Flag Flip Command

**Timestamp**: {{ROLLOUT_100_TIMESTAMP}}

```bash
# Enable RL_CB_ENABLE=1 on all production pods
{{PROD_100_ENABLE_CMD}}

# Verify flag state (all pods)
{{PROD_100_VERIFY_CMD}}
# Expected: All return "1"
```

**Verification**:
```bash
# Sample 20 random instances
# PASTE VERIFICATION OUTPUT HERE
```

---

### Monitoring Snapshots (Every 6h for 48h)

#### Hour 0 (Initial)

**Timestamp**: {{HOUR_0_100_TIMESTAMP}}

```promql
# Circuit opens by reason
sum by (scope, reason) (increase(plot_engine_circuit_open_total[5m]))
# Result: {{HOUR_0_100_CIRCUIT_OPENS}}

# 429 rate per route
sum by (route) (increase(plot_engine_rate_limit_429_total[5m]))
# Result: {{HOUR_0_100_429_RATE}}

# Principal capacity (aggregated across full fleet)
avg(plot_engine_circuit_breaker_principals_tracked / plot_engine_circuit_breaker_principals_capacity)
# Result: {{HOUR_0_100_CAPACITY}}
```

---

#### Hour 12

**Timestamp**: {{HOUR_12_100_TIMESTAMP}}

```promql
# Circuit opens by reason
sum by (scope, reason) (increase(plot_engine_circuit_open_total[5m]))
# Result: {{HOUR_12_100_CIRCUIT_OPENS}}

# 429 rate per route
sum by (route) (increase(plot_engine_rate_limit_429_total[5m]))
# Result: {{HOUR_12_100_429_RATE}}

# Principal capacity
avg(plot_engine_circuit_breaker_principals_tracked / plot_engine_circuit_breaker_principals_capacity)
# Result: {{HOUR_12_100_CAPACITY}}
```

---

#### Hour 24

**Timestamp**: {{HOUR_24_100_TIMESTAMP}}

```promql
# Circuit opens by reason
sum by (scope, reason) (increase(plot_engine_circuit_open_total[5m]))
# Result: {{HOUR_24_100_CIRCUIT_OPENS}}

# 429 rate per route
sum by (route) (increase(plot_engine_rate_limit_429_total[5m]))
# Result: {{HOUR_24_100_429_RATE}}

# Principal capacity
avg(plot_engine_circuit_breaker_principals_tracked / plot_engine_circuit_breaker_principals_capacity)
# Result: {{HOUR_24_100_CAPACITY}}
```

---

#### Hour 36

**Timestamp**: {{HOUR_36_100_TIMESTAMP}}

```promql
# Circuit opens by reason
sum by (scope, reason) (increase(plot_engine_circuit_open_total[5m]))
# Result: {{HOUR_36_100_CIRCUIT_OPENS}}

# 429 rate per route
sum by (route) (increase(plot_engine_rate_limit_429_total[5m]))
# Result: {{HOUR_36_100_429_RATE}}

# Principal capacity
avg(plot_engine_circuit_breaker_principals_tracked / plot_engine_circuit_breaker_principals_capacity)
# Result: {{HOUR_36_100_CAPACITY}}
```

---

#### Hour 48 (Final)

**Timestamp**: {{HOUR_48_100_TIMESTAMP}}

```promql
# Circuit opens by reason
sum by (scope, reason) (increase(plot_engine_circuit_open_total[5m]))
# Result: {{HOUR_48_100_CIRCUIT_OPENS}}

# 429 rate per route
sum by (route) (increase(plot_engine_rate_limit_429_total[5m]))
# Result: {{HOUR_48_100_429_RATE}}

# Principal capacity
avg(plot_engine_circuit_breaker_principals_tracked / plot_engine_circuit_breaker_principals_capacity)
# Result: {{HOUR_48_100_CAPACITY}}
```

**p95 Latency (48h average)**:
```promql
histogram_quantile(0.95, sum by (route, le) (rate(plot_engine_request_duration_ms_bucket{route=~"/v1/run|/v1/stream"}[48h])))
# Result: {{P95_AVG_100}}
```

---

### 100% Pass Gates

- [ ] **Zero P1 alerts** (48h)
- [ ] **Trip rate stable** ({{TRIP_COUNT_100}} opens in 48h)
- [ ] **429 baseline unchanged** ({{RATE_429_VARIANCE_100}} variance)
- [ ] **p95 latency within budget** ({{P95_AVG_100}} < {{P95_BUDGET_MS}}ms)
- [ ] **No half-open timeouts** ({{TIMEOUT_COUNT_100}} in 48h)
- [ ] **Principal capacity healthy** ({{CAPACITY_MAX_100}} < 80%)
- [ ] **No degraded mode** (mode="fallback" across all instances)
- [ ] **No customer impact** (no incidents reported)

---

## Final Validation

### All Instances Enabled

```bash
# PASTE VERIFICATION COMMAND OUTPUT HERE
```

### Health Check (Sample)

```bash
$ curl -s {{PROD_URL}}/v1/health | jq '{
  principal_extraction: .principal_extraction.mode,
  global_state: .circuit_breaker.global.state,
  principals_open: .circuit_breaker.principals.open,
  flag: .version.flags.RL_CB_ENABLE
}'
```

**Output**:
```json
# PASTE HEALTH OUTPUT HERE
```

---

## Status

**Progressive Rollout**: {{OVERALL_STATUS}}

- **50% Rollout (8h)**: {{STATUS_50}}
- **100% Rollout (48h)**: {{STATUS_100}}
- **Fleet-wide enablement**: {{ENABLEMENT_STATUS}}
- **Health**: {{HEALTH_STATUS}}

**Notes**:
{{NOTES}}

---

**Completed By**: {{OWNER}}  
**Date**: {{DATE}}
