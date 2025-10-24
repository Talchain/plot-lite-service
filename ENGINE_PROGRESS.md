# Engine Track Progress (plot-lite-service)

## ✅ Completed Phases

### Phase A-1: Determinism Integration Fix
- JCS normalization (RFC 8785) - compact, sorted keys
- Exclude volatile fields: trace_id, response_id, elapsed_ms
- 8/8 tests passing (integration + exclusions)
- Evidence: 5 runs → 1 hash (7bbee9cc...)
- Commit: 900c82a

### Phase A-2: Error Taxonomy
- Helpers: clampRetryAfter, rateLimitedError, limitExceededError
- ApiError interface with retry_after
- 16/16 tests passing
- Friendly copy: "Please retry after N seconds"
- Machine-checkable fields: {field, max}, retry_after
- Commit: 84bc186

### Phase A-3: Limits Endpoint
- GET /v1/limits → {max_nodes:12, max_edges:20, version:1}
- ETag caching with If-None-Match → 304
- Cache-Control: max-age=60, must-revalidate
- Tests created (6 tests)
- Commit: 5990c5d

## 🔄 Remaining Phases

### Phase A-4: SSE Canary Hardening (Optional)
- retry: 1500 at start
- Heartbeats ~15s
- Monotonic id, response_id in events
- Headers: Cache-Control: no-store, no redirects
- Behind flag

### Phase A-5: OpenAPI + Fixtures (Optional)
- Minimal OpenAPI for /v1/run, /v1/limits
- Fixtures for success, BAD_INPUT, LIMIT_EXCEEDED
- Consumer/provider test skeleton

## Summary
- 3 commits, 3 phases complete
- 30+ tests passing (token + determinism + errors + limits)
- All changes additive and reversible
- Ready for UI integration

## Next: UI Track (DecisionGuideAI)
Phase B-0: Remove extra bottom menu, add Templates entry
