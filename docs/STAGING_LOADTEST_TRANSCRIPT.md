> ⚠️ This document is a **SIMULATION** used for training/process validation.  
> For a real rollout, use the templates in `templates/rollout/` and fill with live data.

# Staging Load Test Transcript

**Date**: 2025-10-18  
**Environment**: Staging (simulated)  
**Command**: `make cb:loadtest BASE_URL="https://staging.example.com" P95=150 THRESHOLD=50 WINDOW_MS=10000`

---

## Full Transcript

```bash
$ make cb:loadtest BASE_URL="https://staging.example.com" P95=150 THRESHOLD=50 WINDOW_MS=10000

Running circuit breaker load tests...
==========================================
Circuit Breaker Load Test
==========================================
Base URL: https://staging.example.com
P95 Budget: 150ms
Threshold: 50
Window: 10000ms
==========================================

Test 1: Burst Load (Trip Global Circuit)
------------------------------------------
Sending 55 invalid requests...
✓ PASS: Burst load trips circuit

Test 2: Recovery Cycle (Half-Open → Closed)
------------------------------------------
Waiting 12s for cooldown...
Circuit entered half-open state
Sending 3 successful probes...
✓ PASS: Recovery cycle (half-open → closed)

Test 3: Half-Open Timeout (No Probes)
------------------------------------------
Tripping circuit...
Waiting 12s for cooldown...
Waiting 16s for half-open timeout...
✓ PASS: Half-open timeout reopens circuit

Test 4: Drip Load (Should NOT Trip)
------------------------------------------
Resetting circuit...
Sending 25 requests over 20s (drip)...
✓ PASS: Drip load does not trip circuit

Test 5: Per-Principal Isolation
------------------------------------------
Resetting circuit...
Principal extraction enabled (mode: fallback)
Tripping principal A...
✓ PASS: Per-principal isolation

Test 6: Performance Impact
------------------------------------------
Resetting circuit...
Measuring p95 latency (10 requests)...
p95 latency: 127.4ms (budget: 150ms)
✓ PASS: Performance impact within budget

==========================================
Summary
==========================================
Passed: 6
Failed: 0
==========================================
✓ ALL TESTS PASSED
```

---

## Health Check Snapshot

```bash
$ curl -s https://staging.example.com/v1/health | jq '{
  principal_extraction,
  circuit_breaker: {
    global: .circuit_breaker.global,
    principals: .circuit_breaker.principals
  }
}'
```

**Output**:
```json
{
  "principal_extraction": {
    "enabled": true,
    "trust_proxy": false,
    "hops": 1,
    "mode": "fallback"
  },
  "circuit_breaker": {
    "global": {
      "state": "closed",
      "failures": 0,
      "opened_at": 0,
      "half_open_probes": 0,
      "last_transition_at": 1729281234567
    },
    "principals": {
      "tracked": 2,
      "open": 0,
      "capacity": 1000,
      "ttl_ms": null
    }
  }
}
```

---

## Pass Gates Validation

- ✅ **6/6 scenarios PASS**
- ✅ **p95 ≤ 150ms** (actual: 127.4ms, margin: 22.6ms)
- ✅ **No drip false-positive trips** (Test 4 passed)
- ✅ **principal_extraction.mode = "fallback"** (not degraded)
- ✅ **circuit_breaker.global.state = "closed"** (nominal)
- ✅ **principals.open = 0** (no stuck circuits)

---

## Status

**Staging Validation**: ✅ **PASS**

**Ready for Canary 25% deployment**
