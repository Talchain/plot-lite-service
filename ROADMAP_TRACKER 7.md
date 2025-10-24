# Phase-A/B Roadmap Tracker

**Session**: 2025-01-22 13:35 UTC+01:00  
**Status**: Phase 0 Complete, Phase 1 Ready

## Progress

- [x] **Phase 0**: Emergency Repair (Complete)
- [ ] **Phase 1**: P2-1 Clean Integration (Ready to commit)
- [ ] **Phase A2**: Error Taxonomy
- [ ] **Phase A3**: Rate-Limit Regression
- [ ] **Phase D1**: Determinism Envelope
- [ ] **Phase L1**: /v1/limits Endpoint
- [ ] **Phase T1**: Templates Registry
- [ ] **Phase S1**: SSE Canary Hardening
- [ ] **Phase O1**: OpenAPI & Fixtures

## Phase 1: P2-1 Clean Integration 🔄

**Branch**: `feat/p2-1-clean-integration`  
**Files**: 4 files (~98 lines)

**Commands**:
```bash
bash EXECUTE_PHASE1.sh
git push -u origin feat/p2-1-clean-integration
```

**PR Evidence**:
- curl canonical header
- curl legacy header
- /metrics counters

**Acceptance**:
- ✅ P2-1 tests pass
- ✅ SSE stability intact
- ✅ No src/*.js artifacts
- ✅ Metrics visible

## Phase A2: Error Taxonomy

**Branch**: `fix/a2-error-taxonomy`  
**Goal**: Closed-set codes + LIMIT_EXCEEDED

**Changes**:
1. Update ErrorType: BAD_INPUT, LIMIT_EXCEEDED, RATE_LIMITED, UNAUTHORIZED, SERVER_ERROR
2. Add LIMIT_EXCEEDED shape: `{ code, field, max, error, schema }`
3. Add retry_after clamping (1-60s)
4. Migrate call sites: INTERNAL→SERVER_ERROR, RATE_LIMIT→RATE_LIMITED
5. Create tests/error.taxonomy.test.ts

**Acceptance**:
- Build green
- Taxonomy tests pass
- No field stripping

## Phase A3: Rate-Limit Regression

**Branch**: `fix/rate-limit-regression`  
**Goal**: Restore 429 behavior

**Changes**:
1. Fix middleware order (before demo short-circuit)
2. Emit clamped retry_after
3. Optional X-RateLimit-Reset header
4. Add tests/rate-limit.behavior.test.ts

**Acceptance**:
- All rate-limit tests pass
- No cross-area regressions

## Phase D1: Determinism Envelope

**Branch**: `feat/determinism-envelope`  
**Goal**: JCS hashing + meta fields

**Changes**:
1. model_card: response_hash, response_hash_algo:"sha256", normalized:true
2. meta: seed, response_id, elapsed_ms
3. Document JCS normalization rules
4. Create tests/determinism.hash.test.ts (5× identical)

**Acceptance**:
- Determinism test passes
- Docs complete

## Phase L1: /v1/limits Endpoint

**Branch**: `feat/limits-endpoint`  
**Goal**: Cache-friendly limits

**Changes**:
1. GET /v1/limits → `{ max_nodes:12, max_edges:20, version:1 }`
2. ETag + Cache-Control: max-age=60, must-revalidate
3. Support If-None-Match → 304
4. Create tests/limits.endpoint.test.ts

**Acceptance**:
- 200 + 304 behavior verified
- Headers correct

## Phase T1: Templates Registry

**Branch**: `feat/templates-registry`  
**Goal**: Read-only templates

**Changes**:
1. GET /v1/templates → array of templates
2. GET /v1/templates/{id} → template JSON
3. Same caching as /v1/limits
4. Tests + docs

**Acceptance**:
- Endpoints work
- Caching correct

## Phase S1: SSE Canary Hardening

**Branch**: `feat/sse-canary-hardening`  
**Goal**: Resilience + token hygiene

**Changes**:
1. Emit retry: 1500
2. Heartbeats every ~15s
3. Monotonic IDs
4. Include response_id, template_id, seed
5. Cache-Control: no-store, Referrer-Policy: no-referrer
6. Create tests/sse.canary.test.ts

**Acceptance**:
- SSE tests pass
- P2-1 counters still work
- No token leakage

## Phase O1: OpenAPI & Fixtures

**Branch**: `docs/openapi-and-fixtures`  
**Goal**: API specs + fixtures

**Changes**:
1. OpenAPI for /v1/run, /v1/limits, SSE events
2. 3 fixtures: success, BAD_INPUT, LIMIT_EXCEEDED
3. Consumer/provider test skeleton

**Acceptance**:
- Schemas committed
- Fixtures validate

## Global Gates (Every PR)

- ✅ npm ci && npm run build green
- ✅ No src/*.js artifacts
- ✅ Tests green, suite no worse
- ✅ Coverage floors met (f≥90, l≥85, b≥80, s≥85)
- ✅ SSE EPIPE handling intact
- ✅ Prometheus labels bounded
- ✅ Conventional commit
- ✅ PR evidence included

## Quick Commands

```bash
# No artifacts
git ls-files | grep '^src/.*\.js$' || echo "OK"

# Determinism 5×
for i in {1..5}; do curl -s -X POST "$BASE/v1/run" \
  -d @tests/fixtures/pricing@v1.json | \
  jq -r '.model_card.response_hash'; done | sort | uniq -c

# SSE smoke
curl -i -H "X-Enable-Enhanced-Stream: 1" "$BASE/v1/stream?demo=1" -m 3 | head -20
curl -s "$BASE/metrics" | grep plot_engine_stream

# Limits caching
etag=$(curl -si "$BASE/v1/limits" | awk '/[Ee][Tt]ag:/ {print $2}')
curl -si -H "If-None-Match: $etag" "$BASE/v1/limits" | head -5
```
