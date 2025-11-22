# PLoT-lite Engine Contracts

This document freezes the current contract wall for Engine endpoints and streaming.
All changes must be additive and gated by environment flags. Default runtime behaviour remains unchanged.

## SSE Events

Final event set:
- hello
- token
- cost
- done
- cancelled
- limited
- error

Semantics:
- Resume: prefer Last-Event-ID header; fallback to `lastEventId` query.
- Cancel: POST `/stream/cancel` with `{ id }` or `?id=...`. Idempotent; the second cancel is a no-op.

Example stream (test routes enabled):

```bash
curl -N 'http://127.0.0.1:4311/stream?id=example' -H 'Accept: text/event-stream'
```

Resume after a single blip:

```bash
# First connection (server may blip once mid-stream)
curl -N 'http://127.0.0.1:4311/stream?id=resume1&blip=1'
# Suppose last event id was 1; resume from 2
curl -N 'http://127.0.0.1:4311/stream?id=resume1' -H 'Last-Event-ID: 1'
```

Cancel mid-stream:

```bash
curl -X POST 'http://127.0.0.1:4311/stream/cancel' -H 'Content-Type: application/json' -d '{"id":"job-1"}'
```

## Report v1

- Body includes `schema: "report.v1"` and `meta.seed`.
- Deterministic fixtures power `GET /draft-flows` for test seeds.

Example:

```bash
curl -s 'http://127.0.0.1:4311/draft-flows?template=pricing_change&seed=101' | jq '.schema, .meta.seed'
```

## Health shape (minimal)

```json
{
  "status": "ok|degraded|down",
  "p95_ms": 0,
  "replay": { "lastStatus": "ok", "refusals": 0, "retries": 0, "lastTs": "2025-01-01T00:00:00Z" },
  "test_routes_enabled": false
}
```

## Change process

- Any contract drift must update schemas under `contracts/` and corresponding tests under `tests/`.
- Default behaviour must not change; use environment flags for new options.
