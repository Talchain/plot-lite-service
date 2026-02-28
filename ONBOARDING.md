# PLoT Engine – New Developer Onboarding

## TL;DR for experienced engineers

- **Run it:** `npm ci && npm run build && npm start`, then hit `/v1/health` on the logged port.
- **Main endpoints:** `/v1/run`, `/v1/limits`, `/v1/health`, `/v1/openapi.json`.
- **Key files:** `src/createServer.ts`, `src/routes/v1/run.ts`, `src/middleware/{rate-limit,idempotency}.ts`, `src/cee/client.ts`, `contracts/openapi.yaml`.
- **Limits & CEE:** Limits in `src/config/constants.ts`; CEE gated by `CEE_ORCHESTRATOR_ENABLED` + `Idempotency-Key` and attached after hashing.
- **Next:** Skim `DEPLOYING.md` and the sections below when you need more detail.

This document is a **quick-start guide** for engineers joining the PLoT Engine codebase.
It complements (but does not replace) the deeper design docs in this repo.

---

## 1. Setup & First Run

### 1.1 Prerequisites

- Node.js 20.x (Render uses the version in `.nvmrc`)
- npm 10.x or later
- GitHub access to `Talchain/plot-lite-service`

Optional: `gh` (GitHub CLI) for PRs, `curl` or HTTPie for manual API checks.

### 1.2 Install & build

From the repo root:

```bash
npm ci
npm run build
```

`npm run build` compiles the app (`tsconfig.json`) and tools (`tsconfig.tools.json`).

### 1.3 Run the server

```bash
npm start
```

You should see logs ending with something like:

```text
"msg":"server started","port":10000,
```

Basic health check:

```bash
curl http://127.0.0.1:10000/v1/health
```

Expect `{"status":"ok", ...}` plus counters and version info.

### 1.4 Useful env vars in dev

Most work can be done with defaults, but common toggles are:

- `NODE_ENV=development`
- `RATE_LIMIT_ENABLED=0` – disable rate limiting locally when load-testing.
- `TEST_ROUTES=1` – enable test-only routes (never set in production).
- `CORS_DEV=1` – permissive CORS for local tools.

Render / production-specific configuration is documented in **`DEPLOYING.md`**.

---

## 2. Project Layout (Mental Map)

### 2.1 Entrypoints & server wiring

- `src/main.ts`
  - Node entrypoint used by `npm start` and Render.
  - Handles runtime config reload on `SIGHUP`.
- `src/createServer.ts` / `.js`
  - Creates the Fastify app.
  - Registers middleware (CORS, security headers, rate limit, idempotency, circuit breaker, metrics).
  - Wires all `/v1/*` routes.

### 2.2 HTTP API surface

- `src/routes/v1/`
  - `run.ts` – main inference endpoint (SCM-Lite, CEE integration, limits, idempotency).
  - `limits.ts` – exposes graph/body/rate-limit caps.
  - Other v1 routes: validation, critique, streaming, openapi, health.
- `contracts/openapi.yaml`
  - Source of truth for the public API.
  - Includes CEE fields (`ceeReview`, `ceeTrace`, `ceeError`) and examples.

### 2.3 Engine & trust logic

- `src/inference/` – inference engines, including SCM-Lite.
- `src/trust/`
  - `model-card.ts` – response model card.
  - `confidence.ts` – trust/confidence score.
  - `critique-builder.ts`, `explain-delta.ts`, `linearity.ts`, `identifiability.ts` – supporting analysis.
- `src/governance/cost-estimator.ts` – compute budget enforcement.

### 2.4 Cross‑cutting middleware & config

- `src/middleware/`
  - `rate-limit.ts` – per-IP rate limiter with bounded map, RPM headers, **sanitized 429 logs**.
  - `idempotency.ts` – inflight + replay cache keyed by `Idempotency-Key`.
  - `circuitBreaker.ts` – circuit breaker with metrics.
  - `security-headers.ts` – JSON/SSE-safe security headers.
  - `input-validation.ts` – Ajv schemas, error formatting, idempotency clearing on 4xx.
