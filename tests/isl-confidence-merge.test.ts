/**
 * ISL Confidence Merge Tests
 *
 * Verifies mergeIslConfidenceIntoGraphFactors:
 * T1: Merge by node_id — graph A,B,C + ISL A,B → A,B get ISL confidence; C keeps graph
 * T2: ISL confidence takes precedence over graph confidence
 * T3: ISL-only factors preserved (appended with source: 'isl')
 * T4: ISL returns null confidence — graph confidence preserved
 * T5: No ISL results — all factors retain graph confidence
 * T6: Determinism — same input → identical output
 * T7: Bootstrap fields copied from ISL to merged entries
 */

import { describe, it, expect } from 'vitest';
import { mergeIslConfidenceIntoGraphFactors } from '../src/lib/factor-influence.js';
import type { FactorSensitivityResultV3 } from '../src/types/engine-v3.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGraphFactor(id: string, overrides?: Partial<FactorSensitivityResultV3>): FactorSensitivityResultV3 {
  return {
    factor_id: id,
    factor_label: `Label ${id}`,
    sensitivity_score: 0.5,
    direction: 'positive',
    confidence: 0.38,
    confidence_source: 'graph',
    source: 'graph',
    importance_rank: 1,
    ...overrides,
  };
}

function makeIslFactor(id: string, overrides?: Partial<FactorSensitivityResultV3>): FactorSensitivityResultV3 {
  return {
    factor_id: id,
    factor_label: `Label ${id}`,
    sensitivity_score: 0.6,
    direction: 'positive',
    confidence: 0.72,
    source: 'isl',
    attribution_stability: 'high',
    elasticity_std: 0.05,
    rank_flip_rate: 0.02,
    stability_method: 'bootstrap_1000',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mergeIslConfidenceIntoGraphFactors', () => {
  it('T1: merges ISL confidence into matching graph factors by node_id', () => {
    const graph = [
      makeGraphFactor('fac_a', { confidence: 0.35 }),
      makeGraphFactor('fac_b', { confidence: 0.40 }),
      makeGraphFactor('fac_c', { confidence: 0.33 }),
    ];
    const isl = [
      makeIslFactor('fac_a', { confidence: 0.82 }),
      makeIslFactor('fac_b', { confidence: 0.21 }),
    ];

    const result = mergeIslConfidenceIntoGraphFactors(graph, isl);

    expect(result).toHaveLength(3);

    // A and B get ISL confidence
    const a = result.find(f => f.factor_id === 'fac_a')!;
    expect(a.confidence).toBe(0.82);
    expect(a.confidence_source).toBe('isl');
    expect(a.sensitivity_score).toBe(0.5); // Graph influence preserved
    expect(a.source).toBe('graph'); // Still graph-based entry

    const b = result.find(f => f.factor_id === 'fac_b')!;
    expect(b.confidence).toBe(0.21);
    expect(b.confidence_source).toBe('isl');

    // C retains graph confidence
    const c = result.find(f => f.factor_id === 'fac_c')!;
    expect(c.confidence).toBe(0.33);
    expect(c.confidence_source).toBe('graph');
  });

  it('T2: ISL confidence takes precedence over graph confidence', () => {
    const graph = [makeGraphFactor('fac_a', { confidence: 0.38 })];
    const isl = [makeIslFactor('fac_a', { confidence: 0.21 })];

    const result = mergeIslConfidenceIntoGraphFactors(graph, isl);

    expect(result[0].confidence).toBe(0.21);
    expect(result[0].confidence_source).toBe('isl');
  });

  it('T3: ISL-only factors appended to result', () => {
    const graph = [makeGraphFactor('fac_a')];
    const isl = [
      makeIslFactor('fac_a', { confidence: 0.80 }),
      makeIslFactor('fac_d', { confidence: 0.55, source: 'isl' }),
    ];

    const result = mergeIslConfidenceIntoGraphFactors(graph, isl);

    expect(result).toHaveLength(2);
    const d = result.find(f => f.factor_id === 'fac_d')!;
    expect(d).toBeDefined();
    expect(d.source).toBe('isl');
    expect(d.confidence).toBe(0.55);
    expect(d.confidence_source).toBe('isl');
  });

  it('T4: ISL returns null confidence — graph confidence preserved', () => {
    const graph = [makeGraphFactor('fac_a', { confidence: 0.38 })];
    const isl = [makeIslFactor('fac_a', { confidence: null as any })];

    const result = mergeIslConfidenceIntoGraphFactors(graph, isl);

    expect(result[0].confidence).toBe(0.38);
    expect(result[0].confidence_source).toBe('graph');
  });

  it('T5: no ISL results — all factors retain graph confidence', () => {
    const graph = [
      makeGraphFactor('fac_a', { confidence: 0.35 }),
      makeGraphFactor('fac_b', { confidence: 0.40 }),
    ];

    const resultUndefined = mergeIslConfidenceIntoGraphFactors(graph, undefined);
    expect(resultUndefined).toHaveLength(2);
    expect(resultUndefined[0].confidence).toBe(0.35);
    expect(resultUndefined[0].confidence_source).toBe('graph');

    const resultEmpty = mergeIslConfidenceIntoGraphFactors(graph, []);
    expect(resultEmpty).toHaveLength(2);
    expect(resultEmpty[0].confidence).toBe(0.35);
  });

  it('T6: determinism — same input produces identical output', () => {
    const graph = [
      makeGraphFactor('fac_a', { confidence: 0.35 }),
      makeGraphFactor('fac_b', { confidence: 0.40 }),
    ];
    const isl = [
      makeIslFactor('fac_a', { confidence: 0.82 }),
      makeIslFactor('fac_b', { confidence: 0.21 }),
    ];

    const result1 = mergeIslConfidenceIntoGraphFactors(graph, isl);
    const result2 = mergeIslConfidenceIntoGraphFactors(graph, isl);

    expect(result1).toEqual(result2);
  });

  it('T7: bootstrap fields copied from ISL to merged entries', () => {
    const graph = [makeGraphFactor('fac_a')];
    const isl = [makeIslFactor('fac_a', {
      confidence: 0.72,
      attribution_stability: 'moderate',
      elasticity_std: 0.08,
      rank_flip_rate: 0.15,
      stability_method: 'bootstrap_1000',
    })];

    const result = mergeIslConfidenceIntoGraphFactors(graph, isl);

    expect(result[0].attribution_stability).toBe('moderate');
    expect(result[0].elasticity_std).toBe(0.08);
    expect(result[0].rank_flip_rate).toBe(0.15);
    expect(result[0].stability_method).toBe('bootstrap_1000');
  });
});
