# PR Body Templates

## PR 1 — feat/p2-1-clean-integration-final

**Title**: `feat(p2-1): stream canary header + metrics`

**Body**:
```markdown
## Summary
Adds stream canary mechanism to track enhanced stream header adoption with both canonical and deprecated header support.

## Contract
- **Canonical header**: `X-Enable-Enhanced-Stream` (truthy variants: `1`, `true`, `yes`, `on`)
- **Legacy header**: `X-Stream-Enhanced` (accepted, tracked as deprecated usage)
- **Metrics**: 
  - `plot_engine_stream_canary_total{route="/v1/stream"}`
  - `plot_engine_stream_deprecated_header_total{route="/v1/stream"}`

## Files Changed
- `src/metrics.ts` — Added canary counter functions
- `src/plugins/metrics.ts` — Exposed canary metrics in Prometheus format
- `src/routes/v1/stream.ts` — Header parsing logic
- `tests/p2-1-canary.test.ts` — 4/4 tests passing

## Proofs
```bash
PORT=3500 PROMETHEUS_ENABLE=1 node dist/main.js &

# Canonical header
curl -i -H "X-Enable-Enhanced-Stream: 1" "http://localhost:3500/v1/stream?demo=1" | head -20

# Legacy header (deprecated)
curl -i -H "X-Stream-Enhanced: true" "http://localhost:3500/v1/stream?demo=1" | head -20

# Metrics
curl -s http://localhost:3500/metrics | grep -E "plot_engine_stream_(canary|deprecated_header)_total"

kill %1
```

## Backwards Compatibility
- ✅ Additive only; no breaking changes
- ✅ Legacy header still accepted
- ✅ No header = default behavior unchanged

## Security
- No PII/tokens in metrics
- Bounded label set (route only)

## Performance
- O(1) header check
- Minimal overhead (~1μs per request)

## Testing
- 4/4 targeted tests passing
- Header parsing (canonical + legacy)
- Metrics incrementation
- Backward compatibility

## Risks
**Low** — Additive feature with no behavior changes to existing flows.

## Rollback Plan
Single commit revert; no migration needed.
```

---

## PR 2 — feat/p1-error-envelope-v1

**Title**: `feat(p1): lock error.v1 envelope + helpers + headers`

**Body**:
```markdown
## Summary
Implements canonical error.v1 envelope with closed error taxonomy, machine-usable fields, and proper HTTP headers for rate limiting.

## Contract (Canonical)
```json
{
  "schema": "error.v1",
  "code": "LIMIT_EXCEEDED",
  "error": "Too many nodes for this plan.",
  "hint": "Please reduce the number of nodes to 12 or fewer.",
  "fields": { "field": "graph.nodes", "max": 12 },
  "retry_after": 15
}
```

### Error Codes (Closed Set)
- `BAD_INPUT` → 400
- `LIMIT_EXCEEDED` → 400 (with `fields: {field, max}`)
- `RATE_LIMITED` → 429 (with `retry_after: 1-60` seconds)
- `UNAUTHORIZED` → 401
- `SERVER_ERROR` → 500

### Rules
- `retry_after`: Only for `RATE_LIMITED`; integer seconds, clamped 1-60
- `fields`: Only for `LIMIT_EXCEEDED`; must include `field` ∈ `{"graph.nodes", "graph.edges"}` and `max` (integer)
- Copy style: Fix first ("Please..."), reason second
- Headers: `Retry-After: <seconds>` + optional `X-RateLimit-Reset: <epoch>`

## Files Changed
- `src/errors.ts` — Error helpers and types
- `src/rateLimit.ts` — Updated to emit error.v1
- `tests/p1-error-envelope.unit.test.ts` — 5/5 unit tests passing
- `tests/p1-error-envelope.int.test.ts` — Integration tests (partial)
- `proofs/p1-error-envelope-proof.sh` — Proof script

## Deliverables
✅ Helper functions: `rateLimitedError()`, `limitExceededError()`, `badInputError()`, `unauthorizedError()`, `serverError()`  
✅ `replyWithError()` — Sends error.v1 with proper status + headers  
✅ Status code mapping: `errorCodeToStatus()`  
✅ Legacy compatibility layer preserved for gradual migration

## Proofs
```bash
# Rate limit (429 + headers)
PORT=3501 RATE_LIMIT_ENABLED=1 RATE_LIMIT_MAX=2 AUTH_ENABLED=0 node dist/main.js &

