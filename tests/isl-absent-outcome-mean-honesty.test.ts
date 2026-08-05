/**
 * ROADMAP 2.480(a) — an ABSENT ISL `outcome.mean` must never become a fabricated 0.
 *
 * WHAT CHANGED UPSTREAM. Until ISL PR #125 (merged 2026-08-05, staging
 * `88275e5c8cb12486601052e971ff179ef3675958`), `OutcomeDistributionV2.mean` and
 * `.std` were REQUIRED floats: a degenerate Monte-Carlo population (every draw
 * non-finite) made the whole response unserializable and the run 500'd, taking
 * its own MONTE_CARLO_FAILED critique with it. #125 made both `Optional` and
 * OMITTED under `exclude_none` — "there is no honest mean for a distribution
 * with no draws". So absence became REACHABLE on a 200 for the first time.
 *
 * THE DEFECT THIS PINS. Two PLoT sites read the RAW ISL result, upstream of and
 * unprotected by the `hasAllRequiredOutcomeStats` egress guard, and coalesced
 * that honest absence into a fabricated `0`:
 *   - `src/coaching/normalise-inputs.ts:142`  `outcomeMean: islOpt.outcome?.mean ?? 0`
 *   - `src/cee/decision-review-request.ts:248`
 *       `expected_outcome: opt.expected_outcome ?? opt.outcome?.mean ?? 0`
 * The second is the live-harm path: that value egresses to CEE as
 * `isl_results.option_comparison[].expected_outcome` and as
 * `winner`/`runner_up.outcome_mean`, i.e. it is handed to the reviewing model as
 * a GROUNDED ISL figure. `normalise-inputs.ts` states the never-coalesce rule in
 * its own file (lines 84-95) and violated it 47 lines later.
 *
 * HOUSE PATTERN (the fix these pins describe). Absence propagates as absence,
 * exactly as this repo already does for `switch_probability`
 * (`tests/coaching/switchprob-absence-honesty.test.ts`, `FragileEdgeData`) and
 * for `buildIslResultsForCorrection` (`decision-review-orchestrator.ts:406`,
 * whose consumer `number-corrector.ts:158` branches on `!== undefined`).
 *
 * FIXTURE PROVENANCE — pinned to a historical artefact, not to "current" (trap 12b).
 * Field shapes are transcribed from ISL at the pinned SHA: the absent-stat shape
 * from `tests/integration/test_numerics_honesty_batch.py`
 * (`TestAllNonFiniteOptionShipsOn200` — `n_valid_samples: 0`,
 * `validity_ratio: 0.0`, `percentiles_source: 'unavailable'`, `mean`/`std`/
 * `downside` ABSENT, never null and never a fabricated 0.0), and the critique
 * severities from `src/models/critique.py`. See the reachability note on
 * `makeIslResult` for why this fixture is NON-blocking rather than a copy of
 * that test's blocker case.
 *
 * ⚠ WHAT THESE TESTS DO NOT SHOW. They pin two builders in isolation. They are
 * not evidence that the degeneracy is DISCLOSED to whoever reads the output —
 * for site 2 it demonstrably is not: the decision-review payload has no
 * `critiques` key at all, and an `option_comparison` entry reduces to
 * `{option_id, option_label, win_probability}`. Absence is honest; absence with
 * no stated reason is not the same thing as disclosure. Rowed separately.
 *
 * EVERY assertion binds to its option by IDENTITY (`id === 'opt_degraded'`),
 * never by a value predicate another option could satisfy (trap 19), and the
 * healthy sibling is the in-run POSITIVE CONTROL: a test that proves an absence
 * must first prove it can see a presence (trap 13).
 */

import { describe, it, expect } from 'vitest';
import { normaliseCoachingInputs } from '../src/coaching/normalise-inputs.js';
import { buildDecisionReviewRequest } from '../src/cee/decision-review-request.js';
import type { EngineGraphV3, OptionV3 } from '../src/types/engine-v3.js';
import type { M1Coaching } from '../src/coaching/types.js';

const DEGRADED = 'opt_degraded';
const HEALTHY = 'opt_healthy';

/** The healthy sibling's real mean. Deliberately NOT 0 and NOT near 0, so a
 *  fabricated 0 can never be mistaken for it. */
const HEALTHY_MEAN = 42.5;

