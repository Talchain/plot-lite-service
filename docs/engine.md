# PLoT-lite Engine (Contracts, Gating, Determinism)

This page documents the frozen engine contracts, gating flags, determinism & caching, and the Evidence Pack.

## Gating & Defaults
- TEST_ROUTES: when `1`, exposes test-only routes (e.g., `/stream`, `/stream/cancel`). Default: off.
- RATE_LIMIT_ENABLED: enable per-IP limiting when not `0`. Default: on locally; disabled in tests when needed.
- CORS_DEV: if `1`, allow `http://localhost:5173`. Default: closed.
- Production guard: `src/main.ts` refuses to boot if `NODE_ENV=production` and `TEST_ROUTES=1`.

## Frozen Contracts
- SSE events (exact set): `hello | token | cost | done | cancelled | limited | error`.
- Report stamp: `schema: "report.v1"` and `meta.seed`.
- Health shape (minimal): `{ status, p95_ms, test_routes_enabled, replay }` plus small runtime fields (≤ 4 KB total).

## Streaming (test routes)
- Endpoints: `GET /stream`, `POST /stream/cancel`.
- Resume: use `Last-Event-ID` header to continue after a disconnect.
- Cancel: idempotent; emits a single `cancelled` event and closes.
- Limited: backpressure signalled with a `limited` SSE event.

## Determinism & Caching
- `/draft-flows` serves deterministic bytes from fixtures with headers:
  - `Content-Type: application/json`
  - `Cache-Control: no-cache`
  - `ETag: "<sha256>"`
  - `Content-Length: <bytes>`
- Caching:
  - `If-None-Match` → `304 Not Modified` when ETag matches.
  - `HEAD` parity: headers mirror `GET`.
- Golden seed: `4242` with checksums for both the report body and a golden stream ndjson.

## Evidence Pack
- Script: `tools/verify-and-pack.sh` (supports `PACK_SELF_START=1`).
- Captures:
  - `/health`, `/version`
  - `/draft-flows` 200 (headers + body), 304, and HEAD
  - taxonomy samples (INVALID_TEMPLATE 404, BAD_QUERY_PARAMS 400, INVALID_SEED 404)
  - access-log snippet (no payload/query logging)
- Checksums:
  - `engine/fixture-seed-4242.sha256` (report body)
  - `engine/stream-ndjson.sha256` (golden SSE)
- Perf:
  - `reports/loadcheck.json` includes `p95_ms` (budget ≤ 600 ms)
- README:
  - commit, lanes status, p95, absolute path, acceptance checklist

### Pack Quality & Determinism
The pack enforces three composer-ready guarantees:
1. **STRICT p95 guard**: Fails loudly if `reports/loadcheck.json` lacks numeric `p95_ms`.
2. **Privacy phrase**: Literal text "no request bodies or query strings in logs" is appended to `SLO_SUMMARY.md`.
3. **Stable features_on**: Sorted in `manifest.json` for byte-stable packs.

Manual pack generation:
```bash
PACK_SELF_START=1 bash tools/verify-and-pack.sh
```

Acceptance format (paste into PR):
```
ENGINE_PACK: evidence/pack/engine_pack_<date>_<sha>.zip, SLO engine_get_p95_ms=<n>, SLO_SUMMARY=present
CONTRACTS: GET/HEAD/ETag/304 parity PASS; privacy check PASS — no request bodies or query strings in logs
GATES: PASS — p95 within budget; size ≤ 50 MB
Handoff: copied|skipped
FLAGS_EXPORT: docs/spec/engine.flags.json present
SIZE_AUDIT: working_tree=<X>, git_db=[…]
SIZE_SUSPECTS: big_tracked_files(>=25MB)=<n>, evidence_pack_tracked=<n>, incoming_tracked=<n>, tooling_node20_tracked=<n>
```

## Error Taxonomy
- Standardized public phrases, e.g., `RATE_LIMIT_RPM`, `TIMEOUT_UPSTREAM`, `RETRYABLE_UPSTREAM`, `INTERNAL_UNEXPECTED`, etc.
- Mapped via `src/lib/error-normaliser.ts` to HTTP statuses.

## Endpoints (summary)
- `GET /health` → minimal shape + runtime + replay snapshot
- `GET /version` → `{ api, build, model }`
- `GET /draft-flows?template=<T>&seed=<N>&budget=<N?>` → deterministic body + strong ETag, 304 if matched
- `POST /draft-flows` → deterministic legacy; supports `Idempotency-Key`
- `POST /critique` → deterministic rules; Ajv validated
- `POST /improve` → echoes `parse_json`
- (test-only) `GET /stream`, `POST /stream/cancel`, `/internal/replay-*`
