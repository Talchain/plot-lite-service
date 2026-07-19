# /simplify — PLoT cleanup PR (BUILD evidence)

Behavior-preserving mechanical cleanups from `SIMPLIFY-CONSOLIDATED-2026-07-19.md`
(the PLoT cleanup PR). Refactors only — no defect fixes, no wire-shape changes.

- Base: `staging` @ `ad255d3c` (fresh shallow clone; local tree stale/hung).
- Branch: `refactor/a3-simplify-cleanups`.
- Scope: `plot-lite-service` only. `contracts/openapi.yaml` NOT touched.

## Items applied

1. **[HIGH] Dedup the double PU-recompute per /v2/run.**
   - Factor side: `buildParameterUncertaintiesV3(filteredGraph.nodes)` is now built
     ONCE at the admission planner (`run.ts`), the node-id Set/count is derived from
     it, and the SAME list is threaded into `toISLRobustnessRequest` via a new
     optional `prebuiltParameterUncertainties` param (`translator-v3.ts`,
     `parameter_uncertainties: prebuiltParameterUncertainties ?? buildParameterUncertaintiesV3(graph.nodes)`).
     `filteredGraph.nodes` is `const` and not mutated between plan-time and
     build-time (verified: no `filteredGraph =` / `.nodes =` / mutating array op),
     and `buildParameterUncertaintiesV3` is a pure function of `nodes`, so the
     request carries a byte-identical PU list while the pass runs once. Also closes
     the lockstep-drift hazard (plan count can no longer diverge from what the
     request sends).
   - Constraint side: one id→node `Map` is built once in `run.ts` (only when
     constraints exist — no-constraint fast path pays nothing) and threaded into
     BOTH `selectConstraintInjectedPuNodeIds` (plan) and
     `injectConstraintParameterUncertainties` (build) via a new optional
     `sharedNodeMap` param on each. The map is identical to the one each function
     built internally (same nodes, same construction, last-wins on dup ids), so the
     classify decisions, `injected`/`skipped` outputs, and all log events are
     byte-identical. The classify logic itself was already single-sourced
     (`classifyConstraintPu`). Chose to share the nodeMap (the low-risk option the
     doc offers) rather than re-plumb the injector's mean/skipped derivation.

2. **Consolidate the finite-check predicates → new `src/util/numeric.ts`.**
   Relocated the shared `typeof===number && Number.isFinite` family to a NEUTRAL
   leaf util: `isFiniteNumber`, `isNonNegInt`, `finiteNum`, `nonNegInt`, plus
   `allFiniteNumberFields` (item 4). Importers:
   - `routes/v2/numeric-egress-guards.ts` imports `finiteNum`/`nonNegInt` from util
     and RE-EXPORTS them (so `run.ts`'s existing import path is unchanged);
     `prob01`/`nonNeg`/`hasAllRequiredOutcomeStats` kept local (not duplicated
     across files) but now build on the imported `isFiniteNumber`.
   - `routes/v2/enrichment-egress-guard.ts` — removed the local `isNonNegInt` /
     `finiteOf` closures; imports `isNonNegInt` + `finiteNum` (`finiteOf`→`finiteNum`).
   - `integrations/isl/compute-admission.ts` — removed local `isFiniteNumber`;
     imports from util.
   **Layering:** `src/util` is a leaf both `routes/v2` and `integrations/isl` import
   from, so it avoids the `integrations/isl → routes/v2` inversion a shared home in
   either dir would have created. Resolves cleanly (tsc green).

3. **normIds extraction** (`lib/intervention-override.ts`) — `factorIdOf` and
   `hasFactorIdConflict` now both call a private `normIds(f) => {nodeId, factorId}`
   carrying the identical empty-string+type normalization.

4. **Unify validWeights/validCaps** (`integrations/isl/compute-admission.ts`) —
   both are now `allFiniteNumberFields(o, KEYS)` over `WEIGHT_KEYS`/`CAP_KEYS`.
   Same boolean result (AND over the same field list; order-independent).

5. **Extract getHealthResponse** (`integrations/isl/client.ts`) — `healthCheck()`
   and `fetchHealth()` share a private `getHealthResponse()` (GET `/health` + auth
   header + AbortController timeout, timeout cleared in `finally`); each caller reads
   only its tail (`response.ok` vs parsed body). Return values unchanged.
   Minor internal improvement: `healthCheck`'s timer is now always cleared
   (`finally`), where the old inline version left it dangling on the fetch-reject
   path — not observable in return value or wire output.

6. **Name the optional-phase retry constant** — `OPTIONAL_PHASE_MAX_RETRIES = 1` in
   `config/timeouts.ts` (next to `ISL_MAX_RETRIES_DEFAULT`), replacing the bare `1`
   at the flip-probe and thresholds call sites in `run.ts`.

## Gate result (authoritative, fresh clone with vendored schemas installed)

- `tsc -p tsconfig.json --noEmit` — **0 errors**.
- `npm run build` (all 3 steps: `tsc tsconfig.json` + `tsc tsconfig.tools.json` +
  `check-no-stale-js.sh --clean`) — **exit 0**, "OK: No stale .js files in src/".
- `scripts/pre-push-validate.sh` — **PASSED**, 6/7 checks run, 0 failures:
  - 1/7 branch guard PASS · 2/7 tsc PASS · 3/7 full suite PASS
    (**Tests 5701 passed | 25 skipped (5737)**) · 4/7 stale-js PASS ·
    5/7 file-dep policy PASS · 6/7 OpenAPI spectral lint PASS.
- No SSE-429 flake observed this run; `gates(windows)` checkout red is CI-only
  (not run locally) and unrelated.

## Byte-identical evidence (wire output unchanged)

Existing goldens + boundary/PU tests all pass UNCHANGED (no golden edits):
- `tests/golden/translator-fixtures.test.ts` (18), `tests/golden/constraint-pu-regression.test.ts` (5),
  `tests/constraint-pu-injection.test.ts`, `tests/parameter-uncertainty-propagation.test.ts`,
  `tests/boundary-plot-to-isl.contract.test.ts`, `tests/multi-constraint.test.ts` — 168 passed.
- `tests/gates/numeric-egress-guards.test.ts`, `tests/enrichment-egress-guard.unit.test.ts`,
  `tests/isl-compute-admission-handshake.test.ts` — 43 passed.
- `tests/factor-id-canonicalisation.test.ts`, `tests/plot-remediation.optional-phase-retry.route.test.ts` — 10 passed.
- Health/enrichment/timeout/intervention set — 181 passed.

No `contracts/openapi.yaml` change → base-vs-branch standing-red set unchanged.
