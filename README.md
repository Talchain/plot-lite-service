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

## Optional Docker
Minimal Dockerfile included for Node 20:

```
docker build -t plot-lite-service .
docker run --rm -p 4311:4311 plot-lite-service
```