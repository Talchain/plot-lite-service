# PLoT Engine — Deflake & Stabilization Session Summary

**Date**: Oct 24, 2025  
**Goal**: Establish stable baseline and achieve ≤3 failing files worst-case

---

## ✅ Phase 0 Complete: Stable Baseline Protocol

### Methodology
Ran full test suite **5 times** with fresh process each run to measure variance.

### Results

| Run | Failed | Passed | Skipped | Total |
|-----|--------|--------|---------|-------|
| 1   | 6      | 157    | 8       | 171   |
| 2   | 6      | 157    | 8       | 171   |
| 3   | 5      | 158    | 8       | 171   |
| 4   | 6      | 157    | 8       | 171   |
| 5   | 9      | 154    | 8       | 171   |

**Statistics**:
- Best case: 5 failing files
- Worst case: 9 failing files  
- Variance: ±4 files
- **MAIN_WORST**: 9 (baseline for all deltas)

---

## 📊 Failure Classification

### Consistent Failures (5/5 runs)
These **always fail** - not flaky:

1. ✅ `tests/circuit-breaker.lru.test.ts` (Issue #45)
2. ✅ `tests/confidence.calibration.test.ts` (Issue #43)
3. ✅ `tests/extract-principal.integration.test.ts` (Issue #44)
4. ✅ `tests/report.contract.test.ts` (Issue #42)
5. ✅ `tests/selfcheck.parity.test.ts` (Issue #41)

### Flaky Tests (1-4/5 runs)
These **intermittently fail** - causing ±4 file variance:

1. ⚠️ `tests/contracts.health.size.test.ts` (1/5)
2. ⚠️ `tests/health.counters.test.ts` (1/5)
3. ⚠️ `tests/rate-limit.ipv6.test.ts` (1/5)
4. ⚠️ `tests/run.scm-lite.integration.test.ts` (1/5)
5. ⚠️ `tests/security.json-headers.test.ts` (1/5)
6. ⚠️ `tests/sse.soak.test.ts` (2/5)

---

## 🎯 Key Insight

**Flakiness is the primary blocker to measuring progress.**

The 6 flaky tests contribute ±4 files of variance, making it impossible to reliably measure improvement. A "successful" PR could show worse results purely due to flaky test timing.

---

## 📋 Action Plan

### Priority 1: Deflake (Stabilize Baseline)
Fix or skip the 6 flaky tests to achieve consistent baseline:
- Target: Same failing file count across 5 runs (±0 variance)
- Approach: Add timeouts, seed RNG, fix race conditions, or skip with issue links

### Priority 2: Fix Consistent Failures
Address the 5 consistent failures:
- Already tracked in issues #41-45
- These are real bugs/mismatches, not flakiness

### Priority 3: Achieve Target
- Goal: ≤3 failing files worst-case across 5 runs
- Current: 9 worst-case, 5 best-case
- Gap: Need to fix 6 files (worst-case) or 2 files (best-case)

---

## 🔧 Protocol Established

**All PRs must**:
1. Run tests 5 times on PR branch
2. Compute worst-case failing file count
3. Show delta ≤ 0 vs MAIN_WORST=9
4. Include three-line evidence:
   ```
   main baseline (worst):  Test Files  9 failed | ... (171)
   this branch (worst):    Test Files  X failed | ... (171)
   delta:                  (X - 9) ≤ 0
   ```

---

## 📈 Progress Tracking

| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| Worst-case failures | 9 | ≤3 | 🔴 In Progress |
| Best-case failures | 5 | ≤3 | 🟡 Close |
| Variance | ±4 | ±0 | 🔴 High |
| Flaky tests | 6 | 0 | 🔴 Blocking |
| Consistent failures | 5 | ≤3 | 🟡 Close |

---

## 🎯 Success Criteria

- [ ] Variance reduced to ±0 (no flaky tests)
- [ ] Worst-case ≤3 failing files across 5 runs
- [ ] All PRs use 5-run protocol for evidence
- [ ] Flaky tests either fixed or skipped with issue links

---

**Status**: Phase 0 Complete ✅  
**Next**: Phase 1 - Deflake the 6 flaky tests

**Files**:
- `BASELINE_STABILITY.md` - Full analysis
- `.ci-main-run{1-5}.txt` - Raw test outputs
- `parse_baseline.sh` - Baseline parser
- `analyze_flaky.sh` - Flakiness analyzer
