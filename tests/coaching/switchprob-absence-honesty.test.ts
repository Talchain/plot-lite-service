/**
 * Codex P1-5 — switch_probability absence honesty in the coaching normaliser.
 *
 * Contract (@talchain/schemas 0.30.0, EnrichmentRobustnessEdgeSchema.switch_probability):
 *   "Absence means NOT COMPUTED — never 0 and never 1. A measured 0 is a real
 *    measurement and must be preserved. Higher means MORE fragile ... Consumers
 *    MUST branch on presence, never coalesce, and MUST omit anything derived
 *    from it."
 *
 * The defect these tests pin against: normalise-inputs.ts coalesced
 *   `edge.switch_probability ?? edge.marginal_switch_probability ?? 0`
 * — (a) aliasing a DIFFERENT ISL quantity (marginal_switch_probability =
 * P(flip | only this edge varies), its own Monte Carlo) into the
 * switch-probability slot (P(alternative wins | edge weak)), and (b) fabricating
 * the SAFEST possible verdict (0) for unmeasured edges. Downstream the aliased
 * value was rendered literally as "X% chance this flips the decision"
 * (next-actions.ts) and re-emitted on the wire under the switch_probability
 * name (m1-coaching.ts top_fragile_edge).
 *
 * House pattern (#292/#269): absence propagates as absence. These tests were
 * proven RED against the fabricating code before the fix (see PR).
 */

import { describe, it, expect } from 'vitest';
import { generateM1Coaching } from '../../src/coaching/m1-coaching.js';
import { normaliseCoachingInputs } from '../../src/coaching/normalise-inputs.js';
import type { EngineGraphV3, OptionV3 } from '../../src/coaching/types.js';

const makeGraph = (): EngineGraphV3 => ({
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'f1', kind: 'factor', label: 'Cost', category: 'controllable' },
    { id: 'f2', kind: 'factor', label: 'Market Risk', category: 'external' },
  ],
  edges: [
    { from: 'f1', to: 'goal', strength: { mean: 0.8, std: 0.1 } },
    { from: 'f2', to: 'goal', strength: { mean: -0.6, std: 0.15 } },
  ],
});

const makeOptions = (): OptionV3[] => [
  { id: 'opt1', label: 'Option A', winProbability: 0.75, expectedOutcome: 120 },
  { id: 'opt2', label: 'Option B', winProbability: 0.25, expectedOutcome: 80 },
];

// 0.9 is deliberately above every fragility threshold in play
// (headline_fragile_edge_min 0.15, action_fragile_edge_threshold 0.20): if the
// alias/coalesce ever returns, this value WILL surface as a rendered
// percentage and these pins go RED.
const makeIslResult = (fragileEdge: Record<string, unknown>) => ({
  options: [
    { id: 'opt1', label: 'Option A', win_probability: 0.75, outcome: { mean: 120, p10: 100, p90: 140 } },
    { id: 'opt2', label: 'Option B', win_probability: 0.25, outcome: { mean: 80, p10: 60, p90: 100 } },
  ],
  factor_sensitivity: [
    { node_id: 'f1', label: 'Cost', importance_rank: 1, elasticity: 0.45, influence_score: 0.85, confidence: 0.6, direction: 'positive' },
    { node_id: 'f2', label: 'Market Risk', importance_rank: 2, elasticity: -0.35, influence_score: 0.65, confidence: 0.3, direction: 'negative' },
  ],
  robustness: {
    fragile_edges: [fragileEdge],
    recommendation_stability: 0.75,
  },
});

describe('switch_probability absence honesty (Codex P1-5)', () => {
  it('does NOT alias marginal_switch_probability into switchProb — absence stays absent', () => {
    const inputs = normaliseCoachingInputs(makeGraph(), makeOptions(), makeIslResult({
      edge_id: 'f1→goal',
      from_id: 'f1',
      to_id: 'goal',
      // No switch_probability — ISL did not compute it for this edge.
      marginal_switch_probability: 0.9,
      alternative_winner_id: 'opt2',
    }));

    expect(inputs.fragileEdges).toHaveLength(1);
    expect(inputs.fragileEdges[0]!.switchProb).toBeUndefined();
  });

  it('does NOT fabricate 0 when both probability fields are missing', () => {
    const inputs = normaliseCoachingInputs(makeGraph(), makeOptions(), makeIslResult({
      edge_id: 'f1→goal',
      from_id: 'f1',
      to_id: 'goal',
      alternative_winner_id: 'opt2',
    }));

    expect(inputs.fragileEdges).toHaveLength(1);
    expect(inputs.fragileEdges[0]!.switchProb).toBeUndefined();
  });

  it('preserves a MEASURED 0 (a real measurement, per the 0.30.0 contract)', () => {
    const inputs = normaliseCoachingInputs(makeGraph(), makeOptions(), makeIslResult({
      edge_id: 'f1→goal',
      from_id: 'f1',
      to_id: 'goal',
      switch_probability: 0,
      marginal_switch_probability: 0.9, // must NOT displace the measured 0
      alternative_winner_id: 'opt2',
    }));

    expect(inputs.fragileEdges[0]!.switchProb).toBe(0);
  });

  it('drops non-finite switch_probability values instead of passing them through', () => {
    const inputs = normaliseCoachingInputs(makeGraph(), makeOptions(), makeIslResult({
      edge_id: 'f1→goal',
      from_id: 'f1',
      to_id: 'goal',
      switch_probability: Number.NaN,
      alternative_winner_id: 'opt2',
    }));

    expect(inputs.fragileEdges[0]!.switchProb).toBeUndefined();
  });

  it('END-TO-END: an edge with ONLY marginal_switch_probability renders NO percentage anywhere', () => {
    const coaching = generateM1Coaching(makeGraph(), makeOptions(), makeIslResult({
      edge_id: 'f1→goal',
      from_id: 'f1',
      to_id: 'goal',
      marginal_switch_probability: 0.9,
      alternative_winner_id: 'opt2',
    }));

    expect(coaching).not.toBeNull();
    const serialised = JSON.stringify(coaching);

    // The aliased marginal (90%) must not surface under flip-chance wording,
    // in any rendered string, or on the wire-named field.
    expect(serialised).not.toContain('90%');
    expect(serialised).not.toMatch(/% chance this flips/);
    expect(serialised).not.toMatch(/% chance of flipping/);
    expect(coaching!.top_fragile_edge?.switch_probability).toBeUndefined();
  });

  it('POSITIVE CONTROL (trap 13): a MEASURED switch_probability DOES render as a percentage', () => {
    const coaching = generateM1Coaching(makeGraph(), makeOptions(), makeIslResult({
      edge_id: 'f1→goal',
      from_id: 'f1',
      to_id: 'goal',
      switch_probability: 0.9,
      alternative_winner_id: 'opt2',
    }));

    expect(coaching).not.toBeNull();
    const serialised = JSON.stringify(coaching);

    // Proves the absence assertions above are capable of seeing a presence:
    // the same pipeline, fed a measured value, DOES produce the strings the
    // absence test asserts missing.
    expect(serialised).toContain('90%');
    expect(coaching!.top_fragile_edge?.switch_probability).toBe(0.9);
  });
});