const makeGraph = (): EngineGraphV3 => ({
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Maximize Revenue' },
    { id: 'factor_a', kind: 'factor', label: 'Market Size' },
    { id: 'factor_b', kind: 'factor', label: 'Competition' },
  ],
  edges: [
    { from: 'factor_a', to: 'goal', strength: { mean: 0.6, std: 0.15 }, exists_probability: 0.9 },
    { from: 'factor_b', to: 'goal', strength: { mean: -0.4, std: 0.1 }, exists_probability: 0.85 },
  ],
});

const makeOptions = (): OptionV3[] => [
  { id: DEGRADED, label: 'Degraded Option', interventions: { factor_a: 0.8 } },
  { id: HEALTHY, label: 'Healthy Option', interventions: { factor_b: 0.6 } },
];

const N_SAMPLES = 500;

/**
 * An ISL 200 body carrying an option whose `outcome.mean` is ABSENT.
 *
 * ⚠ REACHABILITY — corrected by adversarial review, and narrower than this file
 * first claimed. The obvious producer of an absent mean (every draw non-finite)
 * emits MONTE_CARLO_FAILED, whose severity is `blocker`
 * (ISL `src/models/critique.py:263`, verified at the pinned SHA). A blocker
 * drives `analysis_status: 'failed'`, and PLoT SHORT-CIRCUITS a failed status at
 * `src/routes/v2/run.ts:7026` — `return reply.send(buildV2RunError(...))`, whose
 * own comment reads "No blockers can arrive here" — which is BEFORE both sites
 * under test. **So the all-non-finite scenario does NOT reach these two
 * builders**, and a fixture pairing `analysis_status: 'partial'` with a blocker
 * critique is a body ISL cannot emit.
 *
 * This fixture is therefore internally consistent and non-blocking: `partial`
 * status with LOW_EFFECTIVE_SAMPLES (severity `warning`, ISL `critique.py:317`),
 * carrying an option whose mean is absent. The reviewer identifies ISL's
 * `dist.samples`-empty branch as a producer of an absent mean with NO blocker,
 * which WOULD reach both sites; **I did not measure that branch and make no
 * claim about it.** What these tests pin is the builders' behaviour GIVEN an
 * absent mean, whatever produced it — which is the property that must hold
 * regardless of which upstream branch delivers it.
 */
const makeIslResult = (overrides: { degradedOutcome?: Record<string, unknown> } = {}) => ({
  analysis_status: 'partial',
  options: [
    {
      id: DEGRADED,
      label: 'Degraded Option',
      status: 'partial',
      // win_probability is absent for an option with no valid draws.
      outcome: overrides.degradedOutcome ?? {
        // mean, std, p10, p50, p90 are ABSENT — omitted, never null.
        n_samples: N_SAMPLES,
        n_valid_samples: 0,
        validity_ratio: 0.0,
        percentiles_source: 'unavailable',
      },
      // downside absent
    },
    {
      id: HEALTHY,
      label: 'Healthy Option',
      status: 'computed',
      win_probability: 1.0,
      outcome: {
        mean: HEALTHY_MEAN,
        std: 3.1,
        p10: 38.2,
        p50: 42.4,
        p90: 47.1,
        n_samples: N_SAMPLES,
        n_valid_samples: N_SAMPLES,
        validity_ratio: 1.0,
        percentiles_source: 'samples',
      },
    },
  ],
  // Non-blocking disclosure, so this body does NOT trip run.ts:7026. Shape and
  // severity from ISL `src/models/critique.py:317` at the pinned SHA.
  // ⚠ Neither function under test reads `critiques` — this is documentary, and
  // it is NOT a disclosure channel for site 2 (see the wire test below).
  critiques: [
    {
      id: 'critique_low_effective_samples_1',
      code: 'LOW_EFFECTIVE_SAMPLES',
      severity: 'warning',
      message: 'Only 0 of 500 samples were numerically valid',
      source: 'analysis',
      affected_option_ids: [DEGRADED],
    },
  ],
  factor_sensitivity: [
    { factor_id: 'factor_c', factor_label: 'Brand Strength', elasticity: 0.15, confidence: 0.6 },
  ],
  robustness: { recommendation_stability: 0.78, fragile_edges: [] },
});

const makeM1Coaching = (): M1Coaching => ({
  readiness: 'ready',
  headline_type: 'clear_winner',
  evidence_gaps: [],
  model_critiques: [],
});

