# P0 UI Integration - API Additions

## New Endpoints

### GET /v1/limits
Returns configured graph size limits.

**Response:**
```json
{
  "nodes": { "max": 200 },
  "edges": { "max": 500 }
}
```

### POST /v1/validate
Validates /v1/run payload without execution.

**Response:**
```json
{
  "valid": true,
  "violations": []
}
```

## New /v1/run Response Fields

### result.response_hash
SHA-256 hash of canonical inputs (7 fields, deterministic).

### result.summary
Direct p10/p50/p90 mapping.

### explain_delta.top_edge_drivers
Top-3 edges by sensitivity (always included).

## Input Validation

Rejects UI-editor fields: `source`, `target`, `data`, `position`

**Error (400):**
```json
{
  "code": "BAD_INPUT",
  "message": "UI-editor field not allowed: graph.nodes[0].position",
  "field": "graph.nodes[0].position"
}
```

## Rate Limiting

429 responses include:
- Header: `Retry-After` (seconds)
- Body: `retry_after_s` field
