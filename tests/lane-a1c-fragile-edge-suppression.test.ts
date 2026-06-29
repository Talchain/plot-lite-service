/**
 * Lane A1c — suppress lever-SOURCED fragile edges from the four PLoT
 * action-guidance surfaces (decision_brief.what_would_change, story_headlines
 * [high_uncertainty], m1_coaching.top_fragile_edge, m1_coaching.next_actions).
 *
 * SOURCE-only by design: a lever as edge TARGET is left untouched.
 * Per-surface filtering (NOT normaliseCoachingInputs — that is shared with
 * assumptions_ledger + readiness surfaces, which must remain unchanged).
 * Fallback: select the top NON-lever fragile edge; if none, each surface uses
 * its existing safe fallback (factor path / headline-type shift / undefined /
 * skip P3). Never blank with a lever, never invent.
 */
import { describe, it, expect } from 'vitest';
import {
  isLeverSourcedEdge,
  filterLeverSourcedFragileEdges,
  interventionOverrideFactorIds,
} from '../src/lib/intervention-override.js';
import { assembleBrief, type BriefAssemblyInput } from '../src/assembly/decision-brief.js';
import { generateHeadlines, detectHeadlineType, getFragileEdgeContext } from '../src/coaching/headlines.js';
import { generateNextActions } from '../src/coaching/next-actions.js';
import type { CoachingInputs, NormalisedFragileEdge, NormalisedFactorSensitivity } from '../src/coaching/types.js';

const LEVER = 'fac_dev_capacity';
const LEVER_LABEL = 'Additional Developer Capacity';
const NONLEVER = 'fac_time_pressure';
const NONLEVER_LABEL = 'Launch Deadline Pressure';

