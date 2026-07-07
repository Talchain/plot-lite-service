# LANE 25 — Goal-fit doctrine B: deliver modelled goal-fit instead of suppressing (P0-C2)

Date: 2026-07-07
Branch: `claude-lane25/goalfit-doctrine-b` (base `origin/staging` ff423310 — includes PR #203)
Doctrine reference: product-owner decision, 2026-07-07, **"option B"** — goal-fit is
scored from the goal node's forward-propagated outcome distribution vs the normalised
threshold, instead of being suppressed because the goal node has no observed value
channel.

## 1. Problem (verified current behaviour on base)

On the live goal-target run (goal node with CEE-stamped `goal_threshold: 0.2` /
`goal_threshold_cap: 100`, explicit `'%'` goal constraint, no observed value on the
goal node):

- ISL computes differentiated per-option goal probabilities from the exact goal
  outcome-sample series, and flags `CONSTRAINT_NODE_DEFAULT_BASE` (base defaulted to
  0.0) via `inference_warnings`.
- Post-#203 the threshold normalisation leg is sound (producer-declared scale), so
  the ONLY remaining unreliability reason is `target_base_defaulted`.
- PLoT (`src/lib/constraint-reliability.ts` + `buildResponse` in
  `src/routes/v2/run.ts`) still SUPPRESSED `probability_of_joint_goal` /
  `constraint_probabilities` for the whole run and emitted the WARNING-severity
  `CONSTRAINT_TARGET_UNRELIABLE` — the user's ratified target produced no goal-fit at
  all.

RED evidence: `tests/goalfit-doctrine-b.fixture.test.ts` on base ff423310 — the three
doctrine tests fail (probabilities absent / warning present); the suppression PINs and
regression controls pass (i.e. the fixture isolates exactly the doctrine surface).

## 2. Mechanism implemented

### Classification (`src/lib/constraint-reliability.ts`)

- `detectUnreliableConstraintTargets` is unchanged (detection semantics identical).
- NEW `partitionConstraintTargets(targets, graph)` splits detected targets:
  - **`modelledBasis`** (doctrine B delivery): reason set is exactly
    `{target_base_defaulted}` AND the target node has ≥1 **directed** incoming edge
    in the graph PLoT sent to ISL (bidirected edges excluded — the ISL translator
    strips them from the forward model, `translator-v3.ts:414`).
  - **`suppressed`**: everything else (default-range normalisation, mixed reason
    sets, root-node targets, absent graph). Conservative on absent inputs.
- NEW `GOAL_FIT_SCORED_FROM_MODELLED_OUTCOME = 'modelled_outcome_distribution'` and
  `buildConstraintGoalFitModelledMessage(nodeLabel)` (claim-safe info-note wording,
  `provisional_doctrine_v0` surface; never quotes the delivered numbers).

### Emission (`src/routes/v2/run.ts`, buildResponse)

- Run-level suppression now keys on `partition.suppressed.length > 0`. When ANY
  target suppresses, the whole run suppresses **exactly as today** (mixed
  multi-constraint runs included), with the same WARNING-severity
  `CONSTRAINT_TARGET_UNRELIABLE` per affected node and the same
  `constraint_probability_suppressed` diagnostics log.
- When nothing suppresses and `modelledBasis` targets exist, per-option
  `probability_of_joint_goal` / `constraint_probabilities` are DELIVERED unchanged,
  plus an **additive** annotation on each delivering option:

  ```json
  "goal_fit_basis": {
    "scored_from": "modelled_outcome_distribution",
    "node_ids": ["goal_productivity"]
  }
  ```

  and one info-severity `CONSTRAINT_GOALFIT_MODELLED_BASIS` inference warning per
  affected node (new code in `INFERENCE_WARNING_CODES`, `src/types/engine-v3.ts`).
  A `constraint_probability_modelled_basis` info log marks each delivery.
- The decision brief's `warning_codes` echoes **warning-severity** codes only
  (`buildWarningCodes`), so the info note does not enter the brief — no brief drift.
- Coaching (`generateM1Coaching` call site): DELIBERATELY left stricter than the
  wire — the GOAL_FEASIBILITY_LOW joint-prob gate still skips for base-defaulted
  targets. A feasibility claim derived from a modelled-baseline number needs its own
  caveated wording; silence stays the claim-safe default until that wording is
  ratified. Pinned by the existing "does not fabricate GOAL_FEASIBILITY_LOW" test.
- Boundary contract doc updated: `src/contracts/isl-to-ui.contract.ts` (filtered
  section now records the doctrine-B exception).
- OpenAPI: the hand-authored spec (`openapi-plot-lite-v1.yaml`) covers V1 only and
  never documented `probability_of_joint_goal`/`option_comparison`; no spec change
  required for this V2-only additive field (verified by grep — 0 hits).

## 3. Semantic-coherence check (deliverable 3 — ISL read-only)

Question: are the goal node's sampled values and the normalised threshold (0.2)
apples-to-apples on the same [0,1]/cap scale, given the defaulted base=0.0?

Verified from ISL code (`Inference-Service-Layer/src/services/robustness_analyzer_v2.py`,
read-only):

1. **Same series as the outcome distribution.** Constraint-target samples are
   captured by `evaluate_multi` inside the same Monte Carlo pass that produces the
   outcome distribution (`_run_monte_carlo`, lines ~1032-1064; `evaluate_multi`
   lines 528-601 duplicates `evaluate`'s structural equation). For a constraint on
   the goal node, `constraint_node_values[option][goal]` is the **identical**
   forward-propagated series used for `outcome.mean/p10/p50/p90`.
2. **What base=0.0 means.** Node value per sample =
   `base + intercept + Σ(parent_value × sampled_strength)` (lines 596, 516). The
   defaulted base (line 583, non-root node without factor sample/observed value)
   makes the goal samples the modelled level attributable to upstream propagation
   from a zero baseline — a real distribution (differentiated across options via
   interventions and sampled strengths), NOT a constant placeholder.
3. **Same scale as the threshold.** `_check_constraint_satisfied` (lines 3076-3097)
   compares each sample against `constraint.threshold` — the value PLoT normalised
   to the goal node's [0,1]/cap scale (0.2 = 20% of `goal_threshold_cap` 100,
   `normaliseGoalConstraints`, `src/lib/intervention-normaliser.ts:951-1047`). The
   samples are on the same normalised scale: PLoT normalises interventions to [0,1]
   (Phase 4a), CEE-drafted node values are [0,1], and edge strengths are unitless
   multipliers in the linear SCM — so `Σ(parent∈[0,1] × strength)` is the goal
   node's modelled normalised level.
4. **The decisive apples-to-apples argument:** ISL's already-delivered,
   never-suppressed `probability_of_goal` is computed as
   `mean(outcome_samples >= request.goal_threshold)` (lines 1242-1245) — the SAME
   samples against the SAME PLoT-normalised threshold. Doctrine-B delivery of
   `prob_satisfied` for a goal-node constraint is computationally the same
   comparison; suppressing one while shipping the other was incoherent.

**Conclusion: no scale mismatch; no PLoT-side comparison change needed.** The honest
residual caveat is the zero baseline (samples measure modelled change from a zero
base, not from an observed level) — exactly what the `goal_fit_basis` annotation and
the info note disclose.

Guard rail derived from this analysis: ISL emits `CONSTRAINT_NODE_DEFAULT_BASE` only
for **non-root** nodes (line 741, `if not is_root and …`), so the marker itself
implies forward propagation; PLoT's incoming-edge check in
`partitionConstraintTargets` is defensive against ISL semantics drift, and a
root-node target (constant-placeholder samples) keeps suppressing.

## 4. Fixture diff (deliverable 1)

New: `tests/goalfit-doctrine-b.fixture.test.ts` (8 tests) — the live goal-target
request shape (goal node `goal_threshold: 0.2` / `goal_threshold_cap: 100`, explicit
`'%'` constraint) with an ISL response fixture carrying **differentiated** per-option
goal probabilities (0.62 / 0.38) + the live-shape `CONSTRAINT_NODE_DEFAULT_BASE`
warning:

- RED→GREEN: delivery of differentiated probabilities; `goal_fit_basis` annotation;
  info-severity `CONSTRAINT_GOALFIT_MODELLED_BASIS` (naming the node, "modelled",
  never quoting the numbers) with NO `CONSTRAINT_TARGET_UNRELIABLE`.
- PINs (passed on base AND after): default-range normalisation suppresses; mixed
  multi-constraint run suppresses the whole run; root-node base-defaulted target
  suppresses.
- Regressions (passed on base AND after): reliable-target run delivers WITHOUT
  annotation/note; no-goal-constraints run untouched.

Updated pins (all were explicitly awaiting the P0-C2 doctrine decision):

- `tests/goal-threshold-normalisation.fixture.test.ts` — the P0-C2 boundary PIN
  ("suppression still fires on target_base_defaulted ALONE") re-pinned to the
  ratified doctrine: delivery + annotation + info note.
- `tests/constraint-target-unreliable.fixture.test.ts` — the two suppression pins
  moved from `'%'` (now a doctrine-B delivery case post-#203) to `'points'` (no
  declared scale → default-range leg still fires); coaching-conservatism test kept
  on `'%'` deliberately.
- `tests/constraint-reliability.unit.test.ts` — +9 unit tests for
  `partitionConstraintTargets` (root/bidirected/absent-graph conservatism, mixed
  sets) and the new message builder.

## 5. Regression pinning (deliverable 5)

- Non-goal constraints on reliable targets: `tests/cil-constraint-passthrough.test.ts`
  (7 tests) — byte-identical path (annotation only attaches when a modelledBasis
  target exists).
- Multi-reason suppression: pinned in the new fixture + re-pinned item-A fixture.
- Runs without goal constraints: pinned in the new fixture (no constraint fields, no
  annotation, no note).
- Brief claim-safety: `tests/decision-brief.claim-safety.test.ts` (22 tests) —
  unchanged (info notes are not echoed into `warning_codes`).

## 6. Test results

- `npx tsc --noEmit` — clean.
- Affected suites: 6 files, 70 tests — all pass.
- `npx vitest run --changed` (after `npm run build`; the spawn-server suites need
  `dist/`): **171 files, 1464 passed, 5 skipped, 0 failed**.

## 7. What remains for ISL (follow-up lane; ISL repo occupied, not touched)

1. **Warning reclassification (cosmetic, low priority):**
   `CONSTRAINT_NODE_DEFAULT_BASE`'s message text ("… constraint probability may be
   unreliable") is forwarded verbatim by PLoT's ISL-warning merge (info severity).
   Under doctrine B the sentence is stale for the forward-propagated goal-node case
   — the probability is now the ratified scoring basis. Suggested ISL change:
   distinguish "non-root defaulted base (modelled distribution; scored per doctrine
   B)" from any future root-ish degenerate case in the message, or drop the
   "may be unreliable" clause for non-root targets. No structural change needed:
   PLoT already classifies correctly from the existing `detail.node_id` payload.
2. **No semantic change required** — the sample/threshold comparison was verified
   coherent (§3). Nothing in ISL blocks doctrine B.

## 8. Residual risks / deliberate stops

- **Coaching stays conservative** (GOAL_FEASIBILITY_LOW still skipped for
  base-defaulted targets even when the wire delivers). Deliberate; needs a ratified
  caveated wording before coaching may consume modelled goal-fit.
- **Top-level `constraint_results[].probability` (buildConstraintFields) was never
  gated by the item-A suppression** (pre-existing seam, unchanged by this lane): it
  carries the first option's `prob_satisfied` regardless of target reliability. Out
  of scope here; flagged for a follow-up honesty pass.
- The `goal_fit_basis` field is additive and undocumented in `@talchain/schemas`;
  consumers on older schema pins will silently drop it (platform-known hazard). The
  UI gates goal-fit on field absence, so delivery itself is consumed; only the
  provenance annotation is at drop risk until the schema package adds it.
