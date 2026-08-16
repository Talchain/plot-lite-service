/**
 * ROADMAP 2.1248 — fabricated defaults on the review path.
 *
 * Every mechanism here used to manufacture a confident claim from missing
 * data, and each fabrication reached the reviewing model as a GROUNDED
 * figure (CEE serialises `isl_results` and `winner` verbatim into the
 * decision-review prompt, and PLoT's own Tier-4 grounding allowlist admitted
 * the fabricated numbers):
 *
 *   - `extractRobustness` sent `is_robust ?? false`,
 *     `recommendation_stability ?? 0`, `flip_risk_category ?? 'unknown'` —
 *     an unassessed run reached the model as "not robust, 0% stability";
 *   - `buildDecisionReviewRequest` fell back to a fabricated winner
 *     `{id:'', label:'', win_probability: 0}` when no analysed options exist;
 *   - `buildIslResultsForCorrection` fed the number-corrector
 *     `recommendation_stability ?? 0` as an authoritative source;
 *   - `buildValidationContext` allowlisted the fabricated 0 for grounding;
 *   - `mapRobustnessLevel` defaulted an ABSENT level to 'moderate' on the
 *     decision brief (tested in tests/decision-brief.test.ts).
 *
 * SPEC (what the consumer contract admits, derived at CEE staging tip
 * c5e24307 `DecisionReviewInputSchema`): `isl_results.robustness` is
 * `z.record(z.unknown()).optional()` — absent keys are admitted; `winner` is
 * REQUIRED non-nullable — an absent winner is NOT admitted on the wire, so
 * the honest behaviour is to not build the request at all (the orchestrator
 * skips with a named reason). Invariants below are written against that
 * spec, not against any single failure mode (trap 13d).
 */

import { describe, it, expect } from 'vitest';
import {
  buildDecisionReviewRequest,
  type ISLResultInput,
} from '../src/cee/decision-review-request.js';
import { buildValidationContext } from '../src/cee/validation/m1-review-validator.js';
import { buildIslResultsForCorrection } from '../src/cee/decision-review-orchestrator.js';
import type { M1Coaching } from '../src/coaching/types.js';
import type { EngineGraphV3, OptionV3 } from '../src/types/engine-v3.js';

// =============================================================================
// Fixtures
// =============================================================================

const GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'opt_a', label: 'Option A', kind: 'option' },
    { id: 'opt_b', label: 'Option B', kind: 'option' },
    { id: 'fac_x', label: 'Factor X', kind: 'factor' },
  ],
  edges: [{ from: 'fac_x', to: 'opt_a', strength: { mean: 0.5, std: 0.2 } }],
} as any;

const OPTIONS: OptionV3[] = [
  { id: 'opt_a', label: 'Option A' },
  { id: 'opt_b', label: 'Option B' },
] as any;

const M1_COACHING: M1Coaching = {
  readiness: 'ready',
  headline_type: 'clear_winner',
  evidence_gaps: [],
  model_critiques: [],
} as any;

