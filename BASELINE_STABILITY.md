# Baseline Stability Analysis (5 runs)

| Run | Failed | Passed | Skipped | Total |
|-----|--------|--------|---------|-------|
| 1   | 6      | 157    | 8       | 171   |
| 2   | 6      | 157    | 8       | 171   |
| 3   | 5      | 158    | 8       | 171   |
| 4   | 6      | 157    | 8       | 171   |
| 5   | 9      | 154    | 8       | 171   |

## Analysis

- **Best case**: 5 failing files
- **Worst case**: 9 failing files
- **Variance**: ±4 files
- **MAIN_WORST (use for deltas)**: 9
## Failing Files Analysis

### Consistency Check

| File | Run1 | Run2 | Run3 | Run4 | Run5 | Frequency |
|------|------|------|------|------|------|-----------|
| circuit-breaker.lru.test.ts | ❌   |❌   |❌   |❌   |❌   | 5/5 |
| confidence.calibration.test.ts | ❌   |❌   |❌   |❌   |❌   | 5/5 |
| contracts.health.size.test.ts | ✅   |✅   |✅   |✅   |❌   | 1/5 |
| extract-principal.integration.test.ts | ❌   |❌   |❌   |❌   |❌   | 5/5 |
| health.counters.test.ts | ❌   |✅   |✅   |✅   |✅   | 1/5 |
| rate-limit.ipv6.test.ts | ✅   |✅   |✅   |✅   |❌   | 1/5 |
| report.contract.test.ts | ❌   |❌   |❌   |❌   |❌   | 5/5 |
| run.scm-lite.integration.test.ts | ✅   |✅   |✅   |✅   |❌   | 1/5 |
| security.json-headers.test.ts | ✅   |✅   |✅   |✅   |❌   | 1/5 |
| selfcheck.parity.test.ts | ❌   |❌   |❌   |❌   |❌   | 5/5 |
| sse.soak.test.ts | ✅   |❌   |✅   |❌   |✅   | 2/5 |

### Classification

**Consistent failures (5/5 runs)**:
- `tests/circuit-breaker.lru.test.ts`
- `tests/confidence.calibration.test.ts`
- `tests/extract-principal.integration.test.ts`
- `tests/report.contract.test.ts`
- `tests/selfcheck.parity.test.ts`

**Flaky (1-4/5 runs)**:
- `tests/contracts.health.size.test.ts` (1/5)
- `tests/health.counters.test.ts` (1/5)
- `tests/rate-limit.ipv6.test.ts` (1/5)
- `tests/run.scm-lite.integration.test.ts` (1/5)
- `tests/security.json-headers.test.ts` (1/5)
- `tests/sse.soak.test.ts` (2/5)

## Summary

**Stable Baseline Protocol Established**

- **MAIN_WORST**: 9 failing files (use this for all delta calculations)
- **Consistent failures**: 5 files (always fail)
- **Flaky tests**: 6 files (intermittent failures)
- **Variance**: ±4 files (5 best → 9 worst)

**Root Cause**: Flakiness is the primary blocker. The 6 flaky tests add ±4 files of variance, making progress measurement unreliable.

**Next Steps**:
1. Fix or skip flaky tests to stabilize baseline
2. Address 5 consistent failures
3. Target: ≤3 failing files worst-case across 5 runs

**Protocol**: All PRs must show delta ≤ 0 vs MAIN_WORST=9
