<!-- ⚠️ TEMPLATE (not a real deployment log). Replace placeholders during a live rollout. -->
<!-- File: templates/rollout/CB_ROLLOUT_COMPLETE.template.md -->

# Circuit Breaker: Rollout Complete — {{DATE}}

**Engineer**: {{OWNER}}  
**Status**: {{OVERALL_STATUS}}  
**Confidence**: {{CONFIDENCE_LEVEL}}

---

## Executive Summary

{{EXECUTIVE_SUMMARY}}

---

## Rollout Timeline

| Stage | Date | Duration | Status |
|-------|------|----------|--------|
| **Preflight** | {{PREFLIGHT_DATE}} | {{PREFLIGHT_DURATION}} | {{PREFLIGHT_STATUS}} |
| **Staging Validation** | {{STAGING_DATE}} | {{STAGING_DURATION}} | {{STAGING_STATUS}} |
| **Canary 25%** | {{CANARY_DATE}} | 24h | {{CANARY_STATUS}} |
| **50% Rollout** | {{ROLLOUT_50_DATE}} | 8h | {{ROLLOUT_50_STATUS}} |
| **100% Rollout** | {{ROLLOUT_100_DATE}} | 48h | {{ROLLOUT_100_STATUS}} |
| **Total Duration** | | {{TOTAL_DURATION}} | {{TOTAL_STATUS}} |

---

## Acceptance Criteria

### Preflight
- [ ] All tests green ({{TEST_COUNT}} CB tests, {{ENABLEMENT_TEST_COUNT}} enablement tests)
- [ ] Alert rules validated ({{ALERT_TEST_COUNT}} tests passing)
- [ ] Dashboard import OK ({{PANEL_COUNT}} panels, valid JSON)
- [ ] Secret strength guard enforced (≥64 hex chars)
- [ ] Default flag OFF (RL_CB_ENABLE === '1' check)

### Staging
- [ ] Load tests: {{STAGING_PASS_COUNT}}/6 PASS
- [ ] p95 ≤ {{P95_BUDGET_MS}}ms (actual: {{STAGING_P95}}ms, margin: {{STAGING_P95_MARGIN}}ms)
- [ ] No drip false-positive trips
- [ ] principal_extraction.mode = "fallback" (not degraded)
- [ ] circuit_breaker.global.state = "closed"

### Canary 25% (24h)
- [ ] No P1 alerts (CircuitBreakerStuckOpen, CircuitBreakerGlobalOpen)
- [ ] Metrics healthy ({{CANARY_OPENS}} opens, 429 baseline {{CANARY_429_VARIANCE}})
- [ ] Latency on budget ({{CANARY_P95_AVG}} avg < {{P95_BUDGET_MS}}ms)
- [ ] No half-open timeouts
- [ ] Principal capacity healthy ({{CANARY_CAPACITY_MAX}} < 80%)

### 50% Rollout (8h)
- [ ] All canary gates met
- [ ] No new incidents
- [ ] Stable for 8h ({{ROLLOUT_50_OPENS}} opens, latency {{ROLLOUT_50_P95}}ms)

### 100% Rollout (48h)
- [ ] All 50% gates met
- [ ] No incidents for 48h
- [ ] Fleet-wide enablement confirmed ({{FLEET_SIZE}} pods)
- [ ] Health nominal (mode="fallback", state="closed", principals_open={{PRINCIPALS_OPEN}})

### Rollback Path
- [ ] Verified (<1 min, no restart required)
- [ ] Tested in staging (make cb:disable)
- [ ] Documented in CB_OPERATOR_HANDOFF.md

### No PII
- [ ] Spot-checked metrics (no raw tokens, IPs canonicalized)
- [ ] Health endpoint safe (HMAC principals only)
- [ ] Logs redacted (no sensitive data)

---

## Key Metrics (48h Production)

### Circuit Breaker
- **Global Opens**: {{GLOBAL_OPENS}} (target: 0)
- **Principal Opens**: {{PRINCIPAL_OPENS}} (target: <5)
- **Half-Open Timeouts**: {{HALF_OPEN_TIMEOUTS}} (target: 0)
- **Principal Capacity**: {{PRINCIPAL_CAPACITY}} (target: <80%)

### Performance
- **p95 Latency**: {{P95_LATENCY}}ms (budget: {{P95_BUDGET_MS}}ms)
- **429 Rate**: {{RATE_429_STATUS}} ({{RATE_429_VARIANCE}} variance)
- **Error Rate**: {{ERROR_RATE_STATUS}}

### Alerts
- **P1 Alerts**: {{P1_ALERT_COUNT}} (target: 0)
- **P2 Alerts**: {{P2_ALERT_COUNT}} (target: 0)
- **P3 Alerts**: {{P3_ALERT_COUNT}} (target: 0)

---

## Completed Checklist (from CB_ROLLOUT_CHECKLIST.md)

