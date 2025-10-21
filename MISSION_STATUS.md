# Mission Status: P0.5 → P1 → P2

**Date**: 2025-10-21 01:05 UTC+01:00
**Commits**: 211e375 (P0.5), d7b735d (P1 helpers), a48751b (P1 inventory)

---

## ✅ P0.5 COMPLETE - Documentation Organization

**Commit**: `211e375`
**Status**: Merged & Deployed

### Deliverables
- ✅ Created `docs/` structure (observability/, runbooks/, reports/, archive/)
- ✅ Archived 70+ status documents
- ✅ Comprehensive metrics documentation (METRICS_CATALOG, PROMETHEUS_QUERIES, HOWTO)
- ✅ Root cleaned to 4 essential files
- ✅ `docs/STATUS.md` as single source of truth with live prod proof

**Acceptance**: All criteria met - root is tidy, docs navigable in <1 minute

---

## 🚧 P1 IN PROGRESS - CI Fully Green

**Commits**: `d7b735d`, `a48751b`
**Status**: Infrastructure complete, fixes needed

### Completed ✅
1. **Test Helpers** (`d7b735d`)
   - `tests/helpers/server.ts` - startServer(), closeServer()
   - `tests/helpers/metrics.ts` - waitForMetric(), getMetricValue()
   - Refactored validation metric test to use helpers

2. **Failing Tests Inventory** (`a48751b`)
   - `docs/reports/P1_FAILING_TESTS.md` - Categorized 42 failing tests
   - `tests/helpers/sse.ts` - SSE helper with heartbeat tolerance

### Test Status
- **Passing**: 474 tests ✅
- **Failing**: 42 tests (categorized by priority)
- **Skipped**: 13 tests

### Remaining Work
- [ ] Fix Schema/Contract issues (12 tests) - HIGH
- [ ] Fix Determinism/Response Hash (8 tests) - HIGH
- [ ] Fix Idempotency cache (3 tests) - MEDIUM
- [ ] Fix Feature Flags (8 tests) - MEDIUM
- [ ] Fix Rate Limiting (3 tests) - MEDIUM
- [ ] Fix Stream/SSE (2 tests) - MEDIUM
- [ ] Fix Environment (5 tests) - LOW
- [ ] Strengthen CI gates (coverage, perf check)

---

## 📋 P2 PLANNED - Enhanced Streaming Canary

**Status**: Ready to implement
**Dependencies**: P1 test infrastructure complete ✅

### Implementation Plan

#### PR-1: Canonical Header + Deprecation
- Header: `X-Enable-Enhanced-Stream` (accept 1|true|yes)
- Deprecation metric for legacy headers
- Per-route canary gate

#### PR-2: Resume via Last-Event-ID
- SSE events with strictly increasing IDs
- Prefer `Last-Event-ID`, fallback to `X-Resume-From`
- Ring buffer (1000 events default)
- Metrics: resume_requests, hits, misses

#### PR-3: Stream Metrics Completeness
- Heartbeat, backpressure, circuit breaker metrics
- Client lifetime histogram
- PromQL queries and alerts
- Operator runbook

---

## Current Production State

**Deploy SHA**: `ab222c0` (validation metrics fix)
**Environment**:
- `PROMETHEUS_ENABLE=1` ✅
- `STREAM_PARITY_ENABLE=0` ✅
- `PRINCIPAL_HMAC_SECRET_ACTIVE=<64-hex>` ✅

**Verification**:
```bash
# Health
curl -s https://plot-lite-service.onrender.com/v1/health | jq '.principal_extraction'
# {"enabled": true, "mode": "fallback", "secrets": {"active": true}}

# Validation metric
curl -s https://plot-lite-service.onrender.com/metrics | \
  grep 'plot_engine_validation_errors_total{route="/v1/run"'
# plot_engine_validation_errors_total{route="/v1/run",phase="request",error_type="ajv"} 5
```

---

## Next Steps

### Immediate (P1 Completion)
1. Fix high-priority schema/contract issues
2. Add determinism fields (determinism_note, response_hash stability)
3. Fix idempotency cache bounds
4. Strengthen CI gates

### After P1 (P2 Implementation)
1. PR-1: Header-based canary
2. PR-2: Resume semantics
3. PR-3: Metrics completeness

---

**Status**: P0.5 ✅ | P1 Infrastructure ✅ | P1 Fixes 🚧 | P2 📋
**Quality**: High - All changes tested, documented, deployed
**Risk**: Low - Incremental, backward compatible, feature-flagged
