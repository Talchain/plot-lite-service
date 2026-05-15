/**
 * Evidence-gap provenance tests.
 *
 * Locks in that `m1_coaching.evidence_gaps` consumes the public/enriched
 * `factor_sensitivity[]` array (graph-merged influence, PLoT-recomputed
 * confidence) — not the raw ISL `factor_sensitivity`. Raw ISL signal must not
 * be republished under public coaching field names. Audit trail: truth-table
 * row A1-PRIMARY.
 */

import { describe, it, expect } from 'vitest';
import { generateM1Coaching } from '../../src/coaching/m1-coaching.js';
import { normaliseCoachingInputs } from '../../src/coaching/normalise-inputs.js';
import { computeEvidenceGaps } from '../../src/coaching/evidence-gaps.js';
import type { CoachingInputs } from '../../src/coaching/types.js';
import type { EngineGraphV3, FactorSensitivityResultV3, OptionV3 } from '../../src/types/engine-v3.js';

const graph: EngineGraphV3 = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'f1', kind: 'factor', label: 'Cost', category: 'controllable' },
    { id: 'f2', kind: 'factor', label: 'Market Risk', category: 'external' },
  ],
  edges: [
    { from: 'f1', to: 'goal', strength: { mean: 0.8, std: 0.1 }, exists_probability: 0.9 },
    { from: 'f2', to: 'goal', strength: { mean: -0.6, std: 0.15 }, exists_probability: 0.9 },
  ],
};

// Default options have no interventions — used for tests that don't exercise
// the intervention-target filter. Tests that do exercise the filter override
// interventions explicitly.
const options: OptionV3[] = [
  { id: 'opt1', label: 'Option A', winProbability: 0.75, expectedOutcome: 120, interventions: {} as any },
  { id: 'opt2', label: 'Option B', winProbability: 0.25, expectedOutcome: 80, interventions: {} as any },
];

const islResult = () => ({
  options: [
    { id: 'opt1', label: 'Option A', win_probability: 0.75, outcome: { mean: 120, p10: 100, p90: 140 } },
    { id: 'opt2', label: 'Option B', win_probability: 0.25, outcome: { mean: 80, p10: 60, p90: 100 } },
  ],
  // Raw-ISL values are deliberately the OPPOSITE of the enriched values below —
  // if the coaching layer ever falls back to raw ISL when an enriched array is
  // supplied, these tests will flip and fail loudly.
  factor_sensitivity: [
    { node_id: 'f1', label: 'Cost', importance_rank: 1, elasticity: 0.05, influence_score: 0.05, confidence: 0.95, direction: 'positive' },
    { node_id: 'f2', label: 'Market Risk', importance_rank: 2, elasticity: 0.05, influence_score: 0.05, confidence: 0.95, direction: 'negative' },
  ],
  robustness: { fragile_edges: [] },
});

// Enriched values represent the PLoT-recomputed signal that the public
// `factor_sensitivity[]` would publish for the same bundle.
const enriched = (): FactorSensitivityResultV3[] => [
  {
    factor_id: 'f1',
    factor_label: 'Cost',
    influence_score: 0.9,
    sensitivity_score: 0.9,
    elasticity: 0.05, // ISL elasticity preserved on the entry — we must NOT use it
    direction: 'positive',
    importance_rank: 1,
    confidence: 0.4, // PLoT-recomputed (band + edge mean) — coaching must use this
    confidence_source: 'plot_unified_from_isl_bootstrap',
    confidence_provenance: {
      computation_source: 'plot_unified_from_isl_bootstrap',
      formula_version: 'plot_unified_v2',
      provisional: false,
      input_quality: 'ok',
    } as any,
    source: 'graph',
  },
  {
    factor_id: 'f2',
    factor_label: 'Market Risk',
    influence_score: 0.5,
    sensitivity_score: 0.5,
    elasticity: 0.05,
    direction: 'negative',
    importance_rank: 2,
    confidence: 0.6,
    confidence_source: 'plot_unified_from_isl_bootstrap',
    confidence_provenance: {
      computation_source: 'plot_unified_from_isl_bootstrap',
      formula_version: 'plot_unified_v2',
      provisional: false,
      input_quality: 'ok',
    } as any,
    source: 'graph',
  },
];

