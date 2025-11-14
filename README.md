# PLoT-lite deterministic fixtures service

[![Nightly Evidence Pack](https://github.com/Talchain/plot-lite-service/actions/workflows/nightly-evidence-pack.yml/badge.svg)](https://github.com/Talchain/plot-lite-service/actions/workflows/nightly-evidence-pack.yml)

See engine contracts, gating, determinism & Evidence Pack in `docs/engine.md`.

Small, deterministic Fastify + TypeScript service for PLoT-lite. No AI calls. Privacy: never log parse_text.

## Requirements
- Node 20 LTS

### Toolchain

We pin to Node 20 LTS and npm 10 for deterministic installs and to avoid tooling incompatibilities on newer Node majors.

Setup:

```
nvm use
npm ci --no-fund --no-audit
```

### 90-second quickstart

```
# Ensure Node 20 LTS
nvm use
npm ci --no-audit --no-fund

# Quick sanity
npm run diag

# Start (new shell)
npm run build && npm start &
BASE=http://127.0.0.1:4311

# 200 + ETag → 304 (determinism)
curl -s "$BASE/draft-flows?template=pricing_change&seed=101" -D 200.h -o 200.json
ET=$(awk 'tolower($1)=="etag:"{print $2}' 200.h | tr -d '\r')
curl -s -i -H "If-None-Match: $ET" "$BASE/draft-flows?template=pricing_change&seed=101" -D 304.h -o /dev/null

# HEAD parity
curl -s -I "$BASE/draft-flows?template=pricing_change&seed=101" -D head-200.h >/dev/null

# Stream canary (flag-gated)
FEATURE_STREAM=1 STREAM_HEARTBEAT_SEC=2 curl -Ns --max-time 5 "$BASE/stream" | head -n 10
```


## Install

```
npm i
```

## Develop

```
npm run dev
```

Server listens on http://localhost:4311

- [STATUS.md](./docs/STATUS.md) — Replay telemetry quick reference

## Build and start (production)

```
npm run build
npm start
```

### Deploying

- **Auth in prod**: set `AUTH_ENABLED=1` and configure `AUTH_TOKEN`. Demo bypass is disabled by policy in production environments.
- **Demo mode (test only)**: `?demo=1` or `X-Demo: 1` is intended for tests and local smoke only. In prod, disable at ingress by stripping `?demo=1` and `X-Demo` headers.
- **SSE proxies**: ensure no buffering at proxies/CDN:
  - Forward headers: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, `Connection: keep-alive`.
  - Avoid response buffering/compression for SSE paths.
- **TTFF/flush**: the stream route flushes a first frame immediately to optimise TTFF. Gate tooling measures TTFF in SLOs and GitHub Step Summary.

## Deployments via Render

**Auto-deploy from GitHub** using Render Blueprint (`render.yaml`):

- **Staging** (`plot-lite-service-staging`): Auto-deploys on every merge to `main`
- **Production** (`plot-lite-service`): Manual deploy only (safer)

### Quick Start

1. **One-time setup**: Connect repo in [Render Dashboard](https://dashboard.render.com/) → New → Blueprint
2. **Every deploy**: Merge to `main` → Staging auto-deploys in ~2-3 minutes
3. **Health check**: `https://plot-lite-service-staging.onrender.com/v1/health`
4. **Feature flag**: `SCM_LITE_ENABLE` (default `0`; enable after validation)

### Validation

```bash
# Set staging URL and auth token
export PLOT_STAGING_URL=https://plot-lite-service-staging.onrender.com
export AUTH_TOKEN=<your-token>

# Run smoke test (health + determinism)
npm run smoke:staging
```

**See [docs/RENDER_SETUP.md](./docs/RENDER_SETUP.md) for complete setup guide.**

## Replay fixtures (determinism harness)

Ensure the server is running, then:

```
node tools/replay-fixtures.js
```

Expected output:

```
All fixtures match (1 case).
```

## Example curl

```
curl -s http://localhost:4311/health
curl -s http://localhost:4311/version
curl -s -X POST http://localhost:4311/draft-flows \
  -H 'Content-Type: application/json' \
  -d @fixtures/deterministic-fixtures.json | head
```

## Privacy and limits
- Never log parse_text or any request body contents.
- Structured logs only: request id, route, status, duration.
- JSON body limit: 128 KiB.
- Request timeout: 5 seconds.

## Rate limiting

When enabled (default), per-IP requests are limited per minute.
- Headers on successful requests: X-RateLimit-Limit and X-RateLimit-Remaining
- When limited (HTTP 429): Retry-After (seconds) is returned
- /health includes rate_limit: { enabled, rpm, last5m_429 }

Exemptions: GET /ready, GET /health, and GET /version are not rate-limited.

## Environment

- PORT: service port (default 4311)
- RATE_LIMIT_ENABLED: enable per-IP rate limiting (default on; set 0 to disable)
- RATE_LIMIT_RPM: requests per minute per IP (default 60)
- REQUEST_TIMEOUT_MS: request timeout in milliseconds (default 5000)
- TRUST_PROXY: if 1, trust X-Forwarded-* headers from a front proxy (add-only; default off)
- CORS_DEV: if 1, enable CORS for http://localhost:5173 (dev only)

## Endpoints

- GET /ready → { ok } (200 when server is ready)
- GET /live → { ok } (always 200 while process is up)
- GET /health → {
  status,
  p95_ms,
  replay: { lastStatus, refusals, retries, lastTs },
  test_routes_enabled: boolean,
  ...small runtime and cache fields (total payload ≤ 4 KB)
}
- GET /version → { api: "warp/0.1.0", model: "plot-lite-<hash>", build: "<git-sha-or-stamp>" }
- GET /draft-flows?template=<pricing_change|feature_launch|build_vs_buy>&seed=<int>&budget=<int>
  - PoC contract for deterministic UI integration; see docs/ui-integration.md
  - Serves fixture bytes verbatim from disk with headers:
    - Content-Type: application/json
    - Content-Length: <bytes>
    - Cache-Control: no-cache
    - ETag: "<sha256-hex>"
    - Returns 304 Not Modified when If-None-Match matches the strong ETag
- POST /draft-flows → legacy route; unchanged for compatibility; supports Idempotency-Key
- POST /critique → deterministic rules (no AI); Ajv-validated parse_json body
- POST /improve → echoes parse_json and returns { fix_applied: [] }


## UI Integration

### Endpoint Availability Probe
Use `HEAD /v1/run` to verify endpoint availability before making POST requests:
```bash
curl -I https://plot-lite-service.onrender.com/v1/run
# Returns: HTTP/2 204 (no body)
```

### Request Size Limits
Check `/v1/limits` for current configuration:
```bash
curl https://plot-lite-service.onrender.com/v1/limits
# Returns: { "schema": "limits.v1", "max_nodes": 50, "max_edges": 200, "max_body_kb": 96 }
```

**Important:** Requests exceeding 96 KB will receive `413 Payload Too Large`.
Structure your graph payloads to stay under this limit.

### Rate Limiting & 429 Responses
The API enforces per-IP rate limits (default: 60 requests/minute).
When rate-limited, you'll receive a `429 Too Many Requests` response with:

- `Retry-After`: Seconds to wait before retrying
- `X-RateLimit-Limit`: Maximum requests per minute
- `X-RateLimit-Remaining`: Requests remaining in current window
- `X-RateLimit-Reset`: Unix timestamp when limit resets

**UX Recommendation:** Display a user-friendly message with the retry delay:
```javascript
if (response.status === 429) {
  const retryAfter = response.headers.get('Retry-After');
  showMessage(`Rate limit exceeded. Please wait ${retryAfter} seconds.`);
}
```

### CORS Configuration
The API allows requests from:
- `https://olumi.netlify.app`
- `http://localhost:5173` (development)

Exposed headers include rate-limit information and `X-SCM-Lite` feature flag.

### Payload Construction
**Client-Side Guard:** Before sending requests, verify payload size:
```javascript
const payload = JSON.stringify({ graph, seed });
const sizeKB = new Blob([payload]).size / 1024;

if (sizeKB > 96) {
  showError(`Payload too large: ${sizeKB.toFixed(1)} KB (max: 96 KB)`);
  return;
}
```

**Graph Limits:**
- Maximum nodes: 50
- Maximum edges: 200
- Enforce these limits in your UI before submission

### SCM-Lite Feature Flag (Optional)
Enable lightweight causal inference mode with `x-scm-lite: 1` header:
```javascript
fetch('https://plot-lite-service.onrender.com/v1/run', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-scm-lite': '1'  // Optional: enable SCM-Lite mode
  },
  body: JSON.stringify({ graph, seed: 4242 })
});
```

**SCM-Lite Benefits:**
- Faster inference for smaller graphs
- Deterministic results with same seed
- Returns `report.v1` schema with summary bands

### Compare & Inspect Endpoints

#### POST /v1/compare
Compare 2-5 graph options with percentile metrics and deltas:
```javascript
fetch('https://plot-lite-service.onrender.com/v1/compare', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    graphs: [
      { graph: { nodes: [...], edges: [...] }, label: 'Option A' },
      { graph: { nodes: [...], edges: [...] }, label: 'Option B' }
    ],
    seed: 4242
  })
});
```

**Returns:**
- Schema: `compare.v1`
- Baseline: First graph label
- Options: Array with p10/p50/p90 metrics, top drivers, and deltas vs baseline
- Deterministic with same seed

#### POST /v1/inspect
Introspect graph evaluation details (beliefs, weights, provenance):
```javascript
fetch('https://plot-lite-service.onrender.com/v1/inspect', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    graph: { nodes: [...], edges: [...] },
    seed: 4242
  })
});
```

**Returns:**
- Schema: `inspect.v1`
- Explain: Top drivers, edge drivers, assumptions, active flags
- Provenance: Inference mode and sample count
- Hashes: Response hash and (if SCM-Lite enabled) BMA hash

**Client Tips:**
- Read `/v1/limits` at startup to enforce size constraints (96 KB) client-side
- Honor `Retry-After` on 429; show a polite UX delay
- Include `X-Request-Id` for correlation; server echoes it back

### New Endpoints (v1.5.0+)

#### POST /v1/intervene - Causal Interventions (Do-Operator)
Perform causal interventions and estimate counterfactual effects:
```javascript
fetch('https://plot-lite-service.onrender.com/v1/intervene', {
  method: 'POST',
  headers: { 
    'Content-Type': 'application/json',
    'X-Request-Id': crypto.randomUUID() // For request correlation
  },
  body: JSON.stringify({
    graph: { nodes: [...], edges: [...] },
    actions: [{ node_id: 'Price', value: 0.8 }],
    seed: 4242
  })
});
```

**Legacy:** `do[]` is accepted for backwards compatibility (use `actions[]` for new code).

**Returns:**
- Schema: `intervene.v1`
- Baseline: Observational outcome
- Counterfactual: Post-intervention outcome
- Delta: Effect size with p10/p50/p90
- Identifiability: Causal identifiability check
- Deterministic with same seed

**Limits:**
- Max nodes: 50
- Max edges: 200
- Max payload: 96 KB
- Performance: p95 ≤ 600ms

#### POST /v1/optimise - Action Selection Under Budget
Select optimal actions under budget to maximize utility:
```javascript
fetch('https://plot-lite-service.onrender.com/v1/optimise', {
  method: 'POST',
  headers: { 
    'Content-Type': 'application/json',
    'X-Request-Id': crypto.randomUUID()
  },
  body: JSON.stringify({
    graph: { nodes: [...], edges: [...] },
    budget: 100,
    actions: [
      { id: 'discount', cost: 50, do: [{ node_id: 'Price', set_to: 0.7 }] },
      { id: 'marketing', cost: 80, do: [{ node_id: 'Demand', set_to: 0.9 }] }
    ],
    objective: {
      type: 'utility_linear',
      weights: { Revenue: 1.0 }
    },
    seed: 4242
  })
});
```

**Returns:**
- Schema: `optimise.v1`
- Selected: Array of action IDs chosen
- Utility: Expected utility with p10/p50/p90
- Explanations: Marginal gain per action
- Deterministic with same seed

**Action Format:**
- `id`: Unique action identifier
- `cost`: Non-negative cost
- `do`: Array of interventions (node_id, set_to)

**Objective:**
- `type`: Currently only `utility_linear` supported
- `weights`: Node weights for utility calculation

**Limits:**
- Max nodes: 50
- Max edges: 200
- Max payload: 96 KB
- Performance: p95 ≤ 800ms

#### POST /v1/run_bundle - Scenario Bundles
Efficiently evaluate multiple scenarios from a base graph:
```javascript
fetch('https://plot-lite-service.onrender.com/v1/run_bundle', {
  method: 'POST',
  headers: { 
    'Content-Type': 'application/json',
    'X-Request-Id': crypto.randomUUID()
  },
  body: JSON.stringify({
    base_graph: { nodes: [...], edges: [...] },
    deltas: [
      { label: 'Low Price', nodes: [{ id: 'Price', value: 0.3 }] },
      { label: 'High Price', nodes: [{ id: 'Price', value: 0.8 }] }
    ],
    seed: 4242
  })
});
```

**Returns:**
- Schema: `run_bundle.v1`
- Results: Array of scenario outcomes with labels
- Meta: Total scenarios, unique results, deduplication info
- Each result includes p10/p50/p90 summary and response_hash
- Deterministic with same seed

**Limits:**
- Max deltas: 10
- Max nodes (merged): 50
- Max edges (merged): 200
- Max payload: 96 KB
- Performance: p95 ≤ 700ms

**Delta Merging:**
- Deltas override or add nodes to base graph
- If delta specifies edges, they replace base edges; otherwise base edges are used
- Server validates merged graph against limits

### Request Correlation
All endpoints support `X-Request-Id` header for request tracking:
```javascript
const requestId = crypto.randomUUID();
const response = await fetch(url, {
  headers: { 'X-Request-Id': requestId }
});
console.log(response.headers.get('x-request-id')); // Echoed back
```

Use this for:
- Debugging failed requests
- Correlating client-side and server-side logs
- Tracking requests across retries

### Replay telemetry (tests & local runs)

GET /health includes a compact replay section that reflects the most recent replay activity:

```
{
  "replay": {
    "lastStatus": "ok",
    "refusals": 0,
    "retries": 3,
    "lastTs": "2025-09-25T12:34:56.789Z"
  }
}
```

| Field     | Type             | Example                       | Meaning                                  |
| ---       | ---              | ---                           | ---                                      |
| lastStatus| "ok"             | ok                            | Final outcome of last replay run         |
| refusals  | number           | 0                             | Count of connection refusals encountered during replay |
| retries   | number           | 3                             | Count of retry attempts made during replay |
| lastTs    | ISO 8601 string  | 2025-09-25T10:15:42.123Z      | Timestamp when replay status last updated |

- Meaning
  - lastStatus: outcome of the last replayed flow (ok or fail)
  - refusals: count of connection refusals observed by the replay harness
  - retries: retry attempts made by the replay harness
  - lastTs: ISO timestamp of the last update

- Test-only endpoints
  - GET /internal/replay-status → same replay object (200 only in test mode)
  - POST /internal/replay-report → increments counters (test mode only)

Test mode is enabled when TEST_ROUTES=1 (set by the test server helper). In production these endpoints return 404.

## Determinism

- Responses from /draft-flows are pre-serialised from fixtures; byte-for-byte equality is enforced by tools/replay-fixtures.js across all cases.
- Unit tests ensure ordering and deterministic critique rule outputs.

## Idempotency-Key

Optional header to safely replay identical POST responses for 10 minutes without recomputation.

- Cache key = sha256(canonical(JSON body)) + the Idempotency-Key header value
- Same body + same key → exact previous response bytes returned
- Same key + different body → 400 BAD_INPUT with a hint to use a new key or the exact same body
- No key → normal behaviour

Examples:

```
# Replay identical /draft-flows response for 10 minutes
curl -s -X POST http://localhost:4311/draft-flows \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: abc-123' \
  -d '{"fixture_case":"price-rise-15pct-enGB","seed":42}'

# Replay /critique response
curl -s -X POST http://localhost:4311/critique \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: abc-123' \
  -d @fixtures/deterministic-fixtures.json
```

## Loadcheck

The loadcheck uses a programmatic probe that waits for readiness and avoids external binaries:
- Readiness: polls GET /ready (fallback /health) until 200 (15s timeout)
- Probe: uses autocannon’s programmatic API when available; otherwise falls back to a pure undici loop
- Artefacts: writes JSON and NDJSON to reports/warp/
- Strict mode (CI): fails if the probe errors or p95_ms is missing or exceeds budget

See docs/ui-integration.md for UI usage details.

Run locally (targets GET /draft-flows):

```
npm run build
npm start &
sleep 1
node tools/loadcheck-wrap.cjs
```

- Writes reports/warp/loadcheck.json and appends to reports/warp/loadcheck.ndjson
- Default budget is ${P95_BUDGET_MS:-600}; STRICT_LOADCHECK=1 enforces non-zero exit on probe error or budget breach

## Versioning

Fixtures versioning: Each deterministic GET fixture contains meta.fixtures_version and meta.template. Any schema/key change requires a fixtures_version minor bump (e.g., 1.0.0 → 1.1.0). Clients should treat fixtures_version as a golden contract version.

Schema: see docs/schema/report.v1.json for the minimal contract enforced in tests.
Error types: see docs/engine/error-codes.md.
UI guide: see docs/ui-integration.md for deterministic usage and headers.

See RELEASING.md for the release checklist and tagging guidance.

## Releases

- Conventional commits enforced via commitlint (local hooks via husky; optional in CI).
- Generate CHANGELOG.md and tags with:
  - Patch: npm run release
  - Minor: npm run release:minor
  - Major: npm run release:major
- A Release workflow runs on tags (vX.Y.Z), builds/tests, and attaches artefacts (tests.json, Postman collection, contract report) to the GitHub Release.
- Release Drafter auto-drafts notes on PR merges.

## For Windsurf

- Base URL: http://localhost:4311
- Endpoints:
  - GET /health → { status, p95_ms, replay, test_routes_enabled } (≤ 4 KB)
  - GET /version → { api: "warp/0.1.0", build, model: "plot-lite-<hash>" }
  - GET /ready → { ok } (200 once fixtures are preloaded)
  - GET /draft-flows → responses are byte-identical to files under fixtures/<template>/<seed>.json; headers include Content-Length, Cache-Control: no-cache, and ETag; supports 304 via If-None-Match
  - POST /draft-flows → legacy deterministic response (unchanged for compatibility)
  - POST /critique → fixed, deterministic list (see above)
  - POST /improve → echoes parse_json and returns { fix_applied: [] }
- Example first call:

```
curl -s -X POST http://localhost:4311/draft-flows \
  -H 'Content-Type: application/json' \
  -d @fixtures/deterministic-fixtures.json | jq '.drafts[0].id'
```

- Edge proxy: proxy /plot-lite/* → http://localhost:4311/*

## Overnight log

- 2025-09-21 01:00 BST: Initial Slice A scaffold with Fastify + TS; endpoints implemented; determinism harness; threshold utility; tests green.
- 2025-09-21 01:05 BST: Added p95 timers, strict structured logs, and optional per-IP rate limit (default on; disable with RATE_LIMIT_ENABLED=0). Tests green.
- 2025-09-21 01:10 BST: Added typed error responses; BAD_INPUT for /improve when parse_json missing. Tests green.
- 2025-09-21 01:12 BST: Added OpenAPI lightweight validator to test runner (skips if spec absent). Tests green.
- 2025-09-21 01:14 BST: Discovered and copied contract files from DecisionGuideAI origin/feat/plot-lite-contract → openapi/docs/schemas. Tests green.
- 2025-09-21 10:15 BST: Loadcheck run → p95_ms=0, max_ms=46, rps=27403.2. Tests green. TODO: verify stability under sustained runs; current numbers are well below the 600 ms target.
- 2025-09-21 12:25 BST: Loadcheck run → p95_ms=0, max_ms=132, rps=17193.6. Ran with RATE_LIMIT_ENABLED=0 against /draft-flows; target p95 ≤ 600 ms.
- 2025-09-21 12:44 BST: Phase 11 docs → Added Idempotency-Key usage section with curl examples; cache TTL 10 minutes; tests remain green.
- 2025-09-21 12:49 BST: Phase 12 → Added X-RateLimit-* on 2xx and Retry-After on 429; /health now reports { enabled, rpm, last5m_429 }. Exempted GET /ready,/health,/version from limiting. Tests green.
- 2025-09-21 12:50 BST: Phase 13 → Added docker-compose with app healthcheck and tests service; `docker compose up --build` brings service healthy and runs tests.
- 2025-09-21 12:52 BST: Phase 14 → Added GitHub Actions workflow with Node 18/20 matrix, npm cache, and artefact uploads (reports/tests.json, Postman collection, contract report). Tests green.
- 2025-09-21 13:41 BST: Slice A → Added smoke script and npm aliases (replay/loadcheck); tests green.
- 2025-09-21 13:43 BST: Slice B → Added offline OpenAPI schema validation for fixtures and critique samples (dev-time). Tests green.
- 2025-09-21 16:20 BST: Slice C → Release hygiene: conventional commits (commitlint + husky), standard-version release scripts, Release Drafter, PR template, CODEOWNERS, release workflow with artefacts. Tests green.
- 2025-09-21 16:35 BST: Slice D → Resilience niceties: enriched /health (runtime, p99, caches), X-Request-ID header, /live, optional /ops/snapshot, improved timeout mapping, graceful shutdown. Tests green.

## Optional Docker
Minimal Dockerfile included for Node 20:

```
docker build -t plot-lite-service .
docker run --rm -p 4311:4311 plot-lite-service
```

## Docker Compose

Bring up the app and run tests in a separate service:

```
docker compose up --build
```

- The app exposes port 4311 and has a healthcheck on GET /ready.
- The tests service depends on app:healthy and runs `npm test` in the same image.
- Rate limiting is disabled in tests by default (RATE_LIMIT_ENABLED=0).

## CI
This repository runs tests on Node 18 and 20. When a run completes, artefacts include:
- `reports/tests.json` (Vitest JSON)
- `docs/collections/plot-lite.postman.json`
- `docs/contract-report.html`

## Verification & Gates

- **Local prerequisites**:
  - Node 20 LTS, npm 10
  - `zip` (used by `tools/pack-engine.mjs`)
  - Python 3.x (for the optional Python SDK smoke; the gate auto-detects `python3`→`python`)

- **Refresh provenance**: `npm run pack:engine` creates `artifact/engine_pack_*.zip`, updates `artifact/pack/manifest.json:path` to the current zip (relative path), and writes `artifact/pack/checksums.json` with `{ sha256, size }` entries for `manifest.json` and the zip.
- **Run verification block locally**:

  ```bash
  bash -lc 'set -euo pipefail
  npm run -s build || true
  vitout=$(npx vitest run \
    tests/*openapi*test.ts \
    tests/*stream*test.ts \
    tests/*health*test.ts \
    tests/*sdk*test.ts \
    tests/*trace*test.ts \
    --reporter=dot || true)
  printf "%s\n" "$vitout" | grep -E "^[.]+$|FAIL|✖" || true
  npm run -s pack:engine || true
  node tools/openapi-lint-gate.mjs           | sed -n "s/^GATES:.*/&/p"
  node tools/stream-chaos-halfclose-gate.mjs | sed -n "s/^GATES:.*/&/p"
  node tools/ttff-sample-gate.mjs            | sed -n "s/^GATES:.*/&/p"
  node tools/sdk-js-smoke.mjs                | sed -n "s/^GATES:.*/&/p" || true
  node tools/sdk-smoke:python.mjs            | sed -n "s/^GATES:.*/&/p" || true
  node tools/runtime-consistency-gate.mjs    | sed -n "s/^GATES:.*/&/p"
  node tools/health-enrich-gate.mjs          | sed -n "s/^GATES:.*/&/p" || true
  node tools/provenance-gate.mjs             | sed -n "s/^GATES:.*/&/p"
  out=$(node tools/gates-status.mjs); code=$?; printf "%s\n" "$out" | sed -n "s/^GATES:.*/&/p"; echo "aggregator_exit:$code"'
  ```

- **Interpreting `GATES:` lines**:
  - `GATES: PASS — …` indicates the gate passed.
  - `GATES: FAIL — …` includes a short reason; non-zero exit.
  - `GATES: SKIP — …` means the gate is not applicable (e.g., missing optional tool). CI required gates must not SKIP.

- **SDK test quickstart**:
  - JS SDK smoke is covered by `tests/sdk.js.test.ts` and `tools/sdk-js-smoke.mjs`.
  - Python parity smoke can be added similarly (not required for local quickstart).

## Provenance

- The Evidence Pack contains `artifact/pack/manifest.json`, `artifact/pack/checksums.json`, and the built zip `artifact/engine_pack_*.zip` referenced by `manifest.path` (relative to `artifact/pack/`).
- `npm run pack:engine` will:
  - Zip current `artifact/pack/` contents into `artifact/engine_pack_*.zip`.
  - Update `artifact/pack/manifest.json:path` to the current zip.
  - Write `artifact/pack/checksums.json` entries with `{ sha256, size }` for `manifest.json` and the current zip, pruning stale zips.
- The provenance gate validates sha256 and size equality for both files and fails with a precise one-liner.
## CI PR Verify Helper

Run CI sanity + PR status comment locally:

```bash
npm run pr:verify
# or to target a branch explicitly
BRANCH=chore/lockfile-sync-ci BASE_BRANCH=main npm run pr:verify
```

- Only required workflows gate status: `OpenAPI Examples Roundtrip`, `engine-safety`, `tests-smoke`.
- Uses safe jq quoting and avoids Node’s npm \"jq\" shim automatically.

## CI status bot (pr-verify)

- Runs on every PR update and comments a compact summary of required checks.
- Local dev: `npm run pr:verify` uses the same Node script used in CI.
- Required gates: OpenAPI Examples Roundtrip, engine-safety, tests-smoke.

## Deployment Verification

Verify which commit is deployed and that routes are bundled:

### 1. Check Version Fingerprint
```bash
curl https://olumi.netlify.app/version.json
```
Returns:
```json
{
  "commit": "full-sha",
  "short": "short-sha",
  "branch": "main",
  "timestamp": "2025-01-05T10:30:00Z"
}
```

### 2. Check Route Guard
```bash
curl https://olumi.netlify.app/sandbox-v1-ok.txt
```
Returns: `OK`

### 3. Verify Rich UI Route
Open: https://olumi.netlify.app/#/sandbox-v1

**Expected:**
- Header shows commit hash (e.g., `@cc6e4bd`)
- Diagnostics bar shows: `edge: /engine  template: pricing_change  seed: 101`
- Request line shows: `Request: /engine/draft-flows?... • status 200`
- Results cards populate automatically (Conservative, Most Likely, Optimistic)
- Graph renders with nodes/edges
- Debug panel appears if fetch fails (shows raw JSON)

**Console Beacon:**
```javascript
UI_POC_SANDBOX_V1_ENHANCED {
  edge: "/engine",
  template: "pricing_change",
  seed: 101,
  hardcoded: { sandbox: true, sse: true },
  sections: "all"
}
```

### 4. Compare with GitHub
The `short` commit in `/version.json` should match the "Latest commit" shown on:
https://github.com/Talchain/DecisionGuideAI

The `short` commit in `/version.json` should match the "Latest commit" shown on:
https://github.com/Talchain/DecisionGuideAI

## Provenance Tracking

When `PROVENANCE_ENABLE=1`, edges can include optional `provenance_note` field (max 200 chars, alphanumeric + common punctuation). Unique notes are aggregated into `model_card.sources[]` for traceability.

Example:
```json
{
  "edges": [
    { "from": "A", "to": "B", "weight": 0.5, "provenance_note": "Study XYZ 2023" }
  ]
}
```

## Budgets & Adaptive K (flagged)

When `ADAPTIVE_K_ENABLE=1` and the request omits `k_samples`, the service uses a deterministic formula to compute sampling budget:

```
K = clamp(250 + 25×edges + 10×nodes, 250, 1000)
```

**Rationale**: Conservative guardrail that scales with graph complexity while maintaining determinism (same graph structure → same K → same hashes).

The computed K and reason are recorded in `model_card.compute_budget`.


## Governance & Audit Surfaces

PLoT-lite maintains minimal immutable audit surfaces for compliance and debugging without storing sensitive payloads.

### Audit Ring Buffer

Runtime-only in-memory ring buffer (max 100 entries) records:
- `evt`: Event type (score, intervene, evidence, etc.)
- `route`: Endpoint path
- `id`: Request ID
- `seed`: Deterministic seed (if applicable)
- `inference_mode`: Model mode used
- `response_hash`: SHA-256 hash of response (first 16 chars)
- `status`: HTTP status code
- `ts`: ISO timestamp

**No payload bodies or PII are logged** - only hashes and metadata.

### Test-Only Audit Endpoint

When `TEST_ROUTES=1`:
```bash
GET /__audit__/recent?limit=50
```

Returns recent audit events for CI verification. Not available in production.

### Compliance Notes

- Audit events are ephemeral (in-memory only, cleared on restart)
- Response hashes enable cache verification without storing payloads
- Suitable for debugging, performance analysis, and compliance spot-checks
- For persistent audit trails, integrate with external logging systems


