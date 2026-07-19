# PLoT read-side of the ISL /health compute-admission handshake (Codex F8, Option B) — A3 BUILD

Base: `origin/staging` = `9700d8bae8549f1e5c8dab3d7e8cc1de6b7e949e` (#232, includes #231 retry +
#232 guards). Built in a FRESH blobless shallow clone at that tip (the local working tree's
`origin/staging` was stale at `b9f825a`/#230 with a hung fetch — the known iCloud-pack hazard; per
CLAUDE.md verification trap #1 the clone is the authority). Node v20.19.5, npm 10.8.2, `npm ci` clean.

Branch: `feat/isl-admission-handshake-a3`.

## Problem (verified) — derive, don't mirror

PLoT hand-mirrored a stale **30M scalar** ceiling (`ISL_COMPLEXITY_BUDGET_DEFAULT`,
`applyComplexityBudget(nSamples,nodeCount,edgeCount)` = `nSamples×nodes×edges`). ISL F8 (#80) replaced
its scalar gate with a **weighted** cost model (24M cost units, `v2-weighted-2026-07`) and advertises it
LIVE on `/health`. The scalar mirror over-reduces on large graphs — e.g. a 50n/100e/10000s graph:
scalar `50M > 30M` → cut to 6000, but the weighted cost is only ~7.5M `< 24M` → ISL would accept the
full 10000. PLoT needlessly degraded quality.

**Live-verified ISL advertisement** (`curl https://isl-staging.onrender.com/health`, no auth needed,
2026-07-18) — `compute_admission`:
```
max_cost_units 24000000, complexity_formula_version "v2-weighted-2026-07",
weights { base_per_sample_per_option_per_struct 1, evpi_sample_cap 2000, sensitivity_coef 4,
          evalue_coef 20, bands_coef 200, path_coef 1, max_decomposition_paths 20000 },
caps    { max_options 10, max_nodes 50, max_edges 200, max_parameter_uncertainties 50 }
```
The exact ISL formula shape was read from the DEPLOYED ISL source at that build
(`src/services/robustness_analyzer_v2.py::compute_weighted_cost`, commit `1289365e`):
```
cost = base·S·O·W + (U+1)·min(S,evpi_sample_cap)·O·W [if voi & U>0]
     + sensitivity_coef·E·min(100,⌊S/10⌋)·W [if 'sensitivity']
     + evalue_coef·E·O + bands_coef·E·O [if e_values]
     + path_coef·min(max_decomposition_paths, E·E) [if path_decomp]   (W = N+E)
```

## What changed (Option B — /health capability handshake)

| File | Change |
|---|---|
| `src/integrations/isl/types/isl-types.ts` | NEW `ISLComputeAdmission` / `…Weights` / `…Caps`; extended `ISLHealthResponse` with `compute_admission` + build identity. |
| `src/integrations/isl/client.ts` | NEW `fetchHealth(): Promise<ISLHealthResponse\|null>` — GET /health, auth + short health timeout, null on any failure. |
| `src/integrations/isl/compute-admission.ts` | NEW resolver: **cache (TTL 60s, stale-while-revalidate, non-blocking)** + **version guard** + **fail-loud skew signal** (warning + metric). |
| `src/config/sampling.ts` | NEW `estimateWeightedCostV2(req, weights)` (consumes ADVERTISED weights), `resolveWeightedCostCeiling` = `min(PLOT_SAFETY_CEILING_COST_UNITS 30M, live max_cost_units, ISL_MAX_COST_UNITS?)`, `planSampleDepth` (weighted / fail-loud fallback), `KNOWN_COMPLEXITY_FORMULA_VERSIONS = {v2-weighted-2026-07}`. Reframed the 30M scalar as the LEGACY FALLBACK; relaxed the deploy-order lock-step comments. |
| `src/routes/v2/run.ts` | Base /v2/run planning now reads the cached capability and calls `planSampleDepth` with the request's O / unique-U / phase flags; refusal + reduction logs/messages made formula-agnostic. |
| `src/metrics/registry.ts` | NEW counter `plot_engine_isl_admission_version_skew_total{reason}` + `recordIslAdmissionVersionSkew`. |
| `src/util/structural-keys.generated.ts` | DERIVED regeneration (drift-test-enforced) picking up the new /health type fields — response-only keys, never in a hashed request. |
| `tests/isl-compute-admission-handshake.test.ts` | NEW — 25 unit/resolver tests. |
| `tests/adaptive-n-samples-complexity.test.ts` | UPDATED route tests to seed the live capability (production reality: F8 deployed) + a fail-loud fallback route test. Scalar `applyComplexityBudget` unit tests retained unchanged (they validate the retained fallback fn). |

### Answers to the caller's confirmations
- **Advertised weights, not a hardcoded copy:** `estimateWeightedCostV2` hard-codes only the STRUCTURAL
  shape; every coefficient is read from the `weights` argument. Proven by tests that change
  `sensitivity_coef` (cost +6,000,000) and `evpi_sample_cap` (EVPI cap +5,400,000) and see the cost move.
- **Known-versions set:** `{ "v2-weighted-2026-07" }`; anything else → fail-loud (see skew tests).
- **Cache:** module-level, TTL **60s** (`ADMISSION_CACHE_TTL_MS`), **stale-while-revalidate** — the hot
  /v2/run path reads synchronously and NEVER blocks on a per-request fetch; a stale/cold entry kicks off a
  deduped background refresh, the cold first request serving the benign `warming` fallback.
- **Effective ceiling:** `min(PLOT_SAFETY_CEILING_COST_UNITS = 30M, live max_cost_units, ISL_MAX_COST_UNITS?)`;
  the env is an OPTIONAL PLoT-side LOWER clamp (cost units, matching ISL's own env — deliberately NOT the
  old scalar `ISL_MAX_COMPUTE_COMPLEXITY`). The scalar env survives only as the lower clamp on the legacy
  fallback path; the cross-service lock-step is RELAXED (comments updated).
- **Fail-loud scope refinement:** the conservative fallback (disable depth-raise → 4000 + 10M scalar +
  loud `isl_admission_version_skew` warning + metric) fires ONLY on a GENUINE skew (ISL configured but
  its capability unreachable / block missing / version unknown). A benign no-gate state (ISL not
  configured, or the cold warm-up) keeps the standard depth + historical scalar budget — byte-for-byte the
  pre-handshake behaviour, so no unrelated test's wire changed (see gate: full suite green).

## Discipline — RED-first + positive controls (all GREEN after build)

`tests/isl-compute-admission-handshake.test.ts` — 25 tests:
- **Handshake happy path:** injected v2 admission (real weights) → 50n/100e/10000s/1opt/U=0 plans at FULL
  10000 (weighted cost 7,522,000 ≤ 24M). **POSITIVE CONTROL (the defect):** `applyComplexityBudget(10000,50,100)`
  (old scalar @ 30M) reduces to 6000 (`> 30M`) — the needless loss the weighted plan avoids.
- **Weighted reduction/refusal:** an EVPI-heavy graph reduces to the MAXIMAL depth (`cost(n) ≤ 24M <
  cost(n+1)`); a 10opt/49-factor graph refuses (floor cost `> 24M`).
- **Version SKEW:** `/health` returns `v9-future` → classify = `unknown_version` skew, admission null;
  **positive control** — the loud `isl_admission_version_skew` warning fires (asserts console.warn carries
  the event + `v9-future`) AND `plot_engine_isl_admission_version_skew_total{reason="unknown_version"} 1`.
- **Unreachable / missing block / malformed weights** → `unreachable` / `missing_block` skew (metric fires
  with the matching reason). ISL disabled (no base URL) → `disabled`, QUIET (no warning/metric — positive
  control asserts warn NOT called).
- **Cache:** seeded fresh capability served synchronously; cold cache serves the non-blocking warming fallback.

`tests/adaptive-n-samples-complexity.test.ts` — 16 tests (10 scalar unit retained + 6 route): reduction is
maximal & never breaches 24M (cost recomputed from the captured ISL body); GRAPH_TOO_COMPLEX refusal before
ISL; normal/explicit depths; **fail-loud fallback route test** (skewed capability → base call plans at 4000,
not 10000 — confirmed live in the run log `flip_probe_n_samples:4000`).

## Mutation checks (throwaway edits in the committed tree; test → RED; `git checkout --` restore, 0 dirty)

| # | Fix hunk reverted | Test → | Result |
|---|---|---|---|
| M1 | version-skew guard in `classify` (`if (false && !KNOWN…has(version))`) | classify `unknown_version` + refresh `v9-future` warning+metric | **RED** (2 failed); `unreachable`/`missing_block` stayed GREEN — targeted |
| M2 | weighted `min(safety,live)` branch in `planSampleDepth` (forces scalar mirror) | 50n/100e FULL-depth (the over-reduction test) + weighted reduce/refuse | **RED** (over-reduces to a scalar cut) |

Each mutation reverted with `git checkout -- <file>` (verified `git status` = 0 dirty) before the next.
Re-verified on the CURRENT tree after the fallback-scope refactor (both still RED).

## Gate

- `tsc -p tsconfig.json --noEmit` → **0 errors**.
- `bash scripts/pre-push-validate.sh` → **PASSED, 0 failures**:
  `[1] branch guard · [2] tsc · [3] full suite 5696 passed | 25 skipped · [4] no stale .js · [5] file-dep
  policy · [6] OpenAPI spectral lint`. (The 7th CI job `gates (windows-latest)` is the standing
  invalid-path red, unrelated; `audit` is the standing dep-advisory red — neither run in the local gate.)
- **Standing-red base-vs-branch check:** files changed vs `9700d8ba` = only `src/*.ts` + `tests/*` + this
  evidence md + the DERIVED `structural-keys.generated.ts`. **NO** `package.json`, `package-lock.json`, or
  `contracts/openapi.yaml` touched → the `audit` / `validate-structure` reds are IDENTICAL to base by
  construction; `gates (windows-latest)` is the pre-existing invalid-path red. No new problem-set introduced.

## Deploy safety

This PR deploys AFTER ISL F8 (already live). In either deploy order the fail-loud fallback is safe: if the
/health handshake is unreadable or the version is unknown, PLoT plans conservatively (legacy scalar, base
depth capped at 4000) and the drift is VISIBLE (warning + metric), never silent.

---

## Review fix — constraint-injected PUs folded into EVPI `u` (the "conservative, never permissive" CONCERN)

**Defect (review-verified):** `estimateWeightedCostV2`'s EVPI `u` was fed only the FACTOR
parameter-uncertainties (`buildParameterUncertaintiesV3`). But the request PLoT actually sends to ISL ALSO
carries CONSTRAINT-TARGET PUs injected afterward (`injectConstraintParameterUncertainties`) for constrained
non-goal nodes with `observed_state.value`. ISL counts those injected node_ids in its EVPI `u`, so on a
near-ceiling multi-constraint graph PLoT UNDER-priced EVPI → planned as if it fit → ISL then 422s. That is
the pass-then-422 mode the handshake exists to prevent — a permissive gap, violating the invariant.

**Fix (one source of truth):** factored the injector's per-constraint accept/skip decision into
`classifyConstraintPu` and a pure `selectConstraintInjectedPuNodeIds` (both in
`constraint-pu-injection.ts`); the injector now routes through `classifyConstraintPu` (behaviour-preserving —
25 existing injection tests green) and the planner counts EVPI `u` as
`factorPuNodeIds.size + selectConstraintInjectedPuNodeIds(activeGoalConstraints, filteredGraph.nodes,
goal, factorPuNodeIds).size` — the UNION, deduplicated by node_id, exactly ISL's `u`. `activeGoalConstraints`
(available at the planning site) shares `constraintsForISL`'s node_id set (normalisation preserves node_ids),
so the count is exact. No node-selection logic is duplicated — injector and planner share
`classifyConstraintPu`.

**Discipline:**
- RED-first (route, `tests/adaptive-n-samples-complexity.test.ts`): a 4-factor + 4-constrained-outcome graph
  (factor-only `u`=4, ISL's real `u`=8) with a ceiling seeded BETWEEN the factor-only estimate (~946k) and the
  true union estimate (~1.28M). Against the pre-fix code the sent request (injected PUs → `u`=8) was NOT
  reduced (`sent`=10000) so its true cost (1.28M) exceeded the ceiling — the permissive gap, asserted via the
  positive control (`factorOnlyFullDepth ≤ ceiling < costOfCall(sent)`). After the fix PLoT counts `u`=8,
  reduces to the maximal honest depth, and the sent cost fits (no pass-then-422).
- Parity (`tests/constraint-pu-injection.test.ts`): `selectConstraintInjectedPuNodeIds` returns EXACTLY the
  node_ids the injector adds (`|select| === injector.injected`), and `existingPu.size + select.size` === ISL's
  `|parameter_uncertainties|` — one source of truth.
- Common no-constraint case BYTE-IDENTICAL: `selectConstraintInjectedPuNodeIds([]/undefined)` = ∅ → union
  `u` === factor `u` → estimate unchanged. Proven twice: the "no-constraint control" route test, AND the
  mutation-check below stays GREEN for it (the fold is a no-op without constraints).
- Mutation-check (throwaway edit in the committed tree; `git checkout --` restore, 0 dirty): revert the union
  fold → factor-only → the MULTI-CONSTRAINT route test goes **RED** (`expected 10000 to be less than 10000`);
  the no-constraint control stays GREEN.
- Gate: `tsc -p tsconfig.json --noEmit` 0; full suite **5701 passed / 0 failed** (one subprocess-startup
  timing test, `counterfactual.zero-baseline`, flaked once under CPU load then passed clean on re-run —
  unrelated to this change, passes in isolation). Files touched: only `src/*.ts` + `tests/*` + this md — no
  `package.json`/lock/`openapi.yaml`, standing-red set unchanged.
