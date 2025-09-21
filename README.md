# PLoT-lite deterministic fixtures service

Small, deterministic Fastify + TypeScript service for PLoT-lite. No AI calls. Privacy: never log parse_text.

## Requirements
- Node 20 LTS

## Install

```
npm i
```

## Develop

```
npm run dev
```

Server listens on http://localhost:4311

## Build and start (production)

```
npm run build
npm start
```

## Replay fixtures (determinism harness)

Ensure the server is running, then:

```
node tools/replay-fixtures.js
```

Expected output:

```
All fixtures match (1 case).
```

## Example curl

```
curl -s http://localhost:4311/health
curl -s http://localhost:4311/version
curl -s -X POST http://localhost:4311/draft-flows \
  -H 'Content-Type: application/json' \
  -d @fixtures/deterministic-fixtures.json | head
```

## Privacy and limits
- Never log parse_text or any request body contents.
- Structured logs only: request id, route, status, duration.
- JSON body limit: 128 KiB.
- Request timeout: 5 seconds.

## Rate limiting

**Off by default** - enable with `RATE_LIMIT_ENABLED=1`. Uses token bucket algorithm with burst and sustained limits.

### Limiting Strategy
- **Organization-level**: When `x-org-id` header is present (highest priority)
- **User-level**: When `x-user-id` header is present
- **IP-level**: Fallback when no org/user headers (respects `TRUST_PROXY` for `X-Forwarded-For`)

### Response Headers
- `X-RateLimit-Limit`: Maximum requests allowed in burst
- `X-RateLimit-Remaining`: Tokens remaining in bucket
- `Retry-After`: Seconds to wait when rate limited (HTTP 429)

**Note**: The temporary `X-RateLimit-Debug` header has been removed.

### Protected Endpoints
All POST endpoints are rate limited:
- `POST /draft-flows`
- `POST /critique`
- `POST /improve`
- `POST /__test/force-error` (when TEST_ROUTES=1)

### Exemptions
Health endpoints are never rate limited: `GET /health`, `GET /version`, `GET /live`, `GET /ops/snapshot`

### Rate Limit Configuration
```bash
# Enable rate limiting (off by default)
RATE_LIMIT_ENABLED=1

# IP limits (fallback)
RL_IP_BURST=120
RL_IP_SUSTAINED_PER_MIN=600

# User limits (x-user-id header)
RL_USER_BURST=180
RL_USER_SUSTAINED_PER_MIN=900

# Org limits (x-org-id header, takes priority)
RL_ORG_BURST=300
RL_ORG_SUSTAINED_PER_MIN=1500

# Trust X-Forwarded-For header
TRUST_PROXY=0
```

### Example Usage
```bash
# Request with org context (gets org-level limits)
curl -X POST http://localhost:4311/draft-flows \
  -H 'x-org-id: acme-corp' \
  -H 'Content-Type: application/json' \
  -d '{"fixture_case":"default"}'

# Request with user context (gets user-level limits)
curl -X POST http://localhost:4311/critique \
  -H 'x-user-id: user123' \
  -H 'Content-Type: application/json' \
  -d '{"parse_json":{"type":"flow","steps":[]}}'

# Request without headers (gets IP-level limits)
curl -X POST http://localhost:4311/improve \
  -H 'Content-Type: application/json' \
  -d '{"parse_json":{"test":"data"}}'
```

## Response Caching

**Off by default** - enable with `CACHE_ENABLED=1`. Provides L1 memory cache with optional L2 Redis layer for improved performance.

### Cache Strategy
- **L1 (Memory)**: In-memory LRU cache with configurable max keys
- **L2 (Redis)**: Optional remote cache via Upstash REST API for scalability
- **Singleflight**: Prevents duplicate computations under concurrent load
- **TTL**: Per-route configurable time-to-live
- **Tags**: Route and organization-based invalidation

### Cached Endpoints
Only deterministic POST endpoints are cached:
- `POST /draft-flows` (default TTL: 5 minutes)
- `POST /critique` (default TTL: 10 minutes)

### Cache Headers
- `X-Cache: HIT` - Response served from cache
- `X-Cache: MISS` - Response computed and cached
- `X-Cache: BYPASS` - Caching disabled or skipped

### Cache Control
- **Disable per request**: Add header `x-cache-allow: 0`
- **Body size limit**: Requests larger than `CACHE_MAX_BODY_BYTES` won't be cached
- **Deterministic keys**: Based on route + org/user context + full request body

