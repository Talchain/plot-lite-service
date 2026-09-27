/**
 * A3 ROUND 2 — A LIMIT IS PLACED ON ITS NODE'S OWN FRAME, OR REFUSED; A CLAMPED
 * VALUE IS NEVER ANALYSED AS THE STATED ONE (normaliser level).
 *
 * WHY (Paul-hit, DL olumi-programme-docs#70 5855470798): Paul's first export
 * `17d1cd3a` (CEE 263dbd5) carried the churn limit `{unit '%', value 4,
 * provenance_unit_relabelled: {pre '% per month'}}` on `monthly_churn {unit
 * '% per month', value 0.03, raw_value 3}` framed 100, and NO option set churn.
 * The served result: `constraint_probabilities` 1, `constraints_decision_grade`
 * true, `probability_of_joint_goal` 1 — "your churn limit is met, with
 * certainty". The rules (AIQ 5855192170, one rule for interventions AND limits):
 *   1. a level limit on a framed node is read on that frame, intervened or not;
 *      unframed and outside [0,1] on a normalised node ⇒ `threshold_unframed`;
 *   2. a clamped intervention ⇒ the option is withheld (`intervention_clamped`);
 *   3. a clamped threshold ⇒ `threshold_clamped`, never scored.
 * A limit whose unit differs from its node's keeps a fail-closed refusal.
 *
 * The 17d1 nodes are READ from `tests/fixtures/paul-17d1cd3a-20260927/` (the
 * export's `payloads.cee_response.draft_graph`, verbatim) — not authored here.
 * Every assertion binds by `constraint_id` / `option_id`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  normaliseGoalConstraints,
  collectScaleFrameByNodeId,
  collectInterventionClamps,
  resolvePercentTargetFrame,
  normaliseOptionsForISL,
  THRESHOLD_UNFRAMED,
  THRESHOLD_CLAMPED,
  PERCENT_UNIT_DISAGREES_WITH_TARGET_FRAME,
  type NormalisationRange,
} from '../src/lib/intervention-normaliser.js';
import type { EngineNodeV3, GoalConstraint, OptionV3 } from '../src/types/engine-v3.js';

const FIXTURE = resolve(__dirname, 'fixtures/paul-17d1cd3a-20260927/draft-graph.json');
const CHURN_LIMIT = 'agent-lane:monthly_churn:<=';

function fixture(): any {
  return JSON.parse(readFileSync(FIXTURE, 'utf8'));
}

function nodes17d1(): EngineNodeV3[] {
  return fixture().draft_graph.nodes as EngineNodeV3[];
}

/** The served limit, verbatim (unit '%', relabelled). */
function servedLimit(): any {
  return structuredClone(fixture().draft_graph.goal_constraints[0]);
}

function asConstraint(raw: any): GoalConstraint {
  return {
    constraint_id: raw.constraint_id,
    node_id: raw.node_id,
    operator: raw.operator,
    value: raw.value,
    value_frame: raw.value_frame,
    label: raw.label,
  };
}

/** Run the normaliser exactly as the route calls it for a gate-open batch. */
function normalise(
  constraints: GoalConstraint[],
  nodes: EngineNodeV3[],
  units: Record<string, string>,
  extra: { interventionScaleByNodeId?: Map<string, NormalisationRange>; scaleFrames?: Map<string, number> } = {},
) {
  return normaliseGoalConstraints(constraints, nodes, {
    unitsByConstraintId: new Map(Object.entries(units)),
    scaleFrameByNodeId: extra.scaleFrames ?? collectScaleFrameByNodeId(nodes),
    interventionScaleByNodeId: extra.interventionScaleByNodeId,
    normaliseWithoutScale: true,
  });
}

