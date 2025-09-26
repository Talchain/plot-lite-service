# UI integration guide for PLoT‑Lite deterministic mode

This document describes how to integrate a UI against the deterministic fixtures service.

Endpoints
- GET /draft-flows
  - Deterministic fixture fetch. Serves bytes verbatim from on‑disk files under fixtures/<template>/<seed>.json
  - Headers:
    - Content-Type: application/json
    - Content-Length: <bytes>
    - Cache-Control: no-cache
    - ETag: "<sha256-hex>" (strong)
  - Conditional requests:
    - Send If-None-Match: "<previous-etag>"; server returns 304 Not Modified when unchanged.
  - Query:
    - template: one of pricing_change | feature_launch | build_vs_buy
    - seed: integer
- GET /health
  - Compact status payload (≤ 4 KB): { status, p95_ms, replay, test_routes_enabled, runtime, caches, rate_limit }
  - Stable keys; suitable for lightweight health displays.
- GET /version
  - { api: "warp/0.1.0", build: "<git-sha>", model: "plot-lite-<git-sha>" }
- GET /ready
  - Returns { ok: true } with HTTP 200 once fixtures are preloaded. Use for readiness checks.

Caching and revalidation
- Always treat GET /draft-flows responses as cacheable only with revalidation: Cache-Control: no-cache
- Use the strong ETag. On a repeat fetch, pass If-None-Match: "<etag>". Expect 304 Not Modified when the file is unchanged.

Filenames and stamps
- Fixture filenames: <template>/<seed>.json
- Required stamps in the file body:
  - schema: "report.v1"
  - meta: { seed: number, fixtures_version: string, template: string }

Schema and validation
- Schema file: docs/schema/report.v1.json (pinned)
- The service validates fixtures and live GET responses against this schema in CI tests.

Error taxonomy
- See docs/engine/error-codes.md for error types and HTTP code mappings. Rate limit responses include Retry-After and X-RateLimit-Reset.

Compatibility
- The legacy POST /draft-flows remains supported for backwards compatibility and is unchanged. The PoC UI should prefer GET /draft-flows (deterministic bytes + ETag).
