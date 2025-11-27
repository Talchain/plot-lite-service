# PLoT Engine Architecture

## Overview

PLoT Engine is a causal inference API service built on Fastify. It provides decision support through graph-based causal models with Monte Carlo simulation, trust signals, and optional external validation via ISL (Inference Service Layer) and CEE (Causal Explanation Engine).

## Deployment Topology

```
┌─────────────┐     ┌─────────────┐     ┌─────────────────┐
│   Web UI    │────▶│  BFF/Proxy  │────▶│  PLoT Engine    │
│ (localhost) │     │  (Netlify)  │     │  (this service) │
└─────────────┘     └─────────────┘     └─────────────────┘
                                               │
                         ┌─────────────────────┼─────────────────────┐
                         ▼                     ▼                     ▼
                   ┌──────────┐          ┌──────────┐          ┌──────────┐
                   │   ISL    │          │   CEE    │          │ Metrics  │
                   │ (opt.)   │          │ (opt.)   │          │ (Prom.)  │
                   └──────────┘          └──────────┘          └──────────┘
```

**Known Timeouts:**
- Netlify proxy: 26s (configurable via `PROXY_TIMEOUT_MS`)
- ISL: 15s default × 3 retries = 45s worst-case
- CEE: 5s default
- Max compute: 10s default

Boot-time validation warns if combined timeout exceeds proxy timeout.

## Directory Structure

```
src/
├── routes/           # HTTP endpoints
│   ├── v1/           # Versioned API routes
│   │   ├── run.ts    # Main inference endpoint
│   │   ├── stream.ts # SSE streaming endpoint
│   │   └── ...       # compare, inspect, counterfactual, etc.
│   ├── ops/          # Operations endpoints (health, metrics)
│   └── test/         # Test-only routes (guarded by TEST_ROUTES)
│
├── middleware/       # Request processing pipeline
│   ├── input-validation.ts   # Ajv schema validation
│   ├── rate-limit.ts         # Token bucket rate limiting
│   ├── idempotency.ts        # Idempotency key handling
│   ├── circuitBreaker.ts     # Circuit breaker for CEE
│   ├── security-headers.ts   # Helmet + custom headers
│   └── demo-mode.ts          # Demo mode bypass
│
├── trust/            # Trust signal computation
│   ├── confidence.ts         # Confidence scoring
│   ├── critique-builder.ts   # Critique generation
│   ├── explain-delta.ts      # Delta explanations
│   ├── evidence-analysis.ts  # Evidence validation
│   ├── graph-quality.ts      # Graph quality metrics
│   ├── insights.ts           # Insight generation
│   ├── sensitivity-*.ts      # Sensitivity analysis
│   └── identifiability.ts    # Causal identifiability
│
├── integrations/     # External service integrations
│   └── isl/          # Inference Service Layer client
│       ├── client.ts         # HTTP client with retry/timeout
│       ├── adapters/         # Response adapters
│       ├── errors.ts         # ISL-specific errors
│       └── types/            # TypeScript types
│
├── cee/              # Causal Explanation Engine
│   ├── client.ts             # CEE HTTP client
│   ├── circuit-breaker.ts    # CEE-specific circuit breaker
│   └── codes.ts              # CEE status codes
│
├── inference/        # Core inference logic
│   ├── model_based.ts        # Model-based inference
│   ├── model_of_inference.ts # Meta-inference
│   └── apply-priors.ts       # Prior application
│
├── scm-lite/         # Structural Causal Model (lightweight)
│   ├── kernel.ts             # Monte Carlo kernel
│   ├── rng.ts                # Seeded RNG
│   └── adapter.ts            # Graph adapter
│
├── config/           # Configuration modules
│   ├── feature-flags.ts      # Feature flag definitions
│   ├── runtimeConfig.ts      # Runtime config loading
│   └── constants.ts          # Static constants
│
├── metrics/          # Observability
│   └── registry.ts           # Prometheus metrics registry
│
├── schemas/          # Response schemas
│   ├── response.ts           # Run response schema
│   └── stream.ts             # SSE event schemas
│
├── lib/              # Shared utilities
│   ├── error-messages.ts     # Error message catalogue
│   ├── BoundedLRU.ts         # LRU cache
│   ├── sensitivity.ts        # Sensitivity computation
│   └── token-principal.ts    # Token-based principal extraction
│
├── util/             # Pure utilities
│   ├── canonical-json.ts     # Deterministic JSON
│   └── normalize.ts          # Normalization helpers
│
├── errors.ts         # Error envelope factory
├── config-validator.ts # Boot-time env validation
└── createServer.ts   # Server factory
```

