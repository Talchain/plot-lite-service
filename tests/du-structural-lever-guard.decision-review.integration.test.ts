/**
 * D-U structural lever guard — M2 decision-review egress (third lever-egress
 * path; review fixup on PR #219).
 *
 * The /v2/run egress guard (du-structural-lever-guard.integration.test.ts)
 * closed the PUBLIC factor_sensitivity/EVPI wire. This file closes the CEE
 * decision-review lane, which forwarded UNSTAMPED union-lever numbers to CEE
 * and could launder them back onto the public wire:
 *
 *   1. extractFactorSensitivity read RAW islResult.factor_sensitivity with the
 *      STAMP-ONLY filter — an unstamped union lever (the live fac_salary_cost
 *      class) passed its elasticity+confidence+label to CEE as
 *      isl_results.factor_sensitivity (ACTIVE path: DECISION_REVIEW_ENABLE).
 *   2. buildValidationContext then allowlisted those elasticities as
 *      "grounded" numbers the LLM may cite.
 *   3. buildIslResultsForCorrection read raw ISL with NO filter and fed the
 *      number-corrector, which can inject the lever's elasticity into the
 *      returned narrative → public wire (run.ts m1_review merge).
 *   4. computeFlipThresholdData was guarded only by the ALL-options
 *      intersection, so a some-but-not-all-options lever became a CEE flip
 *      candidate whenever preResolvedFlipData was absent.
 *
 * Fixture archetypes (mirrors the /v2/run guard test):
 *   - fac_union  union lever: pinned ONLY by the NON-first option, arrives
 *                UNSTAMPED (no zero_reason) with nonzero elasticity −0.19 and
 *                confidence 0.77. Must reach NONE of the four surfaces.
 *   - fac_plain  non-lever control (elasticity 0.53, confidence 0.61). Must
 *                still flow to ALL FOUR surfaces (no over-suppression).
 *
 * One-union-definition discipline: the expected lever set is derived via the
 * shared leaf (interventionTargetIdsFromOptions), never inlined.
 */
import { describe, it, expect } from 'vitest';
import {
  buildDecisionReviewRequest,
  type ISLResultInput,
} from '../src/cee/decision-review-request.js';
import { buildIslResultsForCorrection } from '../src/cee/decision-review-orchestrator.js';
import { buildValidationContext } from '../src/cee/validation/m1-review-validator.js';
import { interventionTargetIdsFromOptions } from '../src/lib/intervention-override.js';
import type { EngineGraphV3, OptionV3 } from '../src/types/engine-v3.js';
import type { M1Coaching } from '../src/coaching/types.js';

const UNION_ID = 'fac_union';
const PLAIN_ID = 'fac_plain';

// Distinctive numerics so allowlist assertions cannot collide with other
// request numbers (win probs 0.65/0.35, margin 0.3, stability 0.82,
// current values 0.6/0.4).
const UNION_ELASTICITY = -0.19;
const UNION_CONFIDENCE = 0.77;
const PLAIN_ELASTICITY = 0.53;
const PLAIN_CONFIDENCE = 0.61;

const graph: EngineGraphV3 = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Goal' },
    // observed_state.value present so both factors are genuinely eligible as
    // flip-threshold candidates (missing value would mask claim 4).
    { id: UNION_ID, kind: 'factor', label: 'Salary Cost (union lever)', observed_state: { value: 0.6 } },
    { id: PLAIN_ID, kind: 'factor', label: 'Background Factor', observed_state: { value: 0.4 } },
  ],
  edges: [
    { from: UNION_ID, to: 'goal', exists_probability: 0.95, strength: { mean: 0.9, std: 0.1 } },
    { from: PLAIN_ID, to: 'goal', exists_probability: 0.7, strength: { mean: 0.3, std: 0.1 } },
  ],
};

// fac_union is pinned ONLY by the NON-first option → structural union member
// that is NOT in the all-options intersection (opt_a does not pin it), and
// ISL did NOT stamp it. This is exactly the class the stamp-only filter and
// the intersection-only flip guard both missed.
const options: OptionV3[] = [
  { id: 'opt_a', label: 'A', interventions: {} },
  { id: 'opt_b', label: 'B', interventions: { [UNION_ID]: 0.2 } },
];