const buildRequest = (islResult: unknown) =>
  buildDecisionReviewRequest(
    'Should we expand?',
    makeGraph(),
    makeOptions(),
    islResult as Parameters<typeof buildDecisionReviewRequest>[3],
    makeM1Coaching()
  );

// =============================================================================
// SITE 1 — src/coaching/normalise-inputs.ts
// =============================================================================

describe('2.480(a) site 1 — coaching normaliser never coalesces an absent mean', () => {
  it('does NOT fabricate 0 for an option whose outcome.mean is absent', () => {
    const inputs = normaliseCoachingInputs(makeGraph(), makeOptions(), makeIslResult());

    const degraded = inputs.options.find((o) => o.id === DEGRADED);
    expect(degraded, 'the degenerate option must still be present').toBeDefined();

    // The defect: this read 0 — an assertion that the option's expected outcome
    // was MEASURED and found to be zero.
    expect(degraded!.outcomeMean).not.toBe(0);
    expect(degraded!.outcomeMean).toBeUndefined();
  });

  it('keeps the degenerate option VISIBLE rather than dropping it', () => {
    const inputs = normaliseCoachingInputs(makeGraph(), makeOptions(), makeIslResult());

    // Silent loss is the other dishonest answer. Both options survive.
    expect(inputs.options.map((o) => o.id).sort()).toEqual([DEGRADED, HEALTHY].sort());
  });

  it('POSITIVE CONTROL — the healthy sibling keeps its measured mean verbatim', () => {
    const inputs = normaliseCoachingInputs(makeGraph(), makeOptions(), makeIslResult());

    const healthy = inputs.options.find((o) => o.id === HEALTHY);
    expect(healthy!.outcomeMean).toBe(HEALTHY_MEAN);
  });

  it('preserves a MEASURED 0 — a real measurement is not an absence', () => {
    const inputs = normaliseCoachingInputs(
      makeGraph(),
      makeOptions(),
      makeIslResult({
        degradedOutcome: {
          mean: 0,
          std: 1.2,
          p10: -2,
          p50: 0,
          p90: 2,
          n_samples: N_SAMPLES,
          n_valid_samples: N_SAMPLES,
          validity_ratio: 1.0,
          percentiles_source: 'samples',
        },
      })
    );

    const measured = inputs.options.find((o) => o.id === DEGRADED);
    expect(measured!.outcomeMean).toBe(0);
  });

  it('does not pass a non-finite mean through as a number', () => {
    const inputs = normaliseCoachingInputs(
      makeGraph(),
      makeOptions(),
      makeIslResult({
        degradedOutcome: {
          mean: Number.NaN,
          n_samples: N_SAMPLES,
          n_valid_samples: 0,
          validity_ratio: 0.0,
          percentiles_source: 'unavailable',
        },
      })
    );

    const degraded = inputs.options.find((o) => o.id === DEGRADED);
    expect(degraded!.outcomeMean).toBeUndefined();
  });
});

// =============================================================================
// SITE 2 — src/cee/decision-review-request.ts (the egress path to CEE)
// =============================================================================