## Request Lifecycle

```
HTTP Request
     │
     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Fastify Pipeline                                                     │
├─────────────────────────────────────────────────────────────────────┤
│ 1. Security Headers (Helmet, CORS)                                   │
│ 2. Rate Limiting (token bucket, per-IP)                              │
│ 3. Authentication (if AUTH_ENABLED=1)                                │
│ 4. Input Validation (Ajv against OpenAPI schema)                     │
│ 5. Idempotency Check (cache hit → return cached)                     │
└─────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Route Handler (e.g., /v1/run)                                        │
├─────────────────────────────────────────────────────────────────────┤
│ 1. Parse detail_level (quick/standard/deep)                          │
│ 2. Run SCM-Lite Monte Carlo simulation                               │
│ 3. Compute trust signals:                                            │
│    - confidence, critique, explain_delta                             │
│    - evidence_analysis, graph_quality, insights                      │
│    - sensitivity_summary (if detail_level != quick)                  │
│    - sensitivity_full (if detail_level == deep)                      │
│ 4. Optional: ISL validation/sensitivity (if ISL_ENABLE=1)            │
│ 5. Optional: CEE decision review (if enabled + IDK detected)         │
│ 6. Build response with model_card                                    │
└─────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Response                                                             │
├─────────────────────────────────────────────────────────────────────┤
│ - schema: 'run.v1'                                                   │
│ - confidence, critique, explain_delta                                │
│ - model_card (version, seed, response_hash)                          │
│ - Optional: debug slice (if include_debug=true)                      │
│ - Headers: x-request-id, x-plot-request-id                           │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 4311 | Server port |
| `AUTH_ENABLED` | 0 | Enable bearer token auth |
| `RATE_LIMIT_ENABLED` | 1 | Enable rate limiting |
| `ISL_ENABLE` | 0 | Enable ISL integration |
| `CEE_ENABLE` | 0 | Enable CEE integration |
| `PROMETHEUS_ENABLE` | 0 | Enable Prometheus metrics |
| `TEST_ROUTES` | 0 | Enable test-only routes |
| `detail_level` | standard | Default detail level |

## Error Handling

All errors use a uniform envelope:

```json
{
  "schema": "error.v1",
  "code": "BAD_INPUT",
  "error": {
    "type": "BAD_INPUT",
    "message": "Human-readable message"
  },
  "request_id": "uuid"
}
```

Error types: `BAD_INPUT`, `INTERNAL`, `TIMEOUT`, `NOT_FOUND`, `RATE_LIMIT`, `AUTH_REQUIRED`, `FORBIDDEN`

## On-Call Runbook

### `/v1/run` timing out

1. Check `detail_level` - `deep` mode is slower
2. Check `/v1/health` for `engine_p95_ms_rolling`
3. Check ISL health if `ISL_ENABLE=1`
4. Check CEE circuit breaker state in health response
5. Review `PROXY_TIMEOUT_MS` vs actual latencies

### 429 Rate Limit errors

1. Check `RATE_LIMIT_RPM` setting
2. Check `/v1/health` for `rate_limit_bucket_count`
3. If legitimate traffic, increase `RATE_LIMIT_RPM`

### ISL fallback (validation/sensitivity showing `source: engine_fallback`)

1. Check ISL service health
2. Check `ISL_TIMEOUT_MS` and `ISL_MAX_RETRIES`
3. Review ISL metrics: `plot_engine_isl_validation_total`, `plot_engine_isl_latency_seconds`

### CEE degraded

1. Check `x-cee-status` header in response
2. Check CEE circuit breaker state in `/v1/health`
3. Review CEE metrics: `plot_engine_cee_degraded_total`

## Contracts

- OpenAPI spec: `contracts/openapi.yaml`
- Response schemas: `contracts/schemas/`
- Snapshots for contract tests: `contracts/snapshots/`

CI gates validate contract alignment on every PR.
