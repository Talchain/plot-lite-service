# LANE 27 — Gate top-level constraint_results by target reliability (ROADMAP 1.26a)

Date: 2026-07-08 (lane launched 2026-07-07)
Branch: `claude-lane27/constraint-results-top-level-gating` (base `origin/staging` 9026304 — includes LANE25/PR #204)
Follow-up to: `docs/lanes/LANE25-goalfit-doctrine-b-2026-07-07.md` §8, which filed this
exact leak as a residual risk ("Top-level `constraint_results[].probability`
(buildConstraintFields) was never gated by the item-A suppression").

## 0. Scope note — deliberate narrowing

A previously-planned wider scope for lane 27 included **ROADMAP 1.24** (V2-shaped ISL
reads + an `isl_version` assertion). That work is **deliberately split out into a
follow-up lane** and was NOT attempted here — this lane is the claim-integrity fix for
the top-level constraint leak only. The narrowing is stated here so it is visible; 1.24
remains open on the roadmap.

## 1. Problem (verified on base 9026304)

The producer-honesty suppression for unreliable constraint targets
(`src/lib/constraint-reliability.ts` — `detectUnreliableConstraintTargets` +
`partitionConstraintTargets`, applied in `buildResponse` of `src/routes/v2/run.ts`)
gated ONLY the per-option fields `probability_of_joint_goal` and
`constraint_probabilities`. The TOP-LEVEL constraint block built by
`buildConstraintFields()` still emitted:

- `constraint_results[].probability` = the first option's `prob_satisfied`,
  REGARDLESS of target reliability — on a suppressed run the withheld probabilities
  leaked straight back out via the top-level surface;
- `constraints_status: 'computed'` — a fabricated decision-grade claim over numbers
  the per-option doctrine had already ruled not decision-grade;
- `constraint_diagnostics` and `conditional_probabilities` derived from the same
  non-decision-grade evaluation.

RED evidence (base 9026304, commit 917a3fc):
`npx vitest run tests/constraint-results-top-level-gating.fixture.test.ts` →
**3 failed | 3 passed**. The three LEAK tests each failed with
`constraints_status: 'computed'` (expected `'unavailable'`) on (a) the full
two-leg suppression chain, (b) the normalisation-default leg alone, and (c) a mixed
run (one suppressed + one reliable target). The doctrine-B delivery pin, the
reliable-run byte-identity pin, and the no-constraints pin passed on base.

## 2. Mechanism implemented

`src/routes/v2/run.ts` only; no ISL change; per-option suppression logic untouched —
its classification is REUSED:

- `buildConstraintFields` gains two optional parameters:
  `suppressedConstraintTargets` (the `suppressed` half of the SAME
  `partitionConstraintTargets` result the per-option suppression keys on) and a
  `logger`.
- Gate placement: AFTER the existing early returns (`'error'` for explicit ISL
  option errors, `'unavailable'` for absent/empty/malformed/incomplete results) and
  immediately BEFORE the `'computed'` return — so ISL error/unavailable outcomes
  keep their more specific status, and only a would-be-`'computed'` block is
  converted. When `suppressedConstraintTargets` is non-empty the function logs a
  `constraint_results_suppressed` diagnostics event (raw constraint_results,
  constraint_diagnostics, conditional_probabilities, and the unreliable-target
  classification — logs only, never the wire) and returns
  `{ constraints_status: 'unavailable' }`.
- Call site (the response spread in `buildResponse`) passes
  `constraintTargetPartition.suppressed` + `logger`.
- Status vocabulary: `'unavailable'` is the existing `ConstraintFeatureStatus`
  member for "constraints sent, no usable result" — consistent with LANE25's
  per-option doctrine, where suppression = honest ABSENCE and the run-level
  explanation is carried by the WARNING-severity `CONSTRAINT_TARGET_UNRELIABLE`
  inference warning (already emitted by the per-option path; one per affected
  node). No new status value, no schema change.
- Doctrine-B `modelledBasis` targets are NOT passed to the gate (only the
  `suppressed` partition is), so a modelled-basis run DELIVERS the top-level block
  unchanged — consistent with the per-option delivery + `goal_fit_basis`
  annotation + info-severity `CONSTRAINT_GOALFIT_MODELLED_BASIS` note.
- Mixed runs: run-level doctrine preserved — ANY suppressed target withholds the
  whole block (`partition.suppressed.length > 0`), exactly as it does per-option.
- Boundary contract doc updated: `src/contracts/isl-to-ui.contract.ts` `filtered`
  section records the top-level mirror.

Byte-identity for reliable runs: the non-suppressed code path through
`buildConstraintFields` is unchanged (the gate is a single length check before the
final return), pinned by the regression test below.

## 3. Fixture diff

New: `tests/constraint-results-top-level-gating.fixture.test.ts` (6 tests) —
mirrors the mocked-ISL harness and graph/constraint fixtures of
`tests/constraint-target-unreliable.fixture.test.ts` (live wire shapes for the
`CONSTRAINT_NODE_DEFAULT_BASE` signal), with a controllable `prob_satisfied`:

- LEAK (RED→GREEN): full two-leg suppression run (`'points'` unit on a valueless
  node + ISL default-base warning) → `constraints_status: 'unavailable'`, NO
  `constraint_results` / `constraint_diagnostics` / `conditional_probabilities`;
  per-option suppression sanity-checked in the same run.
- LEAK (RED→GREEN): normalisation-default leg ALONE (no ISL warning) gates the top
  level too.
- LEAK (RED→GREEN): mixed run (one suppressed valueless target + one reliable
  valued target) withholds the WHOLE top-level block.
- PIN (green on base AND after): doctrine-B modelled-basis run (`'%'` declared
  scale, base-defaulted forward-propagated node) DELIVERS the top-level block
  (`constraints_status: 'computed'`, exact `constraint_results` row with the
  modelled probability) with the info note and no warning.
- REGRESSION PIN (green on base AND after): reliable run keeps the EXACT top-level
  block — deep-equal on `constraint_results`, `conditional_probabilities: []`, no
  `constraint_diagnostics`, no constraint-reliability warning codes.
- REGRESSION PIN (green on base AND after): no goal constraints → no top-level
  constraint fields at all.

Updated: `tests/gates/constraint-scale-correctness.test.ts` — the WP1
constraints_status gate suite's shared payload gains `observed_state: { value:
40000 }` on the `goal` node. Its three positive controls ("computed" cases) used a
valueless target whose 20000/50000 constraints normalised against the default
[0,1] range — exactly the unreliable case the new gate withholds (on base, those
runs' per-option probability fields were ALREADY suppressed; the suite just never
read them). The suite's intent is the correspondence/validity mechanics of
`buildConstraintFields`, so its target is made RELIABLE (`deriveRange` →
`[0, 80000]`, source `inferred_value`); the reliability gating itself is pinned in
the new fixture. All 14 regression/error-shape tests in that suite were unaffected
(they exercise the early returns above the gate).

## 4. Test results (exact commands)

- RED (base 9026304): `npx vitest run tests/constraint-results-top-level-gating.fixture.test.ts`
  → 3 failed | 3 passed (failures are the three LEAK tests, each on
  `expected 'unavailable', received 'computed'`).
- After fix: same command → **6 passed**.
- `npm run typecheck` (`tsc -p tsconfig.json --noEmit`) → clean.
- Constraint-adjacent sweep: `npx vitest run` over 12 files
  (constraint-results-top-level-gating, constraint-target-unreliable,
  goalfit-doctrine-b, goal-threshold-normalisation, constraint-reliability.unit,
  gates/constraint-scale-correctness, cil-constraint-passthrough, multi-constraint,
  boundary-isl-to-ui.contract, enrichment-emission-contract, cil-constraint-auto-pu,
  golden/canonical-route-integration) → **12 files, 171 passed, 0 failed**.
  (Note: `tests/multi-constraint.test.ts` spawn-server cases require `npm run
  build` first — 11 `waitFor(server ready)` timeouts in a fresh worktree without
  `dist/` are an environment artifact, reproduced and cleared by building.)
- Full gate: `npm test` (build + engine fixtures + vitest + OpenAPI + loadcheck)
  → exit 0.
- `bash scripts/pre-push-validate.sh` → PASSED, 0 failures — branch guard,
  TypeScript compilation, full test suite (**5340 passed | 25 skipped (5376), 0
  failed**), no stale .js, file: dependency policy, OpenAPI spectral lint. The
  same script also ran as the husky pre-push hook on the final push.

## 5. Residual risks / deliberate stops

- **ROADMAP 1.24 (V2-shaped ISL reads + `isl_version` assertion) deliberately not
  attempted** — split to a follow-up lane (see §0).
- `constraints_status: 'unavailable'` does not DISTINGUISH "ISL returned nothing
  usable" from "computed but withheld for reliability" at the status level; the
  distinction is carried by the WARNING-severity `CONSTRAINT_TARGET_UNRELIABLE`
  inference warning (present only in the withheld case) and the
  `constraint_results_suppressed` diagnostics log. Introducing a dedicated status
  value would be a wire-vocabulary change across consumers — deliberately not done
  in a claim-integrity lane.
- The suppressed-run diagnostics log (`constraint_results_suppressed`) duplicates
  raw values also logged per-option by `constraint_probability_suppressed` —
  acceptable redundancy; both are log-only surfaces.
- Consumers that previously read the leaked top-level `constraint_results` on
  suppressed runs will now see the block absent with `'unavailable'`. This is the
  intended honesty fix; the UI already gates constraint rendering on absence
  (same doctrine as the per-option fields, LANE25 §2).
- The known-open PLoT→CEE enrichment passthrough (`z.record`, untyped) is
  unchanged by this lane — nothing new crosses that seam.
