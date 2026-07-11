# PLoT Engine API Reference

## Base URL

- **Production**: `https://plot-lite-service.onrender.com`
- **Staging**: `https://plot-lite-service-staging.onrender.com`
- **Local**: `http://localhost:4311`

## Authentication

Set `AUTH_ENABLED=1` and configure `AUTH_TOKEN` for production environments.

```bash
curl -H "Authorization: Bearer $AUTH_TOKEN" https://...
```

---

## Health & Status Endpoints

### GET /ready
Returns 200 when server is ready to accept requests.
```json
{ "ok": true }
```

### GET /live
Always returns 200 while process is running (liveness probe).
```json
{ "ok": true }
```

### GET /health
Comprehensive health status with metrics.
```json
{
  "status": "ok",
  "p95_ms": 45,
  "replay": { "lastStatus": "ok", "refusals": 0, "retries": 0, "lastTs": "..." },
  "test_routes_enabled": false,
  "rate_limit": { "enabled": true, "rpm": 60, "last5m_429": 0 }
}
```

### GET /version
Service version information.
```json
{
  "api": "warp/0.1.0",
  "model": "plot-lite-<hash>",
  "build": "<git-sha>"
}
```

### GET /v1/limits
Current configuration limits.
```json
{
  "schema": "limits.v1",
  "max_nodes": 50,
  "max_edges": 200,
  "max_body_kb": 96
}
```

---

## Core Inference Endpoints

### POST /v1/run
Execute the probabilistic simulation over a decision graph (user-specified causal structure).

**Request:**
```json
{
  "graph": {
    "nodes": [{ "id": "Price", "label": "Price", "value": 0.5 }],
    "edges": [{ "from": "Price", "to": "Revenue", "weight": 0.8 }]
  },
  "seed": 4242,
  "treatment_node": "Price",
  "outcome_node": "Revenue"
}
```

**Response (schema: `run.v1`):**
```json
{
  "schema": "run.v1",
  "results": {
    "conservative": { "p10": 0.3, "p50": 0.5, "p90": 0.7 },
    "most_likely": { "p10": 0.4, "p50": 0.6, "p90": 0.8 },
    "optimistic": { "p10": 0.5, "p50": 0.7, "p90": 0.9 }
  },
  "confidence": { "level": "HIGH", "score": 0.85, "reason": "..." },
  "model_card": { "seed": 4242, "response_hash": "abc123..." }
}
```

**Limits:** 50 nodes, 200 edges, 96 KB payload, p95 ≤ 600ms

### POST /v1/validate
Validate graph structure without running inference.
```json
{
  "graph": { "nodes": [...], "edges": [...] }
}
```

### POST /v1/critique
Get structural critique and improvement suggestions.
```json
{
  "graph": { "nodes": [...], "edges": [...] }
}
```

---

## Scenario Analysis Endpoints

### POST /v1/compare
Compare 2-5 graph scenarios.
```json
{
  "graphs": [
    { "graph": {...}, "label": "Option A" },
    { "graph": {...}, "label": "Option B" }
  ],
  "seed": 4242
}
```

### POST /v1/run_bundle
Evaluate multiple scenarios from a base graph.
```json
{
  "base_graph": { "nodes": [...], "edges": [...] },
  "deltas": [
    { "label": "Low Price", "nodes": [{ "id": "Price", "value": 0.3 }] },
    { "label": "High Price", "nodes": [{ "id": "Price", "value": 0.8 }] }
  ],
  "seed": 4242
}
```
**Limits:** Max 10 deltas

### POST /v1/run_timeslices
Evaluate graphs across multiple time periods.
```json
{
  "graph": { "nodes": [...], "edges": [...] },
  "timeslices": [
    { "label": "Q1", "nodes": [...] },
    { "label": "Q2", "nodes": [...] }
  ],
  "seed": 4242
}
```
**Limits:** Max 12 timeslices

---

## Causal Intervention Endpoints