describe('2.480(a) site 2 — decision-review request never coalesces an absent mean', () => {
  it('does NOT fabricate 0 in option_comparison for the degenerate option', () => {
    const request = buildRequest(makeIslResult());

    const degraded = request.isl_results.option_comparison.find((o) => o.option_id === DEGRADED);
    expect(degraded, 'the degenerate option must still be present').toBeDefined();

    // The defect: CEE was told this option's expected outcome IS 0, as a
    // grounded ISL figure.
    expect(degraded!.expected_outcome).not.toBe(0);
    expect(degraded!.expected_outcome).toBeUndefined();
  });

  it('keeps the degenerate option VISIBLE in option_comparison', () => {
    const request = buildRequest(makeIslResult());

    expect(request.isl_results.option_comparison.map((o) => o.option_id).sort()).toEqual(
      [DEGRADED, HEALTHY].sort()
    );
  });

  it('POSITIVE CONTROL — the healthy sibling keeps its measured expected_outcome', () => {
    const request = buildRequest(makeIslResult());

    const healthy = request.isl_results.option_comparison.find((o) => o.option_id === HEALTHY);
    expect(healthy!.expected_outcome).toBe(HEALTHY_MEAN);
  });

  it('does NOT fabricate 0 for runner_up.outcome_mean', () => {
    const request = buildRequest(makeIslResult());

    // Identity, not position: the healthy option wins on win_probability.
    expect(request.winner.id).toBe(HEALTHY);
    expect(request.runner_up?.id).toBe(DEGRADED);

    expect(request.runner_up!.outcome_mean).not.toBe(0);
    expect(request.runner_up!.outcome_mean).toBeUndefined();
    // Positive control on the same object family.
    expect(request.winner.outcome_mean).toBe(HEALTHY_MEAN);
  });

  it('carries no fabricated 0 ON THE WIRE for the degenerate option', () => {
    const request = buildRequest(makeIslResult());
    const wire = JSON.parse(JSON.stringify(request));

    const degraded = wire.isl_results.option_comparison.find(
      (o: { option_id: string }) => o.option_id === DEGRADED
    );
    expect(Object.prototype.hasOwnProperty.call(degraded, 'expected_outcome')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(wire.runner_up, 'outcome_mean')).toBe(false);

    // The healthy sibling still carries its real number on the same wire.
    const healthy = wire.isl_results.option_comparison.find(
      (o: { option_id: string }) => o.option_id === HEALTHY
    );
    expect(healthy.expected_outcome).toBe(HEALTHY_MEAN);
  });

  /**
   * M4 CLOSER — added after adversarial review, which executed the mutant and
   * found it SURVIVED: dropping site 2's FINITENESS guard (leaving a
   * presence-only `!== undefined` check) kept the suite 12/12 GREEN while the
   * CEE wire gained `"expected_outcome": null` and `"outcome_mean": null`.
   *
   * Site 1's non-finite twin already bit; site 2's had no pin, and the PR body
   * claimed the non-finiteness fix at BOTH sites. `null` on the wire is the same
   * lie in a different costume — CEE cannot tell "not computed" from "computed
   * as null", and JSON.stringify converts NaN to null silently, so ONLY a
   * wire-level key-absence assertion can see this.
   */
  it('does NOT emit a null expected_outcome when the mean is non-finite', () => {
    const nanIsl = makeIslResult({
      degradedOutcome: {
        mean: Number.NaN,
        n_samples: N_SAMPLES,
        n_valid_samples: 0,
        validity_ratio: 0.0,
        percentiles_source: 'unavailable',
      },
    });

    const request = buildRequest(nanIsl);

    // In memory: never NaN, never null.
    const degraded = request.isl_results.option_comparison.find((o) => o.option_id === DEGRADED);
    expect(degraded, 'the degenerate option must still be present').toBeDefined();
    expect(degraded!.expected_outcome).toBeUndefined();

    // On the wire: the KEY must be absent. `expected_outcome: NaN` serialises to
    // `null`, which a presence-only guard would happily emit.
    const wire = JSON.parse(JSON.stringify(request));
    const wireDegraded = wire.isl_results.option_comparison.find(
      (o: { option_id: string }) => o.option_id === DEGRADED
    );
    expect(Object.prototype.hasOwnProperty.call(wireDegraded, 'expected_outcome')).toBe(false);

    // Same for the winner/runner_up projection of the same value.
    expect(request.runner_up?.id).toBe(DEGRADED);
    expect(request.runner_up!.outcome_mean).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(wire.runner_up, 'outcome_mean')).toBe(false);

    // POSITIVE CONTROL — the healthy sibling still carries its real number, so
    // this test cannot pass by the whole payload being empty.
    const wireHealthy = wire.isl_results.option_comparison.find(
      (o: { option_id: string }) => o.option_id === HEALTHY
    );
    expect(wireHealthy.expected_outcome).toBe(HEALTHY_MEAN);
  });

  it('preserves a MEASURED 0 expected_outcome', () => {
    const request = buildRequest(
      makeIslResult({
        degradedOutcome: {
          mean: 0,
          std: 1.2,
          p10: -2,
          p50: 0,
          p90: 2,
          n_samples: N_SAMPLES,
          n_valid_samples: N_SAMPLES,
          validity_ratio: 1.0,
          percentiles_source: 'samples',
        },
      })
    );

    const measured = request.isl_results.option_comparison.find((o) => o.option_id === DEGRADED);
    expect(measured!.expected_outcome).toBe(0);
  });

  it('still prefers an explicit expected_outcome over outcome.mean', () => {
    const isl = makeIslResult();
    (isl.options[1] as Record<string, unknown>).expected_outcome = 99.5;

    const request = buildRequest(isl);
    const healthy = request.isl_results.option_comparison.find((o) => o.option_id === HEALTHY);
    expect(healthy!.expected_outcome).toBe(99.5);
  });
});