describe('evidence_gaps provenance — uses enriched factor_sensitivity, not raw ISL', () => {
  it('confidence comes from enriched (PLoT-recomputed), not raw ISL', () => {
    const inputs = normaliseCoachingInputs(graph, options, islResult(), enriched());
    const f1 = inputs.factorSensitivity.find((f) => f.node_id === 'f1');
    expect(f1?.confidence).toBe(0.4); // enriched
    expect(f1?.confidence).not.toBe(0.95); // raw ISL — must NOT leak
  });

  it('influence/impact comes from enriched canonical signal, not raw ISL elasticity', () => {
    const inputs = normaliseCoachingInputs(graph, options, islResult(), enriched());
    const f1 = inputs.factorSensitivity.find((f) => f.node_id === 'f1');
    // influence_score on the normalised entry is the canonical signal that
    // computeNormalisedImpact will divide by max(abs) — coaching consumes this,
    // not raw ISL elasticity (which is 0.05 in the fixture).
    expect(f1?.influence_score).toBe(0.9);
    expect(f1?.influence_score).not.toBe(0.05);
  });

  it('end-to-end gap.influence is computed from enriched influence_score, not raw-ISL elasticity', () => {
    // Direct impact-provenance assertion (reviewer P1 follow-up):
    // enriched entry carries elasticity=0.05 alongside influence_score=0.9.
    // After computeNormalisedImpact + computeEvidenceGaps, the gap's `influence`
    // field must be derived from influence_score (the canonical PLoT signal),
    // not from raw-ISL elasticity. Locks the provenance promise that the
    // public response makes: same value, same source, same scale.
    const enrichedConflict: FactorSensitivityResultV3[] = [
      {
        factor_id: 'f1',
        factor_label: 'Cost',
        elasticity: 0.05,   // raw-ISL value preserved on the enriched entry
        influence_score: 0.9, // canonical graph-merged signal
        sensitivity_score: 0.9,
        direction: 'positive',
        importance_rank: 1,
        confidence: 0.4,    // low enough to pass the < 0.7 gate
        confidence_source: 'plot_unified_from_isl_bootstrap',
        confidence_provenance: {
          computation_source: 'plot_unified_from_isl_bootstrap',
          formula_version: 'plot_unified_v2',
          provisional: false,
          input_quality: 'ok',
        } as any,
        source: 'graph',
      },
    ];
    const coaching = generateM1Coaching(
      graph,
      options,
      islResult(),
      undefined, undefined, undefined, undefined,
      enrichedConflict,
    );
    const gap = coaching!.evidence_gaps.find((g) => g.factor_id === 'f1');
    expect(gap).toBeDefined();
    // With only one factor, max(|influence_score|) = 0.9, so normalised
    // impact = 0.9 / 0.9 = 1.0 — the published `influence` field.
    expect(gap!.influence).toBe(1);
    // Sanity: would have been 1 if computed from elasticity (max=0.05) too,
    // since there's only one factor — both normalise to 1. So also verify the
    // raw VOI magnitude: voi = normalisedImpact × (1 − confidence) = 1 × 0.6.
    expect(gap!.voi_score).toBeCloseTo(0.6, 4);
    // The display string is rounded to integer percent: 100%.
    expect(gap!.influence_display).toBe('100%');
  });

  it('with two enriched factors whose elasticity-vs-influence_score orderings differ, ranking follows influence_score', () => {
    // Stronger provenance test (reviewer P1 follow-up): two factors where the
    // elasticity-based ranking would invert the influence_score-based ranking.
    // The published `influence` magnitudes must reflect influence_score order,
    // and the evidence_gap with higher influence_score must publish a higher
    // `influence` value.
    const enrichedTwo: FactorSensitivityResultV3[] = [
      // f1: HIGH influence_score (0.9), LOW elasticity (0.05) — should win on influence
      {
        factor_id: 'f1', factor_label: 'High graph influence',
        elasticity: 0.05, influence_score: 0.9, sensitivity_score: 0.9,
        direction: 'positive', importance_rank: 1, confidence: 0.4,
        confidence_source: 'plot_unified_from_isl_bootstrap',
        confidence_provenance: { computation_source: 'plot_unified_from_isl_bootstrap', formula_version: 'plot_unified_v2', provisional: false, input_quality: 'ok' } as any,
        source: 'graph',
      },
      // f2: LOW influence_score (0.3), HIGH elasticity (0.8) — would win under elasticity-based ranking
      {
        factor_id: 'f2', factor_label: 'High raw elasticity',
        elasticity: 0.8, influence_score: 0.3, sensitivity_score: 0.3,
        direction: 'positive', importance_rank: 2, confidence: 0.4,
        confidence_source: 'plot_unified_from_isl_bootstrap',
        confidence_provenance: { computation_source: 'plot_unified_from_isl_bootstrap', formula_version: 'plot_unified_v2', provisional: false, input_quality: 'ok' } as any,
        source: 'graph',
      },
    ];
    const coaching = generateM1Coaching(
      graph, options, islResult(),
      undefined, undefined, undefined, undefined,
      enrichedTwo,
    );
    const f1Gap = coaching!.evidence_gaps.find((g) => g.factor_id === 'f1');
    const f2Gap = coaching!.evidence_gaps.find((g) => g.factor_id === 'f2');
    expect(f1Gap?.influence).toBe(1);                  // max = 0.9 / 0.9
    expect(f2Gap?.influence).toBeCloseTo(0.3 / 0.9, 4); // 0.333…
    // VOI orders: f1 voi = 1 × 0.6 = 0.6; f2 voi = (0.3/0.9) × 0.6 = 0.2.
    // Therefore f1 must rank ahead of f2 (top-1).
    expect(coaching!.evidence_gaps[0].factor_id).toBe('f1');
  });

  it('coaching evidence_gaps output reflects enriched confidence, not raw ISL', () => {
    const coaching = generateM1Coaching(
      graph,
      options,
      islResult(),
      undefined, undefined, undefined, undefined,
      enriched(),
    );
    expect(coaching).toBeDefined();
    const gap = coaching!.evidence_gaps.find((g) => g.factor_id === 'f1');
    // With enriched provenance: confidence = 0.4 → gap visible
    expect(gap).toBeDefined();
    expect(gap!.confidence).toBe(0.4);
    expect(gap!.confidence_display).toBe('40%');
  });

  it('intervention-target factor with non-zero graph influence is NOT silently zeroed', () => {
    // Raw ISL marks f1 as intervention_override with elasticity=0; the legacy
    // path would have collapsed normalisedImpact and VOI to 0, silently
    // excluding it from evidence_gaps via the VOI floor. With the enriched
    // array providing non-zero graph influence, the factor remains a
    // first-class participant in the heuristic and is judged on its merits.
    const interventionIsl = {
      ...islResult(),
      factor_sensitivity: [
        { node_id: 'f1', label: 'Cost', importance_rank: 1, elasticity: 0, influence_score: 0, confidence: 0.5, direction: 'positive', zero_reason: 'intervention_override' },
        { node_id: 'f2', label: 'Market Risk', importance_rank: 2, elasticity: 0.4, influence_score: 0.5, confidence: 0.6, direction: 'negative' },
      ],
    };
    const inputs = normaliseCoachingInputs(graph, options, interventionIsl, enriched());
    const f1 = inputs.factorSensitivity.find((f) => f.node_id === 'f1');
    expect(f1).toBeDefined();
    // Enriched influence (0.9) preserved — not collapsed to ISL's elasticity=0
    expect(f1?.influence_score).toBe(0.9);
    expect(f1?.elasticity).toBe(0.05); // from enriched entry, not 0 from raw ISL
  });

  it('raw ISL confidence string and elasticity are not republished under public coaching field names', () => {
    const coaching = generateM1Coaching(
      graph,
      options,
      islResult(),
      undefined, undefined, undefined, undefined,
      enriched(),
    );
    const gap = coaching!.evidence_gaps.find((g) => g.factor_id === 'f1');
    if (!gap) return; // floor may filter; if so the leak surface is null and the test still passes
    // Raw-ISL confidence in the fixture is 0.95 (display "95%"). It must NOT
    // surface in the public coaching payload.
    expect(gap.confidence).not.toBe(0.95);
    expect(gap.confidence_display).not.toBe('95%');
  });

  it('falls back to raw ISL when enriched array is omitted (backward compatibility)', () => {
    const inputs = normaliseCoachingInputs(graph, options, islResult());
    const f1 = inputs.factorSensitivity.find((f) => f.node_id === 'f1');
    // Legacy path: raw-ISL values flow through unchanged.
    expect(f1?.confidence).toBe(0.95);
    expect(f1?.influence_score).toBe(0.05);
  });

  it('normalised direction is sanitised — mixed/unknown become undefined', () => {
    const enrichedMixed: FactorSensitivityResultV3[] = enriched().map((f) => ({
      ...f,
      direction: 'mixed' as const,
    }));
    const inputs = normaliseCoachingInputs(graph, options, islResult(), enrichedMixed);
    expect(inputs.factorSensitivity.every((f) => f.direction === undefined)).toBe(true);
  });

  it('node label falls back through enriched factor_label and finally factor_id', () => {
    const enrichedNoGraphMatch: FactorSensitivityResultV3[] = [
      {
        factor_id: 'detached_factor',
        factor_label: 'Detached Factor Label',
        influence_score: 0.7,
        confidence: 0.5,
        confidence_source: 'plot_unified_from_graph',
        confidence_provenance: {
          computation_source: 'plot_unified_from_graph',
          formula_version: 'plot_unified_v2',
          provisional: false,
          input_quality: 'ok',
        } as any,
        source: 'graph',
      },
    ];
    const inputs = normaliseCoachingInputs(graph, options, islResult(), enrichedNoGraphMatch);
    expect(inputs.factorSensitivity[0].label).toBe('Detached Factor Label');
  });
});

