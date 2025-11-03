# Test Evidence - P0 UI Integration

**Date:** 2025-11-03  
**Branch:** feat/ui-integration-p0

## Three Consecutive Runs (RATE_LIMIT_ENABLED=0)

| Run | Failed | Passed | Skipped | Total | Pass Rate |
|-----|--------|--------|---------|-------|-----------|
| 1   | 5      | 575    | 15      | 595   | 96.6%     |
| 2   | 4      | 576    | 15      | 595   | 96.8%     |
| 3   | 7      | 573    | 15      | 595   | 96.3%     |

**Median:** 575/595 (96.6%)  
**Variance:** ±3 tests

## Isolation Fixes Applied

- Added `PRINCIPAL_HMAC_SECRET*` env vars to all flaky tests
- Per-test server spawning with `vi.resetModules()`
- Proper cleanup in `afterEach` hooks

Files fixed: inspector.test.ts, option-compare.test.ts, metrics.shape.test.ts, run.scm-lite.integration.test.ts, scm-lite.disabled-warning.test.ts
