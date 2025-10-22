# Phase-B Progress Summary

## ✅ Completed

### Phase 1: Query-Token SSE
- Token issuance POST /v1/stream/token
- SSE auth with query tokens
- Redaction, metrics, 14/14 tests passing
- Commit: 164d574

### Phase 2: Determinism Fix
- JCS normalization (RFC 8785)
- Exclude trace_id, response_id, elapsed_ms
- 8/8 tests passing (integration + exclusions)
- Commit: 900c82a

### Phase 3: Error Taxonomy (Partial)
- Added retry_after to ApiError
- clampRetryAfter, rateLimitedError, limitExceededError helpers exist
- Need: Update helper signatures to match ApiError
- Need: Run tests

## 🔄 Next Steps

1. Fix helper signatures in src/errors.ts
2. Run error.helpers.test.ts
3. Commit Phase 3
4. Continue with Phases 4-7 (Limits, Templates, SSE hardening, OpenAPI)
5. Switch to UI repo for Phase U-0 onwards

## Evidence
- Determinism: 5 runs → 1 hash (7bbee9cc...)
- All builds green
- 22/22 tests passing (token + determinism)
