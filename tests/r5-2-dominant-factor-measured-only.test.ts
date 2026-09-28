/**
 * R5-2 (R5 handed to R&C whole, MG #72 5871363476; the engine-fact gate PLoT #388 introduced, AIQ 5866850180):
 * DOMINANT_FACTOR NAMES A FACTOR ONLY WHEN ITS WEIGHT ON THE DECISION WAS MEASURED.
 *
 * The critique ("One factor dominates. What would change if X had less influence?") fired on an elasticity-share
 * heuristic: |elasticity| / Σ|elasticity| ≥ 0.50 among the top 3. Elasticities are in the model's normalised units,
 * so the verdict moves with a node's scale frame. AI Quality's contract run F (#72 5868664986, body A `a6ed1bff`,
 * served PLoT ccd602c) doubled one frame and a DOMINANT_FACTOR warning APPEARED, with no change to anything the user
 * said. A frame-dependent sentence is not an engine fact about the decision.
 *
 * The gate (#388's, reused rather than restated): the named factor must be one ISL MEASURED above its noise floor,
 * its `factor_evppi` row `status: 'resolved'` (`resolvedEvppiFactorIds`, read through `evidenceAdviceMayName`).
 * That status is computed on win outcomes, so it does not move with a frame. Absent = nothing measured = no
 * critique (fail closed).
 */
import { describe, it, expect } from 'vitest';
import { generateCritiques } from '../src/coaching/critiques.js';
import type { CoachingInputs, NormalisedFactorSensitivity } from '../src/coaching/types.js';

function factor(node_id: string, elasticity: number, importance_rank: number): NormalisedFactorSensitivity {
  return { node_id, label: node_id.replace(/_/g, ' '), elasticity, importance_rank, confidence: 0.8, direction: 'positive', influence_score: Math.abs(elasticity), zero_reason: undefined };
}

function inputs(sensitivity: NormalisedFactorSensitivity[], resolved?: string[]): CoachingInputs {
  return {
    factorSensitivity: sensitivity,
    fragileEdges: [],
    options: [],
    graph: { nodes: [], edges: [] } as unknown as CoachingInputs['graph'],
    robustness: { level: 'moderate' } as unknown as CoachingInputs['robustness'],
    interventionTargetIds: new Set(),
    ...(resolved !== undefined ? { resolvedEvppiFactorIds: new Set(resolved) } : {}),
  };
}

const dominant = (i: CoachingInputs) => generateCritiques(i).filter((c) => c.type === 'DOMINANT_FACTOR');

// other_mrr_growth carries 0.8 / (0.8 + 0.1 + 0.1) = 80% of the elasticity mass: "dominant" by the heuristic.
const HEURISTIC_DOMINANT = [factor('other_mrr_growth', 0.8, 1), factor('pro_plan_price', 0.1, 2), factor('new_subscribers', 0.1, 3)];

describe('R5-2 — DOMINANT_FACTOR names only a factor whose weight on the decision was measured', () => {
  it('RED: heuristic-dominant but NOT measured (its EVPPI row is not resolved) → no DOMINANT_FACTOR', () => {
    expect(dominant(inputs(HEURISTIC_DOMINANT, ['pro_plan_price']))).toEqual([]);
  });

  it('RED: nothing measured at all (no resolved EVPPI row) → no DOMINANT_FACTOR', () => {
    expect(dominant(inputs(HEURISTIC_DOMINANT, []))).toEqual([]);
  });

  it('RED: the field absent (nothing was measured) → no DOMINANT_FACTOR (fail closed)', () => {
    expect(dominant(inputs(HEURISTIC_DOMINANT))).toEqual([]);
  });

  it('RED (AIQ contract run F shape): doubling one factor\'s frame cannot make the critique appear', () => {
    // Before: no factor reaches 50% of the mass. After the frame ×2 on other_mrr_growth its elasticity doubles
    // (0.45 → 0.9 of 1.45 = 62%): the heuristic flips. Its measured status did not change, so neither may the critique.
    const before = [factor('other_mrr_growth', 0.45, 1), factor('pro_plan_price', 0.3, 2), factor('new_subscribers', 0.25, 3)];
    const after = [factor('other_mrr_growth', 0.9, 1), factor('pro_plan_price', 0.3, 2), factor('new_subscribers', 0.25, 3)];
    expect(dominant(inputs(before, ['pro_plan_price']))).toEqual([]);
    expect(dominant(inputs(after, ['pro_plan_price']))).toEqual([]);
  });

  it('CONTRAST: heuristic-dominant AND measured → the critique names that factor, by id', () => {
    const out = dominant(inputs(HEURISTIC_DOMINANT, ['other_mrr_growth', 'pro_plan_price']));
    expect(out).toHaveLength(1);
    expect(out[0]!.targets).toEqual(['other_mrr_growth']);
    expect(out[0]!.challenge_question).toContain('other mrr growth');
  });

  it('CONTRAST: measured but NOT heuristic-dominant → still no critique (the gate adds a condition, never a new trigger)', () => {
    const even = [factor('other_mrr_growth', 0.34, 1), factor('pro_plan_price', 0.33, 2), factor('new_subscribers', 0.33, 3)];
    expect(dominant(inputs(even, ['other_mrr_growth', 'pro_plan_price', 'new_subscribers']))).toEqual([]);
  });
});