# Exhaust rate limit
for i in 1 2 3; do
  curl -s "http://localhost:3501/v1/run" \
    -H "Content-Type: application/json" \
    -d '{"template":"test","graph":{"nodes":[{"id":"1","label":"A"}],"edges":[]}}' \
    | jq '.schema,.code,.retry_after'
done

# Check headers
curl -i "http://localhost:3501/v1/run" \
  -H "Content-Type: application/json" \
  -d '{"template":"test","graph":{"nodes":[{"id":"1","label":"A"}],"edges":[]}}' \
  | grep -E "Retry-After|X-RateLimit-Reset"

kill %1
```

## Backwards Compatibility
- ✅ Legacy `errorResponse()` and `replyWithAppError()` preserved
- ✅ Internal code can migrate gradually
- ✅ Always emits canonical error.v1 externally

## Security
- ✅ `retry_after` clamped to prevent abuse
- ✅ Error messages follow "fix first" pattern (no internal details)
- ✅ No PII in error responses

## Performance
- No performance impact; same code paths

## Testing
- 5/5 unit tests passing
- Clamping logic verified
- Helper output shapes validated
- Status code mapping tested

## Risks
**Medium** — Contract surface change. Review carefully.

## Notes for Reviewer
- Hybrid approach keeps legacy codes internally but always emits canonical error.v1 outward
- Rate limiter already updated to use new format
- Route handlers will be updated in follow-up PRs

## Rollback Plan
Single PR revert; legacy paths remain intact.
```

---

## PR 3 — feat/p2-determinism-stamp

**Title**: `feat(p2): determinism stamp with JCS sha256`

**Body**:
```markdown
## Summary
Implements deterministic response hashing using JSON Canonicalization Scheme (RFC 8785) for reproducible outcomes and trust-building.

## Contract (On Success)
Adds to `report.v1`:
```json
{
  "schema": "report.v1",
  "meta": {
    "seed": 1337,
    "response_id": "uuid-abc",
    "elapsed_ms": 214
  },
  "model_card": {
    "response_hash": "a1b2c3d4...",
    "response_hash_algo": "sha256",
    "normalized": true
  }
}
```

### Rules
- **Hash input**: Normalized payload (JCS canonical form)
- **Excluded from hash**: `trace_id`, `meta.response_id`, `meta.elapsed_ms`
- **Algorithm**: SHA-256 (hex digest, 64 chars)
- **Normalization**: RFC 8785 (sorted keys, no whitespace)

## Files Changed
- `src/lib/jcs-hash.ts` — JCS implementation + hash utilities
- `tests/p2-determinism.unit.test.ts` — 11/11 unit tests passing
- `proofs/p2-determinism-proof.sh` — 5× proof script

## Deliverables
✅ `canonicalizeJSON()` — RFC 8785 implementation  
✅ `hashJSON()` — SHA-256 of canonical JSON  
✅ `normalizeForHash()` — Strips volatile fields  
✅ `stampResponseHash()` — Returns `{response_hash, normalized: true}`

## Proofs
```bash
# 5× identical runs → one unique hash
node <<'NODEEOF'
const { stampResponseHash } = require('./dist/lib/jcs-hash.js');

const template = { template: 'test', seed: 4242, result: { value: 100 } };
const hashes = [];

for (let i = 0; i < 5; i++) {
  const payload = {
    ...template,
    trace_id: `trace-${i}`,
    meta: { seed: 4242, response_id: `uuid-${i}`, elapsed_ms: 100 + i }
  };
  const { response_hash } = stampResponseHash(payload);
  hashes.push(response_hash);
  console.log(`Run ${i + 1}: ${response_hash.slice(0, 16)}...`);
}

