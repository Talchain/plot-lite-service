# Autonomous Sprint Progress: Staging → PoC

**Started**: October 14, 2025, 11:58 PM UTC+1  
**Status**: Task 1/10 Complete

---

## Sprint Overview

Breaking down 10 tasks into small, reviewable PRs. Each PR includes:
- ✅ Code changes (minimal, focused)
- ✅ Tests (unit + integration)
- ✅ Documentation
- ✅ One-paragraph summary

---

## Task Status

### ✅ Task 1: Auth + Version Route + Evidence Pack on Deploy (COMPLETE)

**PR**: `feat/task1-auth-version-evidence`  
**Branch**: https://github.com/Talchain/plot-lite-service/pull/new/feat/task1-auth-version-evidence

**Delivered**:
- Enhanced `/version` route (commit, build_time_iso, flags)
- Auth integration tests (401/403/200 behavior)
- Auth exemptions for `/v1/health` and `/v1/version`
- Enhanced smoke script with version check
- Evidence Pack canonical structure tests
- Golden fixture: `fixtures/run-graph.json`

**Tests**: 8/8 passing ✅  
**Risk**: Minimal (backward compatible, no API drift)

**Summary**: Enhanced /version route to expose commit hash, build time, and feature flags for deployment tracking. Added auth integration tests proving 401/403/200 behavior works correctly. Exempted /v1/health and /v1/version from auth guard (standard practice for observability endpoints). Updated smoke script to validate version endpoint. Added evidence pack structure tests. Risk is minimal: backward compatible, no API drift, all tests passing.

---

### 🔄 Task 2: OpenAPI Docs (/openapi.json + /docs) (IN PROGRESS)

**Goal**: Expose API documentation at `/openapi.json` and `/docs`

**Approach**:
- Use `@fastify/swagger` and `@fastify/swagger-ui`
- Register route schemas for `/v1/run`, `/v1/health`, `/version`
- No contract drift (describe existing API)

**Acceptance**:
- GET `/openapi.json` → 200, valid OpenAPI JSON
- GET `/docs` → 200, Swagger UI
- No runtime changes to request/response

---

### ⏳ Task 3: UI Contract Parity Tests (PENDING)

**Goal**: Validate UI-consumed fields are always present

**Approach**:
- Test `results`, `confidence`, `meta.seed`, `model_card.response_hash/bma_hash`
- Use golden fixture `fixtures/run-graph.json`
- Assert deterministic hash across 5 calls

---

### ⏳ Task 4: Monitoring & Alert Runbook (PENDING)

**Goal**: Rolling p95 threshold logging + runbook

**Approach**:
- Background tick checks `engine_p95_ms_rolling`
- Log warning if > 100ms for 5 consecutive minutes
- Create `docs/ALERT_RUNBOOK.md`

---

### ⏳ Task 5: Test Hardening (Smoke + De-flake) (PENDING)

**Goal**: Enhanced smoke job + de-flake network timing tests

**Approach**:
- Enhance `tools/smoke.mjs` with 3-step validation
- Add manual GH Action for staging smoke
- Replace sleeps with polling utilities

---

### ⏳ Task 6: Confidence Calibration Pass (PENDING)

**Goal**: Deterministic thresholds for LOW/MEDIUM/HIGH badges

**Approach**:
- Define thresholds based on diversity, path_stability, linearity_distance
- No response shape changes
- 3 fixtures (one per badge level)

---

### ⏳ Task 7: Identifiability Tag (PENDING)

**Goal**: Plain English identifiability tag

**Approach**:
- "Decision-ready" vs "Exploratory (reason)"
- Simple backdoor criterion
- Surface tag + reason alongside confidence

---

### ⏳ Task 8: Provenance Hook (PENDING)

**Goal**: Pass-through provenance notes

**Approach**:
- Accept optional `edge.provenance_note?: string`
- Output `model_card.sources?: string[]`
- Include in Evidence Pack

---

### ⏳ Task 9: Adaptive K (Deterministic) (PENDING)

**Goal**: Deterministic K-plan based on graph complexity

**Approach**:
- `K = clamp(250 + 25*edges + 10*nodes, 250, 1000)`
- Same input + seed → same K
- Record in `model_card.compute_budget.k_samples`

---

### ⏳ Task 10: Load Probe & Budget Lock (PENDING)

**Goal**: Light load probe against staging

**Approach**:
- ~25 RPS for ~2 minutes
- Summarize: success rate, p95 client latency
- Write to `evidence/slos.live.json`

---

## Definition of Done (Each Task)

- ✅ Build: `npm run build` clean
- ✅ Tests: new unit/integration tests added; full suite green
- ✅ Gates: 7/7 PASS
- ✅ Performance: p95 ≤ 600ms (12-node ref); staging rolling p95 < 100ms
- ✅ Determinism: 10/10 identical response_hash for fixed seed
- ✅ Docs: updated/added as listed

---

## Guardrails

- ❌ Never change public response schemas
- ✅ All new behavior off by default in production
- ✅ Prefer polling utilities over fixed sleeps
- ✅ Clean up processes/ports after tests
- ✅ Evidence Pack filenames remain canonical

---

**Last Updated**: October 15, 2025, 12:15 AM UTC+1
