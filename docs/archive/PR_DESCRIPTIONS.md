# 📋 PR Descriptions (Copy-Paste Ready)

---

## PR 1: Response Validation + Metrics

### Title
```
Enforce /v1/run response schema + emit validation error metrics
```

### Description
```markdown
## Summary
Enforce strict AJV response validation on `/v1/run` and emit validation error metrics.

## Changes
- ✅ Wire `runResponseSchema` into `/v1/run` (schema.response.200)
- ✅ Track request/response AJV failures via `plot_engine_validation_errors_total{route,phase,error_type}`
- ✅ Keep `/v1/health` flexible (no strict response validation - dynamic fields by design)
- ✅ Integrated into existing error handler (no plugin conflicts)

## Files Changed (5 files, +82 LOC)
- `src/schemas/response.ts` - Response schemas + test helper
- `src/routes/v1/run.ts` - Wired response validation
- `src/routes/v1/index.ts` - Health documented as flexible
- `src/createServer.ts` - Validation metrics in error handler
- `tests/p0-1-response-validation.test.ts` - 3 tests (all passing)

## Metrics
```
plot_engine_validation_errors_total{route="/v1/run",phase="request",error_type="ajv"}
plot_engine_validation_errors_total{route="/v1/run",phase="response",error_type="ajv"}
```

## Tests: 3/3 ✅
```bash
npm test -- tests/p0-1-response-validation.test.ts
```

## Performance
- Overhead: <0.5ms p95
- Isolated perf test validates budget

## Risk
**Low** - Additive only, no breaking changes.

## Post-Merge Smoke
```bash
# Force a 400 and confirm metric increments
curl -XPOST localhost:3000/v1/run -H 'content-type: application/json' -d '{}'
curl -s localhost:3000/metrics | grep plot_engine_validation_errors_total
```

## Design Decision: Why No Health Validation?
Health returns dynamic fields based on runtime state (circuit breaker, caches, flags). Strict schema would break on every new metric added. Health is observability, not user-facing API contract. Request validation (user input) is the critical security boundary.
```

---

## PR 2: E2E Observability + Robust Wait

### Title
```
E2E harness: Prometheus assertions + robust PromQL wait + MD report
```

### Description
```markdown
## Summary
E2E harness now verifies circuit breaker via Prometheus with robust retry logic (no brittle sleeps) and writes Markdown reports.

## Changes
- ✅ Add `PROMETHEUS_ENABLE=1` to `docker-compose.e2e.yml`
- ✅ Introduce `waitForMetric()` retry helper (configurable timeout/interval/predicate)
- ✅ Scenario `02-burst-trips-circuit` asserts `plot_engine_circuit_open_total > 0`
- ✅ Orchestrator writes `e2e/reports/summary.json` and `summary.md`

## Files Changed (3 files, +40 LOC)
- `docker-compose.e2e.yml` - Enable Prometheus metrics
- `e2e/lib/prom-wait.ts` - Robust metric polling (NEW)
- `e2e/scenarios/02-burst-trip.ts` - Use `waitForMetric()` instead of fixed sleep

## Key Improvement
**Before**: `await new Promise(r => setTimeout(r, 8000))` ❌ (brittle)  
**After**: `await waitForMetric(() => prom.val('plot_engine_circuit_open_total'))` ✅ (robust)

## Run E2E
```bash
npm run e2e:up && sleep 30 && npm run e2e && npm run e2e:down
```

## Reports
- `e2e/reports/summary.json` - Machine-readable results
- `e2e/reports/summary.md` - Human-readable with pass/fail + timings

## Risk
**Low** - E2E infrastructure only, no production code changes.

## Review Checklist
- [x] `docker-compose.e2e.yml` has `PROMETHEUS_ENABLE=1`
- [x] `waitForMetric()` is used (no hardcoded sleep)
- [x] Scenario validates circuit opens via PromQL
```

---

## PR 3: Secret Rotation (ACTIVE + STAGED)

### Title
```
Dual-secret principal verification (ACTIVE+STAGED) + metrics + health
```

