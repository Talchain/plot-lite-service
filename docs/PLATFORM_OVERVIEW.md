# PLoT Platform – Enterprise-Focused Overview (All Workstreams)

This document provides a platform-wide overview for DevOps: what PLoT is, how it integrates with external services (CEE, ISL), and how UI clients consume the APIs. Includes high-level technical details, integration points, and links to authoritative documentation.

---

## 1. Platform Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              UI Clients                                  │
│         (Browser/Node.js via @olumi/plot-sdk, SSE streams)              │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │ HTTPS (CORS-enabled)
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         PLoT Engine (Core)                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │ /v1/run     │  │ /v1/compare │  │ /v1/stream  │  │ /v1/limits  │    │
│  │ /v1/inspect │  │ /v1/score   │  │ /v1/health  │  │ /metrics    │    │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘    │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Inference Engine (SCM-Lite Monte Carlo) + Trust Layer           │   │
│  │  - D-separation, Identifiability, Meta-reasoning                 │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ CEE (EE)        │    │ ISL             │    │ Prometheus      │
│ Decision Review │    │ Causal Validation│   │ Metrics         │
│ Circuit Breaker │    │ Sensitivity      │    │ Observability   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

---

## 2. PLoT Engine (Core Service)

### Purpose
- **Causal inference backend** that takes a causal DAG + query and returns:
  - Model-based causal effect estimates (conservative/most_likely/optimistic bands)
  - Optional **meta-reasoning** about quality, stability, and trust
- Designed as a **stateless microservice** behind a gateway

### Technology Stack
- Node.js / TypeScript service using **Fastify** HTTP server
- Single containerizable HTTP process
- API contract defined in **OpenAPI 3** (`contracts/openapi.yaml`)

### Core Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/run` | POST | Main inference API |
| `/v1/compare` | POST | Compare multiple graph options |
| `/v1/inspect` | POST | Inspect graph evaluation details |
| `/v1/score` | POST | Score options with utility functions |
| `/v1/intervene` | POST | Causal interventions (do-operator) |
| `/v1/evidence` | POST | Apply reference-class priors |
| `/v1/stream` | GET | SSE streaming (real-time) |
| `/v1/limits` | GET | Service capacity limits (SSOT for SDKs) |
| `/v1/health` | GET | Health & readiness |
| `/metrics` | GET | Prometheus metrics |

---

## 3. CEE (EE) Workstream Integration

**CEE = Causal Explanation Engine** (also referred to as "EE" in some contexts)

### Purpose
Provides decision review and validation for causal inference results:
- Create decision review graphs from run context
- Validate causal relationships in the user's model
- Provide structured feedback on model quality
- Support evidence-based decision making

### Integration Architecture
```
PLoT /v1/run
    │
    ├─► Health probe: GET /healthz
    │
    ├─► Decision Review: POST /assist/v1/decision-review
    │   (or SDK orchestrator with multi-step workflow)
    │
    └─► Fixture fallback: GET /assist/v1/decision-review/example
        (used when CEE is unhealthy or unavailable)
```

### Circuit Breaker
In-memory circuit breaker protects against cascading CEE failures:
- **Closed** (default): Allow all calls
- **Open**: Block calls after N consecutive failures
- **Half-Open**: Single probe allowed, then either close or reopen

### Configuration Variables
| Variable | Default | Description |
|----------|---------|-------------|
| `CEE_ORCHESTRATOR_ENABLE` | `0` | Master gate to enable CEE |
| `CEE_BASE_URL` | (required) | CEE service base URL |
| `CEE_API_KEY` | (required) | API key for authentication |
| `CEE_TIMEOUT_MS` | `2000` | Request timeout (500-30000ms) |
| `CEE_CB_FAILURE_THRESHOLD` | `5` | Failures to open circuit |
| `CEE_CB_COOLDOWN_MS` | `30000` | Cooldown before half-open |

### Activation Gates
CEE is only called when ALL conditions are met:
1. `Idempotency-Key` header present (saved runs only)
2. `CEE_ORCHESTRATOR_ENABLE=1`
3. Both `CEE_BASE_URL` and `CEE_API_KEY` configured
4. `detail_level` is not `quick`
5. Circuit breaker allows call

### Fallback Behavior
Multi-layer graceful degradation:
1. Health probe failure → Try fixture endpoint
2. Decision review POST failure → Fallback to fixture
3. Network/timeout error → Fallback to fixture