describe('evidence_gaps intervention-target filter — F1a refined', () => {
  // f1 is a decision lever (set by every option). f2 is a background uncertainty.
  // Both have similar enriched influence — without the filter, f1 wins on rank.
  const enrichedLeverDominant = (): FactorSensitivityResultV3[] => [
    {
      factor_id: 'f1',
      factor_label: 'Cost (lever)',
      influence_score: 0.9,
      sensitivity_score: 0.9,
      direction: 'positive',
      importance_rank: 1,
      confidence: 0.25,
      confidence_source: 'plot_unified_from_isl_bootstrap',
      confidence_provenance: {
        computation_source: 'plot_unified_from_isl_bootstrap',
        formula_version: 'plot_unified_v2',
        provisional: false,
        input_quality: 'ok',
      } as any,
      source: 'graph',
    },
    {
      factor_id: 'f2',
      factor_label: 'Market Risk (background)',
      influence_score: 0.5,
      sensitivity_score: 0.5,
      direction: 'negative',
      importance_rank: 2,
      confidence: 0.4,
      confidence_source: 'plot_unified_from_isl_bootstrap',
      confidence_provenance: {
        computation_source: 'plot_unified_from_isl_bootstrap',
        formula_version: 'plot_unified_v2',
        provisional: false,
        input_quality: 'ok',
      } as any,
      source: 'graph',
    },
  ];

  const optionsWithLever: OptionV3[] = [
    { id: 'opt1', label: 'Option A', winProbability: 0.75, expectedOutcome: 120, interventions: { f1: 0.3 } as any },
    { id: 'opt2', label: 'Option B', winProbability: 0.25, expectedOutcome: 80, interventions: { f1: 0.7 } as any },
  ];

  it('intervention-target ids are derived from options[].interventions keys', () => {
    const inputs = normaliseCoachingInputs(graph, optionsWithLever, islResult(), enrichedLeverDominant());
    expect(inputs.interventionTargetIds).toBeInstanceOf(Set);
    expect([...(inputs.interventionTargetIds ?? [])]).toEqual(['f1']);
  });

  it('intervention-target factor with HIGH enriched influence is excluded from evidence_gaps', () => {
    const inputs = normaliseCoachingInputs(graph, optionsWithLever, islResult(), enrichedLeverDominant());
    const gaps = computeEvidenceGaps(inputs);
    expect(gaps.find((g) => g.factor_id === 'f1')).toBeUndefined();
    expect(gaps.find((g) => g.factor_id === 'f2')).toBeDefined();
  });

  it('non-intervention background factor remains eligible', () => {
    const inputs = normaliseCoachingInputs(graph, optionsWithLever, islResult(), enrichedLeverDominant());
    const gaps = computeEvidenceGaps(inputs);
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps[0].factor_id).toBe('f2');
  });

  it('raw ISL zero_reason is NOT required for the exclusion to work', () => {
    // Same enriched array, but raw ISL has NO zero_reason marker — exclusion
    // must still happen because the source of truth is options[].interventions.
    const islNoZeroReason = {
      ...islResult(),
      factor_sensitivity: [
        { node_id: 'f1', label: 'Cost', importance_rank: 1, elasticity: 0.5, influence_score: 0.5, confidence: 0.4, direction: 'positive' },
        { node_id: 'f2', label: 'Market Risk', importance_rank: 2, elasticity: 0.3, influence_score: 0.3, confidence: 0.4, direction: 'negative' },
      ],
    };
    const inputs = normaliseCoachingInputs(graph, optionsWithLever, islNoZeroReason, enrichedLeverDominant());
    const gaps = computeEvidenceGaps(inputs);
    expect(gaps.find((g) => g.factor_id === 'f1')).toBeUndefined();
  });

  it('malformed interventions (array, null, primitive) are silently ignored — no spurious lever keys', () => {
    // Defence-in-depth: route schema enforces a plain object in production,
    // but bad inputs shouldn't pollute the lever set with positional indices
    // (e.g. Object.keys([…]) yields "0","1",…) or string indices.
    const malformedOptions: OptionV3[] = [
      { id: 'opt1', label: 'A', winProbability: 0.5, expectedOutcome: 100, interventions: ['f1', 'f2'] as any },
      { id: 'opt2', label: 'B', winProbability: 0.5, expectedOutcome: 100, interventions: null as any },
      { id: 'opt3', label: 'C', winProbability: 0.5, expectedOutcome: 100, interventions: 'nope' as any },
      { id: 'opt4', label: 'D', winProbability: 0.5, expectedOutcome: 100, interventions: 42 as any },
    ];
    const inputs = normaliseCoachingInputs(graph, malformedOptions, islResult(), enriched());
    expect([...(inputs.interventionTargetIds ?? [])]).toEqual([]);
  });

  it('multiple options contribute to the lever set via union of intervention keys', () => {
    const optionsMulti: OptionV3[] = [
      { id: 'opt1', label: 'A', winProbability: 0.5, expectedOutcome: 100, interventions: { f1: 0.3 } as any },
      { id: 'opt2', label: 'B', winProbability: 0.5, expectedOutcome: 100, interventions: { f2: 0.5 } as any },
    ];
    const inputs = normaliseCoachingInputs(graph, optionsMulti, islResult(), enrichedLeverDominant());
    expect([...(inputs.interventionTargetIds ?? [])].sort()).toEqual(['f1', 'f2']);
  });

  it('non-lever factor with importance_rank BELOW levers remains eligible after composition fix', () => {
    // 4 factors total. f1,f2,f3 are levers ranked 1-3 in the enriched array.
    // f4 is the only non-lever, ranked 4th. Pre-composition-fix, the rank gate
    // `importance_rank <= k=3` would exclude f4 because levers occupy ranks 1-3.
    // Post-composition-fix, levers are removed first, the rank gate is computed
    // over the non-lever subset (size 1, k=1), and f4 surfaces.
    const enrichedLeverHeavy: FactorSensitivityResultV3[] = [
      { factor_id: 'f1', factor_label: 'Lever 1', influence_score: 1.0, confidence: 0.3, importance_rank: 1, confidence_source: 'plot_unified_from_isl_bootstrap', confidence_provenance: { computation_source: 'plot_unified_from_isl_bootstrap', formula_version: 'plot_unified_v2', provisional: false, input_quality: 'ok' } as any, source: 'graph' },
      { factor_id: 'f2', factor_label: 'Lever 2', influence_score: 0.8, confidence: 0.3, importance_rank: 2, confidence_source: 'plot_unified_from_isl_bootstrap', confidence_provenance: { computation_source: 'plot_unified_from_isl_bootstrap', formula_version: 'plot_unified_v2', provisional: false, input_quality: 'ok' } as any, source: 'graph' },
      { factor_id: 'f3', factor_label: 'Lever 3', influence_score: 0.6, confidence: 0.3, importance_rank: 3, confidence_source: 'plot_unified_from_isl_bootstrap', confidence_provenance: { computation_source: 'plot_unified_from_isl_bootstrap', formula_version: 'plot_unified_v2', provisional: false, input_quality: 'ok' } as any, source: 'graph' },
      { factor_id: 'f4', factor_label: 'Background uncertainty', influence_score: 0.2, confidence: 0.4, importance_rank: 4, confidence_source: 'plot_unified_from_isl_bootstrap', confidence_provenance: { computation_source: 'plot_unified_from_isl_bootstrap', formula_version: 'plot_unified_v2', provisional: false, input_quality: 'ok' } as any, source: 'graph' },
    ];
    const optionsAllLevers: OptionV3[] = [
      { id: 'opt1', label: 'A', winProbability: 0.6, expectedOutcome: 100, interventions: { f1: 0.3, f2: 0.4, f3: 0.5 } as any },
      { id: 'opt2', label: 'B', winProbability: 0.4, expectedOutcome: 90,  interventions: { f1: 0.7, f2: 0.6, f3: 0.4 } as any },
    ];
    const isl = {
      ...islResult(),
      factor_sensitivity: [
        { node_id: 'f1', importance_rank: 1, elasticity: 0, influence_score: 1.0, confidence: 0.1, direction: 'positive', zero_reason: 'intervention_override' },
        { node_id: 'f2', importance_rank: 2, elasticity: 0, influence_score: 0.8, confidence: 0.1, direction: 'positive', zero_reason: 'intervention_override' },
        { node_id: 'f3', importance_rank: 3, elasticity: 0, influence_score: 0.6, confidence: 0.1, direction: 'positive', zero_reason: 'intervention_override' },
        { node_id: 'f4', importance_rank: 4, elasticity: 0.05, influence_score: 0.2, confidence: 0.4, direction: 'positive' },
      ],
    };
    const inputs = normaliseCoachingInputs(graph, optionsAllLevers, isl, enrichedLeverHeavy);
    const gaps = computeEvidenceGaps(inputs);
    expect(gaps.map((g) => g.factor_id)).toContain('f4');
    expect(gaps.some((g) => ['f1', 'f2', 'f3'].includes(g.factor_id))).toBe(false);
  });

  it('two non-levers below levers in enriched ranking both surface after composition fix', () => {
    // Mirrors the dev-hiring bundle shape: 5 factors, 3 levers in mixed top
    // positions, 2 non-levers split across ranks. With composition fix, both
    // non-levers should appear in evidence_gaps subject to VOI/confidence.
    const enriched: FactorSensitivityResultV3[] = [
      { factor_id: 'lever_top',     influence_score: 1.0,  confidence: 0.25,  importance_rank: 1, confidence_source: 'plot_unified_from_isl_bootstrap', confidence_provenance: { computation_source: 'plot_unified_from_isl_bootstrap', formula_version: 'plot_unified_v2', provisional: false, input_quality: 'ok' } as any, source: 'graph' },
      { factor_id: 'bg_mid',        influence_score: 0.9,  confidence: 0.375, importance_rank: 2, confidence_source: 'plot_unified_from_isl_bootstrap', confidence_provenance: { computation_source: 'plot_unified_from_isl_bootstrap', formula_version: 'plot_unified_v2', provisional: false, input_quality: 'ok' } as any, source: 'graph' },
      { factor_id: 'lever_mid',     influence_score: 0.85, confidence: 0.25,  importance_rank: 3, confidence_source: 'plot_unified_from_isl_bootstrap', confidence_provenance: { computation_source: 'plot_unified_from_isl_bootstrap', formula_version: 'plot_unified_v2', provisional: false, input_quality: 'ok' } as any, source: 'graph' },
      { factor_id: 'lever_low',     influence_score: 0.4,  confidence: 0.25,  importance_rank: 4, confidence_source: 'plot_unified_from_isl_bootstrap', confidence_provenance: { computation_source: 'plot_unified_from_isl_bootstrap', formula_version: 'plot_unified_v2', provisional: false, input_quality: 'ok' } as any, source: 'graph' },
      { factor_id: 'bg_tail',       influence_score: 0.3,  confidence: 0.375, importance_rank: 5, confidence_source: 'plot_unified_from_isl_bootstrap', confidence_provenance: { computation_source: 'plot_unified_from_isl_bootstrap', formula_version: 'plot_unified_v2', provisional: false, input_quality: 'ok' } as any, source: 'graph' },
    ];
    const opts: OptionV3[] = [
      { id: 'opt1', label: 'A', winProbability: 0.6, expectedOutcome: 100, interventions: { lever_top: 0.2, lever_mid: 0.5, lever_low: 0.3 } as any },
      { id: 'opt2', label: 'B', winProbability: 0.4, expectedOutcome: 90,  interventions: { lever_top: 0.8, lever_mid: 0.4, lever_low: 0.6 } as any },
    ];
    const inputs = normaliseCoachingInputs(graph, opts, islResult(), enriched);
    const gaps = computeEvidenceGaps(inputs);
    expect(gaps.map((g) => g.factor_id).sort()).toEqual(['bg_mid', 'bg_tail']);
  });

  it('no backfill with levers when no non-lever passes VOI/confidence gates', () => {
    // Non-lever exists but has confidence >= 0.7 (fails confidence gate).
    // Levers must NOT silently take its place — evidence_gaps remains empty.
    const enriched: FactorSensitivityResultV3[] = [
      { factor_id: 'f1', influence_score: 1.0, confidence: 0.3, importance_rank: 1, confidence_source: 'plot_unified_from_isl_bootstrap', confidence_provenance: { computation_source: 'plot_unified_from_isl_bootstrap', formula_version: 'plot_unified_v2', provisional: false, input_quality: 'ok' } as any, source: 'graph' },
      { factor_id: 'f2_high_conf', influence_score: 0.5, confidence: 0.85, importance_rank: 2, confidence_source: 'plot_unified_from_isl_bootstrap', confidence_provenance: { computation_source: 'plot_unified_from_isl_bootstrap', formula_version: 'plot_unified_v2', provisional: false, input_quality: 'ok' } as any, source: 'graph' },
    ];
    const opts: OptionV3[] = [
      { id: 'opt1', label: 'A', winProbability: 0.6, expectedOutcome: 100, interventions: { f1: 0.3 } as any },
      { id: 'opt2', label: 'B', winProbability: 0.4, expectedOutcome: 90,  interventions: { f1: 0.7 } as any },
    ];
    const inputs = normaliseCoachingInputs(graph, opts, islResult(), enriched);
    const gaps = computeEvidenceGaps(inputs);
    expect(gaps).toEqual([]);
  });

  it('when computeEvidenceGaps is called directly with empty/undefined interventionTargetIds, no exclusion happens (legacy contract)', () => {
    const inputs: CoachingInputs = {
      graph,
      options: [
        { id: 'opt1', label: 'A', winProbability: 0.75, expectedOutcome: 120 } as any,
        { id: 'opt2', label: 'B', winProbability: 0.25, expectedOutcome: 80 } as any,
      ],
      factorSensitivity: [
        { node_id: 'f1', label: 'Cost', importance_rank: 1, elasticity: 0.9, influence_score: 0.9, confidence: 0.25, direction: 'positive' } as any,
      ],
      fragileEdges: [],
      robustness: {} as any,
      // interventionTargetIds omitted
    };
    const gaps = computeEvidenceGaps(inputs);
    expect(gaps.find((g) => g.factor_id === 'f1')).toBeDefined();
  });
});

