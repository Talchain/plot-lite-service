# A-Grade Stabilisation - Current Status

## Test Results (3× Runs - Post #71 Merge)

```
Run 1: Tests  10 failed | 572 passed | 15 skipped (597) - 95.8%
Run 2: Tests   6 failed | 576 passed | 15 skipped (597) - 96.5%
Run 3: Tests   7 failed | 575 passed | 15 skipped (597) - 96.4%
```

**Median:** 575/597 (96.4%)  
**Variance:** ±4 tests  
**Evidence:** `.tmp/a-grade/run{1,2,3}.txt`

---

## A-Grade Criteria Assessment

| Criterion | Target | Actual | Status |
|-----------|--------|--------|--------|
| Pass Rate | ≥579/597 (97.0%) | 575/597 (96.4%) | ❌ -4 tests short |
| Variance | ≤2 tests | ±4 tests | ❌ Need -2 variance |
| P1A/P1B | 0 failures | 1-2 failures | ❌ Intermittent |
| SCM-Lite | 0 failures | 3-5 failures | ❌ Env not applied |
| Determinism | Maintained | ✅ Passing | ✅ PASS |

**Result:** 1/5 criteria met

---

## Progress Since Baseline

**PR #71 Merged:** ✅ Test env isolation in spawnServer

**Impact:**
- Baseline (before #71): 570-574/597, ±4 variance
- Current (after #71): 572-576/597, ±4 variance
- **Improvement:** +2-4 tests more stable

**Variance:** Still ±4 (target ≤2)

---

## Remaining Issues

### 1. P1B Inspector (1-2 failures, intermittent)
**Tests:**
- `tests/inspector.test.ts` - debug.inspector undefined

**Symptoms:**
- Passes in isolation (5/5)
- Fails in full suite (3-4/5)
- Highly variable (3-5 test file failures across runs)

**Root Cause:** Module-level state pollution despite env isolation

**Requires:**
- Identify which test file runs before inspector
- Check for module cache issues
- May need global state reset between test files

### 2. SCM-Lite Integration (3-5 failures)
**Tests:**
- `tests/run.scm-lite.integration.test.ts` (3-4 failures)
- `tests/scm-lite.disabled-warning.test.ts` (1 failure)

**Symptoms:**
- Returns `run.v1` instead of `report.v1`
- SCM_LITE_ENABLE=1 not being respected
- Rate limit test expects 429, gets 200

**Root Cause:** SCM-Lite not initializing despite env var

**Requires:**
- Debug why SCM_LITE_ENABLE not applied
- Check module initialization order
- May need explicit SCM-Lite ready check

### 3. Other Failures (2-3)
- `tests/health.counters.test.ts` - 503 expected
- `tests/rate-limit.clarity.test.ts` - 429 headers missing

---

## What Was Tried

### ✅ Completed
1. **PR #71:** Test env isolation in spawnServer
   - Removed `process.env` spread
   - Minimal base env (PATH, HOME, USER, TMPDIR)
   - Test-specific vars now override cleanly

### ❌ Not Sufficient
- Env isolation alone didn't solve ordering issues
- Module-level state still polluting between tests
- SCM-Lite initialization still failing

---

## Path to A-Grade (Estimated 6-8 hours)

### Phase 1: Module State Isolation (2-3h)
- Add `vi.resetModules()` in global `beforeEach`
- Clear module cache between test files
- Audit for global state in src/ modules

### Phase 2: SCM-Lite Debugging (2-3h)
- Add logging to see if SCM_LITE_ENABLE reaches code
- Check module import order
- Verify SCM-Lite initialization sequence
- Add explicit ready check

### Phase 3: Test Ordering (1-2h)
- Run tests in different orders to identify polluters
- Add explicit cleanup in problematic tests
- Consider test file isolation strategies

### Phase 4: Final Verification (1h)
- 3× runs with fixes
- Achieve ≥579/597, ≤2 variance
- Update PR #70

---

## Recommendation

**Current Grade:** B (82/100)
- ✅ Env isolation improved
- ✅ Foundation solid
- ❌ Ordering issues remain
- ❌ 4 tests short of target

**Options:**
1. **Continue debugging** (6-8h) - Full A-grade
2. **Defer to follow-up** - Focus on other priorities
3. **Accept B-grade** - 96.4% is solid for now

---

**Status:** PROGRESS MADE, A-GRADE REQUIRES MORE TIME  
**Median:** 575/597 (96.4%)  
**Variance:** ±4 tests  
**Gap:** -4 tests, -2 variance