/** Two analysed options; NO robustness object; nothing legitimately zero. */
function islResultNoRobustness(): ISLResultInput {
  return {
    options: [
      { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
      { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.38 },
    ],
    factor_sensitivity: [
      { factor_id: 'fac_x', factor_label: 'Factor X', elasticity: 0.7, confidence: 0.8 },
    ],
  };
}

// =============================================================================
// extractRobustness — absence propagates as absence
// =============================================================================

describe('decision-review request robustness — absent inputs stay absent (2.1248)', () => {
  it('no robustness object from ISL → no fabricated is_robust / recommendation_stability / flip_risk_category keys', () => {
    const request = buildDecisionReviewRequest('brief', GRAPH, OPTIONS, islResultNoRobustness(), M1_COACHING);
    expect(request).not.toBeNull();
    const rob = request!.isl_results.robustness as Record<string, unknown>;
    expect('is_robust' in rob).toBe(false);
    expect('recommendation_stability' in rob).toBe(false);
    expect('flip_risk_category' in rob).toBe(false);
  });

  it('partially-measured robustness → only the measured keys are sent', () => {
    const isl = islResultNoRobustness();
    isl.robustness = { recommendation_stability: 0.42 };
    const request = buildDecisionReviewRequest('brief', GRAPH, OPTIONS, isl, M1_COACHING);
    const rob = request!.isl_results.robustness as Record<string, unknown>;
    expect(rob.recommendation_stability).toBe(0.42);
    expect('is_robust' in rob).toBe(false);
    expect('flip_risk_category' in rob).toBe(false);
  });

  it('a MEASURED false / 0 is a real measurement and is preserved verbatim', () => {
    const isl = islResultNoRobustness();
    isl.robustness = { is_robust: false, recommendation_stability: 0, flip_risk_category: 'high' };
    const request = buildDecisionReviewRequest('brief', GRAPH, OPTIONS, isl, M1_COACHING);
    const rob = request!.isl_results.robustness as Record<string, unknown>;
    expect(rob.is_robust).toBe(false);
    expect(rob.recommendation_stability).toBe(0);
    expect(rob.flip_risk_category).toBe('high');
  });
});

// =============================================================================
// Winner — never fabricated; the request is not built at all
// =============================================================================

describe('decision-review winner — no fabricated empty winner (2.1248)', () => {
  it('no analysed options → returns null instead of a fabricated {id:"", win_probability: 0} winner', () => {
    const isl: ISLResultInput = { factor_sensitivity: [] };
    const request = buildDecisionReviewRequest('brief', GRAPH, OPTIONS, isl, M1_COACHING);
    expect(request).toBeNull();
  });

  it('empty options array → returns null (not an empty-identity winner)', () => {
    const isl: ISLResultInput = { options: [], factor_sensitivity: [] };
    const request = buildDecisionReviewRequest('brief', GRAPH, OPTIONS, isl, M1_COACHING);
    expect(request).toBeNull();
  });

  it('analysed options present → real winner, bound by identity', () => {
    const request = buildDecisionReviewRequest('brief', GRAPH, OPTIONS, islResultNoRobustness(), M1_COACHING);
    expect(request).not.toBeNull();
    expect(request!.winner).toEqual({ id: 'opt_a', label: 'Option A', win_probability: 0.62 });
    expect(request!.runner_up).toEqual({ id: 'opt_b', label: 'Option B', win_probability: 0.38 });
  });
});

// =============================================================================
// Number-corrector sources — no authoritative fabricated 0
// =============================================================================

describe('buildIslResultsForCorrection — absent stability never becomes an authoritative 0 (2.1248)', () => {
  it('no robustness object → recommendation_stability key absent from corrector input', () => {
    const out = buildIslResultsForCorrection(islResultNoRobustness());
    expect('recommendation_stability' in out.robustness).toBe(false);
  });

  it('measured stability → preserved verbatim (including a measured 0)', () => {
    const isl = islResultNoRobustness();
    isl.robustness = { recommendation_stability: 0 };
    const out = buildIslResultsForCorrection(isl);
    expect(out.robustness.recommendation_stability).toBe(0);
  });
});

// =============================================================================
// Grounding allowlist — a number nobody measured is not grounded
// =============================================================================

describe('buildValidationContext — fabricated stability never enters the grounding allowlist (2.1248)', () => {
  it('absent recommendation_stability → 0 is NOT allowlisted (fixture carries no legitimate zero)', () => {
    const request = buildDecisionReviewRequest('brief', GRAPH, OPTIONS, islResultNoRobustness(), M1_COACHING);
    expect(request).not.toBeNull();
    const ctx = buildValidationContext(request! as any);
    // Identity binding: the fixture is constructed so NO legitimate source is 0
    // (win probabilities .62/.38, elasticity .7, confidence .8, margin .24) —
    // a 0 in the allowlist could only be the fabricated stability.
    expect(ctx.allowedNumbers).not.toContain(0);
    // SPEC invariant (trap 13d — written against what Tier-4 is FOR, not
    // against the old failure mode): a grounding allowlist of numbers contains
    // ONLY finite numbers. This is what catches the residual shape of the old
    // defect — an unconditional push now inserts `undefined` rather than the
    // fabricated 0, which the toContain(0) guard alone cannot see (the M7
    // mutant survived exactly that way before this assertion existed).
    expect(ctx.allowedNumbers.every((n) => typeof n === 'number' && Number.isFinite(n))).toBe(true);
    expect(ctx.allowedNumbers.length).toBeGreaterThan(0);
  });

  it('measured recommendation_stability → allowlisted verbatim', () => {
    const isl = islResultNoRobustness();
    isl.robustness = { recommendation_stability: 0.42 };
    const request = buildDecisionReviewRequest('brief', GRAPH, OPTIONS, isl, M1_COACHING);
    const ctx = buildValidationContext(request! as any);
    expect(ctx.allowedNumbers).toContain(0.42);
  });
});
