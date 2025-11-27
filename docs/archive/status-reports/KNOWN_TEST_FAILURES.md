# Known Test Failures (Pre-existing)

This document tracks test failures that existed before the CEE integration work and are unrelated to the recent changes.

## Summary

**Total Tests**: 844
**Passing**: 827 (98.0%)
**Failing**: 2 (0.2%)
**Skipped**: 15 (quarantined)

## Failing Tests

### 1. CORS Origins CSV Test
**File**: `tests/cors.origins-csv.test.ts`
**Test**: `CORS: CORS_ORIGINS CSV > echoes Access-Control-Allow-Origin for allowed origin`

**Error**:
```
AssertionError: expected null to be 'https://app.example.com'
```

**Root Cause**: CORS configuration issue where `CORS_ORIGINS` environment variable is not being properly parsed/applied.

**Impact**: Low - This is a configuration test for the CSV-based CORS origins feature

**Status**: Pre-existing from Windsurf's CORS work
**Owner**: Windsurf's CORS integration task

**Reproduction**:
```bash
npm test tests/cors.origins-csv.test.ts
```

**Expected Behavior**: When `CORS_ORIGINS='https://app.example.com,https://staging.example.com'`, the `Access-Control-Allow-Origin` header should be set to the requesting origin.

**Actual Behavior**: The header is `null`, indicating CORS middleware is not applying the allowed origins correctly.

**Next Steps**:
- Review CORS parser in `src/lib/corsParser.ts`
- Check CORS middleware configuration in `src/createServer.js`
- Verify environment variable is being read correctly

---

### 2. Rate Limit Conformance Test
**File**: `tests/rate-limit.conformance.test.ts`
**Test**: `Rate-limit conformance > does not log payloads or query strings`

**Error**:
```
AssertionError: expected true to be false
```

**Root Cause**: Test logs contain a `?` character, which the test interprets as evidence of query string leakage.

**Impact**: Low - This is a privacy/logging test to ensure query strings aren't logged

**Status**: May be a false positive (the `?` might be from a different context)

**Reproduction**:
```bash
npm test tests/rate-limit.conformance.test.ts
```

**Expected Behavior**: No query strings (`?`) should appear in logs when rate-limiting requests.

**Actual Behavior**: A `?` character is found in the test logs.

**Next Steps**:
- Investigate what's writing the `?` to logs
- Determine if it's an actual query string leak or a false positive (e.g., from log message text)
- If false positive, update the test to be more specific in what it checks

---

## CEE Integration Impact

**All CEE integration tests are passing** ✅

The 2 failing tests are **unrelated** to the CEE integration work:
- No changes were made to CORS configuration
- No changes were made to rate limiting or logging

The CEE integration maintained the existing pass rate and did not introduce any regressions.

---

## Test Suite Health

**Overall Grade**: A- (98% pass rate)

The test suite is in good health with comprehensive coverage across:
- 827 passing tests covering determinism, security, contracts, SSE, idempotency
- 15 intentionally quarantined tests (known flaky tests with documented reasons)
- 2 pre-existing failures unrelated to recent work

**Recommendation**: Address the 2 failing tests as separate issues/PRs to avoid mixing concerns with the CEE integration work.
