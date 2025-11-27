# Circuit Breaker: GO/NO-GO Decision

**Date**: 2025-10-18  
**Version**: v2.3 (Circuit Breaker Fix Pack)  
**Decision**: ✅ **GO FOR PRODUCTION**

---

## Preconditions (All Met ✅)

### Code & Tests
- ✅ **6 code PRs merged** (PR-1, PR-2A, PR-2B, PR-2C, PR-2C.1, PR-3)
- ✅ **PR-6 docs in main** (ALERT_RUNBOOK, LOADTEST_BREAKER, CB_PRODUCTION_ENABLEMENT)
- ✅ **37/37 tests passing** (100% pass rate)
- ✅ **Typecheck clean** (no errors)
- ✅ **Lint clean** (no warnings)

### Configuration
- ✅ **PRINCIPAL_HMAC_SECRET** ready (64-hex, vaulted)
- ✅ **TRUST_PROXY** configured (default: 0, safe)
- ✅ **TRUST_PROXY_HOPS** configured (default: 1)
- ✅ **Default posture**: `RL_CB_ENABLE=0` (metrics only)

### Documentation
- ✅ **ALERT_RUNBOOK.md** (522 lines, operator-ready)
- ✅ **LOADTEST_BREAKER.md** (400 lines, 6 scenarios)
- ✅ **CB_PRODUCTION_ENABLEMENT.md** (411 lines, rollout guide)
- ✅ **RELEASE_NOTES_v2.3.md** (comprehensive feature docs)

---

## 🚀 Rollout Plan (Copy-Paste Friendly)

### Stage 1: Staging Validation (NOW)

**Enable Breaker:**
```bash
export RL_CB_ENABLE=1
export PRINCIPAL_HMAC_SECRET="<from-vault>"
export TRUST_PROXY=0  # Unless behind trusted proxy

# Deploy to staging
```

**Run Load Tests:**
```bash
# Follow docs/LOADTEST_BREAKER.md
# All 6 scenarios must pass:
# 1. Burst load (trip global circuit)
# 2. Recovery (half-open → closed)
# 3. Half-open timeout (no probes)
# 4. Drip load (should NOT trip)
# 5. Per-principal isolation
# 6. Performance impact (<1ms p95)
```

**Pass Criteria:**
- ✅ Threshold trips within ±10%
- ✅ p95 latency within budget
- ✅ No false trips in drip test
- ✅ All 6 tests pass

---

### Stage 2: Canary 25% (24h Soak)

**Enable on Canary:**
```bash
# Set on canary pods only
export RL_CB_ENABLE=1
```

**Watch Dashboards:**
```promql
# Circuit opens by reason (5m)
sum by (scope, reason) (increase(plot_engine_circuit_open_total[5m]))

# 429 rate per route (5m)
sum by (route) (increase(plot_engine_rate_limit_429_total[5m]))

# Half-open timeouts (15m)
sum(increase(plot_engine_circuit_open_total{reason="half_open_timeout"}[15m]))
```

**Health Checks (Every 5 min):**
```bash
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

**Pass Criteria (24h):**
- ✅ No circuit opens (or <5 in 24h)
- ✅ 429 rate within baseline (±20%)
- ✅ No half-open timeouts
- ✅ p95 latency unchanged
- ✅ No errors in logs

**Rollback (<1 min if needed):**
```bash
export RL_CB_ENABLE=0
# No restart required
```

---

### Stage 3: Progressive Rollout (50% → 100%)

**50% Rollout:**
- Enable on 50% of fleet
- Monitor for 8 hours
- Same pass criteria as canary

**100% Rollout:**
- Enable on all instances
- Monitor for 48 hours
- Final validation

**Success Criteria:**
```bash
# All instances show fallback mode
curl -s https://prod.example.com/v1/health | jq '.principal_extraction.mode'
# Expected: "fallback"

# Low circuit open count
curl -s https://prod.example.com/metrics | grep circuit_open_total
# Should show low values
```

---

## 👀 What to Watch (Fast Triage)

### Key Metrics

**1. Half-Open Timeout Spike**
```promql
sum(increase(plot_engine_circuit_open_total{reason="half_open_timeout"}[15m])) > 5
```
**Action**: Probes aren't succeeding → tune timeout or check downstream

**2. Global vs Principal Trips**
- Many principal opens + low global → distributed abuse (rate-limit/WAF)
- Global opens → system-wide overload (capacity/upstream)

**3. Principal Capacity**
```bash
curl -s https://prod.example.com/v1/health | jq '.circuit_breaker.principals | {
  tracked,
  capacity,
  utilization: (.tracked / .capacity)
}'
```
**Action**: If utilization > 0.8 → raise capacity or investigate churn

---

## 🧯 Instant Rollback

**No Restart Needed:**
```bash
# Disable enforcement immediately
export RL_CB_ENABLE=0

# Verify via health
curl -s https://prod.example.com/v1/health | jq '.version.flags.RL_CB_ENABLE'
# Expected: "0"