### POST /v1/intervene
Perform causal do-operator interventions.
```json
{
  "graph": { "nodes": [...], "edges": [...] },
  "actions": [{ "node_id": "Price", "value": 0.8 }],
  "seed": 4242
}
```

**Response:**
```json
{
  "schema": "intervene.v1",
  "baseline": { "p10": 0.4, "p50": 0.5, "p90": 0.6 },
  "counterfactual": { "p10": 0.5, "p50": 0.65, "p90": 0.8 },
  "delta": { "p10": 0.1, "p50": 0.15, "p90": 0.2 }
}
```

### POST /v1/optimise
Select optimal actions under budget constraint.
```json
{
  "graph": { "nodes": [...], "edges": [...] },
  "budget": 100,
  "actions": [
    { "id": "discount", "cost": 50, "do": [{ "node_id": "Price", "set_to": 0.7 }] },
    { "id": "marketing", "cost": 80, "do": [{ "node_id": "Demand", "set_to": 0.9 }] }
  ],
  "objective": { "type": "utility_linear", "weights": { "Revenue": 1.0 } },
  "seed": 4242
}
```

### POST /v1/sensitivity
Analyze sensitivity of outcomes to input changes.
```json
{
  "graph": { "nodes": [...], "edges": [...] },
  "seed": 4242
}
```

---

## Inspection Endpoints

### POST /v1/inspect
Introspect graph evaluation details.
```json
{
  "graph": { "nodes": [...], "edges": [...] },
  "seed": 4242
}
```

### GET /v1/openapi.json
Machine-readable OpenAPI specification.

---

## Headers

### Request Headers

| Header | Purpose |
|--------|---------|
| `Content-Type` | `application/json` (required for POST) |
| `Authorization` | `Bearer <token>` (when AUTH_ENABLED=1) |
| `X-Request-Id` | Request correlation ID (echoed back) |
| `Idempotency-Key` | Cache key for idempotent requests (10 min TTL) |
| `X-SCM-Lite` | `1` to enable SCM-Lite mode |
| `X-Demo` | `1` for demo mode (test only) |

### Response Headers

| Header | Purpose |
|--------|---------|
| `X-Request-Id` | Echoed request ID |
| `X-RateLimit-Limit` | Max requests per minute |
| `X-RateLimit-Remaining` | Requests remaining |
| `X-RateLimit-Reset` | Unix timestamp when limit resets |
| `Retry-After` | Seconds to wait (on 429) |
| `ETag` | Response hash for caching |

---

## Rate Limiting

- Default: 60 requests/minute per IP
- Exempt: `GET /ready`, `GET /health`, `GET /version`
- On 429: Check `Retry-After` header

```javascript
if (response.status === 429) {
  const retryAfter = response.headers.get('Retry-After');
  await sleep(retryAfter * 1000);
}
```

---

## Error Responses

All errors follow `error.v1` schema:
```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "message": "Human-readable message",
  "field": "graph.nodes[0].id",
  "path": ["/graph/nodes/0/id"]
}
```

| Code | HTTP | Description |
|------|------|-------------|
| `BAD_INPUT` | 400 | Invalid request payload |
| `UNAUTHORIZED` | 401 | Missing or invalid auth |
| `FORBIDDEN` | 403 | Access denied |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL` | 500 | Server error |

---

## Idempotency

Use `Idempotency-Key` header for safe retries:
```bash
curl -X POST http://localhost:4311/v1/run \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: unique-request-id-123' \
  -d '{"graph": {...}, "seed": 4242}'
```

- Cache key = `sha256(body) + Idempotency-Key`
- TTL: 10 minutes
- Same body + same key = cached response
- Same key + different body = 400 error

---

## CORS

Allowed origins:
- `https://olumi.netlify.app`
- `http://localhost:5173` (development)

Exposed headers: `X-RateLimit-*`, `X-SCM-Lite`, `X-Request-Id`

---

## Determinism

All inference endpoints are deterministic:
- Same `graph` + same `seed` = identical `response_hash`
- Use `ETag` / `If-None-Match` for conditional requests
- Verify with `tools/replay-fixtures.js`