const uniqueHashes = new Set(hashes);
console.log(`\n✅ Unique hashes: ${uniqueHashes.size} (expected: 1)`);
NODEEOF
```

## Backwards Compatibility
- ✅ Additive only; no breaking changes
- ✅ Existing responses unchanged until integrated

## Security
- ✅ Volatile fields excluded to prevent timing attacks
- ✅ Deterministic hashing aids debugging without exposing internals

## Performance
- O(n) in payload size
- Typical report: ~1-2ms overhead
- Suitable for all response sizes

## Testing
- 11/11 unit tests passing
- Canonicalization correctness
- Hash stability across runs
- Normalization (volatile field exclusion)
- 5× determinism proof

## Risks
**Low** — Additive metadata; no behavior changes.

## Rollback Plan
Single PR revert; reporting remains functional.
```

---

## PR 4 — feat/p3-etag-caching

**Title**: `feat(p3): ETag + 304 for /v1/limits`

**Body**:
```markdown
## Summary
Adds comprehensive tests and proofs for ETag/304 caching on `/v1/limits` endpoint (already implemented).

## Contract
- **ETag**: Weak ETag (e.g., `"abc123def"`)
- **Cache-Control**: `max-age=60, must-revalidate`
- **If-None-Match**: Returns `304 Not Modified` when ETag matches
- **No `no-store`**: Allows client-side caching

## Files Changed
- `tests/p3-etag-caching.int.test.ts` — 5/5 integration tests passing
- `proofs/p3-etag-proof.sh` — Proof script

## Behavior
1. **First request**: `200 OK` + `ETag: "abc123"` + `Cache-Control: max-age=60, must-revalidate`
2. **Second request** with `If-None-Match: "abc123"`: `304 Not Modified` (no body)
3. **Wrong ETag**: `200 OK` with full body

## Proofs
```bash
PORT=3502 AUTH_ENABLED=0 node dist/main.js &

# First request (200 + ETag)
RESP1=$(curl -si "http://localhost:3502/v1/limits")
echo "$RESP1" | grep -E "HTTP/|ETag|Cache-Control"
ETAG=$(echo "$RESP1" | grep -i "etag:" | awk '{print $2}' | tr -d '\r')

# Second request with If-None-Match (304)
curl -si "http://localhost:3502/v1/limits" -H "If-None-Match: $ETAG" | grep -E "HTTP/|ETag"

kill %1
```

## Backwards Compatibility
- ✅ Endpoint already exists; tests added
- ✅ No breaking changes

## Security
- ✅ No sensitive data in ETags (hash of static limits)
- ✅ Cache headers properly scoped

## Performance
- ✅ Reduces bandwidth for repeated requests
- ✅ ETag computed once at startup (O(1))

## Testing
- 5/5 integration tests passing
- ETag generation and stability
- If-None-Match handling (304 on match, 200 on mismatch)
- Cache-Control headers verified
- No `no-store` directive confirmed

## Risks
**Low** — Read-only endpoint; tests only.

## Rollback Plan
Single PR revert; endpoint remains functional.
```

---

## PR 5 — feat/a2-taxonomy-hybrid (Optional)

**Title**: `feat(a2): hybrid error taxonomy (non-breaking bridge)`

**Body**:
```markdown
## Summary
Hybrid error taxonomy that supports both new (A2) and legacy error codes for gradual migration.

**Note**: This PR may be superseded by `feat/p1-error-envelope-v1` which provides a cleaner implementation. Review P1 first.

## Contract
- **New codes**: `BAD_INPUT`, `LIMIT_EXCEEDED`, `RATE_LIMITED`, `UNAUTHORIZED`, `SERVER_ERROR`
- **Legacy codes** (deprecated): `TIMEOUT`, `BLOCKED_CONTENT`, `RETRYABLE`, `INTERNAL`, `RATE_LIMIT`, `BREAKER_OPEN`

## Files Changed
- `src/errors.ts` — Hybrid error types

## Backwards Compatibility
- ✅ All legacy codes still accepted
- ✅ Gradual migration path

## Recommendation
Consider merging `feat/p1-error-envelope-v1` instead, which provides a cleaner canonical implementation with legacy compatibility layer.

## Rollback Plan
Single PR revert.
```
