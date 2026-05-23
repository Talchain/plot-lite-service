/**
 * VOI surface-divergence regression pin.
 *
 * `factor_sensitivity[*].value_of_information` (public surface) and
 * `m1_coaching.evidence_gaps[*].voi_score` (coaching-internal) use
 * different formulas and can legitimately diverge on the same factor.
 *
 * Public-surface VOI (graph fallback in `src/lib/factor-influence.ts`):
 *     |sensitivity| × (1 - confidence) × decision_fragility
 *   where `decision_fragility` requires an adjacent fragile edge. Returns
 *   0 when the factor has no fragile-edge neighbour.
 *
 * Coaching VOI (`src/coaching/evidence-gaps.ts`):
 *     normalisedImpact × (1 - confidence)
 *   Never consults fragile edges. Almost always non-zero when impact > 0
 *   and confidence < 1.
 *
 * This test pins the divergence on a graph with no fragile edges, where
 * the two surfaces MUST disagree by design. No PR behaviour change is
 * involved — see the workstream plan for the documentation jsdoc that
 * makes this contract visible to consumers.
 *
 * See follow-up: VOI/EVPI naming/provenance clarification (Priority 2)
 * for the longer-term schema-versioned rename
 * (`EvidenceGap.voi_score` → `EvidenceGap.impact_score` or similar).
 */

import { describe, it, expect } from 'vitest';
import { computeValueOfInformation } from '../src/lib/factor-influence.js';
import { computeEvidenceGaps } from '../src/coaching/evidence-gaps.js';
import type { CoachingInputs, EngineGraphV3 } from '../src/coaching/types.js';

const noFragileGraph = (): EngineGraphV3 => ({
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'f_brand', kind: 'factor', label: 'Brand awareness' },
    { id: 'f_cost', kind: 'factor', label: 'Campaign cost' },
  ],
  edges: [
    { from: 'f_brand', to: 'goal', strength: { mean: 0.7, std: 0.1 } },
    { from: 'f_cost', to: 'goal', strength: { mean: -0.5, std: 0.1 } },
  ],
});

const noFragileInputs: CoachingInputs = {
  graph: noFragileGraph(),
  options: [
    { id: 'opt_a', label: 'Option A', winProbability: 0.7, outcomeMean: 110, outcomeP10: 90, outcomeP90: 130 },
    { id: 'opt_b', label: 'Option B', winProbability: 0.3, outcomeMean: 90, outcomeP10: 70, outcomeP90: 110 },
  ],
  factorSensitivity: [
    // Both factors: high impact, low confidence — coaching VOI will be high.
    // No fragile edges below — graph-path VOI will be 0.
    { node_id: 'f_brand', label: 'Brand awareness', importance_rank: 1, elasticity: 0.7, influence_score: 0.7, confidence: 0.3, direction: 'positive', zero_reason: undefined },
    { node_id: 'f_cost', label: 'Campaign cost', importance_rank: 2, elasticity: 0.5, influence_score: 0.5, confidence: 0.4, direction: 'negative', zero_reason: undefined },
  ],
  fragileEdges: [],
  robustness: { level: 'high', recommendationStability: 0.85, isRobust: true },
};

describe('VOI surface divergence — graph fallback vs coaching formula', () => {
  it('graph-fallback VOI is 0 when factor has no adjacent fragile edge', () => {
    // The public-surface VOI for both factors is 0 because decision_fragility = 0
    // (no fragile edges to be adjacent to). This is the production path that
    // emits factor_sensitivity[*].value_of_information when ISL is absent.
    const brandVoi = computeValueOfInformation('f_brand', 0.7, 0.3, []);
    const costVoi = computeValueOfInformation('f_cost', 0.5, 0.4, []);

    expect(brandVoi).toBe(0);
    expect(costVoi).toBe(0);
  });

  it('coaching evidence-gaps VOI is positive for the same factors with no fragile edges', () => {
    // The coaching-internal voi_score uses impact × (1 - confidence) and does
    // NOT consult fragile edges, so both factors surface as evidence gaps
    // with positive voi_score.
    const gaps = computeEvidenceGaps(noFragileInputs);

    expect(gaps.length).toBeGreaterThanOrEqual(1);
    for (const gap of gaps) {
      expect(gap.voi_score).toBeGreaterThan(0);
    }
  });

  it('the two surfaces diverge by design — same factors, different VOI values', () => {
    // The headline pin: same factor (f_brand / f_cost), same confidence and
    // impact, but factor_sensitivity VOI = 0 while evidence_gaps voi_score > 0.
    // This is correct: the two surfaces measure related but different
    // quantities. The factor_sensitivity surface answers "what would perfect
    // info about this factor be worth, given how fragile the decision is to
    // it?" (zero when the factor is not in the decision-fragility set). The
    // evidence_gaps surface answers "which uncertainties matter most for the
    // decision, ranked by impact × uncertainty?" (independent of fragility).
    const graphBrandVoi = computeValueOfInformation('f_brand', 0.7, 0.3, []);
    const gaps = computeEvidenceGaps(noFragileInputs);
    const coachingBrandGap = gaps.find((g) => g.factor_id === 'f_brand');

    expect(graphBrandVoi).toBe(0);
    expect(coachingBrandGap).toBeDefined();
    expect(coachingBrandGap!.voi_score).toBeGreaterThan(0);

    // Documented contract: the two are NOT directly comparable. Any future
    // PR that makes them numerically equal must update the surface jsdocs
    // (src/types/engine-v3.ts FactorSensitivityResultV3.value_of_information
    // and src/coaching/types.ts EvidenceGap.voi_score) to drop the
    // distinction.
  });
});
