/**
 * ISL Confidence Merge Tests
 *
 * Verifies mergeIslConfidenceIntoGraphFactors with unified confidence formula
 * (formula_version plot_unified_v2, audit row A1-PRIMARY).
 *
 * T1: Merge by node_id — graph A,B,C + ISL A,B → A,B get unified confidence; C keeps graph
 * T2: Unified confidence blends ISL attribution_stability with incoming edge mean
 * T3: ISL-only factors preserved (appended with new honest source enum)
 * T4: ISL entry without attribution_stability — degenerate fallback flagged via input_quality
 * T5: No ISL results — all factors retain graph confidence
 * T6: Determinism — same input → identical output
 * T7: Bootstrap fields copied from ISL to merged entries
 * T8: confidence_components populated correctly
 * T9: ISL-only factors get unified confidence from graph edges
 * T10: intervention_override updates but doesn't append
 * T11 (audit A1-PRIMARY): ISL's own `confidence` and ISL-style `confidence_source`
 *      values (e.g. "bootstrap_sampling") never reach the merged public response.
 */

import { describe, it, expect } from 'vitest';
import { mergeIslConfidenceIntoGraphFactors } from '../src/lib/factor-influence.js';
import type { FactorSensitivityResultV3, EngineEdgeV3 } from '../src/types/engine-v3.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGraphFactor(id: string, overrides?: Partial<FactorSensitivityResultV3>): FactorSensitivityResultV3 {
  return {
    factor_id: id,
    factor_label: `Label ${id}`,
    sensitivity_score: 0.5,
    direction: 'positive',
    confidence: 0.5, // Unified default (no ISL, no incoming edges)
    confidence_source: 'plot_unified_from_graph',
    confidence_provenance: {
      computation_source: 'plot_unified_from_graph',
      formula_version: 'plot_unified_v2',
      is_provisional: true,
      calibration_status: 'provisional_pending_pilot_calibration',
      input_quality: 'standard',
    },
    confidence_components: {
      structural_certainty: 0.5,
      sampling_stability: null,
    },
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
    confidence: 0.72, // ISL's internal confidence — must be dropped, never propagated.
    // Use a free-form string here so tests can detect leaks. The narrowed
    // public type doesn't permit this value, but ISL emits it on the wire so
    // we cast through `any` to simulate the upstream payload shape.
    confidence_source: 'bootstrap_sampling' as any,
    source: 'isl',
    attribution_stability: 'high',
    elasticity_std: 0.05,
    rank_flip_rate: 0.02,
    stability_method: 'bootstrap_1000',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Honest source-enum constants (for assertion clarity)
// ---------------------------------------------------------------------------

const SRC_ISL_BOOTSTRAP = 'plot_unified_from_isl_bootstrap';
const SRC_GRAPH = 'plot_unified_from_graph';

// Legacy values that must NEVER appear in the public response (audit A1-PRIMARY).
const LEGACY_FORBIDDEN_SOURCES = ['isl', 'graph', 'fallback_degenerate', 'bootstrap_sampling'] as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mergeIslConfidenceIntoGraphFactors', () => {
  it('T1: merges ISL attribution_stability into matching graph factors and recomputes unified confidence', () => {
    const graph = [
      makeGraphFactor('fac_a', { confidence: 0.5, confidence_components: { structural_certainty: 0.5, sampling_stability: null } }),
      makeGraphFactor('fac_b', { confidence: 0.7, confidence_components: { structural_certainty: 0.9, sampling_stability: null } }),
      makeGraphFactor('fac_c', { confidence: 0.5, confidence_components: { structural_certainty: 0.5, sampling_stability: null } }),
    ];
    const isl = [
      makeIslFactor('fac_a', { attribution_stability: 'high' }),   // v2 band_score = 1.0
      makeIslFactor('fac_b', { attribution_stability: 'low' }),    // v2 band_score = 0.25 (was 0.0)
    ];

    const result = mergeIslConfidenceIntoGraphFactors(graph, isl);

    expect(result).toHaveLength(3);

    // A: unified = 0.5 × 1.0 + 0.5 × 0.5 = 0.75
    const a = result.find(f => f.factor_id === 'fac_a')!;
    expect(a.confidence).toBeCloseTo(0.75, 5);
    expect(a.confidence_source).toBe(SRC_ISL_BOOTSTRAP);
    expect(a.sensitivity_score).toBe(0.5); // Graph influence preserved
    expect(a.source).toBe('graph'); // Still graph-based entry

    // B: v2 — unified = 0.5 × 0.25 + 0.5 × 0.9 = 0.575 (pre-v2: 0.45)
    const b = result.find(f => f.factor_id === 'fac_b')!;
    expect(b.confidence).toBeCloseTo(0.575, 5);
    expect(b.confidence_source).toBe(SRC_ISL_BOOTSTRAP);

    // C retains graph confidence (no ISL match)
    const c = result.find(f => f.factor_id === 'fac_c')!;
    expect(c.confidence).toBe(0.5);
    expect(c.confidence_source).toBe(SRC_GRAPH);
  });

  it('T2: unified confidence blends both ISL and edge signals', () => {
    // Graph factor with incoming edges (structural_certainty = 0.8)
    const graph = [makeGraphFactor('fac_a', {
      confidence: 0.65, // graph-stage: 0.5×0.5 + 0.5×0.8 = 0.65
      confidence_components: { structural_certainty: 0.8, sampling_stability: null },
    })];
    // ISL provides moderate stability
    const isl = [makeIslFactor('fac_a', { attribution_stability: 'moderate' })]; // band_score = 0.5

    const result = mergeIslConfidenceIntoGraphFactors(graph, isl);

    // unified = 0.5 × 0.5 + 0.5 × 0.8 = 0.65
    expect(result[0].confidence).toBeCloseTo(0.65, 5);
    expect(result[0].confidence_source).toBe(SRC_ISL_BOOTSTRAP);
    expect(result[0].confidence_components).toEqual({
      structural_certainty: 0.8,
      sampling_stability: 0.5, // moderate → 0.5
    });
  });

  it('T3: ISL-only factors appended to result with unified confidence', () => {
    const graph = [makeGraphFactor('fac_a')];
    const isl = [
      makeIslFactor('fac_a', { attribution_stability: 'high' }),
      makeIslFactor('fac_d', { attribution_stability: 'moderate', source: 'isl' }),
    ];

    // Provide graph edges so ISL-only factor fac_d can compute incoming edges
    const graphEdges: EngineEdgeV3[] = [
      { from: 'fac_a', to: 'fac_d', exists_probability: 0.85, strength: { mean: 0.5, std: 0.1 } },
    ];

    const result = mergeIslConfidenceIntoGraphFactors(graph, isl, graphEdges);

    expect(result).toHaveLength(2);
    const d = result.find(f => f.factor_id === 'fac_d')!;
    expect(d).toBeDefined();
    expect(d.source).toBe('isl');
    expect(d.confidence_source).toBe(SRC_ISL_BOOTSTRAP);
    // unified = 0.5 × 0.5 + 0.5 × 0.85 = 0.675
    expect(d.confidence).toBeCloseTo(0.675, 5);
    expect(d.confidence_components).toEqual({
      structural_certainty: 0.85,
      sampling_stability: 0.5, // moderate → 0.5
    });
  });

  it('T4: ISL entry without attribution_stability — degenerate fallback surfaces via input_quality', () => {
    const graph = [makeGraphFactor('fac_a', { confidence: 0.5 })];
    const isl = [makeIslFactor('fac_a', { attribution_stability: undefined as any })];

    // No graphEdges passed → merge synthesises a single exists_probability edge
    // from structural_certainty; that stripped edge has no strength_mean/std, so
    // the CV (graph) path cannot fire and the degenerate branch is the correct
    // tag here. The confidence value stays 0.5 (uniform default).
    const result = mergeIslConfidenceIntoGraphFactors(graph, isl);

    expect(result[0].confidence).toBe(0.5);
    // Audit A1-PRIMARY: source no longer carries 'fallback_degenerate' — it
    // honestly reports the COMPUTATION origin. The degeneracy signal moved
    // into provenance.input_quality so consumers can still detect it.
    expect(result[0].confidence_source).toBe(SRC_GRAPH);
    expect(result[0].confidence_provenance?.input_quality).toBe('degenerate_fallback');
  });

  it('T5: no ISL results — all factors retain graph confidence', () => {
    const graph = [
      makeGraphFactor('fac_a', { confidence: 0.5 }),
      makeGraphFactor('fac_b', { confidence: 0.65 }),
    ];

    const resultUndefined = mergeIslConfidenceIntoGraphFactors(graph, undefined);
    expect(resultUndefined).toHaveLength(2);
    expect(resultUndefined[0].confidence).toBe(0.5);
    expect(resultUndefined[0].confidence_source).toBe(SRC_GRAPH);

    const resultEmpty = mergeIslConfidenceIntoGraphFactors(graph, []);
    expect(resultEmpty).toHaveLength(2);
    expect(resultEmpty[0].confidence).toBe(0.5);
  });

  it('T6: determinism — same input produces identical output', () => {
    const graph = [
      makeGraphFactor('fac_a', { confidence: 0.5, confidence_components: { structural_certainty: 0.5, sampling_stability: null } }),
      makeGraphFactor('fac_b', { confidence: 0.7, confidence_components: { structural_certainty: 0.9, sampling_stability: null } }),
    ];
    const isl = [
      makeIslFactor('fac_a', { attribution_stability: 'high' }),
      makeIslFactor('fac_b', { attribution_stability: 'moderate' }),
    ];

    const result1 = mergeIslConfidenceIntoGraphFactors(graph, isl);
    const result2 = mergeIslConfidenceIntoGraphFactors(graph, isl);

    expect(result1).toEqual(result2);
  });

  it('T7: bootstrap fields copied from ISL to merged entries', () => {
    const graph = [makeGraphFactor('fac_a')];
    const isl = [makeIslFactor('fac_a', {
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

  it('T8: confidence_components populated correctly for all scenarios', () => {
    // Graph factor with edges, ISL with high stability
    const graph = [makeGraphFactor('fac_a', {
      confidence_components: { structural_certainty: 0.85, sampling_stability: null },
    })];
    const isl = [makeIslFactor('fac_a', { attribution_stability: 'high' })];

    const result = mergeIslConfidenceIntoGraphFactors(graph, isl);

    expect(result[0].confidence_components).toEqual({
      structural_certainty: 0.85,
      sampling_stability: 1.0, // high → 1.0
    });
  });

  it('T9: ISL-only factor without graph edges gets default structural_certainty', () => {
    const graph = [makeGraphFactor('fac_a')];
    const isl = [
      makeIslFactor('fac_a', { attribution_stability: 'high' }),
      makeIslFactor('fac_d', { attribution_stability: 'low', source: 'isl' }),
    ];

    // No graph edges provided → ISL-only factor fac_d has no incoming edges
    const result = mergeIslConfidenceIntoGraphFactors(graph, isl);

    const d = result.find(f => f.factor_id === 'fac_d')!;
    // v2 — unified = 0.5 × 0.25 + 0.5 × 0.5 = 0.375 (pre-v2: 0.25)
    expect(d.confidence).toBeCloseTo(0.375, 5);
    expect(d.confidence_components).toEqual({
      structural_certainty: 0.5,
      sampling_stability: 0.25, // v2: low → 0.25 (was 0.0)
    });
  });

  it('consistent values regardless of source: same edges + same stability = same confidence', () => {
    // Two factors with identical structural_certainty and attribution_stability
    // should produce identical confidence regardless of whether they came from graph or ISL path
    const graph = [
      makeGraphFactor('fac_graph', {
        confidence_components: { structural_certainty: 0.7, sampling_stability: null },
      }),
    ];
    const isl = [
      makeIslFactor('fac_graph', { attribution_stability: 'moderate' }),
      makeIslFactor('fac_isl_only', { attribution_stability: 'moderate', source: 'isl' }),
    ];

    // fac_isl_only has same incoming edge profile (0.7 from graph edges)
    const graphEdges: EngineEdgeV3[] = [
      { from: 'other', to: 'fac_isl_only', exists_probability: 0.7, strength: { mean: 0.5, std: 0.1 } },
    ];

    const result = mergeIslConfidenceIntoGraphFactors(graph, isl, graphEdges);

    const graphFactor = result.find(f => f.factor_id === 'fac_graph')!;
    const islFactor = result.find(f => f.factor_id === 'fac_isl_only')!;

    // Both: 0.5 × 0.5 + 0.5 × 0.7 = 0.6
    expect(graphFactor.confidence).toBeCloseTo(0.6, 5);
    expect(islFactor.confidence).toBeCloseTo(0.6, 5);
    expect(graphFactor.confidence).toBe(islFactor.confidence);
  });

  it('T10: intervention_override ISL entries update confidence on matching graph factors but do not append', () => {
    // When unfiltered ISL entries are passed, intervention_override entries
    // carry valid attribution_stability for confidence recomputation but
    // must NOT appear as new entries in the output.
    const graph = [
      makeGraphFactor('fac_a', { confidence: 0.5 }),
      makeGraphFactor('fac_b', { confidence: 0.5 }),
    ];
    const isl = [
      // fac_a matches graph — its attribution_stability should update confidence
      makeIslFactor('fac_a', {
        attribution_stability: 'negligible',
        zero_reason: 'intervention_override',
      }),
      // fac_c is ISL-only AND intervention_override — must NOT be appended
      makeIslFactor('fac_c', {
        attribution_stability: 'negligible',
        zero_reason: 'intervention_override',
      }),
    ];

    const result = mergeIslConfidenceIntoGraphFactors(graph, isl);

    // Only 2 entries — fac_c must not be appended
    expect(result).toHaveLength(2);
    expect(result.map(f => f.factor_id).sort()).toEqual(['fac_a', 'fac_b']);

    // fac_a should have updated confidence from ISL attribution_stability: negligible
    // negligible band score = 0.0, mean_ep = 0.5 (default) → 0.5×0.0 + 0.5×0.5 = 0.25
    const facA = result.find(f => f.factor_id === 'fac_a')!;
    expect(facA.confidence).toBeCloseTo(0.25, 5);
    expect(facA.confidence_source).toBe(SRC_ISL_BOOTSTRAP);
    expect(facA.attribution_stability).toBe('negligible');

    // fac_b has no ISL match — keeps default 0.5
    const facB = result.find(f => f.factor_id === 'fac_b')!;
    expect(facB.confidence).toBe(0.5);
    expect(facB.confidence_source).toBe(SRC_GRAPH);
  });

  // -------------------------------------------------------------------------
  // T11 — heart-of-the-fix regression (audit row A1-PRIMARY)
  // -------------------------------------------------------------------------

  it('T11: ISL own confidence and confidence_source ("bootstrap_sampling") never reach the public response', () => {
    const graph = [makeGraphFactor('fac_a')];
    // makeIslFactor() helper sets confidence: 0.72, confidence_source: 'bootstrap_sampling'.
    // After merge, neither must surface in the output object.
    const isl = [makeIslFactor('fac_a', { attribution_stability: 'high', confidence: 0.99 as any })];

    const result = mergeIslConfidenceIntoGraphFactors(graph, isl);

    expect(result[0].confidence).not.toBe(0.99); // ISL's value dropped
    expect(result[0].confidence_source).not.toBe('bootstrap_sampling');
    // Belt-and-braces: forbid every legacy or upstream-ISL source label.
    for (const forbidden of LEGACY_FORBIDDEN_SOURCES) {
      expect(result[0].confidence_source).not.toBe(forbidden);
    }
    // And the new honest label is what we get instead.
    expect(result[0].confidence_source).toBe(SRC_ISL_BOOTSTRAP);
    // Provenance metadata populated.
    expect(result[0].confidence_provenance).toEqual({
      computation_source: SRC_ISL_BOOTSTRAP,
      formula_version: 'plot_unified_v2',
      is_provisional: true,
      calibration_status: 'provisional_pending_pilot_calibration',
      input_quality: 'standard',
    });
  });

  it('T11b: aggregate regression — every factor in merged output uses honest source enum only', () => {
    const graph = [
      makeGraphFactor('fac_a'),
      makeGraphFactor('fac_b'),
      makeGraphFactor('fac_c'),
    ];
    const isl = [
      makeIslFactor('fac_a', { attribution_stability: 'high' }),
      makeIslFactor('fac_b', { attribution_stability: 'low' }),
      makeIslFactor('fac_d', { attribution_stability: 'negligible', source: 'isl' }), // ISL-only append
    ];

    const result = mergeIslConfidenceIntoGraphFactors(graph, isl);

    for (const f of result) {
      for (const forbidden of LEGACY_FORBIDDEN_SOURCES) {
        expect(f.confidence_source).not.toBe(forbidden);
      }
      // Source is one of the honest enum values.
      expect([SRC_ISL_BOOTSTRAP, SRC_GRAPH]).toContain(f.confidence_source);
      // Provenance present and well-formed.
      expect(f.confidence_provenance?.formula_version).toBe('plot_unified_v2');
      expect(f.confidence_provenance?.is_provisional).toBe(true);
    }
  });
});
