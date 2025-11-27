# PLoT Engine Technical Specification

**Version**: 1.5.0
**Last Updated**: 2025-11-27

This document provides detailed technical specifications for developers and operators working with PLoT Engine.

---

## Table of Contents

1. [API Specification](#api-specification)
2. [Request/Response Contracts](#requestresponse-contracts)
3. [Configuration Reference](#configuration-reference)
4. [Integration Points](#integration-points)
5. [Error Handling](#error-handling)
6. [Performance Characteristics](#performance-characteristics)
7. [Security Model](#security-model)

---

## API Specification

### Core Endpoints

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/v1/run` | POST | Execute causal inference | Optional |
| `/v1/stream` | POST | SSE streaming inference | Optional |
| `/v1/compare` | POST | Compare 2-5 graph scenarios | Optional |
| `/v1/inspect` | POST | Introspect graph evaluation | Optional |
| `/v1/intervene` | POST | Causal interventions (do-operator) | Optional |
| `/v1/optimise` | POST | Action selection under budget | Optional |
| `/v1/run_bundle` | POST | Evaluate scenario bundles | Optional |
| `/v1/validate` | POST | Validate graph structure | No |
| `/v1/limits` | GET | Get current limits | No |
| `/v1/health` | GET | Health check with metrics | No |
| `/v1/openapi.json` | GET | OpenAPI specification | No |

### Operations Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/ready` | GET | Readiness probe |
| `/live` | GET | Liveness probe |
| `/metrics` | GET | Prometheus metrics (if enabled) |

### Request Headers

| Header | Description | Required |
|--------|-------------|----------|
| `Content-Type` | Must be `application/json` | Yes (POST) |
| `X-Request-Id` | Request correlation ID | No |
| `Idempotency-Key` | Enables response caching | No |
| `Authorization` | Bearer token (if AUTH_ENABLED=1) | Conditional |
| `x-scm-lite` | Enable SCM-Lite mode (`1`) | No |

### Response Headers

| Header | Description |
|--------|-------------|
| `X-Request-Id` | Echoed request ID |
| `X-Plot-Request-Id` | Internal request ID |
| `X-RateLimit-Limit` | Rate limit ceiling |
| `X-RateLimit-Remaining` | Remaining requests |
| `X-RateLimit-Reset` | Reset timestamp |
| `X-SCM-Lite` | SCM-Lite mode indicator |
| `x-cee-status` | CEE integration status |

---

## Request/Response Contracts

### Graph Schema (GraphV1)

```typescript
interface GraphV1 {
  nodes: Array<{
    id: string;           // Unique node identifier
    label: string;        // Display label
    value?: number;       // Initial belief (0-1)
    type?: string;        // Node type hint
    [key: string]: any;   // Additional metadata
  }>;
  edges: Array<{
    from: string;         // Source node ID
    to: string;           // Target node ID
    weight?: number;      // Edge weight (0-1)
    provenance_note?: string; // Source attribution
    [key: string]: any;   // Additional metadata
  }>;
}
```

### Run Response Schema (ReportV1)

```typescript
interface ReportV1 {
  schema: 'run.v1' | 'report.v1';
  graph: GraphV1;
  results: {
    conservative: ResultBand;
    most_likely: ResultBand;
    optimistic: ResultBand;
  };
  result: {
    response_hash: string;
    summary: { p10: number; p50: number; p90: number };
  };
  model_card: {
    version: string;
    seed: number;
    response_hash: string;
    determinism_note?: string;
    compute_budget?: { k: number; reason: string };
  };
  meta: {
    seed: number;
    commit?: string;
    inference_mode?: string;
    evidence_applied?: Array<{ node_id: string; source: string }>;
  };
  // Optional trust signals
  confidence?: ConfidenceResult;
  critique?: CritiqueResult;
  explain_delta?: ExplainDeltaResult;
  identifiability?: IdentifiabilityResult;
  sensitivity_summary?: SensitivitySummary;
  sensitivity_full?: SensitivityFull;
  insights?: InsightsResult;
  graph_quality?: GraphQualityResult;
}
```

### Error Response Schema (ErrorV1)

```typescript
interface ErrorV1 {
  schema: 'error.v1';
  code: 'BAD_INPUT' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'RATE_LIMITED' | 'INTERNAL' | 'TIMEOUT';
  error: {
    type: string;
    message: string;
  };
  request_id?: string;
  field?: string;
  path?: string[];
  details?: Record<string, any>;
}
```

---

## Configuration Reference

### Environment Variables

#### Core Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 4311 | Server port |
| `NODE_ENV` | development | Environment mode |
| `REQUEST_TIMEOUT_MS` | 5000 | Request timeout |
| `MAX_COMPUTE_MS` | 10000 | Max compute time |

#### Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_ENABLED` | 0 | Enable bearer auth |
| `AUTH_TOKEN` | - | Required if AUTH_ENABLED=1 |
| `TOKEN_HMAC_SECRET` | - | 64+ char HMAC secret |

#### Rate Limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_ENABLED` | 1 | Enable rate limiting |
| `RATE_LIMIT_RPM` | 60 | Requests per minute per IP |
| `RL_CB_ENABLE` | 0 | Enable circuit breaker |
| `RL_CB_THRESHOLD` | 5 | Circuit breaker threshold |
| `RL_CB_HALF_OPEN_TIMEOUT_MS` | 30000 | Half-open timeout |

#### Feature Flags

| Variable | Default | Description |
|----------|---------|-------------|
| `SCM_LITE_ENABLE` | 0 | Enable SCM-Lite inference |
| `ADAPTIVE_K_ENABLE` | 0 | Enable adaptive sampling |
| `PROVENANCE_ENABLE` | 0 | Enable provenance tracking |
| `TEST_ROUTES` | 0 | Enable test-only routes |
| `CORS_DEV` | 0 | Enable dev CORS |

#### ISL Integration

| Variable | Default | Description |
|----------|---------|-------------|
| `ISL_ENABLE` | 0 | Enable ISL integration |
| `ISL_BASE_URL` | - | ISL service base URL |
| `ISL_API_KEY` | - | ISL API key |
| `ISL_TIMEOUT_MS` | 15000 | ISL request timeout |
| `ISL_MAX_RETRIES` | 3 | Max retry attempts (0-5) |

#### CEE Integration

| Variable | Default | Description |
|----------|---------|-------------|
| `CEE_ENABLE` | 0 | Enable CEE integration |
| `CEE_BASE_URL` | - | CEE service base URL |
| `CEE_API_KEY` | - | CEE API key |
| `CEE_TIMEOUT_MS` | 5000 | CEE request timeout |

#### Observability

| Variable | Default | Description |
|----------|---------|-------------|
| `PROMETHEUS_ENABLE` | 0 | Enable Prometheus metrics |
| `PROXY_TIMEOUT_MS` | 26000 | Upstream proxy timeout |

---

## Integration Points

### ISL (Inference Service Layer)

ISL provides external causal validation and sensitivity analysis.

**Fallback Behavior**: If ISL is unavailable, the engine falls back to local validation with `source: engine_fallback`.

**Metrics**:
- `plot_engine_isl_validation_total{backend,result}`
- `plot_engine_isl_sensitivity_total{backend,result}`
- `plot_engine_isl_latency_seconds{operation,result}`

### CEE (Causal Explanation Engine)

CEE provides decision review for high-uncertainty scenarios.

**Trigger**: CEE is called when:
1. `CEE_ENABLE=1`
2. Request has `Idempotency-Key` header
3. Response contains IDK (I Don't Know) indicators

**Circuit Breaker**: CEE has a dedicated circuit breaker to prevent cascading failures.

**Metrics**:
- `plot_engine_cee_attempted_total`
- `plot_engine_cee_ok_total`
- `plot_engine_cee_skipped_total{reason}`
- `plot_engine_cee_degraded_total{code}`

---

## Error Handling

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `BAD_INPUT` | 400 | Invalid request payload |
| `UNAUTHORIZED` | 401 | Missing or invalid auth |
| `FORBIDDEN` | 403 | Access denied |
| `NOT_FOUND` | 404 | Resource not found |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `INTERNAL` | 500 | Internal server error |
| `TIMEOUT` | 504 | Request timeout |

### Validation Errors

Request validation uses Ajv against OpenAPI schemas. Common validation failures:

- `graph.nodes` - Invalid node structure
- `graph.edges` - Invalid edge structure
- `graph_too_large` - Exceeds node/edge limits
- `body_too_large` - Exceeds 96KB limit

---

## Performance Characteristics

### Limits

| Resource | Limit |
|----------|-------|
| Max nodes | 50 |
| Max edges | 200 |
| Body size | 96 KB |
| Rate limit | 60 RPM/IP |

### SLO Targets by Detail Level

| Detail Level | Target p95 |
|--------------|------------|
| quick | 200ms |
| standard | 600ms |
| deep | 1500ms |

### Timeout Budget

Boot-time validation warns if combined timeouts exceed proxy timeout:

```
ISL worst-case: ISL_TIMEOUT_MS × ISL_MAX_RETRIES
Total worst-case: max(ISL, CEE) + MAX_COMPUTE_MS

Warning if: total_worst_case > PROXY_TIMEOUT_MS
```

---

## Security Model

### Authentication

When `AUTH_ENABLED=1`:
- Requests must include `Authorization: Bearer <token>`
- Token is validated against `AUTH_TOKEN` env var
- Failed auth returns 401 Unauthorized

### Principal Extraction

Request principals are extracted for:
- Rate limiting (per-principal buckets)
- Audit logging (anonymized)
- Idempotency keying

Principal sources (in priority order):
1. HMAC-signed token from `Authorization` header
2. Forwarded IP from `X-Forwarded-For` (if `TRUST_PROXY=1`)
3. Direct IP address

### Data Handling

- Request bodies are never logged
- Only metadata (route, status, duration) appears in logs
- Audit ring buffer stores only hashes, not payloads
- Evidence metadata is sanitized before response

---

## See Also

- [ARCHITECTURE.md](../ARCHITECTURE.md) - System design overview
- [DEPLOYING.md](../DEPLOYING.md) - Deployment guide
- [contracts/openapi.yaml](../contracts/openapi.yaml) - Full OpenAPI spec
- [observability/METRICS_CATALOG.md](observability/METRICS_CATALOG.md) - Metrics reference
