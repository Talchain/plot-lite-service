# PLoT retry cluster — Codex F9 / F3 / F11 + ISL_MAX_RETRIES de-mirror (A3, r1 BUILD)

Base: `origin/staging` = `b9f825afc0762b911edb2429cbab399a264dabbc` (#230). Built in a
fresh shallow clone at that tip (the local working tree's `origin/staging` was stale
at `e0293fe5` #224 with a hung fetch — the known iCloud-pack hazard; per CLAUDE.md
verification trap #1 the clone is the authority). Node v20.19.5, npm 10.8.2, `npm ci` clean.

Branch: `fix/isl-retry-bound-cancellation-a3`.

## What changed (single source of truth: `src/config/timeouts.ts`)

New exports in `config/timeouts.ts` (derive-don't-mirror):
- `ISL_MAX_RETRIES_DEFAULT = 3` + `resolveIslMaxRetries()` — the `'3'` default was
  hand-written in BOTH `isl/client.ts` and `config-validator.ts`; both now derive it.
- `ISL_RETRY_BACKOFF_BASE_MS` / `ISL_RETRY_BACKOFF_CAP_MS` / `islRetryBackoffMs(attempt)`
  — the client's backoff series, now one source (client uses it too).
- `worstCaseMs(attempts, perAttemptTimeoutMs)` = `attempts × perAttempt + Σ backoff`
  (the exact 1s+2s… series, capped 5s). The honest formula used by the clamp fitting,
  the clamp telemetry, config-validator's budget warn, AND the tests.

| Finding | Change |
|---|---|
| **F9** threshold call (`run.ts` `/api/v1/analysis/thresholds`) | pass `maxRetries = 1` (was omitted → inherited config default 3). Timeout stays clamped to remaining budget. |
| **F3** flip probes | (a) pass `maxRetries = 1`; (b) thread an **AbortSignal** run.ts arrow → `createISLInferenceFn` → `callAnalysisEndpoint` → client fetch, combining it with the client's per-attempt timeout controller (folded via `controller.abort()`, preserving AbortError→ISLTimeoutError); (c) build a per-factor `AbortSignal.any([overall, factorTimeout])` in `searchFlipForFactorInner`, thread through the semaphore + grid fallback; (d) early-abort short-circuit in `createISLInferenceFn` so a probe dequeued past the deadline does no work (the "re-check deadline in acquire/release" requirement); (e) deadline-aware reclassification of a rejected/thrown probe to `flip_reason: 'timeout'` (else genuine `'error'`). |
| **F11** base-call clamp | fitting loop + telemetry (`worst_case_total_ms`) + config-validator budget warn + the base-call-budget test now use `worstCaseMs` (backoff included). No runtime change at defaults (still 1 attempt @70s budget) — just honest accounting, centralised. |
| **de-mirror** | `client.ts` `maxRetries` default and `config-validator.ts` `islMaxRetries` both derive `resolveIslMaxRetries()`; client backoff derives `islRetryBackoffMs`. |

## Files touched
- `src/config/timeouts.ts` (new helpers)
- `src/integrations/isl/client.ts` (external signal fold; backoff + retries de-mirror)
- `src/integrations/isl/index.ts` (`callAnalysisEndpoint` gains `signal?` arg #6; interface + impl)
- `src/routes/v2/run.ts` (F9 threshold `maxRetries=1`; F3 flip arrow `maxRetries=1`+signal; F11 clamp/telemetry via `worstCaseMs`)
- `src/analysis/flip-thresholds.ts` (F3 signal threading + cancellation + deadline-aware disclosure)
- `src/config-validator.ts` (F11 honest budget warn + retries de-mirror)
- `tests/plot-remediation.base-call-budget.route.test.ts` (F11 honest formula)
- NEW `tests/isl-worst-case-accounting.test.ts` (F11 unit)
- NEW `tests/isl-retry-bound.wallclock.test.ts` (F9/F3 wall-clock mechanism + positive control)
- NEW `tests/flip-probe-cancellation.test.ts` (F3 cancellation + positive control)
- NEW `tests/plot-remediation.optional-phase-retry.route.test.ts` (F9+F3 route capture)

## Gate — typecheck
`npx tsc --noEmit` → **0 errors** (TSC_EXIT=0). PLoT's authoritative Tier-1 typecheck
(repo CLAUDE.md; PLoT has no openapi:generate step — that is the CEE gate).

## GREEN run (new + regression)
8 files / **92 tests passed**. Telemetry confirmed live in the run:
- `base_isl_call_budget_clamped … worst_case_total_ms: 60000` (= `worstCaseMs(1, 60000)`, honest).
- wall-clock positive control: `attempt: 3, max_retries: 3`, elapsed **3762ms** (~3× + 1s+2s backoff).
- wall-clock fix: `attempt: 1, max_retries: 1`, elapsed **~252ms**.
- flip probes ran (`probes_used: 3` per factor in the lane2 fixture) — F3 capture path is live.

## Mutation checks (each fix hunk reverted in the committed tree; test → RED; `git checkout` restore, 0 dirty)

| # | Fix hunk reverted | Test run | Result |
|---|---|---|---|
| 1 | `worstCaseMs` → `n × perAttempt` (drop backoff) | `isl-worst-case-accounting` | **RED** — `expected 180000 to be 183000` (+ 2 more) |
| 2 | `run.ts` threshold call: remove `, 1` (maxRetries) | `optional-phase-retry` (F9) | **RED** — `expected undefined to be 1`; F3 case stayed green |
| 3 | `run.ts` flip arrow: remove `, 1, signal` | `optional-phase-retry` (F3) | **RED** — `expected undefined to be 1`; F9 case stayed green |
| 4 | `flip-thresholds.ts` Step-0 probes: drop `factorSignal` arg | `flip-probe-cancellation` | **RED** — `flip search did not cancel within 3s`; positive control stayed green |
| 5 | `client.ts`: remove the external-signal fold | `isl-retry-bound.wallclock` (WIRING) | **RED** — `expected 5006 to be less than 1500` (ran full 5s per-attempt) |

Each mutation was reverted with `git checkout -- <file>` (verified `git status` = 0 dirty) before the next.
The de-mirror (single-source `ISL_MAX_RETRIES_DEFAULT` / `islRetryBackoffMs`) is a structural refactor
with no dedicated behavioural test; it is exercised indirectly — the wall-clock positive control depends on
`resolveIslMaxRetries()` returning 3 at default (it overran to attempt 3), and `tsc` proves both call sites bind.

## Standing-red base-vs-branch check
Files changed vs base `b9f825af`: **only** `src/*.ts` + `tests/*` + this evidence md. **No** `package.json`,
`package-lock.json`, or `contracts/openapi.yaml` touched → the `audit` (dep advisories) and
`validate-structure` (spectral/redocly) reds are IDENTICAL to base by construction; `gates (windows-latest)`
is the pre-existing invalid-path red, unrelated. (Confirmed no new problem-set introduced.)

## Full gate (`scripts/pre-push-validate.sh`) — PASSED, 0 failures
```
PASS [1/7] Branch guard (fix/isl-retry-bound-cancellation-a3)
PASS [2/7] TypeScript compilation (tsc --noEmit)
PASS [3/7] Full test suite —  Tests  5634 passed | 25 skipped (5670)
PASS [4/7] No stale .js files tracked in src/
PASS [5/7] file: dependency policy OK
PASS [6/7] OpenAPI spec validation (spectral lint)
Failures: 0 — Pre-push validation PASSED
```
(The local pre-push gate has no `npm audit` step; the CI `audit` / `gates (windows-latest)` /
`validate-structure` jobs are the separate standing reds, unchanged — no deps/spec touched.)