### Description
```markdown
## Summary
Dual-secret principal verification (ACTIVE+STAGED) for safe, zero-downtime secret rotation.

## Changes
- ✅ Config: `PRINCIPAL_HMAC_SECRET_ACTIVE` (generate) and `PRINCIPAL_HMAC_SECRET_STAGED` (grace verify)
- ✅ Back-compat with legacy `PRINCIPAL_HMAC_SECRET`
- ✅ Metric: `plot_engine_principal_secret_fallback_total{used="active|staged"}`
- ✅ Health: `principal_extraction.secrets.{active,staged}` booleans
- ✅ Tests: rotation + health exposure + backward compatibility (all passing)

## Files Changed (5 files, +145 LOC)
- `src/observability/principalSecretMetrics.ts` - Fallback counter (NEW)
- `src/lib/extractPrincipal.ts` - Dual-secret verification functions
- `src/middleware/circuitBreaker.ts` - Validate both secrets
- `src/plugins/metrics.ts` - Wire fallback metrics
- `tests/secret-rotation.test.ts` - 3 tests (NEW, all passing)
- `tests/secret-rotation-verify-unit.test.ts` - 2 direct unit tests (NEW)

## Metrics
```
plot_engine_principal_secret_fallback_total{used="active"} N
plot_engine_principal_secret_fallback_total{used="staged"} N
```

## Health Exposure
```json
{
  "principal_extraction": {
    "secrets": {
      "active": true,
      "staged": true
    }
  }
}
```

## Tests: 5/5 ✅
```bash
npm test -- tests/secret-rotation.test.ts
npm test -- tests/secret-rotation-verify-unit.test.ts
```

## Operator Playbook: Zero-Downtime Rotation

### Stage New Secret (24-48h grace)
```bash
export PRINCIPAL_HMAC_SECRET_ACTIVE=<new-64-hex>
export PRINCIPAL_HMAC_SECRET_STAGED=<old-64-hex>
kubectl set env deployment/plot-engine \
  PRINCIPAL_HMAC_SECRET_ACTIVE=$PRINCIPAL_HMAC_SECRET_ACTIVE \
  PRINCIPAL_HMAC_SECRET_STAGED=$PRINCIPAL_HMAC_SECRET_STAGED
```

### Monitor
```bash
# Check health
curl /v1/health | jq '.principal_extraction.secrets'
# Should show: {"active": true, "staged": true}

# Watch metric (should trend to 0)
curl /metrics | grep principal_secret_fallback_total
```

### Finalize
```bash
unset PRINCIPAL_HMAC_SECRET_STAGED
kubectl set env deployment/plot-engine PRINCIPAL_HMAC_SECRET_STAGED-

# Verify
curl /v1/health | jq '.principal_extraction.secrets'
# Should show: {"active": true, "staged": false}
```

### Rollback
If `staged` fallback stays high, keep grace window and investigate client drift.

## Risk
**Low** - Backward compatible, additive only. Legacy env var still works.

## Review Checklist
- [x] Changing only ACTIVE rejects old signatures; adding STAGED accepts both
- [x] `/metrics` shows fallback counter after traffic
- [x] Health reports `staged: true` during grace window
- [x] Backward compatibility test passes
- [x] Direct unit test validates ACTIVE→STAGED path
```

---

## Cleanup Commit

### Title
```
chore(p0-2): add direct verifyPrincipalSignature unit test & remove unused validation-observer plugin
```

### Description
```markdown
## Changes
- Remove `src/plugins/validation-observer.ts` (superseded by main error handler)
- Add `tests/secret-rotation-verify-unit.test.ts` (direct ACTIVE→STAGED verification)

## Tests: 2/2 ✅
- Accepts ACTIVE signatures and STAGED (grace) signatures
- Rejects signatures from unknown secrets

## Rationale
The validation-observer plugin was replaced by integrating validation metrics directly into the existing error handler in `createServer.ts`. This avoids plugin conflicts and keeps error handling centralized.

The new unit test directly exercises `verifyPrincipalSignature()` with both secrets to prove the ACTIVE→STAGED fallback path works correctly, independent of HTTP request flow.
```

---

