# Overnight Autonomy Status Report

**Date:** 2025-10-31  
**Agent:** Cascade (Implementation Agent)  
**Reviewer:** Claude Code

---

## Executive Summary

✅ **P0 Complete** — Baseline stabilised and locked at 564/578 (97.6%)  
📋 **P1-P2 Planned** — Comprehensive implementation plan documented  
🚀 **Ready for Execution** — All prerequisites in place

---

## P0: Stabilisation & Baseline Lock ✅

### Delivered
- **Test Isolation Restored**: Removed global RL defaults; per-test env control
- **SCM-Lite Gating Verified**: Correct `bma_hash` behaviour when enabled/disabled
- **Contract Snapshot Regenerated**: Clean env, reproducible hash
- **OpenAPI Error Examples**: All v1 routes have proper error examples
- **Repository Hygiene**: Artefact logs removed, `.gitignore` updated

### Test Results
```
Baseline (RATE_LIMIT_ENABLED=0): 564/578 passing (97.6%)
RL Tests (targeted): All 4 passing ✅
Full Suite: 564/578 passing (97.6%)
```

### Commits (8 total)
```
6204aba fix(tests): remove global RL default from setup
7ab7970 test(harness): add withEnv helper for scoped env overrides
c0c5a5d test(secrets): per-test secret overrides verified
ac79d0a test(rate-limit): enable RL inside RL tests only
1146618 chore(repo): remove artefact logs; update .gitignore
16e8b2d chore(snapshot): regenerate report snapshot from clean env
7e7eef1 fix(tests): disable RL in report.contract test to match snapshot
442286b feat(flags): add COMPARE_VIEW_ENABLE and INSPECTOR_DEBUG_ENABLE
```

### Acceptance Criteria: All Met ✅
- ✅ Tests ≥ 558/578 (achieved 564/578)
- ✅ No new flakes
- ✅ All contract tests green
- ✅ Snapshot reproducible
- ✅ No artefacts committed

---

## P1-P2: Implementation Plan 📋

### P1 — Option Compare View
**Goal:** Deterministic sensitivity ranking using existing run artefacts (no extra sampling)

**Key Components:**
- `src/lib/sensitivity.ts`: Variance-based edge ranking
- Request field: `include_debug: boolean`
- Response field: `debug.compare[optionId].top3_edges[]`
- Hash exclusion: `debug/*` not included in `response_hash`
- Feature flag: `COMPARE_VIEW_ENABLE`

**Acceptance:**
- Top-3 edges stable across re-runs
- No added sampling; runtime delta ≤ 5%
- `response_hash` unchanged with/without `include_debug`

---

### P1 — Inspector: Belief × Weight × Provenance
**Goal:** Trust and auditability without changing summaries

**Key Components:**
- Ingress normalisation: `belief` (0-1), `provenance` (string)
- Response field: `debug.inspector.edges[]`
- Semantics: Belief = sampling probability; Weight = effect magnitude
- Feature flag: `INSPECTOR_DEBUG_ENABLE`

**Acceptance:**
- All edges populate fields in debug slice
- No change to summary shape
- `response_hash` unaffected

---

### P2 — Inference Modes Parity
**Goal:** Hash parity across `model_based` and `model_of_inference`

**Key Components:**
- Quantisation: 4 decimal places in hash function
- Parity test on canonical template
- Docs: When to pick which mode

**Acceptance:**
- Mode tests green
- Hash parity established
- OpenAPI and UI handoff updated

---

### P2 — TypeScript SDK v0.1
**Goal:** Typed, minimal SDK with tree-shakeable exports

**Structure:**
```
sdk/ts/
  src/
    client.ts (runSync, runStream, validate, getLimits, getTemplateGraph)
    types.ts
    events.ts
  examples/
    run-sync.ts
    run-stream.ts
```

**Acceptance:**
- SDK builds in CI
- Example app compiles and runs
- Proper SSE close handling

---

### P2 — Performance and Soak Guardrails
**Goal:** Enforce budgets and detect leaks

