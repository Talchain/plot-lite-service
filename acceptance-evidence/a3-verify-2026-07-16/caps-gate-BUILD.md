# PLoT admission CAPS gate — completing the /health capability handshake (A3 BUILD)

Base: `origin/staging` = `ad255d3c90a9b0fe5a28f3cfdf40a486ca10d38b` (#233, the COST half of the
handshake). Built in a FRESH shallow clone at that tip (local working tree stale/hung-fetch — per
CLAUDE.md verification trap #1 the clone is the authority). Node v20.19.5, npm 10.8.2, `npm ci` clean.

Branch: `feat/admission-caps-handshake-a3`.

Completes finding **A1** of `SIMPLIFY-CONSOLIDATED-2026-07-19.md`: #233 shipped the COST half
(`planSampleDepth` vs advertised `max_cost_units`); this ships the **CAPS half**.

## Problem (verified) — the passthrough gap the handshake exists to prevent

ISL advertises structural caps on `/health` (`compute_admission.caps`:
`max_nodes` / `max_edges` / `max_options` / `max_parameter_uncertainties`) SPECIFICALLY so PLoT can
pre-check them and refuse BEFORE calling ISL. But the admission-planning path
(`planWeighted`/`planSampleDepth`, `src/config/sampling.ts`, called at `run.ts` ~4499) read ONLY
`max_cost_units` + `weights` — it never consulted `caps`.

Consequence: a request UNDER the cost ceiling but OVER a structural cap was forwarded and came back a
**raw Pydantic 422** ("List should have at most 50 items"), the exact PLoT-passes-ISL-422 passthrough
the handshake is meant to prevent. The genuinely un-checkable dimension is **`max_parameter_uncertainties=50`**:
`grep` confirms ZERO PU-count check anywhere in PLoT `src/`. PLoT enforces node/edge/option from its OWN
`LIMITS` mirror (which can skew from ISL's pin) but has NO check for `parameter_uncertainties` at all.

**Live-verified ISL advertisement** (isl-staging `/health`, 2026-07-18, carried from #233 evidence) —
`compute_admission.caps`: `{ max_options 10, max_nodes 50, max_edges 200, max_parameter_uncertainties 50 }`.
PLoT LIMITS (schemas 0.15.0): `MAX_NODES 50 / MAX_EDGES 100 / MAX_OPTIONS 10`.

## What changed (scoped to the admission-planning path only)

| File | Change |
|---|---|
| `src/config/sampling.ts` | NEW `checkAdmissionCaps(input, admission, limits)` + `AdmissionCapsInput` / `AdmissionCapsDecision` / `AdmissionCapDimension` / `StructuralSafetyLimits`. Pure function; no change to `planSampleDepth`/`planWeighted` (the shipped cost path is untouched). |
| `src/routes/v2/run.ts` | Calls `checkAdmissionCaps` at the plan call site — right after `getIslComputeAdmission()`, BEFORE `planSampleDepth` — using the counts ALREADY assembled for the cost formula (`causalNodeCount`, `causalDirectedEdgeCount`, `causalOptionCount`, `uniqueParamUncertainties`). On breach → the SAME structured `GRAPH_TOO_COMPLEX` blocked response (422 via `buildBlockedResponse`) the cost ceiling produces, naming the cap + observed/limit; plus a `graph_exceeds_admission_cap` warn log. NEW helper `capsRefusalMessage`. |
| `tests/isl-admission-caps-gate.test.ts` | NEW — 10 tests (RED-first + positive control + derive-not-mirror + no-regression + skew fallback). |

`contracts/openapi.yaml` NOT touched. PLoT's preflight LIMITS checks elsewhere NOT touched.

## Design decisions (matching the task spec)

- **PU (the must-add, genuinely un-checkable):** `uniqueParamUncertainties > caps.max_parameter_uncertainties`
  → refusal. No PLoT LIMITS twin exists, so the advertised cap is the sole gate. Checked FIRST.
- **Node/edge/option:** enforced at **`min(PLoT LIMITS, advertised caps.max_*)`** — the derive-not-mirror
  completion. An ISL-tightened cap (below PLoT's LIMITS) now bites here; PLoT's LIMITS stay the
  belt-and-braces LOWER bound so a garbage-high advertised cap can never WIDEN what PLoT admits.
  In normal operation (caps ≥ LIMITS) the min is LIMITS, which preflight already enforces → no new
  refusals; the only NEW refusals are (a) ISL-tightened caps and (b) requests ISL would 422 anyway.
- **Skew / no-caps fallback:** the caps check is gated on `admission !== null` — EXACTLY like the cost
  gate. When `/health` caps are absent (version skew / ISL unconfigured / cold warm-up) the resolver
  returns `admission: null` and `checkAdmissionCaps` returns `{ kind: 'ok' }` → NO spurious refusal;
  the conservative cost-gate fallback governs, byte-identical to today.
- **Handled response, not a throw:** structured `GRAPH_TOO_COMPLEX` via `buildBlockedResponse` (422),
  matching how the cost ceiling refuses — the caller gets the same handled shape.

## RED-first + positive control + mutation (throwaway-safe, isolated single-owner clone)

Test file `tests/isl-admission-caps-gate.test.ts`, 10 tests.

**Positive control (the passthrough gap):** a `10n/10e/1opt/51-PU @10000s` graph (weighted cost ≈ 2.36M
≪ 24M ceiling) → `planSampleDepth(...)` returns `kind: 'unchanged'` — the COST gate admits it at full
depth, i.e. PLoT WOULD forward it to ISL, which 422s it. This assertion PASSES both before and after the
fix, documenting the seam the caps gate closes.

**THE FIX (GREEN post-fix):** `checkAdmissionCaps` on the SAME input → `exceeded`, `dimension:
'parameter_uncertainties'`, `observed 51`, `limit 50`, `source 'isl_cap'`.

**Mutation-check:** neutered the caps logic (short-circuit `return { kind: 'ok' }` right after the null
guard) and re-ran →

```
❯ tests/isl-admission-caps-gate.test.ts (10 tests | 6 failed)
  ✓ POSITIVE CONTROL (passthrough gap) ...unchanged...        (control — stays green)
  × THE FIX: refuses the >50-PU graph naming the cap
  ✓ exactly AT the cap (50) admits                             (control — stays green)
  × DERIVE-NOT-MIRROR: tightened PU cap (5) bites at 10 PUs
  × 120 edges breach min(100,200)=100 via plot_limit
  × tightened caps.max_nodes 20 refuses 30 nodes via isl_cap
  × options over min(10,10) breach
  × PU checked FIRST (PU + edges → names parameter_uncertainties)
  ✓ WITHIN every cap admits (no regression)                    (control — stays green)
  ✓ SKEW / no-caps (admission null) does NOT refuse            (control — stays green)
```

Reverting the check turns the 6 over-cap tests RED while the 4 controls (positive-control passthrough,
at-cap=50 admits, within-caps admits, skew-null admits) stay GREEN. File restored (`0` MUTATION lines,
`git diff` shows only the intended `+121` insertions) and re-run → 10/10 GREEN.

## Controls confirmed

- **Within-caps still admits (no regression):** `50n/100e/10opt/50-PU` with a live block → `{ kind: 'ok' }`.
- **Skew / no-caps does NOT spuriously refuse:** `admission: null` with a wildly over-cap input
  (`999/999/999/999`) → `{ kind: 'ok' }`.
- **`min(LIMITS, cap)` used for node/edge/option:** YES — 120 edges breach the PLoT floor `min(100,200)=100`
  (`source plot_limit`); a tightened `caps.max_nodes 20` breaches at 30 nodes (`source isl_cap`).

## Gate results

| Gate | Result |
|---|---|
| `tsc -p tsconfig.json --noEmit` | PASS (0 errors) |
| `npm run build` (tsc app + tsc tools + `check-no-stale-js`) — all 3 steps | PASS (`OK: No stale .js files in src/`) |
| New test `tests/isl-admission-caps-gate.test.ts` | 10/10 PASS |
| Sibling regression (`isl-compute-admission-handshake` + `adaptive-n-samples-complexity` + `sampling-engine` + new) | 109/109 PASS |
| `scripts/pre-push-validate.sh` (7 checks) | PASS — branch guard, tsc, **full suite 5711 passed / 25 skipped**, stale-.js, file-dep policy, OpenAPI spectral lint. 0 failures |

Standing CI reds `gates (windows-latest)` + `audit` are tolerated (pre-existing, per CLAUDE.md).

## Merge-sequence note (for the orchestrator)

This branch is off `ad255d3c` and touches `src/config/sampling.ts` + `src/routes/v2/run.ts`, which the
HELD cleanup PR **#235** (`refactor/a3-simplify-cleanups`) also touches. Expected sequence: **merge #235
first, then rebase this caps PR onto it.** (The additions here are self-contained — a new function +
a new call-site block — so the rebase should be low-conflict, but sequence deliberately.)
