# PR: P0 Stabilisation — Test Isolation & Baseline Lock

## What Changed and Why

**Goal:** Restore a clean, deterministic test bed and lock the baseline for future work.

### Changes Applied

1. **Test Isolation Restored**
   - Removed global `RATE_LIMIT_ENABLED='0'` from test setup
   - Rate-limit tests now enable RL per-test using spawned server env
   - Baseline 64-char `PRINCIPAL_HMAC_SECRET` preserved for infra stability
   - Created `tests/helpers/env.ts` with `withEnv()` for scoped overrides

2. **SCM-Lite Gating Verified**
   - When `SCM_LITE_ENABLE !== '1'`: `model_card.bma_hash` is omitted ✅
   - When enabled: `bma_hash` computed before `stampResponseHash()` ✅
   - Determinism preserved across runs

3. **Contract Snapshot Regenerated**
   - Clean env: `RATE_LIMIT_ENABLED=0 TEST_ROUTES=1 SCM_LITE_ENABLE=0`
   - Hash: `f871171550de6aa59d92159da3c112a862218809624fb3065fb7a07380fef311`
   - Includes `meta.inference_mode` ✅
   - No stderr artefacts ✅

4. **OpenAPI Error Examples Complete**
   - `/v1/run/stream`: 429 with `Retry-After` and `retry_after_s` ✅
   - `/v1/version`, `/v1/templates`: 500 examples ✅
   - All v1 routes have error examples ✅

5. **Repository Hygiene**
   - Removed artefact logs
   - Updated `.gitignore` to block test logs
   - No large logs committed ✅

---

## Verification Protocol Results

### 1. Baseline run (no RL):
```bash
RATE_LIMIT_ENABLED=0 pnpm test --run
```
**Result:**
```
 Test Files  173 passed | 8 skipped (181)
      Tests  564 passed | 14 skipped (578)
```
✅ **564/578 passing (97.6%)** — Exceeds ≥558 baseline requirement

---

### 2. Targeted RL tests:
```bash
pnpm test tests/health.counters.test.ts tests/rate-limit.clarity.test.ts tests/request.guards.test.ts
```
**Result:**
```
 ✓ tests/health.counters.test.ts (1 test) 1017ms
   ✓ Health counters and last reload timestamp > exposes json_429_count, sse_429_count and last_config_reload_iso
 
 ✓ tests/rate-limit.clarity.test.ts (2 tests) 1660ms
   ✓ 429 clarity headers > JSON route 429 includes Retry-After and X-RateLimit-Reason; 2xx has no X-RateLimit-Reason
   ✓ 429 clarity headers > SSE 429 includes Retry-After and X-RateLimit-Reason
 
 ✓ tests/request.guards.test.ts (1 test) 555ms
   ✓ request guards > 413 oversized body; 400 unknown field; JSON 429 headers; 400 out-of-range stream param
```
✅ **All 4 RL tests passing** with proper headers and counters

---

### 3. Full suite (CI mirror):
```bash
pnpm test --run
```
**Result:**
```
 Test Files  173 passed | 8 skipped (181)
      Tests  564 passed | 14 skipped (578)
```
✅ **564/578 passing (97.6%)**

---

## P0 Acceptance Criteria: All Met ✅

- ✅ Full Vitest summary ≥ 558/578 (achieved 564/578 = 97.6%)
- ✅ No new flakes introduced
- ✅ `scm-lite.*` tests green
- ✅ `openapi.examples.*` tests green
- ✅ `report.contract.*` tests green
- ✅ Rate-limit tests green with proper headers
- ✅ `report.v1` snapshot reproducible from clean env
- ✅ No large logs committed; `.gitignore` blocks artefacts

---

## Commits (7 patches)

```
6204aba fix(tests): remove global RL default from setup (tests own their env)
7ab7970 test(harness): add withEnv helper for scoped env overrides
c0c5a5d test(secrets): per-test secret overrides verified (no changes needed)
ac79d0a test(rate-limit): enable RL inside RL tests only; assert headers and counters
1146618 chore(repo): remove artefact logs; update .gitignore
16e8b2d chore(snapshot): regenerate report snapshot from clean env
7e7eef1 fix(tests): disable RL in report.contract test to match snapshot
```

---

## Security Notes

- ✅ No secrets in logs
- ✅ Rate limiting properly gated per-test
- ✅ Circuit breaker uses `process.exitCode` in tests (no process kills)
- ✅ HMAC secret validation enforced (64-char minimum)

---

## Risk and Rollback

**Risk:** Low — Only test infrastructure changes; no production code changes  
**Rollback:** `git revert 7e7eef1^..6204aba` (revert all 7 commits)

---

## What's Kept (Not Reverted)

- Circuit breaker `process.exitCode` change ✅
- OpenAPI error examples ✅
- `RATE_LIMIT_ENABLED` in `KNOWN_FEATURE_FLAGS` ✅
- Baseline 64-char `PRINCIPAL_HMAC_SECRET` ✅

---

## Next Steps

P0 baseline locked. Ready to proceed with:
- P1: Option Compare view (engine support)
- P1: Inspector (belief × weight × provenance)
- P2: Inference modes parity
- P2: TypeScript SDK v0.1
- P2: Performance and soak guardrails
- P2: Security and limits hardening

---

**Status: ✅ READY FOR REVIEW & MERGE**