### Prometheus Metrics
- `plot_engine_cee_attempted_total` – CEE attempts
- `plot_engine_cee_ok_total` – Successful reviews
- `plot_engine_cee_skipped_total` – Skipped (with reason label)
- `plot_engine_cee_degraded_total` – Degraded (with code label)

### Key Files
| File | Purpose |
|------|---------|
| `src/cee/client.ts` | HTTP client with fallback logic |
| `src/cee/circuit-breaker.ts` | Circuit breaker implementation |
| `src/cee/codes.ts` | Error code normalization |
| `tests/cee-circuit-breaker.test.ts` | Circuit breaker tests |
| `tests/cee.integration.test.ts` | Integration tests |

---

## 4. ISL Workstream Integration

**ISL = Inference Service Layer**

### Purpose
Optional external service for enhanced causal validation and sensitivity analysis:
- Validate causal identifiability
- Analyze parameter sensitivity
- Compute counterfactual estimates

### Integration Architecture
```
PLoT /v1/run (after SCM-Lite Monte Carlo)
    │
    ├─► Validate: POST /api/v1/causal/validate
    │
    ├─► Sensitivity: POST /api/v1/causal/sensitivity/detailed
    │   (only when detail_level=deep)
    │
    └─► Health: GET /health (5s timeout, hardcoded)
```

### Conditional Activation
- ISL calls happen **after** SCM-Lite Monte Carlo simulation
- Only called when `ISL_ENABLE=1` AND `detail_level != 'quick'`
- Sensitivity analysis only runs on `detail_level === 'deep'`
- Calls are **non-blocking** with graceful fallback on failure

### Configuration Variables
| Variable | Default | Description |
|----------|---------|-------------|
| `ISL_ENABLE` | `0` | Enable/disable ISL integration |
| `ISL_BASE_URL` | (required) | Base URL for ISL service |
| `ISL_API_KEY` | (required) | API key for authentication |
| `ISL_TIMEOUT_MS` | `15000` | Request timeout (15s default) |
| `ISL_MAX_RETRIES` | `3` | Maximum retry attempts |

### Retry Strategy
- **Exponential backoff**: 1s, 2s, 4s (capped at 5s)
- **Max retries**: 3 by default
- **Retryable errors**: 5xx, 429, network errors, timeouts
- **Worst-case latency**: 15s × 3 + backoff = ~45 seconds

### Error Classes
- `ISLHttpError` – HTTP errors with status codes
- `ISLTimeoutError` – Request timeout
- `ISLNetworkError` – Network-level failures
- `ISLUnavailableError` – Service unavailable

### Prometheus Metrics
- `plot_engine_isl_validation_total` – Validation call counts
- `plot_engine_isl_sensitivity_total` – Sensitivity call counts
- `plot_engine_isl_latency_seconds` – Latency histogram

### Key Files
| File | Purpose |
|------|---------|
| `src/integrations/isl/client.ts` | HTTP client with retry/timeout |
| `src/integrations/isl/index.ts` | Service wrapper |
| `src/integrations/isl/errors.ts` | Custom error classes |
| `src/integrations/isl/adapters/` | Response transformers |
| `tests/isl-circuit-breaker.test.ts` | Circuit breaker tests |

---

## 5. UI Workstream Integration

### SDK Package
**Package**: `@olumi/plot-sdk` (v0.4.0)
**Location**: `packages/olumi-plot-sdk/`
**Environments**: Node.js and browsers (browser-safe with fallbacks)

### SDK Methods
| Method | Purpose |
|--------|---------|
| `limits()` | Get service capacity limits |
| `run()` | Execute inference on graph |
| `compare()` | Compare multiple graph options |
| `inspect()` | Inspect graph evaluation details |
| `score()` | Score options with utility functions |
| `intervene()` | Causal interventions (do-operator) |
| `evidence()` | Apply reference-class priors |
| `runBatch()` | Batch processing (up to 10 items) |
| `optimise()` | Budget-constrained optimization |

### Browser Safety Features
- Auto-generates UUID-based request IDs via `crypto.randomUUID()`
- Skips User-Agent header in browsers (CORS restriction)
- Auto-retries on 429 with exponential backoff using Retry-After header
- Headers: `x-olumi-sdk`, `X-Request-Id`, `Idempotency-Key`

### SSE Streaming
**Endpoint**: `GET /v1/stream`
- Server-sent events with demo-first semantics
- Bounded event queue (max 100 events)
- Heartbeat support (configurable via `SSE_HEARTBEAT_MS`)
- Backpressure handling with drain events