### Cache Configuration
```bash
# Enable caching (off by default)
CACHE_ENABLED=1

# Per-route TTL (milliseconds)
CACHE_DRAFT_FLOWS_TTL_MS=300000  # 5 minutes
CACHE_CRITIQUE_TTL_MS=600000     # 10 minutes

# L1 memory cache limits
CACHE_L1_MAX_KEYS=1000          # Max entries in memory
CACHE_MAX_BODY_BYTES=32768      # 32KB max body size

# Optional L2 Redis cache
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token
```

### Example Usage
```bash
# First request (cache miss)
curl -X POST http://localhost:4311/draft-flows \
  -H 'x-org-id: acme-corp' \
  -H 'Content-Type: application/json' \
  -d '{"fixture_case":"default"}' \
  -v
# Returns: X-Cache: MISS

# Second identical request (cache hit)
curl -X POST http://localhost:4311/draft-flows \
  -H 'x-org-id: acme-corp' \
  -H 'Content-Type: application/json' \
  -d '{"fixture_case":"default"}' \
  -v
# Returns: X-Cache: HIT

# Disable caching for specific request
curl -X POST http://localhost:4311/critique \
  -H 'x-cache-allow: 0' \
  -H 'Content-Type: application/json' \
  -d '{"parse_json":{"type":"flow","steps":[]}}' \
  -v
# Returns: X-Cache: BYPASS
```

### Cache Stats
Monitor cache performance via the health endpoint:
```bash
curl http://localhost:4311/health | jq '.caches.response_cache'
```

Returns:
```json
{
  "hits": 42,
  "misses": 8,
  "size": 15,
  "l2Enabled": true
}
```

## Environment

- PORT: service port (default 4311)
- RATE_LIMIT_ENABLED: enable rate limiting (default 0/off; set 1 to enable)
- REQUEST_TIMEOUT_MS: request timeout in milliseconds (default 5000)
- CORS_DEV: if 1, enable CORS for http://localhost:5173 (dev only)
- TRUST_PROXY: if 1, honor X-Forwarded-For for client IP (default 0)

See `.env.example` for all rate limiting configuration options.

## Endpoints

- GET /ready → { ok } (200 when server is ready)
- GET /live → { ok } (always 200 while process is up)
- GET /health → {
  status,
  p95_ms,
  c2xx, c4xx, c5xx, lastReplayStatus,
  runtime: { node, uptime_s, rss_mb, heap_used_mb, eventloop_delay_ms, p95_ms, p99_ms },
  caches: { idempotency_current, response_cache: { hits, misses, size, l2Enabled } },
  rate_limit: { enabled, rpm, last5m_429 }
}
- GET /version → { api: "1.0.0", build, model: "fixtures", runtime: { node } }
- POST /draft-flows → deterministic fixtures (cases[0] by default; accepts fixture_case)
- POST /critique → deterministic rules (no AI); Ajv-validated parse_json body
- POST /improve → echoes parse_json and returns { fix_applied: [] }

## Determinism

- Responses from /draft-flows are pre-serialised from fixtures; byte-for-byte equality is enforced by tools/replay-fixtures.js across all cases.
- Unit tests ensure ordering and deterministic critique rule outputs.

## Idempotency-Key

Optional header to safely replay identical POST responses for 10 minutes without recomputation.

- Cache key = sha256(canonical(JSON body)) + the Idempotency-Key header value
- Same body + same key → exact previous response bytes returned
- Same key + different body → 400 BAD_INPUT with a hint to use a new key or the exact same body
- No key → normal behaviour

Examples:

```
# Replay identical /draft-flows response for 10 minutes
curl -s -X POST http://localhost:4311/draft-flows \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: abc-123' \
  -d '{"fixture_case":"price-rise-15pct-enGB","seed":42}'

# Replay /critique response
curl -s -X POST http://localhost:4311/critique \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: abc-123' \
  -d @fixtures/deterministic-fixtures.json
```

## Loadcheck

Run a quick check locally:

```
npm run build
npm start &
sleep 1
node tools/loadcheck.js
```

The output includes p95_ms, max_ms, and rps. Our target p95 is ≤ 600 ms.

## Versioning

See RELEASING.md for the release checklist and tagging guidance.

## Releases

## Releasing

Run a patch release and tag, then push:

```
npm run release
git push && git push --tags
```

- Conventional commits enforced via commitlint (local hooks via husky; optional in CI).
- Generate CHANGELOG.md and tags with:
  - Patch: npm run release
  - Minor: npm run release:minor
  - Major: npm run release:major
