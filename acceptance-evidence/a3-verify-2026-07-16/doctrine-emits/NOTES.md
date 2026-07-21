# Doctrine emits 039 / 013 / 014 — evidence NOTES

Producer-owned emit lane on `plot-lite-service` `/v2/run`:

- **039** — `driver_label` (strong/moderate/minor) over normalised `influence_score`
  (`src/lib/driver-label.ts`, wired in `src/routes/v2/run.ts`).
- **013** — fragile-edge `visible` gate over `switch_probability`
  (`src/trust/edge-severity.ts`, wired in `src/routes/v2/run.ts`).
- **014** — `evidence_hint` ("gather evidence") gate over real counterfactual EVPI
  with VOI fallback (`src/lib/evpi-emission.ts`, wired in `src/routes/v2/run.ts`).

All three are **producer-DISCLOSED flags** derived from scalars the wire already
carried; none filters an array or changes an existing shipped scalar.

---

## §013 — fragile-edge `visible`

Ratified cut-point `FRAGILE_EDGE_VISIBLE_MIN = 0.15` (from the UI's
`THRESHOLDS.FRAGILE_EDGE_FILTER`, strict `>`). The pure helper
`deriveFragileEdgeVisible` **omits** the field on absent/non-finite input.

**KNOWN SEAM (rowed) — the absent-omitting behaviour is NOT end-to-end.** The
upstream adapter `normalizeFragileEdge` (`src/integrations/isl/adapters/robustness-analysis.ts:65`)
defaults `switch_probability ?? 0`. So on the live wire an sp-less fragile edge
reaches the helper as `0` and emits `visible:false` (consistent with its
likewise-`?? 0`-defaulted `severity` on the same seam) — NOT an omitted field.
This is unreachable on current ISL output (fragile edges always carry sp). The
real fix is the source `?? 0` kill, tracked separately (NOT done here).

## §014 — `evidence_hint`

Gate: real counterfactual `evpi_percentage_points >= EVPI_HINT_MIN_PP (0.5pp)`
where present, else heuristic `value_of_information > VOI_HINT_MIN (0.05)`, else
no field. Levers (`zero_reason === 'intervention_override'`) are skipped.

**`EVPI_HINT_MIN_PP = 0.5` is a PROVISIONAL, WEAKLY-grounded placeholder.** The
available staging captures (`isl-v2-live-2026070{6,7,8}`) are near-duplicate
re-captures (effectively 1–2 distinct runs, mixed metric types), and the
observed "material" EVPI values sit at/below ISL's own ~6pp counterfactual noise
floor — so this gate is **near-inert** on current stamped builds. The value is
harmless (one-line reversible), but the REAL threshold is DOCTRINE-PENDING
(Neil), to be set once EVPI is calibrated against a wider, distinct sample. Do
NOT cite a "clean bimodal 0.85–7.8pp band" as firm grounding.

## §039 — `driver_label`

3-band label (`>=0.50` strong / `>=0.20` moderate / else minor) over normalised
`influence_score`, ratified from the UI's `useResultsSectionData.ts` cut-points.
Absent/non-finite influence ⇒ no label.

**NOTE — `driver_label` does NOT yet supersede the UI's `getSemanticLabel`.** The
UI helper is **4-valued** (adds a rank-1 'biggest'/'strongest' band) and keys off
normalised `|elasticity| / max`, NOT the wire `influence_score`. So the UI cannot
fully drop its copy on this field alone. Reconciling the rank-1 band and the
elasticity-vs-influence basis is a doctrine row (Neil/UI), tracked separately.
The field is valid and honest as a producer influence-band.

---

## Adversarial-round claim corrections (2026-07-21)

Corrections from the adversarial review of this lane. **No shipped value moved**:
`FRAGILE_EDGE_VISIBLE_MIN` (0.15), `DRIVER_LABEL_STRONG_MIN`/`MODERATE_MIN`
(0.50/0.20), `EVPI_HINT_MIN_PP` (0.5), `VOI_HINT_MIN` (0.05) are all unchanged,
and the `plot-v2-run.golden.json` bytes are unchanged (verified zero-delta). The
changes are **comments, one test file, and this NOTES** only.

1. **013 route test de-circularised** (`tests/doctrine-013-fragile-edge-visible.test.ts`).
   The old "every visible flag matches deriveFragileEdgeVisible(switch_probability)"
   route assertion read `e.switch_probability` from the wire — already `?? 0`
   defaulted by the upstream adapter — so it compared the code against itself and
   could never detect that an absent-sp edge fabricates `visible:false`. Rewritten
   to (a) assert only the REACHABLE threshold-correctness for edges that carry sp,
   explicitly noting it is not an absence check; and (b) ADD a KNOWN-LIMITATION
   describe that feeds the route an ISL fragile edge OMITTING `switch_probability`
   and PINS the current seam honestly: the wire emits `visible:false` (via the
   upstream `?? 0`), not an omitted field. That pin PASSES today and would FAIL if
   the upstream `?? 0` were removed (visible would then be omitted) — so it will
   alarm when the rowed source fix lands and must then be flipped to the honest
   absent⇒omitted expectation. The honest unit tests
   (`deriveFragileEdgeVisible(undefined) → undefined`) are unchanged.

2. **013 helper/header comment corrected** (`src/trust/edge-severity.ts` +
   013 test-file header). The claim "non-finite switch_probability ⇒ NO visible
   field (honesty)" is true of the HELPER but FALSE of the route path. Amended to
   disclose that the upstream `?? 0` default makes the live wire emit
   `visible:false` for an sp-less edge (unreachable on current ISL output; source
   `?? 0` kill rowed) — do not describe this field as absent-omitting end-to-end
   until that fix lands.

3. **014 grounding narrative corrected** (`src/lib/evpi-emission.ts`
   `EVPI_HINT_MIN_PP` docstring + 014 test-file header). Replaced the overstated
   "clean bimodal 0.85–7.8pp band" grounding with the honest PROVISIONAL /
   WEAKLY-grounded framing (see §014 above). Value 0.5 unchanged; real threshold
   DOCTRINE-PENDING (Neil).

4. **039 "UI drops its copy" claim corrected** (`src/lib/driver-label.ts` header +
   039 test-file header). The UI's `getSemanticLabel` is 4-valued and keys off
   `|elasticity|`, not `influence_score`, so `driver_label` is NOT a drop-in
   replacement. Amended to present it as a producer-owned influence-band that does
   not yet supersede `getSemanticLabel`; reconciliation is a doctrine row.
