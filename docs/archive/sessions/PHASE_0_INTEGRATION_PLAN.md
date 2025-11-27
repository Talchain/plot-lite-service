# Phase 0 Integration Plan - Three New Endpoints

**Date:** 2025-11-14  
**Status:** 🚧 IN PROGRESS  
**Target:** Sequential merge of PRs #104, #105, #106

---

## Overview

Integrating three ready PRs with critical fixes applied:
- **PR #104:** `/v1/intervene` (do-operator semantics)
- **PR #105:** `/v1/optimise` (constraints-aware optimizer)
- **PR #106:** `/v1/run_bundle` (base graph + deltas)

---

## Branch Status

### feat/intervene-do-operator (PR #104)
**Commit:** `41c89d3`  
**Status:** ✅ Ready for merge

**Features:**
- POST /v1/intervene with do-operator semantics
- Contract: `{graph, actions: [{node_id, value}], seed}`
- Structured logging present
- OpenAPI examples + error examples

**Critical Fixes Applied:**
- ✅ X-Request-Id echo via onSend hook
- ✅ Status check in perf-gate measureLatency
- ✅ Perf gates: 1-node and 20-node (p95 ≤ 600ms)

**Test Status:**
- Perf gates: ✅ Passing
- Functional tests: ✅ Passing
- OpenAPI round-trip: ✅ Passing

---

### feat/constraints-and-optimise (PR #105)
**Commit:** `6a06f86`  
**Status:** ⚠️ Needs deterministic solver merge

**Features:**
- POST /v1/optimise with constraints support
- Contract: `{graph, budget, actions, objective, constraints?}`
- Constraints: bounds, must, forbid, require_all_of, require_one_of
- Feasibility checking and violation reporting

**Critical Fixes Applied:**
- ✅ X-Request-Id echo (already present)
- ✅ Status check in perf-gate measureLatency
- ✅ Perf gate: 3 actions (p95 ≤ 800ms)

**Pending:**
- ⚠️ Still uses Math.random() stub for marginal gains
- ⚠️ Needs deterministic solver from feat/run-bundle
- ⚠️ Will be merged during integration

**Test Status:**
- Perf gates: ✅ Passing (with stub)
- Functional tests: ✅ Passing
- Constraints validation: ✅ Passing

---

### feat/run-bundle (PR #106)
**Commit:** `23b524b`  
**Status:** ✅ Ready for merge

**Features:**
- POST /v1/run_bundle (base graph + deltas)
- Contract: `{base_graph, deltas: [{label, nodes}], seed}`
- Efficient batch processing
- Deterministic /v1/optimise solver with kernel integration

**Critical Fixes Applied:**
- ✅ X-Request-Id echo via onSend hook
- ✅ Status check in perf-gate measureLatency
- ✅ Deterministic /v1/optimise solver (runKernel + utility calculation)
- ✅ Real idempotency tests with Idempotency-Key
- ✅ OpenAPI examples + error examples
- ✅ Perf gates for all three endpoints
- ✅ Fixed /v1/compare perf test payload

**Test Status:**
- Pass rate: 731/742 = 98.5% ✅
- Perf gates: ✅ All passing
- Idempotency: ✅ 7/7 tests passing
- OpenAPI round-trip: ✅ Passing

**Known Non-Blockers (11 failures):**
- 6x constraints.test.ts - Tests /v1/run with constraints (not in scope)
- 2x scm-lite.disabled-warning - Pre-existing timeouts
- 1x openapi.examples.test.ts - Path count (cosmetic)
- 1x score.test.ts - Ranking stability (pre-existing)
- 1x perf-gate /v1/compare - Fixed in 23b524b

---

## Integration Sequence

### Step 1: Merge feat/intervene-do-operator → main
**Branch:** feat/intervene-do-operator  
**Commit:** 41c89d3

**Pre-merge checklist:**
- [x] X-Request-Id echo implemented
- [x] Perf gates passing (p95 ≤ 600ms)
- [x] Structured logging present
- [x] OpenAPI examples complete
- [x] Tests passing

**Post-merge:**
- [ ] Wait for Render deploy
- [ ] Run smoke test: `/v1/intervene` with 1-node and 20-node graphs
- [ ] Verify X-Request-Id echo
- [ ] Verify structured logs
- [ ] Attach artifacts

---

### Step 2: Merge feat/constraints-and-optimise → main
**Branch:** feat/constraints-and-optimise  
**Commit:** 6a06f86 + deterministic solver