describe('key_drivers internal provenance consistency — reviewer round-2 P1', () => {
  // Locks the contract: within a single `key_drivers[]` entry,
  //   `rank`, `influence_score`, and `normalised_impact` must all agree on the
  //   same impact signal. Pre-fix, sorting used `elasticity ?? influence_score`
  //   while `normalised_impact` (via `computeNormalisedImpact`) used the new
  //   `influence_score ?? elasticity` precedence, so the same entry could ship
  //   an elasticity-ordered rank alongside an influence-score-ordered impact
  //   display. Post-fix, all three derive from the same precedence.
  it('rank ordering follows influence_score precedence, not elasticity', () => {
    // f1 wins on influence_score (0.9 > 0.3); f2 would win on elasticity (0.8 > 0.05).
    const enrichedInvert: FactorSensitivityResultV3[] = [
      { factor_id: 'f1', factor_label: 'High graph influence', elasticity: 0.05, influence_score: 0.9, sensitivity_score: 0.9, direction: 'positive', importance_rank: 1, confidence: 0.4, confidence_source: 'plot_unified_from_isl_bootstrap', confidence_provenance: { computation_source: 'plot_unified_from_isl_bootstrap', formula_version: 'plot_unified_v2', provisional: false, input_quality: 'ok' } as any, source: 'graph' },
      { factor_id: 'f2', factor_label: 'High raw elasticity', elasticity: 0.8, influence_score: 0.3, sensitivity_score: 0.3, direction: 'positive', importance_rank: 2, confidence: 0.4, confidence_source: 'plot_unified_from_isl_bootstrap', confidence_provenance: { computation_source: 'plot_unified_from_isl_bootstrap', formula_version: 'plot_unified_v2', provisional: false, input_quality: 'ok' } as any, source: 'graph' },
    ];
    const coaching = generateM1Coaching(
      graph, options, islResult(),
      undefined, undefined, undefined, undefined,
      enrichedInvert,
    );
    const drivers = coaching!.key_drivers!;
    expect(drivers[0].factor_id).toBe('f1');     // rank 1 = highest influence_score
    expect(drivers[1].factor_id).toBe('f2');
  });

  it('within a single key_drivers entry, influence_score and normalised_impact agree on the same source', () => {
    // f1: elasticity=0.05, influence_score=0.9. Published influence_score must
    // reflect 0.9 (rounded), and normalised_impact must reflect (0.9 / 0.9) = 1.
    // Pre-fix the published influence_score was 0.05 (elasticity) while
    // normalised_impact was 1.0 (helper) — internal contradiction.
    const enrichedInvert: FactorSensitivityResultV3[] = [
      { factor_id: 'f1', factor_label: 'Cost', elasticity: 0.05, influence_score: 0.9, sensitivity_score: 0.9, direction: 'positive', importance_rank: 1, confidence: 0.4, confidence_source: 'plot_unified_from_isl_bootstrap', confidence_provenance: { computation_source: 'plot_unified_from_isl_bootstrap', formula_version: 'plot_unified_v2', provisional: false, input_quality: 'ok' } as any, source: 'graph' },
      { factor_id: 'f2', factor_label: 'Market Risk', elasticity: 0.8, influence_score: 0.3, sensitivity_score: 0.3, direction: 'negative', importance_rank: 2, confidence: 0.4, confidence_source: 'plot_unified_from_isl_bootstrap', confidence_provenance: { computation_source: 'plot_unified_from_isl_bootstrap', formula_version: 'plot_unified_v2', provisional: false, input_quality: 'ok' } as any, source: 'graph' },
    ];
    const coaching = generateM1Coaching(
      graph, options, islResult(),
      undefined, undefined, undefined, undefined,
      enrichedInvert,
    );
    const f1Driver = coaching!.key_drivers!.find((d) => d.factor_id === 'f1');
    expect(f1Driver).toBeDefined();
    expect(f1Driver!.influence_score).toBe(0.9);  // canonical, not elasticity=0.05
    expect(f1Driver!.normalised_impact).toBe(1);   // 0.9 / max(0.9, 0.3) = 1
    expect(f1Driver!.rank).toBe(1);                // highest of the two
    // Cross-check: a key_drivers entry whose influence_score is the max must
    // have normalised_impact === 1.0; the two cannot disagree.
    const maxInfluence = Math.max(...coaching!.key_drivers!.map((d) => d.influence_score));
    const maxByImpact = coaching!.key_drivers!.find((d) => d.normalised_impact === 1);
    expect(maxByImpact!.influence_score).toBe(maxInfluence);
  });
});