### CORS Configuration
**Environment Variables**:
- `CORS_ORIGINS` – Comma-separated allowed origins
- `CORS_DEV=1` – Allow wildcard `*` in development

**Allowed Methods**: `GET`, `POST`, `OPTIONS`, `HEAD`

**Exposed Headers**:
```
Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining,
X-RateLimit-Reset, X-Request-Id, X-CEE-Debug, X-Build-Tag
```

### Response Format
```typescript
{
  schema: 'report.v1' | 'run.v1',
  confidence: { level, reason, score },
  results: { conservative, most_likely, optimistic },
  model_card: { seed, determinism_note, response_hash },
  meta: { seed, version, inference_mode },
  // Optional (gated by detail_level):
  sensitivity_summary, graph_quality, insights,
  evidence_analysis, sensitivity_full,
  // Optional (model_of_inference mode):
  meta_reasoning: { quality_assessment, diagnostics, reliability }
}
```

### Key Files
| File | Purpose |
|------|---------|
| `packages/olumi-plot-sdk/src/index.ts` | Main SDK exports |
| `packages/olumi-plot-sdk/src/http.ts` | HTTP layer |
| `src/routes/v1/stream.ts` | SSE endpoint |
| `src/lib/corsParser.ts` | CORS configuration |
| `docs/ui-integration.md` | UI integration guide |
| `docs/UI_Handoff_PLoT_v1.md` | Debug features doc |

---

## 6. Runtime & Timeout Budgets

### Timeout Hierarchy
```
Netlify Proxy: 26s (hard limit)
    │
    ├─► Server Request: 60s (REQUEST_TIMEOUT_MS)
    │
    ├─► ISL: 15s × 3 retries = 45s worst-case
    │
    ├─► CEE: 2s default (CEE_TIMEOUT_MS)
    │
    └─► Compute: 10s default (MAX_COMPUTE_MS)
```

**Boot-time validation**: Combined ISL + CEE + compute timeouts are validated against proxy budget to avoid misconfiguration.

### Resource Controls
- **Body size limit**: 96 KiB
- **Graph size limits**: Exposed via `/v1/limits`
- **Rate limiting**: In-service + gateway-level
- **Idempotency cache**: Bounded (`MAX_IDEM_ENTRIES`)

---

## 7. Observability & Diagnostics

### Prometheus Metrics
Exposed at `/metrics` (requires `PROMETHEUS_ENABLE=1`):

**Core Metrics**:
- Request/response counts and latencies per route
- Error classifications and validation failures

**Meta-Reasoning Metrics**:
- `plot_engine_meta_quality_score` – histogram (0-1)
- `plot_engine_meta_confidence_total` – by level (HIGH/MEDIUM/LOW)
- `plot_engine_meta_stability_total` – by stability
- `plot_engine_meta_convergence_total` – by status

**External Service Metrics**:
- CEE: `cee_attempted`, `cee_ok`, `cee_skipped`, `cee_degraded`
- ISL: `isl_validation_total`, `isl_sensitivity_total`, `isl_latency_seconds`

### Logging
- Structured logging via Fastify's logger
- Correlation IDs and request context propagated
- No payload logging in production (security guard)

---

## 8. Key Configuration Variables (Complete)

### Core Service
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 4311 | Server port |
| `AUTH_ENABLED` | 0 | Enable bearer token auth |
| `RATE_LIMIT_ENABLED` | 1 | Enable rate limiting |
| `REQUEST_TIMEOUT_MS` | 60000 | Server request timeout |
| `PROMETHEUS_ENABLE` | 0 | Enable Prometheus metrics |
| `TEST_ROUTES` | 0 | Enable test-only routes |

### CEE Integration
| Variable | Default | Description |
|----------|---------|-------------|
| `CEE_ORCHESTRATOR_ENABLE` | 0 | Enable CEE integration |
| `CEE_BASE_URL` | - | CEE service URL |
| `CEE_API_KEY` | - | CEE API key |
| `CEE_TIMEOUT_MS` | 2000 | Request timeout |
| `CEE_CB_FAILURE_THRESHOLD` | 5 | Circuit breaker threshold |
| `CEE_CB_COOLDOWN_MS` | 30000 | Circuit breaker cooldown |

