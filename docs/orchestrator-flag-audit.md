# Orchestrator Flag Audit

**Date:** 2026-03-03
**Brief reference:** D-PLoT H.3
**Purpose:** Document all feature flags related to CEE routing architecture during transition from old proxy architecture (UI → PLoT → CEE) to new orchestrator architecture (UI → CEE → PLoT).

---

## Architecture Context

### Old architecture (deprecated, not in codebase)
UI → PLoT → CEE: PLoT acted as a routing proxy, forwarding UI requests to CEE.

### New architecture (current canonical path)
UI → CEE → PLoT: CEE is the orchestrator. UI talks to CEE directly. CEE calls PLoT for analysis. PLoT returns analysis to CEE. CEE returns enriched response to UI.

**BFF proxy routes** (`/v1/cee/*`) are a **separate concern** — they bypass the Netlify 50s edge function timeout by letting the browser call PLoT instead of Netlify, which then proxies to CEE. This is not architecture routing; it is a networking workaround that remains valid in the new architecture.

---

## Flag Inventory

### 1. `CEE_ORCHESTRATOR_ENABLED`

| Field | Value |
|-------|-------|
| **Env var** | `CEE_ORCHESTRATOR_ENABLED` |
| **Default** | `false` (must be explicitly set to `1`) |
| **Staging** | NOT SET in render.yaml — disabled by default |
| **Production** | NOT SET in render.yaml — disabled by default |

**Files:**

| File | Lines | Role |
|------|-------|------|
| `src/config/flags.ts` | 68–71 | Flag definition |
| `src/config/feature-flags.ts` | 48 | KNOWN_FEATURE_FLAGS registry |
| `src/routes/v1/run.ts` | 1304 | Gates CEE decision review on v1 `/run` |
| `src/routes/v2/run.ts` | 1601 | Gates CEE integration in v2 flow |
| `src/cee/client.ts` | 819–821 | Master gate in `runDecisionReview()` |
| `src/routes/v1/helpers/cee-integration.ts` | multiple | Fallback for 8 v1 per-endpoint sub-flags |

**Behavior:**
- **ON:** Enables M1 coaching and CEE orchestration. Required: `Idempotency-Key` header + `CEE_BASE_URL` + `CEE_API_KEY` + detail level not `quick`.
- **OFF:** CEE integration completely disabled. All CEE fields return null/empty in responses.

**Recommended action:** **KEEP**
This is the canonical gate for the new orchestrator architecture. It exists because the orchestrator path requires explicit configuration (API keys, CEE URL) and is not auto-enabled on any environment. Remove when CEE integration becomes the universal default.

---

### 2. `DECISION_REVIEW_ENABLE`

| Field | Value |
|-------|-------|
| **Env var** | `DECISION_REVIEW_ENABLE` |
| **Default** | `false` (must be explicitly set to `1`) |
| **Staging** | NOT SET in render.yaml — disabled by default |
| **Production** | NOT SET in render.yaml — disabled by default |

**Files:**

| File | Lines | Role |
|------|-------|------|
| `src/config/flags.ts` | 75–77 | Flag definition |
| `src/config/feature-flags.ts` | 49 | KNOWN_FEATURE_FLAGS registry |
| `src/cee/decision-review-orchestrator.ts` | 92 | Master gate in `orchestrateDecisionReview()` |
| `src/routes/v2/run.ts` | 2462–2464, 2921–2923, 2997–2998, 3542–3628 | Gates M2 decision review pipeline |

**Behavior:**
- **ON:** Enables M2 LLM decision review pipeline. PLoT calls CEE `/assist/v1/decision-review`. Response includes `m1_review`, `review_status: 'complete'`.
- **OFF:** Decision review completely disabled. Response includes `review_status: 'disabled'`.

**Independent of `CEE_ORCHESTRATOR_ENABLED`**: These two flags can be toggled independently.

**Recommended action:** **KEEP**
This flag controls an expensive LLM call and must be explicitly enabled per-environment. It is independent of the routing architecture. Remove when M2 decision review becomes universally on.

---

### 3. `CEE_ORCHESTRATOR_ENABLED` sub-flags (v1 per-endpoint overrides)

These allow individual v1 endpoints to override the master `CEE_ORCHESTRATOR_ENABLED` flag.

| Sub-flag | Endpoint | Files |
|----------|----------|-------|
| `CEE_ELICIT_BELIEF_ENABLE` | `POST /v1/elicit-belief` | `src/routes/v1/helpers/cee-integration.ts` |
| `CEE_EDGE_FUNCTION_ENABLE` | `POST /v1/suggest-edge-function` | same |
| `CEE_RISK_TOLERANCE_ENABLE` | `POST /v1/elicit-risk-tolerance` | same |
| `CEE_UTILITY_WEIGHTS_ENABLE` | `POST /v1/suggest-utility-weights` | same |
| `CEE_KEY_INSIGHT_ENABLE` | `POST /v1/key-insight` | same |
| `CEE_NARRATE_CONDITIONS_ENABLE` | `POST /v1/narrate-conditions` | same |
| `CEE_EXPLAIN_POLICY_ENABLE` | `POST /v1/explain-policy` | same |
| `CEE_GENERATE_RECOMMENDATION_ENABLE` | `POST /v1/recommend-generate` | same |

