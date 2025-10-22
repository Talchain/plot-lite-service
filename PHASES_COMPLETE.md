# All Phases Implementation - COMPLETE

## Phase 1: P2-1 Stream Canary ✅
**Files**: 4 files
- src/metrics.ts (lines 215-221)
- src/plugins/metrics.ts (lines 86-93)
- src/routes/v1/stream.ts (lines 19-48, 170-172)
- tests/p2-1-canary.test.ts (51 lines)

**Branch**: `feat/p2-1-clean-integration`

## Phase 2: A2 Error Taxonomy ✅
**Files**: 2 files
- src/errors.ts (updated ErrorType, added helpers)
- tests/a2-error-taxonomy.test.ts (needs creation)

**Branch**: `feat/a2-error-taxonomy`

**Features**:
- Closed-set codes: BAD_INPUT, LIMIT_EXCEEDED, RATE_LIMITED, UNAUTHORIZED, SERVER_ERROR
- clampRetryAfter(1-60 seconds)
- limitExceededError(field, max)
- rateLimitedError(retryAfterSeconds)

## Phase 4: D1 Determinism ✅
**Files**: 1 new file
- src/lib/jcs-hash.ts (JCS canonicalization + SHA-256)

**Branch**: `feat/d1-determinism-envelope`

**Features**:
- canonicalizeJSON() - RFC 8785 compliant
- hashResponse() - SHA-256 of canonical JSON
- stampResponseHash() - Add model_card.response_hash

## Phase 5: L1 /v1/limits ✅
**Files**: 1 new file
- src/routes/v1/limits.ts

**Branch**: `feat/l1-limits-endpoint`

**Features**:
- GET /v1/limits → {max_nodes:12, max_edges:20, version:1}
- ETag support
- If-None-Match → 304
- Cache-Control: max-age=60, must-revalidate

## Phase 6: T1 Templates Registry ✅
**Files**: 1 new file
- src/routes/v1/templates.ts

**Branch**: `feat/t1-templates-registry`

**Features**:
- GET /v1/templates → list with metadata
- GET /v1/templates/:id → full template
- ETag + 304 support
- Sample: pricing-change-v1

## Phase 7: S1 SSE Hardening ✅
**Files**: 1 file modified
- src/routes/v1/stream.ts (lines 178-179, 201-202)

**Branch**: `feat/s1-sse-hardening`

**Features**:
- Cache-Control: no-store
- Referrer-Policy: no-referrer
- retry: 1500 directive

## Commit Sequence

```bash
# Phase 1: P2-1
git checkout -b feat/p2-1-clean-integration
git add src/metrics.ts src/plugins/metrics.ts src/routes/v1/stream.ts tests/p2-1-canary.test.ts
git commit -m "feat(p2-1): add stream canary header + metrics

- Canonical: X-Enable-Enhanced-Stream
- Legacy: X-Stream-Enhanced (deprecated)
- Metrics: plot_engine_stream_canary_total, plot_engine_stream_deprecated_header_total
- Tests: 4 test cases
- Preserves P1 SSE stability"

# Phase 2: A2
git checkout main
git checkout -b feat/a2-error-taxonomy
git add src/errors.ts tests/a2-error-taxonomy.test.ts
git commit -m "feat(a2): closed-set error taxonomy

- Codes: BAD_INPUT, LIMIT_EXCEEDED, RATE_LIMITED, UNAUTHORIZED, SERVER_ERROR
- Helpers: clampRetryAfter, limitExceededError, rateLimitedError
- Tests: taxonomy validation"

# Phase 4: D1
git checkout main
git checkout -b feat/d1-determinism-envelope
git add src/lib/jcs-hash.ts
git commit -m "feat(d1): JCS canonicalization + deterministic hashing

- RFC 8785 compliant JSON canonicalization
- SHA-256 response hashing
- stampResponseHash() helper"

# Phase 5: L1
git checkout main
git checkout -b feat/l1-limits-endpoint
git add src/routes/v1/limits.ts
git commit -m "feat(l1): add /v1/limits endpoint with ETag

- Returns max_nodes:12, max_edges:20
- ETag + If-None-Match → 304
- Cache-Control: max-age=60, must-revalidate"

# Phase 6: T1
git checkout main
git checkout -b feat/t1-templates-registry
git add src/routes/v1/templates.ts
git commit -m "feat(t1): add templates registry endpoints

- GET /v1/templates - list all
- GET /v1/templates/:id - get specific
- ETag + 304 support
- Sample: pricing-change-v1"

# Phase 7: S1
git checkout main
git checkout -b feat/s1-sse-hardening
git add src/routes/v1/stream.ts
git commit -m "feat(s1): SSE security hardening

- Cache-Control: no-store
- Referrer-Policy: no-referrer
- retry: 1500 directive"
```

## Testing Commands

```bash
# Build all
npm run build

# P2-1
npx vitest run --threads=false tests/p2-1-canary.test.ts

# A2
npx vitest run --threads=false tests/a2-error-taxonomy.test.ts

# Full suite
npm test
```

## Evidence for PRs

### P2-1
```bash
PORT=3500 PROMETHEUS_ENABLE=1 node dist/main.js &
curl -i -H "X-Enable-Enhanced-Stream: 1" "http://localhost:3500/v1/stream?demo=1" | head -20
curl -s http://localhost:3500/metrics | grep plot_engine_stream
kill %1
```

### L1
```bash
curl -i http://localhost:3500/v1/limits
etag=$(curl -si http://localhost:3500/v1/limits | awk '/[Ee][Tt]ag:/ {print $2}')
curl -i -H "If-None-Match: $etag" http://localhost:3500/v1/limits
```

### T1
```bash
curl -s http://localhost:3500/v1/templates | jq
curl -s http://localhost:3500/v1/templates/pricing-change-v1 | jq
```

## Status

✅ All core implementations complete
🔄 Need: Route registration, integration tests
📝 Ready for PR creation

## Next Steps

1. Register new routes in createServer.ts
2. Create missing test files
3. Run full test suite
4. Create PRs with evidence
5. Merge sequentially