describe("A3 round 2 — the 17d1 SHAPE: Paul's churn limit on a framed node no option sets", () => {
  it('PRECONDITION — the fixture is the served shape (framed pair, scale_frame 100, relabelled "%" limit, no churn option)', () => {
    const fx = fixture();
    const churn = fx.draft_graph.nodes.find((n: any) => n.id === 'monthly_churn');
    expect(churn.observed_state).toMatchObject({ value: 0.03, raw_value: 3, unit: '% per month' });
    expect(churn.scale_frame).toBe(100);
    expect(churn.observed_state.cap).toBeUndefined();
    const limit = servedLimit();
    expect(limit).toMatchObject({ constraint_id: CHURN_LIMIT, node_id: 'monthly_churn', value: 4, unit: '%', value_frame: 'level' });
    expect(limit.provenance_unit_relabelled).toMatchObject({ rule: 'agent_lane_limit_unit_v1', pre_normalisation_unit: '% per month' });
    for (const o of fx.cee_options) expect(Object.keys(o.interventions)).not.toContain('monthly_churn');
    // The served (wrong) pass, from the same export.
    for (const o of fx.served_isl_option_comparison) {
      expect(o.constraint_probabilities[CHURN_LIMIT]).toBe(1);
      expect(o.probability_of_joint_goal).toBe(1);
    }
  });

  it("RED→GREEN — the limit in the node's own unit ('% per month' on both) is read on the node's frame: 4 → 0.04, not the clamped 1", () => {
    const res = normalise([asConstraint(servedLimit())], nodes17d1(), { [CHURN_LIMIT]: '% per month' });
    expect(res.refused).toEqual([]);
    const sent = res.constraints.find((c) => c.constraint_id === CHURN_LIMIT);
    expect(sent?.value).toBe(0.04);
    const diag = res.diagnostics.find((d) => d.constraint_id === CHURN_LIMIT)!;
    expect(diag.range).toEqual({ min: 0, max: 100, source: 'scale_frame' });
    expect(diag.clamped).toBe(false);
    // Same spelling on both sides: the unit check reconciles byte-for-byte.
    expect(diag.unit_mismatch).toBeUndefined();
  });

  it('the PAIR alone carries the frame when the raw scale_frame is absent (3 / 0.03 → 100): 0.04, source pair_frame', () => {
    const res = normalise([asConstraint(servedLimit())], nodes17d1(), { [CHURN_LIMIT]: '% per month' }, { scaleFrames: new Map() });
    expect(res.constraints.find((c) => c.constraint_id === CHURN_LIMIT)?.value).toBe(0.04);
    expect(res.diagnostics.find((d) => d.constraint_id === CHURN_LIMIT)?.range.source).toBe('pair_frame');
  });

  it("RED→GREEN — the SERVED relabel ('%' limit on a '% per month' node) is REFUSED by name, never scored", () => {
    const res = normalise([asConstraint(servedLimit())], nodes17d1(), { [CHURN_LIMIT]: '%' });
    expect(res.constraints.find((c) => c.constraint_id === CHURN_LIMIT)).toBeUndefined();
    expect(res.refused).toHaveLength(1);
    expect(res.refused[0]).toMatchObject({ constraint_id: CHURN_LIMIT, node_id: 'monthly_churn', reason: PERCENT_UNIT_DISAGREES_WITH_TARGET_FRAME });
    const churn = nodes17d1().find((n) => n.id === 'monthly_churn');
    expect(resolvePercentTargetFrame(churn, 100)).toEqual({ verdict: 'refused', frame: 100, frame_unit: '% per month' });
  });

  it("the same refusal WITHOUT a frame: '%' on an unframed '% per month' level is a different unit too", () => {
    const n = { id: 'c', kind: 'factor', label: 'C', observed_state: { value: 0.03, unit: '% per month' } } as unknown as EngineNodeV3;
    expect(resolvePercentTargetFrame(n, undefined)).toEqual({ verdict: 'refused', frame: undefined, frame_unit: '% per month' });
  });

  it("CONTROL — a '%' limit on a '%' node framed 100, and on an undeclared-unit node, keeps the legacy [0,100] reading", () => {
    const pct = { id: 'c', kind: 'factor', label: 'C', observed_state: { value: 0.03, raw_value: 3, unit: '%' } } as unknown as EngineNodeV3;
    expect(resolvePercentTargetFrame(pct, 100)).toEqual({ verdict: 'legacy' });
    const bare = { id: 'c', kind: 'factor', label: 'C', observed_state: { value: 0.03, raw_value: 3 } } as unknown as EngineNodeV3;
    expect(resolvePercentTargetFrame(bare, 100)).toEqual({ verdict: 'legacy' });
  });
});

