# UI Handoff - P0 Integration

## Response Shape

### result.response_hash (Primary)
```json
{
  "result": {
    "response_hash": "68bad0aa879b3e01b67c746b5c29f2721b37b4632d6feb048f01db3c6239250f"
  }
}
```
- **Type:** string (64-char SHA-256 hex)
- **Purpose:** Deterministic cache key for UI
- **Fallback:** Use `model_card.response_hash` if `result.response_hash` not present

### result.summary
```json
{
  "result": {
    "summary": {
      "p10": 105,
      "p50": 115,
      "p90": 125
    }
  }
}
```

### explain_delta.top_edge_drivers
```json
{
  "explain_delta": {
    "top_edge_drivers": [
      {
        "edge_id": "A::B::0",
        "from": "A",
        "to": "B",
        "score": 1.0,
        "rank": 1
      }
    ]
  }
}
```

## New Endpoints

### GET /v1/limits
```bash
curl https://plot-lite-service.onrender.com/v1/limits
```
Response:
```json
{
  "nodes": {"max": 200},
  "edges": {"max": 500}
}
```

### POST /v1/validate
```bash
curl -X POST https://plot-lite-service.onrender.com/v1/validate \
  -H 'Content-Type: application/json' \
  -d '{"graph":{"nodes":[{"id":"A"}],"edges":[]},"seed":42}'
```
Response:
```json
{
  "valid": true,
  "violations": []
}
```

## UI Field Rejection

The following fields are **rejected** with 400 if present in nodes/edges:
- `source`, `target` (edge UI metadata)
- `data`, `position`, `type` (node UI metadata)

Keep these in UI state only; strip before sending to API.