const islResult: ISLResultInput = {
  options: [
    { option_id: 'opt_a', option_label: 'A', win_probability: 0.65, outcome: { mean: 0.72 } },
    { option_id: 'opt_b', option_label: 'B', win_probability: 0.35, outcome: { mean: 0.58 } },
  ],
  factor_sensitivity: [
    // UNSTAMPED union lever: no zero_reason, nonzero elasticity.
    { factor_id: UNION_ID, factor_label: 'Salary Cost (union lever)', elasticity: UNION_ELASTICITY, confidence: UNION_CONFIDENCE, direction: 'negative' },
    { factor_id: PLAIN_ID, factor_label: 'Background Factor', elasticity: PLAIN_ELASTICITY, confidence: PLAIN_CONFIDENCE, direction: 'positive' },
  ],
  robustness: {
    recommendation_stability: 0.82,
    flip_risk_category: 'low',
    is_robust: true,
    fragile_edges: [],
  },
};

const m1Coaching: M1Coaching = {
  story_headlines: {},
  evidence_gaps: [],
  model_critiques: [],
  next_actions: [],
  readiness: 'ready',
  headline_type: 'clear_winner',
} as unknown as M1Coaching;

const structuralLeverIds = interventionTargetIdsFromOptions(options);

function buildRequest() {
  return buildDecisionReviewRequest('Union-lever decision-review egress test', graph, options, islResult, m1Coaching);
}

describe('D-U guard — M2 decision-review lane (third egress path)', () => {
  it('claim 1: an unstamped union lever never reaches the CEE request isl_results.factor_sensitivity; the non-lever control still flows', () => {
    // RED pre-fixup: filter was stamp-only, fac_union has no zero_reason →
    // its elasticity −0.19 + confidence 0.77 + label went to CEE.
    const request = buildRequest();
    const ids = request.isl_results.factor_sensitivity.map((f) => f.factor_id);
    expect(ids, 'union lever must not egress to CEE').not.toContain(UNION_ID);
    expect(ids, 'non-lever control must survive').toContain(PLAIN_ID);
    const plain = request.isl_results.factor_sensitivity.find((f) => f.factor_id === PLAIN_ID)!;
    expect(plain.elasticity).toBe(PLAIN_ELASTICITY);
    expect(plain.confidence).toBe(PLAIN_CONFIDENCE);
  });

  it('claim 2: the union lever\'s elasticity/confidence are NOT allowlisted as "grounded" numbers; the control\'s are', () => {
    // RED pre-fixup: buildValidationContext derived allowedNumbers from the
    // leaked factor_sensitivity → the LLM could cite the lever's numbers and
    // pass tier-validation as "grounded".
    const context = buildValidationContext(buildRequest() as never);
    expect(context.allowedNumbers, 'lever elasticity must not be grounded').not.toContain(UNION_ELASTICITY);
    expect(context.allowedNumbers, 'lever confidence must not be grounded').not.toContain(UNION_CONFIDENCE);
    expect(context.allowedNumbers, 'control elasticity stays grounded').toContain(PLAIN_ELASTICITY);
    expect(context.allowedNumbers, 'control confidence stays grounded').toContain(PLAIN_CONFIDENCE);
  });

  it('claim 3: the union lever never appears in the number-corrector\'s ISL input; the control does', () => {
    // RED pre-fixup: buildIslResultsForCorrection read raw ISL with NO filter
    // → the corrector could inject the lever's elasticity into the returned
    // narrative (public wire via the m1_review merge).
    const corrInput = buildIslResultsForCorrection(islResult, structuralLeverIds);
    const ids = corrInput.factor_sensitivity.map((f) => f.factor_id);
    expect(ids, 'union lever must not feed the number-corrector').not.toContain(UNION_ID);
    expect(ids, 'non-lever control must survive').toContain(PLAIN_ID);
  });

  it('claim 4: a some-but-not-all-options lever never becomes a CEE flip candidate; the control still can', () => {
    // RED pre-fixup: the flip guard was getFactorsOverriddenByAllOptions —
    // opt_a does not pin fac_union, so the intersection missed it and its
    // |elasticity| 0.19 made it a ranked flip candidate.
    const request = buildRequest();
    const flipIds = request.flip_threshold_data.map((f) => f.factor_id);
    expect(flipIds, 'union lever must not be a flip candidate').not.toContain(UNION_ID);
    expect(flipIds, 'non-lever control stays a flip candidate').toContain(PLAIN_ID);
  });
});