describe('A3 round 2 — rule 1: an unframed raw threshold on a normalised node is refused (threshold_unframed)', () => {
  const NPS_LIMIT: GoalConstraint = { constraint_id: 'nps_floor', node_id: 'nps', operator: '>=', value: 60, value_frame: 'level' };

  it('RED→GREEN — 60 on {value 0.4} with no cap, no scale_frame and no pair: refused threshold_unframed, not scaled on [0, 0.8]', () => {
    const nodes = [{ id: 'nps', kind: 'factor', label: 'NPS', observed_state: { value: 0.4 } }] as unknown as EngineNodeV3[];
    const res = normalise([NPS_LIMIT], nodes, {});
    expect(res.constraints.find((c) => c.constraint_id === 'nps_floor')).toBeUndefined();
    expect(res.refused).toHaveLength(1);
    expect(res.refused[0]).toMatchObject({ constraint_id: 'nps_floor', reason: THRESHOLD_UNFRAMED, stated_value: 60 });
    expect(res.refused[0].range.source).toBe('inferred_value');
  });

  it('CONTRAST — the same node framed (scale_frame 100): 60 → 0.6, scored', () => {
    const nodes = [{ id: 'nps', kind: 'factor', label: 'NPS', observed_state: { value: 0.4 } }] as unknown as EngineNodeV3[];
    const res = normalise([NPS_LIMIT], nodes, {}, { scaleFrames: new Map([['nps', 100]]) });
    expect(res.refused).toEqual([]);
    expect(res.constraints.find((c) => c.constraint_id === 'nps_floor')?.value).toBe(0.6);
  });

  it('CONTRAST — an unframed node whose level is NOT normalised (raw 3) keeps the disclosed inferred ladder (rule 4)', () => {
    const nodes = [{ id: 'hires', kind: 'factor', label: 'Hires', observed_state: { value: 3 } }] as unknown as EngineNodeV3[];
    const c: GoalConstraint = { constraint_id: 'hires_cap', node_id: 'hires', operator: '<=', value: 4, value_frame: 'level' };
    const res = normalise([c], nodes, {});
    expect(res.refused).toEqual([]);
    const diag = res.diagnostics.find((d) => d.constraint_id === 'hires_cap')!;
    expect(diag.range).toEqual({ min: 0, max: 6, source: 'inferred_value' });
    expect(diag.clamped).toBe(false);
  });

  it('SCOPE — a DELTA keeps 2.878\'s refusal reason (the more specific one)', () => {
    const nodes = [{ id: 'nps', kind: 'factor', label: 'NPS', observed_state: { value: 0.4 } }] as unknown as EngineNodeV3[];
    const res = normalise([{ ...NPS_LIMIT, value_frame: 'delta' }], nodes, {});
    expect(res.refused).toHaveLength(1);
    expect(res.refused[0].reason).toBe('delta_frame_value_altered_by_normalisation');
  });
});

describe('A3 round 2 — rule 3: a threshold that would clamp is refused (threshold_clamped), never scored', () => {
  const pctNode = [{ id: 'churn_pct', kind: 'factor', label: 'Churn', observed_state: { value: 0.04, raw_value: 4, unit: '%', cap: 100 } }] as unknown as EngineNodeV3[];

  it("RED→GREEN — a '%' limit of 150 on a '%' node framed 100 would pin to 1: refused threshold_clamped", () => {
    const c: GoalConstraint = { constraint_id: 'churn_pct_cap', node_id: 'churn_pct', operator: '<=', value: 150, value_frame: 'level' };
    const res = normalise([c], pctNode, { churn_pct_cap: '%' });
    expect(res.constraints.find((x) => x.constraint_id === 'churn_pct_cap')).toBeUndefined();
    expect(res.refused).toHaveLength(1);
    expect(res.refused[0]).toMatchObject({ constraint_id: 'churn_pct_cap', reason: THRESHOLD_CLAMPED, stated_value: 150, would_have_sent: 1 });
  });

  it("CONTRAST — the same limit at 50 is inside the frame: 0.5, scored", () => {
    const c: GoalConstraint = { constraint_id: 'churn_pct_cap', node_id: 'churn_pct', operator: '<=', value: 50, value_frame: 'level' };
    const res = normalise([c], pctNode, { churn_pct_cap: '%' });
    expect(res.refused).toEqual([]);
    expect(res.constraints.find((x) => x.constraint_id === 'churn_pct_cap')?.value).toBe(0.5);
  });

  it("the frame rung clamps too: '% per month' 150 on Paul's churn (frame 100) is refused threshold_clamped", () => {
    const limit = { ...asConstraint(servedLimit()), value: 150 };
    const res = normalise([limit], nodes17d1(), { [CHURN_LIMIT]: '% per month' });
    expect(res.refused).toHaveLength(1);
    expect(res.refused[0]).toMatchObject({ constraint_id: CHURN_LIMIT, reason: THRESHOLD_CLAMPED });
  });
});

