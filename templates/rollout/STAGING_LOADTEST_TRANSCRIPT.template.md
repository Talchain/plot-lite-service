<!-- ⚠️ TEMPLATE (not a real deployment log). Replace placeholders during a live rollout. -->
<!-- File: templates/rollout/STAGING_LOADTEST_TRANSCRIPT.template.md -->

# Staging Load Test Transcript — {{DATE}}

**Engineer**: {{OWNER}}  
**Environment**: Staging  
**Command**: `make cb:loadtest BASE_URL="{{STAGING_BASE_URL}}" P95={{P95_BUDGET_MS}} THRESHOLD={{THRESHOLD}} WINDOW_MS={{WINDOW_MS}}`

---

## Configuration

- **Base URL**: {{STAGING_BASE_URL}}
- **P95 Budget**: {{P95_BUDGET_MS}} ms
- **Threshold**: {{THRESHOLD}} failures
- **Window**: {{WINDOW_MS}} ms

---

## Full Transcript

```bash
$ make cb:loadtest BASE_URL="{{STAGING_BASE_URL}}" P95={{P95_BUDGET_MS}} THRESHOLD={{THRESHOLD}} WINDOW_MS={{WINDOW_MS}}

# PASTE FULL OUTPUT HERE
```

---

## Results (Fill During Run)

| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| **1. Burst Load** | Circuit trips | {{BURST_RESULT}} | {{BURST_PASS_FAIL}} |
| **2. Recovery Cycle** | Half-open → closed | {{RECOVERY_RESULT}} | {{RECOVERY_PASS_FAIL}} |
| **3. Half-Open Timeout** | Timeout reopens circuit | {{TIMEOUT_RESULT}} | {{TIMEOUT_PASS_FAIL}} |
| **4. Drip Tolerance** | No false trip | {{DRIP_RESULT}} | {{DRIP_PASS_FAIL}} |
| **5. Principal Isolation** | Per-principal tracking | {{ISOLATION_RESULT}} | {{ISOLATION_PASS_FAIL}} |
| **6. Performance Baseline** | p95 ≤ {{P95_BUDGET_MS}}ms | {{P95_VALUE}} ms | {{PERF_PASS_FAIL}} |

**Summary**: {{PASSED_COUNT}}/6 PASS, {{FAILED_COUNT}}/6 FAIL

---

## Health Check Snapshot

```bash
$ curl -s {{STAGING_BASE_URL}}/v1/health | jq '{
  principal_extraction,
  circuit_breaker: {
    global: .circuit_breaker.global,
    principals: .circuit_breaker.principals
  }
}'
```

**Output**:
```json
# PASTE HEALTH OUTPUT HERE
```

---

## Pass Gates Validation

- [ ] **6/6 scenarios PASS**
- [ ] **p95 ≤ {{P95_BUDGET_MS}}ms** (actual: {{P95_VALUE}}ms, margin: {{P95_MARGIN}}ms)
- [ ] **No drip false-positive trips** (Test 4 passed)
- [ ] **principal_extraction.mode = "fallback"** (not degraded)
- [ ] **circuit_breaker.global.state = "closed"** (nominal)
- [ ] **principals.open = 0** (no stuck circuits)

---

## Unhappy Path (If Needed)

### p95 > {{P95_BUDGET_MS}}ms
```bash
# Re-run with +20% threshold
make cb:loadtest BASE_URL="{{STAGING_BASE_URL}}" P95={{P95_BUDGET_MS}} THRESHOLD={{THRESHOLD_PLUS_20}} WINDOW_MS={{WINDOW_MS}}

# If still > {{P95_BUDGET_MS}}ms:
# 1. Abort rollout
# 2. File perf ticket
# 3. Investigate latency spike
```

### Circuit doesn't trip in burst test
```bash
# Check threshold configuration
make cb:health BASE_URL="{{STAGING_BASE_URL}}" | jq '.circuit_breaker.config'

# Lower threshold for testing
make cb:loadtest BASE_URL="{{STAGING_BASE_URL}}" P95={{P95_BUDGET_MS}} THRESHOLD=10 WINDOW_MS={{WINDOW_MS}}
```

---

## Status

**Staging Validation**: {{OVERALL_STATUS}}

**Ready for Canary**: {{READY_FOR_CANARY}}

**Notes**:
{{NOTES}}

---

**Completed By**: {{OWNER}}  
**Date**: {{DATE}}  
**Duration**: {{DURATION}}