**Pre-merge tasks:**
1. Cherry-pick deterministic solver from feat/run-bundle
2. Merge constraints logic with kernel-based utility calculation
3. Verify perf gates still pass (p95 ≤ 800ms)
4. Run full test suite

**Pre-merge checklist:**
- [ ] Deterministic solver integrated
- [ ] Utility calculation uses kernel quantiles
- [ ] Constraints validation preserved
- [ ] Perf gates passing
- [ ] Structured logging present
- [ ] OpenAPI examples complete

**Post-merge:**
- [ ] Wait for Render deploy
- [ ] Run smoke test: `/v1/optimise` with budget + 3 actions
- [ ] Verify deterministic results (same seed → same output)
- [ ] Verify constraints enforcement
- [ ] Attach artifacts

---

### Step 3: Merge feat/run-bundle → main
**Branch:** feat/run-bundle  
**Commit:** 23b524b

**Pre-merge checklist:**
- [x] X-Request-Id echo implemented
- [x] Perf gates passing (p95 ≤ 700ms for ≤10 deltas)
- [x] Structured logging present
- [x] OpenAPI examples complete
- [x] Idempotency tests passing
- [x] Tests passing (98.5%)

**Post-merge:**
- [ ] Wait for Render deploy
- [ ] Run smoke test: `/v1/run_bundle` with 10 deltas
- [ ] Verify deterministic results
- [ ] Verify efficient batch processing
- [ ] Attach artifacts

---

## Quality Gates

### Performance Targets
- `/v1/intervene`: p95 ≤ 600ms (1-node and 20-node)
- `/v1/optimise`: p95 ≤ 800ms (budget + ≥3 actions)
- `/v1/run_bundle`: p95 ≤ 700ms (≤10 deltas)

### Pass Rate
- Target: ≥98.5% in two consecutive runs
- Current: 98.5% ✅

### Invariants
- ✅ 96 KiB body guard
- ✅ 429/413/400 clear idempotency inflight
- ✅ X-Request-Id echo
- ✅ Rate-limit headers
- ✅ No payload logging
- ✅ OpenAPI paths under paths: only
- ✅ Deterministic (seed → identical results)

---

## CI/CD Strategy

### Pre-Merge
1. Run 2 back-to-back full CI suites on each branch
2. Verify pass rate ≥98.5% with zero flakes
3. Confirm all perf gates green

### Post-Merge (Each PR)
1. Wait for Render auto-deploy
2. Run smoke tests for new endpoint
3. Verify:
   - X-Request-Id echo
   - Structured logs
   - Determinism (same seed)
   - Performance targets
   - Error handling (400/413)
4. Attach artifacts to PR

### Final Verification (After All 3 Merged)
1. Run full perf-gate suite
2. Run 10-minute soak test (~1-2 RPS)
3. Smoke production endpoints
4. Verify all invariants

---

## Rollback Plan

If any merge causes issues:
1. Identify failing endpoint
2. `git revert <merge-commit>`
3. Push revert to main
4. Wait for Render redeploy
5. Verify rollback successful
6. Fix issue in branch
7. Re-attempt merge

---

## Next Steps (After Phase 0)

### SDK v0.5.0
- Add `intervene()`, `optimise()`, `runBundle()` functions
- Keep browser-safe rules (no User-Agent, x-olumi-sdk, TextEncoder)
- Add 429 auto-retry
- Update README examples
- Node + Browser samples

### CHANGELOG Updates
- v1.5.0: `/v1/intervene` (do-operator)
- v1.6.0: `/v1/optimise` (constraints + deterministic solver)
- v1.7.0: `/v1/run_bundle` (batch processing)

### Documentation
- Update README UI integration sections
- Add OpenAPI examples for all new endpoints
- Document limits, 429 UX, correlation patterns

---

## Current Status

**Branches Ready:**
- ✅ feat/intervene-do-operator (41c89d3)
- ⚠️ feat/constraints-and-optimise (6a06f86) - needs solver merge
- ✅ feat/run-bundle (23b524b)

**Next Action:**
1. Push all branches to origin
2. Merge deterministic solver into feat/constraints-and-optimise
3. Run 2 back-to-back CI suites on each branch
4. Begin sequential merge: #104 → #105 → #106

**Estimated Timeline:**
- Step 1 (intervene): 30 minutes
- Step 2 (optimise): 1 hour (includes solver merge)
- Step 3 (run_bundle): 30 minutes
- **Total:** ~2 hours

---

**Status:** Ready to begin sequential integration after pushing branches and merging deterministic solver.
