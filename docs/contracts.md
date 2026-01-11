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

## V2/run - Option Comparison Mode

The `/v2/run` endpoint provides the canonical option-comparison model with explicit intervention bundles.

**Key differences from /v1/run:**
- Options are intervention bundles (not graph nodes)
- Strict preflight validation with BLOCKER critiques
- No intervention synthesis - requires explicit interventions
- Option nodes filtered from graph before analysis

**Required fields:**
- `graph`: Causal graph with nodes and edges
- `options`: Array of intervention bundles (min 1)
- `goal_node_id`: Target node for outcome measurement

**Response status fields:**
- `option_comparison_status`: 'available' | 'unavailable'
- `robustness_status`: 'available' | 'unavailable'
- `drivers_status`: 'available' | 'unavailable'

**Blocker codes:**
- `MISSING_GOAL_NODE` - Goal node required or not found
- `NO_OPTIONS` - At least one option required
- `EMPTY_INTERVENTIONS` - Each option needs interventions
- `INVALID_INTERVENTION_TARGET` - Intervention targets non-existent node
- `INVALID_INTERVENTION_VALUE` - Intervention value not a finite number
- `NO_PATH_TO_GOAL` - No causal path from intervention to goal
- `IDENTICAL_OPTIONS` - Duplicate intervention bundles
- `GRAPH_CYCLE_DETECTED` - Graph must be a DAG
- `GRAPH_TOO_LARGE` - Max 50 nodes, 100 edges

Example:

```bash
curl -X POST 'http://127.0.0.1:4311/v2/run' \
  -H 'Content-Type: application/json' \
  -d '{
    "graph": {
      "nodes": [
        {"id": "budget", "kind": "factor"},
        {"id": "revenue", "kind": "outcome"}
      ],
      "edges": [
        {"from": "budget", "to": "revenue", "exists_probability": 0.9, "strength": {"mean": 0.5, "std": 0.1}}
      ]
    },
    "options": [
      {"id": "opt1", "label": "Increase Budget", "interventions": {"budget": {"value": 100000}}}
    ],
    "goal_node_id": "revenue"
  }'
```

## Change process

- Any contract drift must update schemas under `contracts/` and corresponding tests under `tests/`.
- Default behaviour must not change; use environment flags for new options.
