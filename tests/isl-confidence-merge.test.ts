/**
 * ISL Confidence Merge Tests
 *
 * Verifies mergeIslConfidenceIntoGraphFactors with unified confidence formula.
 *
 * Default test path (formula_version plot_unified_v3): when `makeIslFactor`
 * supplies a finite continuous ISL `confidence` (default 0.72) together with
 * a non-null `attribution_stability`, the merge fires the v3 branch:
 *   confidence = 0.5 × ISL_continuous_bootstrap_confidence + 0.5 × mean(exists_probability)
 * The 4-bucket band fallback (plot_unified_v2) is exercised by tests that
 * explicitly set `confidence: null` on the ISL factor (V3-T3).
 *
 * T1: Merge by node_id — graph A,B,C + ISL A,B → A,B get unified confidence; C keeps graph
 * T2: Unified confidence blends ISL continuous confidence with incoming edge mean
 * T3: ISL-only factors preserved (appended with new honest source enum)
 * T4: ISL entry without attribution_stability — degenerate fallback flagged via input_quality
 * T5: No ISL results — all factors retain graph confidence
 * T6: Determinism — same input → identical output
 * T7: Bootstrap fields copied from ISL to merged entries
 * T8: confidence_components populated correctly
 * T9: ISL-only factors get unified confidence from graph edges
 * T10: intervention_override updates but doesn't append
 * T11 (audit A1-PRIMARY): ISL's own `confidence` literal and ISL-style
 *      `confidence_source` (e.g. "bootstrap_sampling") never reach the
 *      merged public response. Under v3, ISL's confidence value is consumed
 *      as a 50/50 input to the blend but never emitted verbatim.
 * V3-T1..V3-T6: plot_unified_v3 invariants (see new `plot_unified_v3` describe block).
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
  it('T1: merges ISL attribution_stability + continuous confidence into matching graph factors and recomputes unified confidence', () => {
    const graph = [
      makeGraphFactor('fac_a', { confidence: 0.5, confidence_components: { structural_certainty: 0.5, sampling_stability: null } }),
      makeGraphFactor('fac_b', { confidence: 0.7, confidence_components: { structural_certainty: 0.9, sampling_stability: null } }),
      makeGraphFactor('fac_c', { confidence: 0.5, confidence_components: { structural_certainty: 0.5, sampling_stability: null } }),
    ];
    const isl = [
      // makeIslFactor default `confidence: 0.72` activates plot_unified_v3.
      makeIslFactor('fac_a', { attribution_stability: 'high' }),   // isl_conf = 0.72
      makeIslFactor('fac_b', { attribution_stability: 'low' }),    // isl_conf = 0.72
    ];

    const result = mergeIslConfidenceIntoGraphFactors(graph, isl);

    expect(result).toHaveLength(3);

    // A (v3): unified = 0.5 × 0.72 + 0.5 × 0.5 = 0.61
    const a = result.find(f => f.factor_id === 'fac_a')!;
    expect(a.confidence).toBeCloseTo(0.61, 5);
    expect(a.confidence_source).toBe(SRC_ISL_BOOTSTRAP);
    expect(a.confidence_provenance?.formula_version).toBe('plot_unified_v3');
    expect(a.sensitivity_score).toBe(0.5); // Graph influence preserved
    expect(a.source).toBe('graph'); // Still graph-based entry

    // B (v3): unified = 0.5 × 0.72 + 0.5 × 0.9 = 0.81
    const b = result.find(f => f.factor_id === 'fac_b')!;
    expect(b.confidence).toBeCloseTo(0.81, 5);
    expect(b.confidence_source).toBe(SRC_ISL_BOOTSTRAP);
    expect(b.confidence_provenance?.formula_version).toBe('plot_unified_v3');

    // C retains graph confidence (no ISL match)
    const c = result.find(f => f.factor_id === 'fac_c')!;
    expect(c.confidence).toBe(0.5);
    expect(c.confidence_source).toBe(SRC_GRAPH);
    expect(c.confidence_provenance?.formula_version).toBe('plot_unified_v2');
  });

  it('T2: unified confidence blends both ISL continuous confidence and edge signals', () => {
    // Graph factor with incoming edges (structural_certainty = 0.8)
    const graph = [makeGraphFactor('fac_a', {
      confidence: 0.65, // graph-stage: 0.5×0.5 + 0.5×0.8 = 0.65
      confidence_components: { structural_certainty: 0.8, sampling_stability: null },
    })];
    // ISL provides moderate stability + default continuous confidence 0.72
    const isl = [makeIslFactor('fac_a', { attribution_stability: 'moderate' })]; // isl_conf = 0.72

    const result = mergeIslConfidenceIntoGraphFactors(graph, isl);

    // v3 unified = 0.5 × 0.72 + 0.5 × 0.8 = 0.76
    expect(result[0].confidence).toBeCloseTo(0.76, 5);
    expect(result[0].confidence_source).toBe(SRC_ISL_BOOTSTRAP);
    expect(result[0].confidence_provenance?.formula_version).toBe('plot_unified_v3');
    expect(result[0].confidence_components).toEqual({
      structural_certainty: 0.8,
      sampling_stability: 0.5, // band-table derived for progressive disclosure; moderate → 0.5
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
    expect(d.confidence_provenance?.formula_version).toBe('plot_unified_v3');
    // v3 unified = 0.5 × 0.72 + 0.5 × 0.85 = 0.785
    expect(d.confidence).toBeCloseTo(0.785, 5);
    expect(d.confidence_components).toEqual({
      structural_certainty: 0.85,
      sampling_stability: 0.5, // band-table derived for progressive disclosure; moderate → 0.5
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
    // v3 unified = 0.5 × 0.72 + 0.5 × 0.5 = 0.61
    expect(d.confidence).toBeCloseTo(0.61, 5);
    expect(d.confidence_provenance?.formula_version).toBe('plot_unified_v3');
    expect(d.confidence_components).toEqual({
      structural_certainty: 0.5,
      sampling_stability: 0.25, // band-table derived for progressive disclosure; low → 0.25
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

    // Both v3: 0.5 × 0.72 + 0.5 × 0.7 = 0.71
    expect(graphFactor.confidence).toBeCloseTo(0.71, 5);
    expect(islFactor.confidence).toBeCloseTo(0.71, 5);
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

    // fac_a should have updated confidence from ISL bootstrap inputs.
    // v3: ISL continuous conf 0.72, mean_ep = 0.5 (default) → 0.5×0.72 + 0.5×0.5 = 0.61
    const facA = result.find(f => f.factor_id === 'fac_a')!;
    expect(facA.confidence).toBeCloseTo(0.61, 5);
    expect(facA.confidence_source).toBe(SRC_ISL_BOOTSTRAP);
    expect(facA.confidence_provenance?.formula_version).toBe('plot_unified_v3');
    expect(facA.attribution_stability).toBe('negligible');

    // fac_b has no ISL match — keeps default 0.5
    const facB = result.find(f => f.factor_id === 'fac_b')!;
    expect(facB.confidence).toBe(0.5);
    expect(facB.confidence_source).toBe(SRC_GRAPH);
  });

  // -------------------------------------------------------------------------
  // T11 — heart-of-the-fix regression (audit row A1-PRIMARY)
  // -------------------------------------------------------------------------

  it('T11: ISL own confidence-source label and verbatim confidence value never reach the public response', () => {
    const graph = [makeGraphFactor('fac_a')];
    // makeIslFactor() helper sets confidence_source: 'bootstrap_sampling'.
    // Set ISL `confidence` to 0.99 — under v3 the value is consumed as the
    // stability input to the blend, but the literal 0.99 must NOT surface
    // verbatim. The emitted value is the PLoT-computed blend.
    const isl = [makeIslFactor('fac_a', { attribution_stability: 'high', confidence: 0.99 as any })];

    const result = mergeIslConfidenceIntoGraphFactors(graph, isl);

    // v3: 0.5 × 0.99 + 0.5 × 0.5 = 0.745 ≠ 0.99
    expect(result[0].confidence).not.toBe(0.99);
    expect(result[0].confidence).toBeCloseTo(0.745, 5);
    expect(result[0].confidence_source).not.toBe('bootstrap_sampling');
    // Belt-and-braces: forbid every legacy or upstream-ISL source label.
    for (const forbidden of LEGACY_FORBIDDEN_SOURCES) {
      expect(result[0].confidence_source).not.toBe(forbidden);
    }
    // And the new honest label is what we get instead.
    expect(result[0].confidence_source).toBe(SRC_ISL_BOOTSTRAP);
    // Provenance metadata populated; v3 because ISL emitted a finite continuous confidence.
    expect(result[0].confidence_provenance).toEqual({
      computation_source: SRC_ISL_BOOTSTRAP,
      formula_version: 'plot_unified_v3',
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
      // Provenance present and well-formed. ISL factors fire v3 (finite continuous
      // confidence supplied by makeIslFactor default 0.72); graph-only factors stay on v2.
      const expectedVersion = f.confidence_source === SRC_ISL_BOOTSTRAP ? 'plot_unified_v3' : 'plot_unified_v2';
      expect(f.confidence_provenance?.formula_version).toBe(expectedVersion);
      expect(f.confidence_provenance?.is_provisional).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// plot_unified_v3 invariants (continuous bootstrap confidence path)
//
// V3-T1: ISL continuous confidence used as the stability component when present.
// V3-T2: Edge-confidence component still blended in.
// V3-T3: Missing / invalid ISL confidence falls back to the v2 banded formula.
// V3-T4: Default-edge case no longer collapses to {0.25, 0.375, 0.5, 0.75}.
// V3-T5: Fixture with at least 5 factors produces ≥ 5 distinct confidence values.
// V3-T6: Unrelated outputs (3C diagnostic fields, source/provenance shape,
//        importance_rank ordering, attribution_stability passthrough) unchanged.
// ---------------------------------------------------------------------------

describe('plot_unified_v3 (continuous bootstrap confidence)', () => {
  it('V3-T1: ISL continuous confidence is used as the stability component (50/50 with edge mean)', () => {
    const graph = [makeGraphFactor('fac_a', {
      confidence_components: { structural_certainty: 0.5, sampling_stability: null },
    })];
    // Default makeIslFactor confidence is 0.72; override to a specific value
    // representative of ISL's `compute_factor_confidence` output for moderate
    // stability with mild CV refinement: 0.6694 (≈ 0.7×0.6 + 0.3×(1/(1+0.2))).
    const isl = [makeIslFactor('fac_a', {
      attribution_stability: 'moderate',
      confidence: 0.6694 as any,
    })];

    const result = mergeIslConfidenceIntoGraphFactors(graph, isl);

    // 0.5 × 0.6694 + 0.5 × 0.5 = 0.5847
    expect(result[0].confidence).toBeCloseTo(0.5847, 6);
    expect(result[0].confidence_source).toBe(SRC_ISL_BOOTSTRAP);
    expect(result[0].confidence_provenance?.formula_version).toBe('plot_unified_v3');
  });

  it('V3-T2: edge-confidence component is still blended in (confidence varies with edge mean)', () => {
    const graphLowEdge = [makeGraphFactor('fac_a', {
      confidence_components: { structural_certainty: 0.5, sampling_stability: null },
    })];
    const graphHighEdge = [makeGraphFactor('fac_a', {
      confidence_components: { structural_certainty: 0.9, sampling_stability: null },
    })];
    const isl = [makeIslFactor('fac_a', {
      attribution_stability: 'moderate',
      confidence: 0.6694 as any,
    })];

    const resultLow = mergeIslConfidenceIntoGraphFactors(graphLowEdge, isl);
    const resultHigh = mergeIslConfidenceIntoGraphFactors(graphHighEdge, isl);

    // Low edges: 0.5 × 0.6694 + 0.5 × 0.5 = 0.5847
    // High edges: 0.5 × 0.6694 + 0.5 × 0.9 = 0.7847
    // Difference proves the edge component is not dropped.
    expect(resultLow[0].confidence).toBeCloseTo(0.5847, 6);
    expect(resultHigh[0].confidence).toBeCloseTo(0.7847, 6);
    expect(resultHigh[0].confidence).toBeGreaterThan(resultLow[0].confidence);
  });

  it('V3-T3: missing or invalid ISL continuous confidence falls back to v2 banded formula', () => {
    const graph = [makeGraphFactor('fac_a', {
      confidence_components: { structural_certainty: 0.5, sampling_stability: null },
    })];
    // Three sub-cases — each MUST produce the v2 band result (low band 0.25
    // → 0.5 × 0.25 + 0.5 × 0.5 = 0.375) and tag formula_version v2.
    const subCases: Array<[string, unknown]> = [
      ['undefined confidence', undefined],
      ['NaN confidence', Number.NaN],
      ['out-of-range confidence (1.5)', 1.5],
      ['out-of-range confidence (-0.1)', -0.1],
      ['null confidence', null],
    ];
    for (const [label, badConfidence] of subCases) {
      const isl = [makeIslFactor('fac_a', {
        attribution_stability: 'low',
        confidence: badConfidence as any,
      })];
      const result = mergeIslConfidenceIntoGraphFactors(graph, isl);
      expect(result[0].confidence, `case=${label}`).toBeCloseTo(0.375, 6);
      expect(result[0].confidence_source, `case=${label}`).toBe(SRC_ISL_BOOTSTRAP);
      expect(result[0].confidence_provenance?.formula_version, `case=${label}`).toBe('plot_unified_v2');
    }
  });

  it('V3-T4: default-edge case no longer collapses to the {0.25, 0.375, 0.5, 0.625, 0.75} lattice', () => {
    // Five factors, all with default-edge mean (0.5), each with a distinct
    // ISL continuous confidence. The pre-v3 formula would have produced
    // values in {0.25, 0.375, 0.5, 0.75} regardless of CV refinement; v3
    // produces continuous values reflecting ISL's actual confidence.
    const graphFactors = ['fac_a', 'fac_b', 'fac_c', 'fac_d', 'fac_e'].map(id =>
      makeGraphFactor(id, {
        confidence_components: { structural_certainty: 0.5, sampling_stability: null },
      })
    );
    const islFactors = [
      makeIslFactor('fac_a', { attribution_stability: 'high', confidence: 0.87 as any }),
      makeIslFactor('fac_b', { attribution_stability: 'moderate', confidence: 0.66 as any }),
      makeIslFactor('fac_c', { attribution_stability: 'low', confidence: 0.31 as any }),
      makeIslFactor('fac_d', { attribution_stability: 'negligible', confidence: 0.12 as any }),
      makeIslFactor('fac_e', { attribution_stability: 'low', confidence: 0.42 as any }),
    ];

    const result = mergeIslConfidenceIntoGraphFactors(graphFactors, islFactors);
    const values = result.map(f => f.confidence!);

    const LATTICE = new Set([0.25, 0.375, 0.5, 0.625, 0.75]);
    for (const v of values) {
      // Round to 5 decimals so 0.685 doesn't accidentally match 0.685000…01.
      const rounded = Math.round(v * 1e5) / 1e5;
      expect(LATTICE.has(rounded), `value ${v} fell on the legacy v2 lattice`).toBe(false);
    }
    // All factors are on the v3 path.
    for (const f of result) {
      expect(f.confidence_provenance?.formula_version).toBe('plot_unified_v3');
    }
  });

  it('V3-T5: fixture with at least 5 factors produces 5+ distinct confidence values', () => {
    const ids = ['fac_a', 'fac_b', 'fac_c', 'fac_d', 'fac_e', 'fac_f'];
    const graphFactors = ids.map(id =>
      makeGraphFactor(id, {
        confidence_components: { structural_certainty: 0.5, sampling_stability: null },
      })
    );
    // ISL confidences chosen so the 50/50 blend with mean_edge=0.5 produces
    // six distinct values: 0.685, 0.580, 0.500, 0.405, 0.310, 0.235.
    const islConfidences = [0.87, 0.66, 0.50, 0.31, 0.12, 0.47];
    const islFactors = ids.map((id, i) =>
      makeIslFactor(id, {
        attribution_stability: 'moderate',
        confidence: islConfidences[i] as any,
      })
    );

    const result = mergeIslConfidenceIntoGraphFactors(graphFactors, islFactors);
    const confidences = result.map(f => f.confidence!);
    // Round to 6 decimals to suppress floating-point hash collisions.
    const distinct = new Set(confidences.map(v => Math.round(v * 1e6) / 1e6));
    expect(distinct.size).toBeGreaterThanOrEqual(5);
  });

  it('V3-T6: unrelated outputs unchanged — 3C diagnostic fields, importance_rank ordering, attribution_stability passthrough', () => {
    const graph = [
      makeGraphFactor('fac_a', { importance_rank: 1, confidence_components: { structural_certainty: 0.5, sampling_stability: null } }),
      makeGraphFactor('fac_b', { importance_rank: 2, confidence_components: { structural_certainty: 0.7, sampling_stability: null } }),
    ];
    const isl = [
      makeIslFactor('fac_a', {
        attribution_stability: 'moderate',
        confidence: 0.6694 as any,
        elasticity_std: 0.05,
        rank_flip_rate: 0.05,
        stability_method: 'bootstrap_20',
      }),
      makeIslFactor('fac_b', {
        attribution_stability: 'high',
        confidence: 0.92 as any,
        elasticity_std: 0.02,
        rank_flip_rate: 0.0,
        stability_method: 'bootstrap_20',
      }),
    ];

    const result = mergeIslConfidenceIntoGraphFactors(graph, isl);

    // importance_rank ordering preserved (graph-side input)
    expect(result.find(f => f.factor_id === 'fac_a')!.importance_rank).toBe(1);
    expect(result.find(f => f.factor_id === 'fac_b')!.importance_rank).toBe(2);

    // 3C diagnostic fields passed through verbatim from ISL
    const a = result.find(f => f.factor_id === 'fac_a')!;
    expect(a.attribution_stability).toBe('moderate');
    expect(a.elasticity_std).toBe(0.05);
    expect(a.rank_flip_rate).toBe(0.05);
    expect(a.stability_method).toBe('bootstrap_20');

    // confidence_source / shape unchanged (v3 keeps the bootstrap source label)
    for (const f of result) {
      expect(f.confidence_source).toBe(SRC_ISL_BOOTSTRAP);
      expect(f.confidence_provenance?.computation_source).toBe(SRC_ISL_BOOTSTRAP);
      expect(f.confidence_provenance?.is_provisional).toBe(true);
      expect(f.confidence_provenance?.calibration_status).toBe('provisional_pending_pilot_calibration');
      expect(f.confidence_provenance?.input_quality).toBe('standard');
    }
  });
});
