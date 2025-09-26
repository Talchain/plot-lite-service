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

When enabled (default), per-IP requests are limited per minute.
- Headers on successful requests: X-RateLimit-Limit and X-RateLimit-Remaining
- When limited (HTTP 429): Retry-After (seconds) is returned
- /health includes rate_limit: { enabled, rpm, last5m_429 }

Exemptions: GET /ready, GET /health, and GET /version are not rate-limited.

## Environment

- PORT: service port (default 4311)
- RATE_LIMIT_ENABLED: enable per-IP rate limiting (default on; set 0 to disable)
- RATE_LIMIT_RPM: requests per minute per IP (default 60)
- REQUEST_TIMEOUT_MS: request timeout in milliseconds (default 5000)
- CORS_DEV: if 1, enable CORS for http://localhost:5173 (dev only)

## Endpoints

- GET /ready → { ok } (200 when server is ready)
- GET /live → { ok } (always 200 while process is up)
- GET /health → {
  status,
  p95_ms,
  c2xx, c4xx, c5xx, lastReplayStatus,
  runtime: { node, uptime_s, rss_mb, heap_used_mb, eventloop_delay_ms, p95_ms, p99_ms },
  caches: { idempotency_current },
  rate_limit: { enabled, rpm, last5m_429 }
}
- GET /version → { api: "1.0.0", build, model: "fixtures", runtime: { node } }
- POST /draft-flows → deterministic fixtures (cases[0] by default; accepts fixture_case)
- POST /critique → deterministic rules (no AI); Ajv-validated parse_json body
- POST /improve → echoes parse_json and returns { fix_applied: [] }

### Replay telemetry (tests & local runs)

GET /health includes a compact replay section that reflects the most recent replay activity:

```
{
  "replay": {
    "lastStatus": "ok",
    "refusals": 0,
    "retries": 3,
    "lastTs": "2025-09-25T12:34:56.789Z"
  }
}
```

- Meaning
  - lastStatus: outcome of the last replayed flow (ok or fail)
  - refusals: count of connection refusals observed by the replay harness
  - retries: retry attempts made by the replay harness
  - lastTs: ISO timestamp of the last update

- Test-only endpoints
  - GET /internal/replay-status → same replay object (200 only in test mode)
  - POST /internal/replay-report → increments counters (test mode only)

Test mode is enabled when TEST_ROUTES=1 (set by the test server helper). In production these endpoints return 404.

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
## CI PR Verify Helper

Run CI sanity + PR status comment locally:

```bash
npm run pr:verify
# or to target a branch explicitly
BRANCH=chore/lockfile-sync-ci BASE_BRANCH=main npm run pr:verify
```

- Only required workflows gate status: `OpenAPI Examples Roundtrip`, `engine-safety`, `tests-smoke`.
- Uses safe jq quoting and avoids Node’s npm \"jq\" shim automatically.

## CI status bot (pr-verify)

- Runs on every PR update and comments a compact summary of required checks.
- Local dev: `npm run pr:verify` uses the same Node script used in CI.
- Required gates: OpenAPI Examples Roundtrip, engine-safety, tests-smoke.