### ISL Integration
| Variable | Default | Description |
|----------|---------|-------------|
| `ISL_ENABLE` | 0 | Enable ISL integration |
| `ISL_BASE_URL` | - | ISL service URL |
| `ISL_API_KEY` | - | ISL API key |
| `ISL_TIMEOUT_MS` | 15000 | Request timeout |
| `ISL_MAX_RETRIES` | 3 | Retry attempts |

### UI/CORS
| Variable | Default | Description |
|----------|---------|-------------|
| `CORS_ORIGINS` | localhost:5173 | Allowed origins |
| `CORS_DEV` | 0 | Allow wildcard in dev |
| `SSE_HEARTBEAT_MS` | 30000 | SSE heartbeat interval |

---

## 9. Documents by Workstream

### All Workstreams
- `README.md` – Project overview
- `ARCHITECTURE.md` – System architecture
- `contracts/openapi.yaml` – **Authoritative API contract**
- `CONTRIBUTING.md` – Coding standards
- `DEPLOYING.md` – Deployment procedures
- `RELEASING.md` – Release process

### CEE (EE) Workstream
- `src/cee/` – Implementation
- `tests/cee-circuit-breaker.test.ts` – Circuit breaker tests
- `tests/cee.integration.test.ts` – Integration tests
- `WINDSURF_CEE_COMPLETION_REPORT.md` – Integration summary

### ISL Workstream
- `src/integrations/isl/` – Implementation
- `tests/isl-circuit-breaker.test.ts` – Circuit breaker tests
- `tests/run.isl-critique.integration.test.ts` – ISL integration tests
- `ARCHITECTURE.md` (ISL section) – Timeout budgets

### UI Workstream
- `packages/olumi-plot-sdk/` – SDK package
- `packages/olumi-plot-sdk/README.md` – SDK documentation
- `packages/olumi-plot-sdk/examples/` – Usage examples
- `docs/ui-integration.md` – Integration guide
- `docs/UI_Handoff_PLoT_v1.md` – Debug features

### Observability & SRE
- `docs/ALERT_RUNBOOK.md` – Alert runbook
- `docs/observability/METRICS_CATALOG.md` – Metrics catalog
- `docs/observability/PROMETHEUS_QUERIES.md` – Example queries
- `docs/STATUS.md` – Current production state

### Assessments & Reports
- `docs/reports/COMPREHENSIVE_ASSESSMENT.md`
- `docs/reports/AUDIT_REPORT.md`
- `docs/reports/RELEASE_NOTES_v2.1.md`

---

## 10. Reproducibility & Determinism

### Seed Handling

PLoT V2 provides deterministic results through seed management:

| Scenario | Behaviour | Reproducibility |
|----------|-----------|-----------------|
| Seed provided | Uses provided seed directly | ✅ Guaranteed |
| Seed omitted | Derives from graph hash | ✅ Same graph = same seed |

**How it works:**
- When a seed is provided in the request, it's used directly for Monte Carlo simulation
- When no seed is provided, a deterministic seed is derived from the canonical hash of the normalized graph
- The same graph structure always produces the same derived seed, ensuring consistent results

**Best Practice:** For audit trails and replay capability, either:
1. Provide explicit seed in request, OR
2. Persist `seed_used` from response for future replay

### Response Hash

The `response_hash` field provides semantic fingerprinting:
- Computed from canonical request representation (semantic fields only)
- Includes: seed, graph structure, options, goal_node_id
- Excludes: labels, descriptions, non-semantic metadata
- Identical requests (same graph + same seed) produce identical hashes
- Use for caching and deduplication

### Determinism Contract

Given the same:
- Graph structure (nodes, edges, strengths, probabilities)
- Seed (explicit or derived)
- Options (intervention bundles)
- Goal node

PLoT guarantees identical:
- Monte Carlo samples
- Inference results
- Response hash

**Key files:**
- `src/routes/v2/run.ts` – seed resolution (`resolveSeed()`)
- `src/sampling/graph-hash.ts` – graph hashing and seed derivation
- `src/normalisation/canonicalise.ts` – response hash computation

---

## Summary

The PLoT platform is a **well-bounded causal inference service** with:

- **Core Engine**: Fastify/TypeScript inference service with strict contracts
- **CEE Integration**: Decision review with circuit breaker and graceful degradation
- **ISL Integration**: Optional causal validation with retry logic
- **UI Support**: Browser-safe SDK, SSE streaming, CORS-enabled APIs

All integrations are **optional and fail-safe** – the core engine operates independently when external services are unavailable.