// ---------------------------------------------------------------------------
// Leaf predicate — source-only + source-id accessor (tightening 2)
// ---------------------------------------------------------------------------
describe('A1c leaf — isLeverSourcedEdge / filterLeverSourcedFragileEdges (source-only)', () => {
  const leverIds = new Set([LEVER]);
  it('matches a lever SOURCE id (the predicate fired on from-id), not a non-lever source', () => {
    expect(isLeverSourcedEdge(LEVER, leverIds)).toBe(true);    // source matched
    expect(isLeverSourcedEdge(NONLEVER, leverIds)).toBe(false);
    expect(isLeverSourcedEdge(undefined, leverIds)).toBe(false);
  });
  it('drops lever-SOURCED edges; KEEPS lever-as-TARGET and non-lever (source-only)', () => {
    const edges = [
      { id: 'lever-source', from: LEVER, to: 'out_x' },        // lever is SOURCE → drop
      { id: 'lever-target', from: 'fac_other', to: LEVER },    // lever is TARGET → keep
      { id: 'non-lever', from: 'fac_other', to: 'out_y' },     // keep
    ];
    const kept = filterLeverSourcedFragileEdges(edges, leverIds, (e) => e.from).map((e) => e.id);
    expect(kept).toEqual(['lever-target', 'non-lever']);       // source-lever dropped; target-lever kept
  });
  it('interventionOverrideFactorIds builds the set from zero_reason', () => {
    const ids = interventionOverrideFactorIds([
      { factor_id: LEVER, zero_reason: 'intervention_override' },
      { factor_id: NONLEVER, zero_reason: null },
    ]);
    expect([...ids]).toEqual([LEVER]);
  });
  it('empty lever set is a no-op', () => {
    const edges = [{ from: LEVER, to: 'x' }];
    expect(filterLeverSourcedFragileEdges(edges, new Set(), (e) => e.from)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Surface 1 — decision_brief.what_would_change
// ---------------------------------------------------------------------------
function rawEdge(from: string, fromLabel: string, to: string, toLabel: string, sp = 0.5) {
  return { edge_id: `${from}->${to}`, from_id: from, from_label: fromLabel, to_id: to, to_label: toLabel, switch_probability: sp, severity: 'high' };
}
function briefInput(fragile: any[], factors: any[]): BriefAssemblyInput {
  return {
    analysis_status: 'computed',
    critiques: [],
    option_comparison: [{ option_id: 'o1', label: 'A', win_probability: 0.6 }, { option_id: 'o2', label: 'B', win_probability: 0.4 }],
    robustness: { level: 'moderate', fragile_edges: fragile, robust_edges: [] } as any,
    factor_sensitivity: factors,
    meta: { seed_used: '1' },
  } as BriefAssemblyInput;
}
const LEVER_FACTORS = [
  { factor_id: LEVER, factor_label: LEVER_LABEL, elasticity: 0, zero_reason: 'intervention_override', direction: 'positive' },
  { factor_id: NONLEVER, factor_label: NONLEVER_LABEL, elasticity: 0.5, direction: 'negative' },
];

describe('A1c — decision_brief.what_would_change', () => {
  it('excludes lever-SOURCED fragile edge; keeps non-lever edge (RED pre-A1c: lever named)', () => {
    const brief = assembleBrief(briefInput(
      [rawEdge(LEVER, LEVER_LABEL, 'out_delivery', 'On-Time Delivery'), rawEdge(NONLEVER, NONLEVER_LABEL, 'risk_miss', 'Launch Miss')],
      LEVER_FACTORS,
    ))!;
    expect(brief.what_would_change.some((s) => s.includes(LEVER_LABEL))).toBe(false);   // lever-sourced edge gone
    expect(brief.what_would_change.some((s) => s.includes(NONLEVER_LABEL))).toBe(true); // non-lever edge kept
  });
  it('lever-as-TARGET edge is kept (source-only)', () => {
    const brief = assembleBrief(briefInput([rawEdge('fac_other', 'Other', LEVER, LEVER_LABEL)], LEVER_FACTORS))!;
    expect(brief.what_would_change.some((s) => s.includes(`→ ${LEVER_LABEL}`))).toBe(true);
  });
  it('FALLBACK PROOF: all fragile edges lever-sourced → factor-path fallback fires (names non-lever factor, not empty, not lever)', () => {
    const brief = assembleBrief(briefInput(
      [rawEdge(LEVER, LEVER_LABEL, 'out_delivery', 'On-Time Delivery')],  // only lever-sourced edge
      LEVER_FACTORS,
    ))!;
    // PRIMARY (fragile) path yields nothing → FACTOR fallback path used → non-lever factor label present.
    expect(brief.what_would_change).toContain(NONLEVER_LABEL);
    expect(brief.what_would_change.some((s) => s.includes(LEVER_LABEL))).toBe(false);
    expect(brief.what_would_change.every((s) => !s.includes('→'))).toBe(true); // factor labels, not edge "X → Y" strings
  });
});

// ---------------------------------------------------------------------------
// Surfaces 2-4 — coaching (headlines / top_fragile_edge / next_actions)
// ---------------------------------------------------------------------------
function nfe(from: string, fromLabel: string, to: string, toLabel: string, sp: number): NormalisedFragileEdge {
  return { edgeId: `${from}::${to}`, fromId: from, toId: to, fromLabel, toLabel, displayLabel: `${fromLabel} → ${toLabel}`, switchProb: sp, altWinnerId: 'o2', altWinnerLabel: 'B' };
}
function nf(id: string, label: string): NormalisedFactorSensitivity {
  return { node_id: id, label, elasticity: 0, importance_rank: 1, confidence: 0.9, direction: 'positive', influence_score: 0, zero_reason: undefined };
}
function ci(fragile: NormalisedFragileEdge[], over: Partial<CoachingInputs> = {}): CoachingInputs {
  return {
    graph: { nodes: [{ id: 'goal', kind: 'goal', label: 'Goal' }], edges: [] } as any,
    options: [{ id: 'o1', label: 'A', winProbability: 0.6, outcomeMean: 0.7, outcomeP10: undefined, outcomeP90: undefined },
              { id: 'o2', label: 'B', winProbability: 0.4, outcomeMean: 0.5, outcomeP10: undefined, outcomeP90: undefined }],
    factorSensitivity: [nf(NONLEVER, NONLEVER_LABEL)],
    fragileEdges: fragile,
    robustness: { level: 'moderate', recommendationStability: 0.8, isRobust: true },
    interventionTargetIds: new Set([LEVER]),
    ...over,
  } as CoachingInputs;
}

describe('A1c — story_headlines[high_uncertainty]', () => {
  it('names a NON-lever fragile edge, not the lever-sourced one (RED pre-A1c: lever named)', () => {
    // lever edge higher switchProb; non-lever also above high_uncertainty_fragile (0.25)
    const inputs = ci([nfe(LEVER, LEVER_LABEL, 'out_delivery', 'On-Time Delivery', 0.6), nfe(NONLEVER, NONLEVER_LABEL, 'risk_miss', 'Launch Miss', 0.5)]);
    const text = Object.values(generateHeadlines(inputs)).join(' || ');
    expect(text).not.toContain(LEVER_LABEL);
    expect(text).toContain(NONLEVER_LABEL);
    expect(detectHeadlineType(inputs)).toBe('high_uncertainty'); // classifier consistent (non-lever drives it)
  });
  it('FALLBACK PROOF: only lever-sourced fragile edges → headline TYPE shifts OFF high_uncertainty; no lever named', () => {
    const inputs = ci([nfe(LEVER, LEVER_LABEL, 'out_delivery', 'On-Time Delivery', 0.6)]); // sole edge, lever-sourced
    expect(detectHeadlineType(inputs)).not.toBe('high_uncertainty');                       // type shifted (no qualifying fragile edge)
    expect(Object.values(generateHeadlines(inputs)).join(' || ')).not.toContain(LEVER_LABEL);
  });
});

describe('A1c — top_fragile_edge (m1-coaching composition)', () => {
  // Mirrors src/coaching/m1-coaching.ts:103 exactly.
  const top = (fragile: NormalisedFragileEdge[]) => getFragileEdgeContext(filterLeverSourcedFragileEdges(fragile, new Set([LEVER]), (e) => e.fromId));
  it('excludes lever-sourced; surfaces top non-lever edge', () => {
    const t = top([nfe(LEVER, LEVER_LABEL, 'out_delivery', 'On-Time Delivery', 0.6), nfe(NONLEVER, NONLEVER_LABEL, 'risk_miss', 'Launch Miss', 0.5)]);
    expect(t?.label).toBe(`${NONLEVER_LABEL} → Launch Miss`);
  });
  it('FALLBACK PROOF: only lever-sourced fragile edges → undefined (no fake replacement)', () => {
    expect(top([nfe(LEVER, LEVER_LABEL, 'out_delivery', 'On-Time Delivery', 0.6)])).toBeUndefined();
  });
});

describe('A1c — next_actions (P3 fragile-edge action)', () => {
  const p3 = (fragile: NormalisedFragileEdge[]) =>
    generateNextActions(ci(fragile), 'high_uncertainty', [], []).find((a) => a.target_type === 'edge');
  it('P3 names a NON-lever fragile edge, not the lever-sourced one', () => {
    const a = p3([nfe(LEVER, LEVER_LABEL, 'out_delivery', 'On-Time Delivery', 0.6), nfe(NONLEVER, NONLEVER_LABEL, 'risk_miss', 'Launch Miss', 0.5)]);
    expect(a?.target_id).toBe(`${NONLEVER}::risk_miss`);
    expect(a?.action).not.toContain(LEVER_LABEL);
    expect(a?.action).toContain(NONLEVER_LABEL);
  });
  it('FALLBACK PROOF: only lever-sourced fragile edges → P3 fragile-edge action SKIPPED (no edge action, no lever named)', () => {
    const actions = generateNextActions(ci([nfe(LEVER, LEVER_LABEL, 'out_delivery', 'On-Time Delivery', 0.6)]), 'high_uncertainty', [], []);
    expect(actions.find((a) => a.target_type === 'edge')).toBeUndefined();
    expect(actions.every((a) => !a.action.includes(LEVER_LABEL))).toBe(true);
  });
});
