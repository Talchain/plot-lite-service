# PLoT Engine Stabilization Session Summary

**Date**: Oct 24, 2025, 2:34pm-3:00pm UTC+01:00  
**Status**: ⚠️ **Blocked by Severe Flakiness**

---

## Priority 0: Housekeeping ✅

**PR #46 Status**: MERGED  
**New baseline established**: Post-merge verification

---

## Priority 1: Issue #43 - Confidence Calibration ⚠️

**Branch**: `fix/confidence-calibration-noop`  
**Status**: Implementation complete, but blocked by baseline drift

### What Was Done
- Created `src/trust/confidence-calibrated.ts` with deterministic threshold logic
- Implements `calculateCalibratedConfidence` with HIGH/MEDIUM/LOW levels
- All 16 tests in `confidence.calibration.test.ts` passing ✅

### Blocker: Severe Baseline Drift

**Expected baseline** (from PR #46): 5-6 failing files  
**Actual measurements**:
- Main (post-#46 single run): 5 failing files
- Main (verification run): 10 failing files  
- Branch (5-run worst-case): 8 failing files

**Root cause**: Test suite has severe flakiness beyond what PR #46 addressed.

### New Flaky Tests Observed
- `tests/metrics.shape.test.ts` - Metrics endpoint gate check
- `tests/inflight.plugin.test.ts` - Inflight accounting
- `tests/security.prod-guard.test.ts` - Security guards

These are **unrelated** to the confidence calibration change (isolated to `src/trust/`).

---

## Critical Finding: Baseline Instability

The test suite baseline is **not stable** even after PR #46:
- Single runs show 5-10 failing files
- 5-run protocol shows 4-8 failing files
- Variance remains high (±4 files)

**Implication**: Cannot reliably measure PR impact with current flakiness level.

---

## Recommendation

### Option A: Aggressive Deflake (Recommended)
1. Run comprehensive 10-run baseline on main to identify all flaky tests
2. Create mega-deflake PR addressing ALL flaky tests (not just the 6 from PR #46)
3. Target: ±0 variance across 10 runs
4. Then proceed with consistent failure fixes

### Option B: Skip Flaky Tests Temporarily
1. Add `.skip` to all flaky tests with issue links
2. Stabilize baseline to consistent failures only
3. Fix consistent failures
4. Unskip and fix flaky tests one by one

### Option C: Proceed with Caution
1. Accept high variance
2. Require 10-run protocol (not 5) for all PRs
3. Use worst-case +2 sigma as baseline
4. Document known flaky tests in each PR

---

## Deliverables This Session

### Code
- ✅ `src/trust/confidence-calibrated.ts` - Functional implementation
- ✅ 16/16 tests passing for confidence.calibration

### Documentation
- ✅ Baseline drift documented
- ✅ New flaky tests identified
- ✅ Recommendations provided

### Not Completed
- ❌ PR for #43 (blocked by baseline uncertainty)
- ❌ Priorities 2-6 (blocked by Priority 1)

---

## Next Steps

**Immediate**: Decision needed on Option A/B/C above

**If Option A (Recommended)**:
1. Run 10-run baseline on main
2. Identify ALL flaky tests (not just 6)
3. Create comprehensive deflake PR
4. Resume consistent failure fixes

**If Option B**:
1. Create PR to skip all flaky tests
2. Establish stable baseline (consistent failures only)
3. Fix consistent failures
4. Unskip flaky tests systematically

---

## Files Modified (Uncommitted)

- `src/trust/confidence-calibrated.ts` (new)
- Test run logs (`.ci-*.txt`)

**Branch**: `fix/confidence-calibration-noop` (1 commit, not pushed)

---

**Status**: ⚠️ **Session paused pending baseline stabilization strategy**
