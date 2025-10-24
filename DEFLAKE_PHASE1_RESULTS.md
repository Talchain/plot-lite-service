# Deflake Phase 1 Results

| Run | Failed | Passed | Skipped | Total |
|-----|--------|--------|---------|-------|
| 1   | 5      | 158    | 8       | 171   |
| 2   | 5      | 158    | 8       | 171   |
| 3   | 6      | 157    | 8       | 171   |
| 4   | 5      | 158    | 8       | 171   |
| 5   | 5      | 158    | 8       | 171   |

## Analysis

- **Best case**: 5 failing files
- **Worst case**: 6 failing files
- **Variance**: ±1 files

### Comparison with Baseline

| Metric | Baseline (main) | After Deflake | Improvement |
|--------|-----------------|---------------|-------------|
| Best case | 5 | 5 | 0 |
| Worst case | 9 | 6 | -3 |
| Variance | ±4 | ±1 | -3 |
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