**Pattern:** `process.env.CEE_*_ENABLE ?? process.env.CEE_ORCHESTRATOR_ENABLED`

**Staging/Production:** NOT SET in render.yaml — all default to `CEE_ORCHESTRATOR_ENABLED`.

**Recommended action:** **DEPRECATE when orchestrator is universally on**
These sub-flags exist for gradual rollout. Once `CEE_ORCHESTRATOR_ENABLED` is the universal default in all environments, these overrides become unnecessary. Keep until that transition.

---

### 4. BFF Proxy routes (not feature-flagged)

These endpoints forward UI requests to CEE, bypassing Netlify's 50s edge function timeout. They are **always registered** — no feature flag gates them.

| Route | File | Timeout | Purpose |
|-------|------|---------|---------|
| `POST /v1/cee/draft-graph` | `src/routes/v1/cee-draft-graph.ts` | 135s | Proxy for graph authoring |
| `POST /v1/cee/graph-readiness` | `src/routes/v1/cee-proxy.ts` | 10s | Proxy for graph readiness check |
| `POST /v1/cee/bias-check` | `src/routes/v1/cee-proxy.ts` | 60s | Proxy for bias analysis |
| `POST /v1/cee/sensitivity-coach` | `src/routes/v1/cee-proxy.ts` | 60s | Proxy for sensitivity coaching |
| `POST /v1/cee/prompts/warm` | `src/routes/v1/cee-proxy.ts` | 10s | Proxy for prompt cache warming |

**Recommended action:** **KEEP** (these are networking workarounds, not architecture artifacts)
They are valid in both old and new architectures. They exist because the browser cannot call CEE directly with long timeouts. They will be relevant as long as the Netlify deployment constraint exists. No deprecation needed.

---

### 5. Legacy backward-compatibility code

#### `CEE_REVIEW_ENABLED` (implicit legacy flag)

- **File:** `src/cee/client.ts:818` — logs a warning and skips when `CEE_ORCHESTRATOR_ENABLED=0` but `CEE_REVIEW_ENABLED=1`
- **Status:** Superseded by `DECISION_REVIEW_ENABLE`
- **Staging/Production:** NOT SET

**Recommended action:** **DEPRECATE**
This code path (`CEE_ORCHESTRATOR_ENABLED=0, CEE_REVIEW_ENABLED=1`) is dead — no environment sets `CEE_REVIEW_ENABLED`. A deprecation comment was added (see below). Do not delete until confirmed unused in all downstream CEE configurations.

---

## Summary Table

| Flag | Staging | Production | Recommended Action |
|------|---------|------------|-------------------|
| `CEE_ORCHESTRATOR_ENABLED` | OFF | OFF | **KEEP** — canonical gate for new architecture |
| `DECISION_REVIEW_ENABLE` | OFF | OFF | **KEEP** — controls expensive LLM call |
| `CEE_*_ENABLE` sub-flags (8) | OFF | OFF | **DEPRECATE** when orchestrator universally on |
| BFF proxy routes (no flag) | ALWAYS ON | ALWAYS ON | **KEEP** — networking workaround, not routing |
| `CEE_REVIEW_ENABLED` (legacy) | OFF | OFF | **DEPRECATE** — superseded by DECISION_REVIEW_ENABLE |
| `ENABLE_VALIDATE_PATCH` | ON (`"1"`) | OFF | **KEEP** — activate in production during P.1 deployment |
| `ENABLE_FACTS_ASSEMBLY` | Auto-ON | OFF | **KEEP** — gates FactCard data in UI |
| `ENABLE_REVIEW_PASS` | Auto-ON | OFF | **KEEP** — gates review card generation |

---

## Dead code paths

No dead code paths were found in the proxy-to-orchestrator transition. The old UI → PLoT → CEE routing architecture was never implemented in code — PLoT always called CEE directly (not as a routing proxy). The BFF proxy routes (`/v1/cee/*`) are separate: they bypass Netlify timeouts, not implement routing.

No endpoints have been deprecated in this audit. If `CEE_REVIEW_ENABLED` becomes confirmed dead, remove the backward-compat branch in `src/cee/client.ts:818`.

---

## When to revisit

Remove `CEE_ORCHESTRATOR_ENABLED` and the 8 sub-flags when:
1. `CEE_BASE_URL` and `CEE_API_KEY` are provisioned in all target environments
2. CEE integration is confirmed stable in production
3. Orchestrator architecture is the only supported path (no fallback needed)

Remove `DECISION_REVIEW_ENABLE` when:
1. M2 decision review SLA is acceptable in all environments
2. All consumers can handle `m1_review` being present in every response