- `src/config/`
  - `constants.ts` – central limits (nodes/edges/body size).
  - `flags.ts` – feature flags.
  - `runtimeConfig.ts` – runtime RPM and related knobs.

### 2.5 CEE (Causal Event Engine) integration

- `src/cee/types.ts` – CEE payload and error/trace types.
- `src/cee/ceePort.ts` – SDK port shim used by the adapter.
- `src/cee/client.ts` – CEE adapter used by `/v1/run`:
  - Env-driven (`CEE_ORCHESTRATOR_ENABLED`, `CEE_BASE_URL`, `CEE_API_KEY`, `CEE_TIMEOUT_MS`).
  - Uses health probe + fixture fallback.
  - Never throws; returns structured degraded results.

---

## 3. Key Behaviours to Understand

### 3.1 Idempotency & saved runs

- `Idempotency-Key` header marks a request as a saved run.
- `src/middleware/idempotency.ts` manages inflight + cached responses.
- `/v1/run`:
  - Replays cached responses when a prior run with the same key exists.
  - Clears inflight entries on early exits (validation errors, 400/429 from limits, etc.).
  - Only **idempotent runs** (with `Idempotency-Key`) are eligible for CEE review.

### 3.2 CEE decision review flow

- `/v1/run`:
  - Builds the full response object and stamps `result.response_hash` first.
  - If `CEE_ORCHESTRATOR_ENABLED` is on **and** `Idempotency-Key` is present, it calls `callDecisionReviewFromEngine`.
  - Attaches `ceeReview`, `ceeTrace`, `ceeError` **after hashing**, so they do not affect determinism.
- Adapter behaviour (`callDecisionReviewFromEngine`):
  - Disabled flag → immediate degraded result (`CEE_DISABLED`).
  - Missing config → degraded result (`CEE_CONFIG_MISSING`).
  - Health probe failure → optional fixture fallback, still best-effort.

### 3.3 Limits & validation

- Centralised in `src/config/constants.ts`:
  - Max nodes/edges for inference and validation.
  - Body size limits (KB/bytes).
- `/v1/limits` returns these so clients know what the engine will accept.
- `input-validation.ts` and `run.ts` perform schema + domain checks for:
  - Graph structure, priors, evidence, node effects, constraints.

### 3.4 Rate limiting & privacy

- `rate-limit.ts` enforces per-IP RPM with bounded in-memory state.
- Always sets `X-RateLimit-*` headers for JSON routes.
- On 429:
  - Clears inflight idempotency keys so retries don’t bypass the limiter.
  - Logs a **sanitized route** (no query string) to avoid leaking sensitive params.

---

## 4. Working With Tests

### 4.1 Running tests

- Full suite:

```bash
npm test
```

- Single file (Vitest where applicable):

```bash
npx vitest run tests/rate-limit.conformance.test.ts
```

Some tests are quarantined or marked as known-flaky; see `KNOWN_TEST_FAILURES.md`.

### 4.2 Useful test helpers

- `tests/helpers/server.ts` – utilities for spinning up a test server.
- `tests/helpers/env.ts` (or similar) – env management helpers.
- CEE tests:
  - `tests/run.cee-adapter.test.ts` – adapter unit tests.
  - `tests/run.decision-review.integration.test.ts` – `/v1/run` + CEE integration.

---

## 5. Where to Read Next

If you are new to the project, these docs are worth skimming early:

- `README.md` – high-level project description (if present).
- `DEPLOYING.md` – Render / deployment setup and environment variables.
- `contracts/openapi.yaml` – API contracts and examples.
- `COMPREHENSIVE_CODEBASE_REVIEW.md` – deeper architecture + risk notes.
- `WINDSURF_CEE_COMPLETION_REPORT.md` – CEE integration design and tradeoffs.
- `KNOWN_TEST_FAILURES.md` – test stability status.

Use this onboarding doc as your map; the above files provide the details.
