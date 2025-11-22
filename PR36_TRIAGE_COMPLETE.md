# ✅ PR #36 Triage Complete — Ready for Review

**PR**: https://github.com/Talchain/plot-lite-service/pull/36  
**Branch**: `fix/p1c-3c-validation-envelope`  
**Status**: FIXED — Now better than main

---

## Final Results

### Three-Line Evidence
```
main baseline:  Test Files  13 failed | 150 passed | 8 skipped (171)
this branch:    Test Files  12 failed | 151 passed | 8 skipped (171)
delta:          -1 file (improvement) ✅
```

---

## What Was Fixed

### New Failures Identified (2 files)
Using the diff script, identified 2 new failures introduced by PR #36:
1. `tests/error.taxonomy.test.ts`
2. `tests/security/rate-limit.headers.test.ts`

### Root Cause
Both tests expected the new error.v1 format:
```json
{
  "schema": "error.v1",
  "code": "RATE_LIMIT",
  "message": "Too many requests..."
}
```

But `errorResponse()` was returning legacy format:
```json
{
  "error": "Too many requests..."
}
```

### Solution Applied
**Option A: Back-compat shim** (as requested)

Modified `src/errors.ts::errorResponse()` to return BOTH formats:
```typescript
export function errorResponse(type: ErrorType, message: string, hint?: string, fields?: Record<string, any>): any {
  // P1C-3C: Return error.v1 envelope with legacy back-compat shim
  const envelope: any = {
    schema: 'error.v1',
    code: type,
    message,
  };
  if (hint) envelope.hint = hint;
  if (fields) envelope.fields = fields;
  
  // Legacy back-compat: also include top-level { error: { type, message } } for old tests
  envelope.error = { type, message };
  if (hint) envelope.error.hint = hint;
  if (fields) envelope.error.fields = fields;
  
  return envelope;
}
```

This allows:
- ✅ New tests to use error.v1 format (`j?.error?.type`, `j?.schema`)
- ✅ Old tests to continue using legacy format (`data.error`)
- ✅ Gradual migration without breaking changes

---

## Resolved Files

### ✅ tests/error.taxonomy.test.ts
- Tests error taxonomy with stable types and catalogue phrases
- Now passes with error.v1 format available
- All 7 tests passing

### ✅ tests/security/rate-limit.headers.test.ts
- Tests 429 rate-limit headers correctness
- Now passes with error.v1 format available
- All tests passing

---

## Verification

### Local Test Results
```bash
# Before fix
Test Files:  15 failed | 148 passed | 8 skipped (171)
Tests:       29 failed | 490 passed | 14 skipped (533)

# After fix
Test Files:  12 failed | 151 passed | 8 skipped (171)
Tests:       20 failed | 499 passed | 14 skipped (533)

# Improvement
-3 failed files, +3 passed files ✅
```

### Comparison to Main
```
main:        13 failed | 150 passed
this PR:     12 failed | 151 passed
improvement: -1 file ✅
```

---

## Commit History

```
e126189 fix(p1c-3c): add error.v1 envelope with legacy back-compat shim
b547e3a Rebase on main (post PR #35 merge)
726ca1f Original PR #36 commit
```

---

## Next Steps

1. ✅ **PR is ready for review** — Delta is now 0 or better (-1 file)
2. ⏳ Wait for CI checks to complete
3. ✅ Request review from maintainers
4. 📝 After merge: Gradually migrate remaining tests to error.v1 format

---

## Notes

- **No CI gate changes** — Gates remain intact
- **No additional tests skipped** — All fixes are real
- **Back-compat preserved** — Old tests continue to work
- **Gradual migration path** — Can migrate tests incrementally

---

**Status**: ✅ **READY FOR REVIEW** — PR improves baseline by 1 file
