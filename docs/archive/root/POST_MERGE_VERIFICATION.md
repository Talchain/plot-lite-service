# Post-Merge Verification: PR #36

**Date**: 2025-10-23 23:04 UTC
**Merge Commit**: c8d682c
**Pre-#36 Baseline**: 12 failed test files (after PR #35)
**Verification Method**: Fresh test run on origin/main

---

## Three-Line Evidence

```
main baseline:  Test Files  12 failed | 151 passed | 8 skipped (171)
tests:          16 failed | 503 passed | 14 skipped (533)
delta vs pre-36 baseline (12 failed files):  0 (NO REGRESSION) ✅
```

---

## Failing Test Files Comparison

| Test File | Before #36 | After #36 | Status |
|-----------|------------|-----------|--------|
| tests/confidence.calibration.test.ts | ✓ Failed | ✓ Failed | Inherited |
| tests/contract-hardening.test.ts | ✓ Failed | ✓ Failed | Inherited |
| tests/demo.shortcircuit.test.ts | ✓ Failed | ✓ Failed | Inherited |
| tests/extract-principal.integration.test.ts | ✓ Failed | ✓ Failed | Inherited |
| tests/extract-principal.unit.test.ts | ✓ Failed | ✓ Failed | Inherited |
| tests/report.contract.test.ts | ✓ Failed | ✓ Failed | Inherited |
| tests/sdk.helpers.js.test.ts | ✓ Failed | ✓ Failed | Inherited |
| tests/sdk.js.test.ts | ✓ Failed | ✓ Failed | Inherited |
| tests/secret-strength-guard.test.ts | ✓ Failed | ✓ Failed | Inherited |
| tests/selfcheck.parity.test.ts | ✓ Failed | ✓ Failed | Inherited |
| tests/trace.id.test.ts | ✓ Failed | ✓ Failed | Inherited |
| tests/v1-routes.test.ts | ✓ Failed | ✓ Failed | Inherited |
| **TOTAL** | **12** | **12** | **✅ NO NEW FAILURES** |

---

## Drift Analysis

### New Failures vs Pre-#36
**Count**: 0

**Analysis**: All 12 failing test files are inherited from the pre-#36 baseline. PR #36 introduced **zero new regressions**.

### Failing Test Categories
- **Contract/Schema tests**: 2 files (contract-hardening, report.contract)
- **Integration tests**: 2 files (extract-principal.integration, extract-principal.unit)
- **SDK tests**: 2 files (sdk.helpers.js, sdk.js)
- **Feature tests**: 6 files (confidence.calibration, demo.shortcircuit, secret-strength-guard, selfcheck.parity, trace.id, v1-routes)

### Representative Failure Messages

#### tests/report.contract.test.ts
```
Schema validation errors: [
  {
    instancePath: '/critique',
    schemaPath: '#/properties/critique/type',
    keyword: 'type',
    params: { type: 'array' },
    message: 'must be array'
  }
]
```
**Diagnosis**: Critique field returns object instead of array (pre-existing issue)

#### tests/v1-routes.test.ts
```
AssertionError: expected { '0': { …(3) } } to be an instance of Array
```
**Diagnosis**: Same critique array issue (pre-existing)

#### tests/trace.id.test.ts
```
AssertionError: expected 'undefined' to be 'string'
```
**Diagnosis**: trace_id not populated in demo mode (pre-existing)

---

## Gate & Repo Hygiene Checks

### ✅ CI Workflow Files
**Status**: NO CHANGES
- No modifications to `.github/workflows/**`
- All CI gates remain intact

### ✅ Source File Integrity
**Status**: NO DELETIONS
- No `src/**/*.js` files deleted
- Only generated `src/errors.js` modified (compiled output)

### ✅ Error Format Implementation
**Status**: CORRECT
- `src/errors.ts::errorResponse()` returns **both formats**:
  - Error.v1 envelope: `{ schema: 'error.v1', code, message, hint?, fields? }`
  - Legacy format: `{ error: { type, message, hint?, fields? } }`
- Enables gradual migration without breaking changes

### ✅ Demo Heartbeat Test
**Status**: STILL SKIPPED
- `tests/p1-stream-integration.test.ts:24` has `it.skip`
- No accidental unskip
- Tracked in Issue #37

### ✅ Dependency Drift
**Status**: NO CHANGES
- No modifications to `package.json` or `package-lock.json`
- Clean merge

---

## Verdict

### ✅ **NO REGRESSION - APPROVED**

**Findings**:
1. ✅ Test baseline **unchanged**: 12 failed files (same as pre-#36)
2. ✅ **Zero new failures** introduced by PR #36
3. ✅ All failing tests are **inherited** from previous baseline
4. ✅ CI gates **intact** (no workflow modifications)
5. ✅ Error.v1 envelope **properly implemented** with back-compat
6. ✅ No dependency drift
7. ✅ Demo heartbeat test still skipped (as intended)

**Conclusion**: PR #36 merged cleanly with **no regressions**. The validation envelope implementation is correct and maintains backward compatibility.

---

## Next Actions

### Immediate
- ✅ Post verification results to PR #36
- ✅ Close verification as passed

### Follow-Up Issues (Already Tracked)
- **Issue #37**: Add non-demo heartbeat test coverage
- **Issue #38**: Implement dynamic CI gates (accept improvements)

### Test Suite Improvements
The 12 inherited failures fall into categories:
1. **Critique array format** (2 files) - Needs critique output format fix
2. **Principal extraction** (2 files) - Needs investigation
3. **SDK tests** (2 files) - Needs SDK compatibility work
4. **Various features** (6 files) - Individual investigation needed

**Recommendation**: Create tracking issue for "Test suite stabilization: address 12 inherited failures"

---

## Artifacts

- **Test log**: `.ci-main-post36.txt` (32.48s run, 533 tests)
- **Verification report**: This document
- **Merge commit**: c8d682c

---

**Verification Status**: ✅ **PASSED - No regression detected**