describe('A3 round 2 — rule 1 on an intervened node whose option levels arrived inside [0,1] (identity scale)', () => {
  it("RED→GREEN — a raw price limit of 60 on a framed price node reads on the frame (0.6), not the identity [0,1] (clamped 1)", () => {
    // CEE's documented seam (level-limit-baseline.ts `limitTargetCaps`, served
    // `w1983-price-10fbbdf`): levels sent normalised (0.49 / 0.59), limit raw 60.
    const nodes = [{ id: 'price', kind: 'factor', label: 'Price', observed_state: { value: 0.49, raw_value: 49 } }] as unknown as EngineNodeV3[];
    const c: GoalConstraint = { constraint_id: 'price_cap', node_id: 'price', operator: '<=', value: 60, value_frame: 'level' };
    const identity: NormalisationRange = { min: 0, max: 1, source: 'default' };
    const res = normalise([c], nodes, {}, {
      interventionScaleByNodeId: new Map([['price', identity]]),
      scaleFrames: new Map([['price', 100]]),
    });
    expect(res.refused).toEqual([]);
    expect(res.constraints.find((x) => x.constraint_id === 'price_cap')?.value).toBe(0.6);
    expect(res.diagnostics.find((d) => d.constraint_id === 'price_cap')?.range.source).toBe('scale_frame');
  });

  it('CONTROL — a threshold INSIDE [0,1] on that node keeps the identity scale (same as-stated scale as its option levels)', () => {
    const nodes = [{ id: 'price', kind: 'factor', label: 'Price', observed_state: { value: 0.49, raw_value: 49 } }] as unknown as EngineNodeV3[];
    const c: GoalConstraint = { constraint_id: 'price_cap', node_id: 'price', operator: '<=', value: 0.6, value_frame: 'level' };
    const identity: NormalisationRange = { min: 0, max: 1, source: 'default' };
    const res = normalise([c], nodes, {}, {
      interventionScaleByNodeId: new Map([['price', identity]]),
      scaleFrames: new Map([['price', 100]]),
    });
    expect(res.constraints.find((x) => x.constraint_id === 'price_cap')?.value).toBe(0.6);
    expect(res.diagnostics.find((d) => d.constraint_id === 'price_cap')?.range).toEqual(identity);
  });
});

describe('A3 round 2 — rule 2: a clamped intervention becomes a typed intervention_clamped record', () => {
  const GOAL = { id: 'goal', kind: 'goal', label: 'Goal', observed_state: { value: 0.5, cap: 100 } } as unknown as EngineNodeV3;
  const HIRES = { id: 'hires', kind: 'factor', label: 'Hires', observed_state: { value: 3 } } as unknown as EngineNodeV3;
  const PRICE = { id: 'price', kind: 'factor', label: 'Price', observed_state: { value: 0.245, raw_value: 49, cap: 200 } } as unknown as EngineNodeV3;
  const opt = (id: string, iv: Record<string, number>): OptionV3 => ({
    id,
    label: id,
    interventions: Object.fromEntries(Object.entries(iv).map(([k, v]) => [k, { value: v, source: 'user_specified' as const }])),
  });

  it('RED→GREEN — an unframed factor at 3 with one option at 10: {option_id, factor_id, stated 10, applied 6}', () => {
    const norm = normaliseOptionsForISL([opt('keep', { price: 49 }), opt('raise', { price: 59 }), opt('hire10', { hires: 10 })], [GOAL, HIRES, PRICE], 'goal');
    const records = collectInterventionClamps(norm.diagnostics);
    expect(records).toEqual([{ option_id: 'hire10', reason: 'intervention_clamped', factor_id: 'hires', stated: 10, applied: 6 }]);
    // The repair stays as the evidence.
    expect(norm.repairs.filter((r) => r.action === 'clamped')).toHaveLength(1);
  });

  it('CONTRAST — the same at 5 (≤ 6) clamps nothing', () => {
    const norm = normaliseOptionsForISL([opt('keep', { price: 49 }), opt('raise', { price: 59 }), opt('hire5', { hires: 5 })], [GOAL, HIRES, PRICE], 'goal');
    expect(collectInterventionClamps(norm.diagnostics)).toEqual([]);
  });
});
