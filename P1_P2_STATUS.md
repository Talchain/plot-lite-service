# P1/P2 Status - 2025-10-21

## ✅ P0.5 COMPLETE (211e375)
- Docs organized: 70+ files archived
- Created docs/observability/ with metrics catalog
- Root cleaned to 4 essential files
- docs/STATUS.md is single source of truth

## 🚧 P1 IN PROGRESS (d7b735d)
**Completed:**
- ✅ Test helpers: tests/helpers/server.ts, metrics.ts
- ✅ Refactored validation metric test to use helpers
- ✅ Helpers provide: startServer(), waitForMetric(), parseMetricLine()

**Remaining:**
- Refactor 20+ E2E tests to use helpers
- Fix 42 failing tests (474 passing)
- Remove test.skip without justification
- Strengthen CI gates

## 📋 P2 PLANNED
**Not started - requires P1 completion**

Planned:
- Header-based canary (X-Enable-Enhanced: 1)
- Stream metrics: heartbeat, backpressure, circuit breaker
- E2E tests for enhanced path
- Operator runbook

## Next Steps
1. Continue P1: Refactor remaining tests
2. Fix failing tests systematically
3. Then proceed to P2 implementation
