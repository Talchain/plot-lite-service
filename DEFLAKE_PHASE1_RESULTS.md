# Deflake Phase 1 Results

## Phase 1 Deflake — 5-run Summary
Runs: 5
Best / Worst / Variance: 5 / 6 / ±1

### Flaky → Stable (now 0/5 failures)
- contracts.health.size.test.ts
- health.counters.test.ts
- rate-limit.ipv6.test.ts
- security.json-headers.test.ts
- sse.soak.test.ts

### Still Flaky (1/5)
- run.scm-lite.integration.test.ts

### Consistent Failures (5/5 every run)
- circuit-breaker.lru.test.ts
- confidence.calibration.test.ts
- extract-principal.integration.test.ts
- report.contract.test.ts
- selfcheck.parity.test.ts

**Evidence (worst-case protocol):**
```
main worst:    Test Files  9 failed | 154 passed | 8 skipped (171)
this branch:   Test Files  6 failed | 157 passed | 8 skipped (171)
delta:         6 - 9 = -3  ✅
```

### Comparison with Baseline

| Metric | Baseline (main) | After Deflake | Improvement |
|--------|-----------------|---------------|-------------|
| Best case | 5 | 5 | 0 |
| Worst case | 9 | 6 | **-3** ✅ |
| Variance | ±4 | ±1 | **-3** ✅ |
