# Lane 2 evidence report — ISL V2 science channel (PLoT)

- **Branch:** `claude-lane2/isl-v2-science-channel` (from `origin/staging` @ `e01c03c` — PR #197 hook-timeout merge)
- **Date:** 2026-07-07
- **Scope:** PLoT reads five science fields at V1-shaped locations the live ISL V2 wire never emits; repoint/delete them, add EVPI hygiene, confidence_tier reconciliation, duplicate-edge preflight, warning tolerance, and a liveness fixture gate.
- **Contracts:** FROZEN — no boundary field shapes changed. Wire-visible deltas are value-level only (fields that already existed now populate honestly; see below).

## 0. Fixture provenance (FIRST ACTION)

The lane brief named `isl-staging-capture.json` / `isl-v2-request.json` in the session scratchpad. **Those standalone files did not exist** (scratchpad contained `plot.jsonl` / `isl.jsonl` / `cee.jsonl` boundary logs). The raw payloads were recovered from PLoT `boundary.response` log entries (`plot.jsonl` lines 70 and 100), which embed the full ISL request/response for two live `/api/v1/robustness/analyze/v2` calls (deployed ISL build `f3f5d92`, 2026-07-06T23:32/23:39Z):

- `tests/fixtures/isl-v2-live-20260706/isl-v2-request.json` + `isl-staging-capture.json` (capture A — plain run)
- `…-request-b.json` + `…-capture-b.json` (capture B — with `goal_constraints`)

Sanitisation: scanned for IPs / emails / hostnames / keys — none present; data is synthetic (hiring-decision demo graph). Committed as `c1835e4` before any code change.

## 1. Wire truth (machine-checked in `tests/isl-v2-envelope.unit.test.ts`)

| Field | V1-shaped read (dead) | Live V2 location | Fixture proof |
|---|---|---|---|
| edge E-values | top-level `edge_e_values` (run.ts) | **nested `robustness.edge_e_values`** (13 entries) | both captures |
| edge sensitivity | top-level `sensitivity` | **NOT EMITTED — V2 wire drops it, no replacement** | both captures |
| validation status | top-level `validation_status` | **NOT EMITTED** | both captures |
| computed timestamp | top-level `computed_at` | **top-level `timestamp`** | both captures |
| factor VOI | `factor_sensitivity[].value_of_information` | **top-level `factor_evpi[]`** (per-factor EVPI) | both captures |

Additional wire facts discovered and pinned:

- `edge_e_values[].flip_direction` live vocabulary is `increase`/`decrease` (typed union previously claimed `positive_to_negative | negative_to_positive | removal`) → PLoT types widened to `string`; passthrough verbatim (ISL owns semantics).
- `is_unflippable: true` entries (4 of 13) **omit `e_value` entirely**. PLoT's numeric-egress guard drops them from outward `edge_e_values` (logged via `edge_e_values_dropped_nonfinite`). Representing unflippable edges outward needs contract work → followup.
- `factor_evpi` carries a **raw negative** entry live: `fac_hiring_cost` `evpi=-0.0015` / `-0.15pp` (MC sampling noise) — the hygiene target for item C.

## 2. What changed (by lane item)

**A — V2 envelope repoint** (`src/integrations/isl/v2-envelope.ts` new; `src/routes/v2/run.ts`; `src/integrations/isl/types/isl-types.ts`)
- `getIslEdgeEValues()`: nested-first accessor (legacy top-level tolerated for old fixtures). Both read sites (primary ~run.ts:4290, fallback ~run.ts:1815) repointed → **`edge_e_values` now populates on the live path (was structurally `[]` forever)**.
- `getIslComputedAt()`: reads V2 `timestamp` → `meta.computed_at` now carries the ISL wire timestamp (was silently falling back to PLoT clock).
- Top-level `sensitivity` reads **deleted** (primary + fallback + CEE `top_edge_drivers`). NO substitute invented. Empty `edge_sensitivity` on a computed analysis is now explicitly marked with new info-level inference warning `EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE` (uses the existing open-vocabulary `inference_warnings` field — no schema change).
- `validation_status`/`validation_confidence` reads deleted from the CEE review request (structurally undefined live → behaviour-identical); `sensitive_parameters.sensitivity` repointed to `sensitivity_score ?? sensitivity`.

**B — VOI honesty** (`v2-envelope.ts`, `src/config/flags.ts`)
- `factor_sensitivity[].value_of_information` read kept but documented as V1-only/dead (public VOI comes from the graph heuristic — unchanged).
- `mapIslFactorEvpi()` guarded internal mapping proves `factor_evpi` arrives; behind **`ISL_FACTOR_EVPI_INTERNAL` (default OFF everywhere)** it logs sanitised diagnostics only. **NOT wired into any user-facing VOI/EVPI surface (P-5 pending).** Public response byte-identical flag on/off; liveness test pins zero leakage.

**C — EVPI hygiene** (`src/lib/evpi-emission.ts`)
- `classifyEvpiPercentagePointsForEmission()`: never emits a negative outward; raw < 0.05pp (incl. all negatives) → `below_resolution: true` + no outward value (labelled, **not clamped to zero**); raw kept in diagnostics fields only. Existing surfaces already sanitise (`sanitiseIslVoi`, `computeEvpiPercentagePoints` clamp) — verified, unchanged.

**D — confidence_tier reconciliation** (`src/trust/confidence-tier.ts`, run.ts assembly)
- `reconcileConfidenceTier()`: caps `strong` → `fair` when the same response carries `robustness.is_robust === false` or `level ∈ {low, very_low}`. Lower tiers never raised; absent robustness leaves tier unchanged. Applied at the single `confidence_tier` emission site.

**E — duplicate-edge preflight** (`src/integrations/isl/preflight.ts`, run.ts before `toISLRobustnessRequest`)
- Exact-identical duplicates (every field equal) coalesced to one edge; logged through existing `repairs_applied` (`COALESCE_DUPLICATE_EDGE: …` reason).
- Non-identical duplicates (same `(from,to,type)`, differing values) → **422 typed blocker** critique `DUPLICATE_EDGE_CONFLICT` naming the pair and divergent fields; ISL is never called. Never silent dedupe.

**F — CONSTRAINT_SAMPLES_UNNOISED** — the warning-forwarding path is open-vocabulary (any `code` string passes; unknown severities degrade to `info`). Verified + pinned by test; no code change needed beyond the tests.

**G — liveness fixture gate** (`tests/isl-v2-liveness.fixture.test.ts`) — every science feature requested on the wire must be non-empty OR explicitly marked; silent empty arrays fail.

## 3. RED → GREEN proof

- With the old top-level `edge_e_values` read temporarily restored (one-line revert), the liveness test **fails**: `edge_e_values` length 0 ≠ 9 (`Tests 1 failed | 11 skipped`).
- With the fix: `Tests 12 passed (12)`.
- Envelope unit tests independently pin the absence of every V1 location and the presence of every V2 location on the raw captures (23 tests).
- Duplicate-edge unit suite caught a real key-collision bug in the first implementation (space-delimited key: `("a b","c")` vs `("a","b c")`) — fixed with JSON-encoded keys; regression test retained.

## 4. Test results

| Suite | Result |
|---|---|
| `npm run typecheck` (`tsc -p tsconfig.json --noEmit`) | PASS (after fresh `npm ci`; also passes on untouched baseline except pre-existing notes below) |
| `tests/isl-v2-envelope.unit.test.ts` | 23 passed |
| `tests/isl-v2-liveness.fixture.test.ts` | 12 passed (RED without fix A) |
| `tests/duplicate-edge-preflight.test.ts` | 11 passed (unit + route-level incl. 422 blocker) |
| `tests/confidence-tier-reconcile.test.ts` | 8 passed |
| `tests/stability-thresholds-passthrough.test.ts` (updated IW1–IW4 to filter by code) | PASS |
| `tests/b1-confidence-tier.test.ts`, `tests/b8-8-3c-field-segregation.test.ts` | PASS |
| `tests/golden/golden.test.ts` + `tests/golden/integration.test.ts` (pricing canary) | PASS — fixture files untouched, present-0 passthrough byte-identical |
| `tests/passthrough-enrichment`, `enrichment-emission-contract`, `boundary-isl-to-ui.contract` | 43 passed |
| `tests/lane-p0a-lever-evpi-egress.integration`, `v2-contract.smoke`, coaching readiness-tone | PASS (v2-contract.smoke requires `npm run build` first — `spawnServer` runs `node dist/main.js`; fails standalone in a fresh tree without build, pre-existing infra behaviour) |

Honest notes:
- Running many server-spawning suites **in one parallel vitest invocation** intermittently hits the 10s hook timeout (contention); each suite passes when run in smaller batches. The repo's own gate (`npm test` via `tools/run-all-tests.js`, exercised by the pre-push hook) is the authoritative pass.
- Pre-existing lint warnings (3: `no-console` in preflight.ts, 2 unused type imports in run.ts) exist on the untouched `origin/staging` baseline — verified via `git stash` + eslint; no new lint debt added.
- Known pre-existing CI reds on every PR (not chased, per lane brief): `audit` (fast-uri/fastify advisories) and `gates (windows-latest)` (invalid path `tools/sdk-smoke:python.mjs`).

## 5. Wire-visible deltas (live path)

1. `edge_e_values`: `[]` → 9 enriched entries (field existed; now populated).
2. `meta.computed_at`: PLoT receive-clock → ISL wire `timestamp`.
3. `inference_warnings`: + `EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE` (info) on computed responses with empty edge sensitivity.
4. `confidence_tier`: capped at `fair` when the same response is non-robust (was possible to emit contradictory `strong`).
5. New 422 (`DUPLICATE_EDGE_CONFLICT`) for conflicting duplicate edges; exact-identical duplicates coalesced with a `repairs_applied` record (previously the request would 422 opaquely at ISL).

No field added/removed/renamed on any boundary payload.

## 6. Followups (recorded, NOT implemented)

1. **ISL contract work: edge-level sensitivity** — the V2 wire genuinely drops it; PLoT must not invent a substitute. Needs an ISL-side decision/field.
2. **Unflippable E-value entries** — live wire omits `e_value` on `is_unflippable: true` entries; PLoT's outward `EnrichedEdgeEValue` requires `e_value`, so 4/13 entries are dropped (logged). Representing "unflippable" outward (e.g. optional `e_value` + `is_unflippable` passthrough) is a contract change → blocked by freeze.
3. **P-5 (Paul)** — wire `factor_evpi` (true counterfactual EVPI) into user-facing VOI/EVPI, replacing the graph heuristic; the guarded mapping + hygiene is ready behind `ISL_FACTOR_EVPI_INTERNAL`.
4. **OpenAPI spec** — `edge_e_values` (and several emitted fields) are absent from the hand-authored `contracts/openapi.yaml`; spec lags the wire. No shape change made this lane, so no spec edit; a reconciliation pass is due.
5. `buildISLResponseSummary.sensitivity_count` (logging only) still reads the dead top-level field — harmless truthful 0; tidy on next touch.
