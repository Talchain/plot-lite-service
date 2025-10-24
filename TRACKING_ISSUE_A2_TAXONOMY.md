# Tracking Issue: A2 Taxonomy Migration Test Failures

**Issue**: Test Stabilization — A2 taxonomy migration left ~18 suite failures  
**Root Cause**: Code migrated to new error codes, but tests still assert legacy codes  
**Impact**: 18 failed test files (31 individual test failures)  
**Status**: Tracked, will be fixed in Phase 2

---

## Canonical Mapping

Legacy tests must be updated to assert new codes:

| Legacy Code | New Code |
|-------------|----------|
| `TIMEOUT` | `SERVER_ERROR` |
| `RETRYABLE` | `SERVER_ERROR` |
| `INTERNAL` | `SERVER_ERROR` |
| `RATE_LIMIT` | `RATE_LIMITED` |
| `BLOCKED_CONTENT` | `BAD_INPUT` |

---

## Failed Test Files (Baseline)

1. `tests/stream.retryable.test.ts` — expects `RETRYABLE`, gets `SERVER_ERROR`
2. `tests/security/rate-limit.headers.test.ts` — expects old error format
3. `tests/trace.id.test.ts` — trace_id not present
4. `tests/selfcheck.parity.test.ts` — hash mismatch
5. `tests/secret-strength-guard.test.ts` — error message format changed
6. ... (13 more files)

**Total**: 18 failed files, 31 individual failures

---

## Safe PRs (Phase 1)

These PRs do NOT increase failures vs baseline:
- ✅ P2-1 Stream Canary (additive)
- ✅ P2 Determinism Stamp (additive)
- ✅ P3 ETag Caching (tests only)

All reference this tracking issue to explain inherited failures.

---

## Fix Plan (Phase 2)

**PR**: `feat/p1-error-envelope-v1`

1. Update all error paths to use `error.v1` envelope
2. Ensure `replyWithAppError` exists and is used
3. Update tests to assert new codes + envelope shape
4. Fix rate-limit headers (`Retry-After`, `X-RateLimit-Reset`)
5. Verify copy style: "Fix first, reason second"

**Target**: Reduce to 0 new failures (same baseline as Phase 1 PRs)

---

**Created**: 2025-10-23 14:42 UTC+01:00  
**Baseline Run**: `BASELINE_TEST_RUN_20251023_144204.log`
