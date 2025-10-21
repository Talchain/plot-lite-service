# P1 Failing Tests Inventory

**Generated**: 2025-10-21 01:00 UTC+01:00
**Status**: 42 failing, 474 passing, 13 skipped

## Categories

### 1. Schema/Contract (12 tests) - HIGH
- Report contract validation failures
- Request validation not rejecting invalid inputs
- Error format missing code/field/hint
**Fix**: Align response structures with schemas

### 2. Determinism/Response Hash (8 tests) - HIGH  
- Missing determinism_note in model_card
- response_hash not stable across runs
- explain_delta not deterministic
**Fix**: Add missing fields, ensure deterministic output

### 3. Idempotency (3 tests) - MEDIUM
- Cache bounds not working
- Replay semantics broken
**Fix**: Fix LRU implementation

### 4. Feature Flags (8 tests) - MEDIUM
- Phase-B integration failures
- Demo mode not working
- Trace ID missing
**Fix**: Ensure flags compose correctly

### 5. Rate Limiting (3 tests) - MEDIUM
- 429 headers missing
- Health counters not exposed
**Fix**: Add proper headers and metrics

### 6. Stream/SSE (2 tests) - MEDIUM
- Heartbeat timing issues
- Unhandled AbortError in disconnect test
**Fix**: Add SSE test helper with tolerance

### 7. Environment (5 tests) - LOW
- Principal extraction health checks
- Secret strength validation
**Fix**: Env setup in tests

## Next Steps
1. Create SSE test helper
2. Fix schema/contract issues
3. Add determinism fields
4. Fix idempotency cache
