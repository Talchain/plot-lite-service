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

## Environment

- PORT: service port (default 4311)
- RATE_LIMIT_ENABLED: enable per-IP rate limiting (default on; set 0 to disable)
- RATE_LIMIT_RPM: requests per minute per IP (default 60)
- REQUEST_TIMEOUT_MS: request timeout in milliseconds (default 5000)
- CORS_DEV: if 1, enable CORS for http://localhost:5173 (dev only)

## Endpoints

- GET /ready → { ok } (200 when server is ready)
- GET /health → { status, p95_ms, c2xx, c4xx, c5xx, lastReplayStatus, rate_limit }
- GET /version → { api: "1.0.0", build, model: "fixtures" }
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

## Optional Docker
Minimal Dockerfile included for Node 20:

```
docker build -t plot-lite-service .
docker run --rm -p 4311:4311 plot-lite-service
```
