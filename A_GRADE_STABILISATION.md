# A-Grade Stabilisation Sprint

**Goal:** Achieve Grade A stability criteria  
**Target:** ≥97.0% pass rate (≥579/597), variance ≤2 tests, 3× verified  
**Current:** 96.5% median, ±3 variance (from PR #69)

---

## A-Grade Criteria

| Criterion | Target | Current | Status |
|-----------|--------|---------|--------|
| Pass Rate | ≥579/597 (97.0%) | 576/597 (96.5%) | ⚠️ Need +3 tests |
| Variance | ≤2 tests | ±3 tests | ⚠️ Need -1 variance |
| P1A/P1B | 0 failures | 4-7 failures | ❌ Fix required |
| Determinism | Maintained | ✅ Passing | ✅ OK |
| No .skip | No skips as fixes | ✅ None | ✅ OK |

---

## Tasks

### 1. Fix P1A/P1B Debug Slices (Priority 1)

**Issue:** `debug.inspector` and `debug.compare` intermittently missing in full suite

**Root Cause:** Test env coupling, empty-string secrets interfering

**Fix:**
- Remove `PRINCIPAL_HMAC_SECRET: ''` (empty strings) from test ENVs
- Use explicit test secrets or omit the vars entirely
- Ensure `COMPARE_VIEW_ENABLE=1` and `INSPECTOR_DEBUG_ENABLE=1` in tests
- Add `TEST_DEBUG=1` logging to see gate decisions
- Per-test server spawn with `vi.resetModules()`

**Files:**
- `tests/inspector.test.ts`
- `tests/option-compare.test.ts`

**Acceptance:** 0 failures in P1A/P1B across 3 runs

---

### 2. Fix SCM-Lite Test Isolation (Priority 2)

**Issue:** Server startup failures, "fetch failed" errors

**Root Cause:** Test ordering dependencies, port conflicts

**Fix:**
- Enforce `vi.resetModules()` before every spawn
- Health probe loop (no sleeps): `while (!ready) { await health(); }`
- Unique ports or ephemeral (port 0)
- Clean `afterEach` teardown
- Ensure no zombie processes

**Files:**
- `tests/run.scm-lite.integration.test.ts`
- `tests/scm-lite.disabled-warning.test.ts`
- `tests/metrics.shape.test.ts`

**Acceptance:** 0 failures in SCM-Lite tests across 3 runs

---

### 3. Secret Guard Deterministic Test (Priority 3)

**Issue:** Test expects exit code 1, gets 0

**Root Cause:** `tests/setup/env-guard.ts` sets default secret, preventing rejection

**Fix:**
- Make guard controlled by `SECRET_GUARD_STRICT=1`
- Test sets only that env + weak secret
- Ensure global setup doesn't override test env
- Isolate test file completely

**Files:**
- `tests/secret-strength-guard.test.ts`
- `tests/setup/env-guard.ts`

**Acceptance:** Test passes consistently

---

### 4. Add 3× Verification CI Job (Priority 4)

**Goal:** Catch variance regressions in CI

**Implementation:**
```yaml
# .github/workflows/verify-3x.yml
name: Verify 3× Stability
on: [pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - name: Run 3× and check variance
        run: |
          for i in 1 2 3; do
            RATE_LIMIT_ENABLED=0 npm test --run | tee run$i.txt
          done
          # Extract pass counts, check variance ≤2
```

**Acceptance:** CI job runs on PRs, fails if variance >2

---

### 5. Do NOT Re-introduce Debug-Gate Refactor

**Reason:** Caused ±7 variance regression

**Decision:** Keep inline checks until stability is green

**Future:** Can refactor once ≥97% + ±2 is achieved

---

## Definition of Done

- [ ] 3 consecutive full-suite runs
- [ ] Each run ≥579/597 (97.0%)
- [ ] Variance ≤2 tests
- [ ] Zero P1A/P1B failures
- [ ] Zero SCM-Lite failures
- [ ] Secret guard test passing
- [ ] Evidence saved in `.tmp/a-grade/`
- [ ] PR includes exact 3 test summary lines

---

## Current Baseline (PR #69)

```
Run 1: Tests  7 failed | 575 passed | 15 skipped (597) - 96.3%
Run 2: Tests  6 failed | 576 passed | 15 skipped (597) - 96.5%
Run 3: Tests  4 failed | 578 passed | 15 skipped (597) - 96.8%
```

**Target Improvement:** +3-4 tests stable, -1 variance

---

**Status:** DRAFT - Tasks defined, ready for implementation