### Preflight
- [x] Secret strength verified (≥64 hex chars)
- [x] Trust proxy configured (TRUST_PROXY={{TRUST_PROXY}})
- [x] Alerts wired (monitoring/alerts/circuit-breaker.yaml)
- [x] Dashboard imported (monitoring/dashboards/circuit_breaker.json)
- [x] Dry-run load test ({{DRYRUN_PASS_COUNT}}/6 PASS)

### Stage 1: Staging Validation
- [x] Enable breaker (RL_CB_ENABLE=1)
- [x] Run load tests ({{STAGING_PASS_COUNT}}/6 PASS)
- [x] Gate: All tests PASS
- [x] Verify health (mode="fallback", state="closed")

### Stage 2: Canary 25% (24h Soak)
- [x] Enable on canary pods
- [x] Monitor dashboards (every 15 min for 24h)
- [x] Health checks (every 5 min for first hour, then hourly)
- [x] Gate: 24h stable (no P1/P2 alerts, metrics healthy)
- [x] Rollback ready (verified)

### Stage 3: Progressive Rollout
- [x] 50% for 8h (gates met)
- [x] 100% for 48h (gates met)
- [x] Final validation (all instances enabled, health nominal)

### Post-Deployment
- [x] Verify all instances ({{FLEET_SIZE}} pods enabled)
- [x] Baseline metrics (captured)
- [x] Review logs (no errors)
- [ ] Operator training (scheduled for {{TRAINING_DATE}})
- [x] Create dashboards (imported to Grafana)
- [x] Collect baseline (48h data captured)
- [ ] Update release comms (circuit breaker enabled)

---

## Quick Reference Commands

### Enable/Disable
```bash
# Enable (already done)
make cb:enable

# Disable (if needed)
make cb:disable
```

### Health Check
```bash
# Check circuit breaker health
make cb:health BASE_URL="{{PROD_URL}}"
```

### Version Check
```bash
# Check version flags
make cb:version BASE_URL="{{PROD_URL}}"
```

### Key PromQL Queries
```promql
# Circuit opens by reason (5m)
sum by (scope, reason) (increase(plot_engine_circuit_open_total[5m]))

# 429 rate per route (5m)
sum by (route) (increase(plot_engine_rate_limit_429_total[5m]))

# Half-open timeouts (15m)
sum(increase(plot_engine_circuit_open_total{reason="half_open_timeout"}[15m]))

# Principal capacity utilization
plot_engine_circuit_breaker_principals_tracked / plot_engine_circuit_breaker_principals_capacity
```

---

## Documentation

### Operator Guides
- [CB_OPERATOR_HANDOFF.md](./CB_OPERATOR_HANDOFF.md) - Quick start guide
- [CB_ROLLOUT_CHECKLIST.md](./CB_ROLLOUT_CHECKLIST.md) - Deployment checklist
- [ALERT_RUNBOOK.md](./ALERT_RUNBOOK.md) - Triage & remediation (<15 min)

### Rollout Reports
- [STAGING_LOADTEST_TRANSCRIPT.md](./STAGING_LOADTEST_TRANSCRIPT.md) - Staging validation
- [CANARY_25_MONITORING.md](./CANARY_25_MONITORING.md) - Canary 24h soak
- [PROGRESSIVE_ROLLOUT.md](./PROGRESSIVE_ROLLOUT.md) - 50% → 100% rollout

---

## Support & Escalation

**Primary Contact**: {{PRIMARY_CONTACT}}  
**Secondary Contact**: {{SECONDARY_CONTACT}}

**Runbook Drills**: Quarterly (see ALERT_RUNBOOK.md)

---

## Next Steps

### Immediate (Week 1)
- [ ] Operator training (30-min walkthrough)
- [ ] Dashboard access verified
- [ ] Alert routing configured
- [ ] Collect baseline metrics (1 week)
- [ ] Update release comms

### Short-Term (Month 1)
- [ ] Quarterly drill scheduled
- [ ] Alert rules validated in production
- [ ] Tuning adjustments (if needed)
- [ ] Success criteria validated

---

## Success Metrics

### Technical
- {{TECH_METRIC_1}}
- {{TECH_METRIC_2}}
- {{TECH_METRIC_3}}
- {{TECH_METRIC_4}}
- {{TECH_METRIC_5}}

### Operational
- {{OPS_METRIC_1}}
- {{OPS_METRIC_2}}
- {{OPS_METRIC_3}}
- {{OPS_METRIC_4}}
- {{OPS_METRIC_5}}

---

## Confidence Assessment

**Overall Confidence**: {{CONFIDENCE_LEVEL}}

**Rationale**:
{{CONFIDENCE_RATIONALE}}

**Risk Level**: {{RISK_LEVEL}}

---

## Status

**Circuit Breaker Rollout**: {{OVERALL_STATUS}}

**Production Status**: {{PROD_STATUS}}

**Health**: {{HEALTH_STATUS}}

**Notes**:
{{FINAL_NOTES}}

---

**Completed By**: {{OWNER}}  
**Date**: {{DATE}}  
**Version**: v2.3 (Circuit Breaker Fix Pack + Production Enablement)
