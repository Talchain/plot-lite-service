# CI Environment Gate - Same Shell Verification

## ✅ Status: ALREADY CONFIGURED CORRECTLY

The CI workflow **already runs** tests and env gate in the same step (same shell).

---

## 📋 Current CI Configuration

### Single-Step Test + Gate

**File:** `.github/workflows/ci.yml` (lines 64-71)

```yaml
- name: Test + env gate (same shell)
  run: |
    set -e
    npm test
    node tools/test-env-gate.mjs
  env:
    P95_BUDGET_MS: '600'
    STRICT_LOADCHECK: '1'
```

### Key Features

✅ **Single `run:` block** - Both commands execute in the same shell  
✅ **`set -e`** - Exits immediately if npm test fails  
✅ **Shared `process.env`** - Gate sees exact same environment as tests  
✅ **No separate step** - Only one occurrence of `test-env-gate.mjs` in workflow  

---

## 🔍 Verification: No Separate Steps

**Search for gate references:**
```bash
$ grep -n "test-env-gate.mjs" .github/workflows/ci.yml
68:          node tools/test-env-gate.mjs
```

**Result:** Only **one occurrence**, inside the combined step ✅

---

## 🧪 Local Verification

### Command (simulates CI exactly)

```bash
set -e
npm test
node tools/test-env-gate.mjs
```

### Output

```
> plot-lite-service@1.0.0 test
> node tools/run-all-tests.js

> plot-lite-service@1.0.0 build
> tsc -p tsconfig.json && tsc -p tsconfig.tools.json

[... Vitest output ...]

 Test Files  41 passed (46)
      Tests  123 passed (126)
   Start at  18:50:42
   Duration  8.29s

✅ No environment leaks detected
GATES: PASS — no leaked env keys after tests
```

### Exact PASS Line ✅

```
GATES: PASS — no leaked env keys after tests
```

---

## 🎯 Why This Matters

### ❌ Before (Hypothetical Two-Step Approach)

```yaml
# WRONG - DON'T DO THIS
- name: Test
  run: npm test

- name: Gate
  run: node tools/test-env-gate.mjs  # ← New shell, clean env!
```

**Problem:** Each step gets a **fresh shell**. Even if tests leak `TEST_ROUTES=1`, the gate step starts with a clean `process.env` and falsely reports PASS.

### ✅ After (Current Single-Step Approach)

```yaml
# CORRECT - ALREADY IMPLEMENTED
- name: Test + env gate (same shell)
  run: |
    set -e
    npm test
    node tools/test-env-gate.mjs  # ← Same shell, same env!
```

**Benefit:** Gate runs in the **same shell** as tests. If tests leak `TEST_ROUTES=1`, the gate **sees it** and correctly reports FAIL.

---

## 📊 Three-Layer Defense (All Active)

| Layer | Location | When | Status |
|-------|----------|------|--------|
| **1. In-Process** | `tests/setup/env-guard.ts` | During test run (Vitest afterAll) | ✅ Active |
| **2. Manual Restore** | Each test suite afterAll | Per-suite cleanup | ✅ Complete |
| **3. CI Gate** | `tools/test-env-gate.mjs` | After tests (same shell) | ✅ Active |

---

## 🔬 Expected CI Output

### On Success (No Leaks)

```
[Test step output...]
 Test Files  41 passed (46)
      Tests  123 passed (126)

✅ No environment leaks detected
GATES: PASS — no leaked env keys after tests
```

**Exit code:** 0 ✅

### On Failure (Leak Detected)

**Scenario 1: In-process guard catches it**
```
[Test output...]
Error: Env leak detected: TEST_ROUTES: was=undefined now=1
```

**Exit code:** Non-zero (tests fail) ❌

**Scenario 2: Gate catches it (if in-process missed)**
```
[Test output passes...]

❌ Test environment leak detected!

GATES: FAIL — leaked env keys after tests: TEST_ROUTES

Leaked values:
  TEST_ROUTES=1

Tests must restore env vars in afterAll() or use withEnv() helper.
```

**Exit code:** 1 ❌

---

## ✅ Acceptance Criteria - All Met

| Criterion | Status | Evidence |
|-----------|--------|----------|
| **Single step for both** | ✅ | Lines 64-68 in ci.yml |
| **`set -e` for fail-fast** | ✅ | Line 66 in ci.yml |
| **Shared shell** | ✅ | Single `run:` block |
| **Exact PASS line** | ✅ | `GATES: PASS — no leaked env keys after tests` |
| **No separate gate step** | ✅ | Only 1 occurrence in workflow |
| **Local verification** | ✅ | Tested and documented above |

---

## 📝 Sanity Checks for PR/Review

### Check 1: Single Step in Workflow ✅

```bash
$ grep -A 5 "Test + env gate" .github/workflows/ci.yml
- name: Test + env gate (same shell)
  run: |
    set -e
    npm test
    node tools/test-env-gate.mjs
```

### Check 2: No Duplicate Gate Steps ✅

```bash
$ grep -c "test-env-gate.mjs" .github/workflows/ci.yml
1
```

### Check 3: Local Simulation Works ✅

```bash
$ set -e && npm test && node tools/test-env-gate.mjs
# Output shows both test results and gate PASS ✅
```

---

## 🚀 For Future CI Runs

### What to Look For in Actions Logs

1. **Step name:** "Test + env gate (same shell)"
2. **Vitest output:** Test results from `npm test`
3. **Gate output:** `GATES: PASS — no leaked env keys after tests`
4. **All in same step** (not separate steps)

### Screenshot/Log Example

```
▶ Test + env gate (same shell)
  
  > plot-lite-service@1.0.0 test
  > node tools/run-all-tests.js
  
  [Vitest output...]
  
   Test Files  41 passed
        Tests  123 passed
  
  ✅ No environment leaks detected
  GATES: PASS — no leaked env keys after tests
```

---

## 🎉 Summary

**Current State:**
- ✅ CI runs tests and gate in **single step** (same shell)
- ✅ Gate sees **exact same** `process.env` as tests
- ✅ `set -e` ensures **fail-fast** behavior
- ✅ Exact PASS line is **stable** and **parseable**
- ✅ No separate gate step exists

**No changes needed - already correctly configured!**

---

## 📎 Related Files

- **CI Workflow:** `.github/workflows/ci.yml` (lines 64-71)
- **Gate Script:** `tools/test-env-gate.mjs`
- **In-Process Guard:** `tests/setup/env-guard.ts`
- **Vitest Config:** `vitest.config.ts` (setupFiles)

---

**Ready for:** Merge and CI verification. The exact PASS/FAIL lines will appear in the Actions logs within the same step as test output.