# Metrics continue collecting
curl -s https://prod.example.com/metrics | grep circuit_open_total
# Metric still exists
```

**Rollback Time**: <1 minute  
**Impact**: None (graceful degradation)  
**Metrics**: Continue collecting (post-incident analysis)

---

## 📝 Post-Deploy Checklist

### Immediate (Day 0)
- [ ] Verify all instances show `principal_extraction.mode="fallback"`
- [ ] Confirm metrics collecting (circuit_open_total exists)
- [ ] Check baseline 429 rate (should be unchanged)
- [ ] Verify p95 latency (should be unchanged)
- [ ] Review logs for errors (should be none)

### Short-Term (Week 1)
- [ ] Schedule 30-min on-call walkthrough (ALERT_RUNBOOK.md)
- [ ] Create Grafana dashboard (PromQL from docs)
- [ ] Monitor circuit open events (should be rare)
- [ ] Collect baseline metrics (429 p50/p95/p99)
- [ ] Update release comms (flag-gated, instantly reversible)

### Long-Term (Month 1)
- [ ] Quarterly runbook drill scheduled
- [ ] Alert rules configured (P1/P2/P3)
- [ ] Tuning adjustments (if needed)
- [ ] Operator training complete
- [ ] Success criteria validated

---

## 🔜 Recommended Next Tickets

### PR-3.1: Secret Strength Guard (High Priority)
**Goal**: Fail-fast on weak secrets

**Changes:**
```typescript
// In extractPrincipal.ts or circuitBreaker.ts init
const secret = process.env.PRINCIPAL_HMAC_SECRET;
if (process.env.RL_CB_ENABLE === '1') {
  if (!secret || secret.length < 64) {
    console.error('[circuit-breaker] PRINCIPAL_HMAC_SECRET must be ≥64 hex chars (32 bytes). Current: ' + (secret?.length || 0));
    process.exit(1); // Fail-fast
  }
}
```

**Tests:**
- Short secret → process exits with error
- Valid secret → no error

**LOC**: ~20 lines  
**Tests**: 1-2 tests  
**Risk**: LOW (boot-time check only)

---

### PR-4/5: Contract Hardening (Next Minor v2.4)
**Goal**: Tighten request/response validation

**Tasks:**
1. **Schema fixes**:
   - Add `additionalProperties: false` on node/edge items
   - Whitelist allowed fields
   - Remove double validation (AJV only)

2. **Response validation**:
   - Add lightweight check before send
   - Or test-time validation

3. **Coverage**:
   - Audit all POST routes
   - Add schemas where missing

4. **Tests**:
   - Unknown-field rejection
   - Malformed types
   - Oversized payloads
   - Perf guard: <1ms p95 overhead

**Acceptance:**
- All POST routes validated
- Unknown fields rejected
- Perf budget respected
- All tests green

**LOC**: ~100-150 lines  
**Timeline**: Next minor release

---

### PR-X: Alert Rule Test File (Optional)
**Goal**: Unit-test alert expressions

**Example:**
```typescript
// tests/alert-rules.test.ts
describe('Alert Rules', () => {
  it('circuit open alert triggers correctly', () => {
    const query = 'increase(plot_engine_circuit_open_total{scope="global"}[5m]) > 0';
    // Mock metrics and verify alert fires
  });
});
```

**LOC**: ~50 lines  
**Value**: Catch typos before prod

---

### PR-Y: Single-Shot Load Test Script (Optional)
**Goal**: One-command validation

```bash
# tests/loadtest-breaker.sh
#!/bin/bash
set -e

echo "Running CB load tests..."
./test1-burst.sh
./test2-recovery.sh
./test3-timeout.sh
./test4-drip.sh
./test5-isolation.sh
./test6-perf.sh

echo "✅ All tests passed!"
```

**LOC**: ~100 lines  
**Value**: Faster pre-prod validation

---

## 📊 Risk Assessment

### Technical Risk: **LOW** ✅
- Flag-gated (safe default: OFF)
- Instant rollback (no restart)
- Comprehensive testing (37/37 tests)
- Small PRs (avg 70 LOC)
- Degraded mode for misconfig

### Operational Risk: **LOW** ✅
- Extensive documentation (1,333 lines)
- Operator runbooks (<15 min triage)
- Load test playbook (6 scenarios)
- Progressive rollout (25% → 50% → 100%)
- Quarterly drills planned

### Business Risk: **LOW** ✅
- No breaking changes
- Backward compatible
- Improves resilience
- Prevents cascade failures
- Easy rollback

---

## 🎯 Success Criteria

### Technical (Week 1)
- ✅ No unplanned circuit opens (global)
- ✅ <5 principal circuits open simultaneously
- ✅ No half-open timeout spikes
- ✅ p95 latency unchanged
- ✅ No degraded mode incidents

### Operational (Week 1)
- ✅ Operators trained on runbook
- ✅ Dashboards created
- ✅ Alert rules configured
- ✅ Runbook drill scheduled
- ✅ No escalations

### Business (Month 1)
- ✅ Improved service resilience
- ✅ Reduced cascade failure risk
- ✅ Better observability
- ✅ Operator confidence high
- ✅ No customer impact

---

## 📞 Contacts & Escalation

**Primary**: @eng-platform (Slack)  
**Secondary**: On-call engineer (PagerDuty)  
**Docs**: docs/ALERT_RUNBOOK.md  
**Runbook**: docs/CB_PRODUCTION_ENABLEMENT.md  
**Load Test**: docs/LOADTEST_BREAKER.md

---

## ✅ Final Decision

**Status**: ✅ **GO FOR PRODUCTION**

**Confidence**: **HIGH**
- All preconditions met
- Comprehensive testing
- Extensive documentation
- Low risk profile
- Easy rollback

**Approved By**:
- [ ] Engineering Lead: ________________
- [ ] Operations Lead: ________________
- [ ] Security Review: ________________

**Date**: 2025-10-18  
**Next Review**: After 1 week in production

---

**🚀 Ready to deploy following CB_PRODUCTION_ENABLEMENT.md**