- A Release workflow runs on tags (vX.Y.Z), builds/tests, and attaches artefacts (tests.json, Postman collection, contract report) to the GitHub Release.
- Release Drafter auto-drafts notes on PR merges.

## For Windsurf

- Base URL: http://localhost:4311
- Endpoints:
  - GET /health → { status, p95_ms }
  - GET /version → { api: "1.0.0", build, model: "fixtures" }
  - POST /draft-flows → returns deterministic fixtures (cases[0].response)
  - POST /critique → fixed, deterministic list (see above)
  - POST /improve → echoes parse_json and returns { fix_applied: [] }
- Example first call:

```
curl -s -X POST http://localhost:4311/draft-flows \
  -H 'Content-Type: application/json' \
  -d @fixtures/deterministic-fixtures.json | jq '.drafts[0].id'
```

- Edge proxy: proxy /plot-lite/* → http://localhost:4311/*

## Overnight log

- 2025-09-21 01:00 BST: Initial Slice A scaffold with Fastify + TS; endpoints implemented; determinism harness; threshold utility; tests green.
- 2025-09-21 01:05 BST: Added p95 timers, strict structured logs, and optional per-IP rate limit (default on; disable with RATE_LIMIT_ENABLED=0). Tests green.
- 2025-09-21 01:10 BST: Added typed error responses; BAD_INPUT for /improve when parse_json missing. Tests green.
- 2025-09-21 01:12 BST: Added OpenAPI lightweight validator to test runner (skips if spec absent). Tests green.
- 2025-09-21 01:14 BST: Discovered and copied contract files from DecisionGuideAI origin/feat/plot-lite-contract → openapi/docs/schemas. Tests green.
- 2025-09-21 10:15 BST: Loadcheck run → p95_ms=0, max_ms=46, rps=27403.2. Tests green. TODO: verify stability under sustained runs; current numbers are well below the 600 ms target.
- 2025-09-21 12:25 BST: Loadcheck run → p95_ms=0, max_ms=132, rps=17193.6. Ran with RATE_LIMIT_ENABLED=0 against /draft-flows; target p95 ≤ 600 ms.
- 2025-09-21 12:44 BST: Phase 11 docs → Added Idempotency-Key usage section with curl examples; cache TTL 10 minutes; tests remain green.
- 2025-09-21 12:49 BST: Phase 12 → Added X-RateLimit-* on 2xx and Retry-After on 429; /health now reports { enabled, rpm, last5m_429 }. Exempted GET /ready,/health,/version from limiting. Tests green.
- 2025-09-21 12:50 BST: Phase 13 → Added docker-compose with app healthcheck and tests service; `docker compose up --build` brings service healthy and runs tests.
- 2025-09-21 12:52 BST: Phase 14 → Added GitHub Actions workflow with Node 18/20 matrix, npm cache, and artefact uploads (reports/tests.json, Postman collection, contract report). Tests green.
- 2025-09-21 13:41 BST: Slice A → Added smoke script and npm aliases (replay/loadcheck); tests green.
- 2025-09-21 13:43 BST: Slice B → Added offline OpenAPI schema validation for fixtures and critique samples (dev-time). Tests green.
- 2025-09-21 16:20 BST: Slice C → Release hygiene: conventional commits (commitlint + husky), standard-version release scripts, Release Drafter, PR template, CODEOWNERS, release workflow with artefacts. Tests green.
- 2025-09-21 16:35 BST: Slice D → Resilience niceties: enriched /health (runtime, p99, caches), X-Request-ID header, /live, optional /ops/snapshot, improved timeout mapping, graceful shutdown. Tests green.
- 2025-09-21 17:56 BST: Main push verified; CI green.

## Optional Docker
Minimal Dockerfile included for Node 20:

```
docker build -t plot-lite-service .
docker run --rm -p 4311:4311 plot-lite-service
```

## Docker Compose

Bring up the app and run tests in a separate service:

```
docker compose up --build
```

- The app exposes port 4311 and has a healthcheck on GET /ready.
- The tests service depends on app:healthy and runs `npm test` in the same image.
- Rate limiting is disabled in tests by default (RATE_LIMIT_ENABLED=0).

## CI
This repository runs tests on Node 18 and 20. When a run completes, artefacts include:
- `reports/tests.json` (Vitest JSON)
- `docs/collections/plot-lite.postman.json`
- `docs/contract-report.html`