**Tools:**
- `tools/perf/probe.mjs`: Autocannon (p95 ≤ 600ms)
- `tools/perf/sse-soak.mjs`: 60-120s soak test

**Budgets in `/v1/limits`:**
```json
{
  "perf_budget_p95_ms": 600,
  "heartbeat_budget_ms": 5000,
  "sse_slot_max_ms": 120000
}
```

**Acceptance:**
- CI perf job passes
- Soak tests stable
- Budgets published

---

### P2 — Security and Limits Hardening
**Goal:** CORS, body limits, timeouts, secret scrubbing

**Components:**
- CORS allowlist: `localhost:5173`, `127.0.0.1:5173`
- Body limit: JSON ≤ 1 MB
- Compute timeouts: `/v1/run` cap, `/v1/run/stream` slot timeout
- Logging: Scrub secrets and large payloads

**Acceptance:**
- Security tests pass
- `/v1/health` counters correct
- No secrets in logs

---

## Engineering Guardrails

### Golden Constraints (Never Violate)
1. **Determinism**: Same (graph, seed, k, mode) ⇒ same `response_hash`
2. **Addition-only contracts**: No breaking changes; keep deprecated aliases
3. **No global test state**: Tests control their own env
4. **SSE hygiene**: Heartbeats, monotonic progress ≤ 90, single terminal frame
5. **Security**: No secret logging, CORS allowlist, body/time limits
6. **Docs as code**: Contract changes ship with OpenAPI, tests, docs

### Implementation Rules
- Fastify schemas: Use `additionalProperties: true` on array items
- Per-test servers: Ephemeral, port 0, try/finally kill
- Event latches, not sleeps: Streaming tests use event latches
- Hash stamping order: All fields set before `stampResponseHash()`; exclude `debug/*`
- Feature flags: Add to `KNOWN_FEATURE_FLAGS`

---

## Verification Protocol (For Each PR)

### 1. Baseline run (no RL):
```bash
RATE_LIMIT_ENABLED=0 pnpm test --run
```
Paste exact Vitest summary lines.

### 2. Targeted RL tests:
```bash
pnpm test tests/health.counters.test.ts tests/rate-limit.clarity.test.ts tests/request.guards.test.ts
```
Paste summaries.

### 3. Full suite (CI mirror):
```bash
pnpm test --run
```
Paste final summary.

### 4. Perf and soak (when relevant):
Paste p95 and soak assertions.

---

## Next Steps

### Immediate (P1)
1. **PR: Option Compare** — Sensitivity analysis + tests
2. **PR: Inspector** — Belief/weight/provenance + tests

### Follow-up (P2)
3. **PR: Inference Parity** — Quantisation + tests + docs
4. **PR: TypeScript SDK** — Client + examples
5. **PR: Perf & Soak** — Tools + budgets
6. **PR: Security Hardening** — CORS + limits + logging

---

## Deliverables Per PR

- ✅ Conventional commits (`feat|fix|docs|test|chore(scope): summary`)
- ✅ Code + tests + OpenAPI + docs in lockstep
- ✅ PR description with:
  - What changed and why
  - Three Vitest summaries
  - Perf/soak numbers (if relevant)
  - Security notes
  - Risk and rollback note

---

## Claude Code Review Checklist

- [ ] Contract changes matched in OpenAPI and UI handoff
- [ ] Determinism preserved; `debug/*` excluded from hash
- [ ] No global test state; per-test env only
- [ ] Streaming tests use latches; no sleeps
- [ ] Security: CORS, body limits, timeouts, no secret logging
- [ ] Performance budgets enforced; no extra sampling for Option Compare

---

## Status: ✅ P0 COMPLETE, P1-P2 READY

**Baseline Locked:** 564/578 (97.6%)  
**Feature Flags Added:** `COMPARE_VIEW_ENABLE`, `INSPECTOR_DEBUG_ENABLE`  
**Implementation Plan:** Complete and detailed  
**Ready for:** Sequential PR execution

**Confidence:** HIGH — All prerequisites met, comprehensive planning, clear acceptance criteria
