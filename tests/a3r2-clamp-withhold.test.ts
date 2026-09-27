/**
 * A3 ROUND 2 — A CLAMPED VALUE IS NEVER ANALYSED AS IF IT WERE THE STATED ONE
 * (normaliser level). Ruling: AIQ olumi-programme-docs#70 5855192170.
 *
 *   rule 1/2 — an intervention the normaliser would PIN to an end of [0,1]
 *     (`normalised` outside [0,1] before the clamp) is a typed
 *     `intervention_clamped {option_id, factor_id, stated, applied}`; the route
 *     withholds that option (tests/a3r2-clamp-withhold.route.test.ts).
 *   rule 3 — a LEVEL limit whose threshold would clamp is REFUSED
 *     (`threshold_clamped`), never scored.
 *   rule 5 — frameless and in range: today's ladder, disclosed as Olumi's.
 *
 * CORRECTED PREMISE (MG replay of Paul's 17d1cd3a, EXECUTED + hash-bound WIRE):
 * PLoT sends Paul's churn limit to ISL as 0.04 — CEE's '%' relabel read on the
 * '%' rung. That path is correct and must not move: it is not clamped, so
 * nothing here touches it (pinned below on the captured CEE→PLoT body).
 *
 * Every assertion binds by `constraint_id` / `option_id`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  normaliseGoalConstraints,
  normaliseOptionsForISL,
  collectScaleFrameByNodeId,
  collectInterventionClamps,
  THRESHOLD_CLAMPED,
  DELTA_FRAME_VALUE_ALTERED,
} from '../src/lib/intervention-normaliser.js';
import type { EngineNodeV3, GoalConstraint, OptionV3 } from '../src/types/engine-v3.js';

const FIXTURE_17D1 = resolve(__dirname, 'fixtures/paul-17d1cd3a-20260927/cee-to-plot.request.json');
const CHURN_LIMIT = 'agent-lane:monthly_churn:<=';

function body17d1(): any {
  return JSON.parse(readFileSync(FIXTURE_17D1, 'utf8'));
}

function normalise(
  constraints: GoalConstraint[],
  nodes: EngineNodeV3[],
  units: Record<string, string>,
  scaleFrames?: Map<string, number>,
) {
  return normaliseGoalConstraints(constraints, nodes, {
    unitsByConstraintId: new Map(Object.entries(units)),
    scaleFrameByNodeId: scaleFrames ?? collectScaleFrameByNodeId(nodes),
    normaliseWithoutScale: true,
  });
}

describe('rule 3 — a level limit whose threshold would clamp is refused (threshold_clamped), never scored', () => {
  const pctNode = [
    { id: 'churn_pct', kind: 'factor', label: 'Churn', observed_state: { value: 0.04, raw_value: 4, unit: '%', cap: 100 } },
  ] as unknown as EngineNodeV3[];

  it("RED→GREEN — a '%' limit of 150 on a '%' node framed 100 would pin to 1: refused threshold_clamped, not sent", () => {
    const c: GoalConstraint = { constraint_id: 'churn_pct_cap', node_id: 'churn_pct', operator: '<=', value: 150, value_frame: 'level' };
    const res = normalise([c], pctNode, { churn_pct_cap: '%' });
    expect(res.constraints.find((x) => x.constraint_id === 'churn_pct_cap')).toBeUndefined();
    expect(res.refused).toHaveLength(1);
    expect(res.refused[0]).toMatchObject({
      constraint_id: 'churn_pct_cap',
      node_id: 'churn_pct',
      reason: THRESHOLD_CLAMPED,
      stated_value: 150,
      would_have_sent: 1,
    });
    // The repair is the evidence: removed, with the reason named.
    const repair = res.repairs.find((r) => r.field === 'constraint.value.churn_pct_cap');
    expect(repair).toMatchObject({ action: 'removed', from_value: 150, to_value: 'refused' });
    expect(String(repair?.reason)).toContain('threshold_clamped');
    // No scored diagnostic survives for it.
    expect(res.diagnostics.find((d) => d.constraint_id === 'churn_pct_cap')).toBeUndefined();
  });

  it('CONTRAST — the same limit at 50 is inside the frame: 0.5, scored', () => {
    const c: GoalConstraint = { constraint_id: 'churn_pct_cap', node_id: 'churn_pct', operator: '<=', value: 50, value_frame: 'level' };
    const res = normalise([c], pctNode, { churn_pct_cap: '%' });
    expect(res.refused).toEqual([]);
    expect(res.constraints.find((x) => x.constraint_id === 'churn_pct_cap')?.value).toBe(0.5);
  });

  it('a unitless level limit below the floor of an explicit range clamps low: refused threshold_clamped', () => {
    const nodes = [
      { id: 'nps', kind: 'factor', label: 'NPS', observed_state: { value: 0.4 }, state_space: { range: { min: 10, max: 90 } } },
    ] as unknown as EngineNodeV3[];
    const c: GoalConstraint = { constraint_id: 'nps_floor', node_id: 'nps', operator: '>=', value: 5, value_frame: 'level' };
    const res = normalise([c], nodes, {});
    expect(res.refused.map((r) => [r.constraint_id, r.reason, r.would_have_sent])).toEqual([['nps_floor', THRESHOLD_CLAMPED, 0]]);
  });

  it('only the clamped limit leaves: a sibling limit in range is still scored', () => {
    const c1: GoalConstraint = { constraint_id: 'churn_pct_cap', node_id: 'churn_pct', operator: '<=', value: 150, value_frame: 'level' };
    const c2: GoalConstraint = { constraint_id: 'churn_pct_floor', node_id: 'churn_pct', operator: '>=', value: 1, value_frame: 'level' };
    const res = normalise([c1, c2], pctNode, { churn_pct_cap: '%', churn_pct_floor: '%' });
    expect(res.refused.map((r) => r.constraint_id)).toEqual(['churn_pct_cap']);
    expect(res.constraints.map((c) => [c.constraint_id, c.value])).toEqual([['churn_pct_floor', 0.01]]);
  });

  it("SCOPE — a clamped DELTA keeps 2.878's refusal reason (the more specific one)", () => {
    const c: GoalConstraint = { constraint_id: 'churn_cut', node_id: 'churn_pct', operator: '<=', value: -150, value_frame: 'delta' };
    const res = normalise([c], pctNode, {});
    expect(res.refused.map((r) => [r.constraint_id, r.reason])).toEqual([['churn_cut', DELTA_FRAME_VALUE_ALTERED]]);
  });

  it("SCOPE — the auto-synthesised goal constraint is NOT refused when it clamps (refusing it would withdraw the user's target, 2.1023)", () => {
    const nodes = [
      { id: 'mrr', kind: 'goal', label: 'MRR', observed_state: { value: 0.6, cap: 125000 } },
    ] as unknown as EngineNodeV3[];
    const auto = {
      constraint_id: 'auto_goal', node_id: 'mrr', operator: '>=', value: 200000, value_frame: 'level',
      _internal: { source: 'auto_from_goal_threshold' },
    } as unknown as GoalConstraint;
    const res = normalise([auto], nodes, {});
    expect(res.refused).toEqual([]);
    const d = res.diagnostics.find((x) => x.constraint_id === 'auto_goal');
    // Today's disclosed path is kept for the target: clamped, and flagged so.
    expect(d?.clamped).toBe(true);
  });
});

describe("the CORRECTED PREMISE — Paul's 17d1 churn limit ('%' relabel on a '% per month' node) keeps 0.04", () => {
  it('PRECONDITION — the fixture is the captured CEE→PLoT body: raw 4, unit %, relabelled from "% per month"; no option sets churn', () => {
    const body = body17d1();
    const limit = body.goal_constraints.find((c: any) => c.constraint_id === CHURN_LIMIT);
    expect(limit).toMatchObject({ node_id: 'monthly_churn', value: 4, unit: '%', value_frame: 'level' });
    expect(limit.provenance_unit_relabelled).toMatchObject({ rule: 'agent_lane_limit_unit_v1', pre_normalisation_unit: '% per month' });
    const churn = body.graph.nodes.find((n: any) => n.id === 'monthly_churn');
    expect(churn.observed_state).toMatchObject({ value: 0.03, raw_value: 3, unit: '% per month' });
    expect(churn.scale_frame).toBe(100);
    for (const o of body.options) expect(Object.keys(o.interventions)).not.toContain('monthly_churn');
  });

  it("the '%' limit on the '% per month' node, framed 100, reads 0.04 on [0,100] — not clamped, not refused", () => {
    const body = body17d1();
    const raw = body.goal_constraints.find((c: any) => c.constraint_id === CHURN_LIMIT);
    const c: GoalConstraint = {
      constraint_id: raw.constraint_id, node_id: raw.node_id, operator: raw.operator, value: raw.value,
      value_frame: raw.value_frame, label: raw.label,
    };
    const nodes = body.graph.nodes as EngineNodeV3[];
    const res = normalise([c], nodes, { [CHURN_LIMIT]: raw.unit }, collectScaleFrameByNodeId(body.graph.nodes));
    expect(res.refused).toEqual([]);
    expect(res.constraints.find((x) => x.constraint_id === CHURN_LIMIT)?.value).toBe(0.04);
    const d = res.diagnostics.find((x) => x.constraint_id === CHURN_LIMIT);
    expect(d?.clamped).toBe(false);
    expect(d?.range).toEqual({ min: 0, max: 100, source: 'unit_percent' });
  });
});

describe('rule 2 — a clamped intervention becomes a typed intervention_clamped record', () => {
  const GOAL = { id: 'goal', kind: 'goal', label: 'Goal', observed_state: { value: 0.5, cap: 100 } } as unknown as EngineNodeV3;
  const HIRES = { id: 'hires', kind: 'factor', label: 'Hires', observed_state: { value: 3 } } as unknown as EngineNodeV3;
  const PRICE = { id: 'price', kind: 'factor', label: 'Price', observed_state: { value: 0.245, raw_value: 49, cap: 200 } } as unknown as EngineNodeV3;
  const opt = (id: string, iv: Record<string, number>): OptionV3 => ({
    id,
    label: id,
    interventions: Object.fromEntries(Object.entries(iv).map(([k, v]) => [k, { value: v, source: 'user_specified' as const }])),
  });

  it('RED→GREEN — an unframed factor at 3 with one option at 10: {option_id hire10, factor_id hires, stated 10, applied 6}', () => {
    const norm = normaliseOptionsForISL(
      [opt('keep', { price: 49 }), opt('raise', { price: 59 }), opt('hire10', { hires: 10 })],
      [GOAL, HIRES, PRICE],
      'goal',
    );
    expect(collectInterventionClamps(norm.diagnostics)).toEqual([
      { option_id: 'hire10', reason: 'intervention_clamped', factor_id: 'hires', stated: 10, applied: 6 },
    ]);
    // The repair stays as the evidence, naming the option.
    expect(norm.repairs.filter((r) => r.action === 'clamped').map((r) => [r.option_id, r.field, r.from_value])).toEqual([
      ['hire10', 'intervention.value.hires', 10],
    ]);
  });

  it('CONTRAST — the same at 5 (≤ 6) clamps nothing, and the range is disclosed as Olumi\'s (inferred_value)', () => {
    const norm = normaliseOptionsForISL(
      [opt('keep', { price: 49 }), opt('raise', { price: 59 }), opt('hire5', { hires: 5 })],
      [GOAL, HIRES, PRICE],
      'goal',
    );
    expect(collectInterventionClamps(norm.diagnostics)).toEqual([]);
    expect(norm.context.factors.get('hires')?.range).toEqual({ min: 0, max: 6, source: 'inferred_value' });
  });

  it('a clamp at the FLOOR is typed too (applied = the range minimum, in the stated units)', () => {
    const norm = normaliseOptionsForISL(
      [opt('keep', { price: 49 }), opt('cut', { hires: -2 })],
      [GOAL, HIRES, PRICE],
      'goal',
    );
    expect(collectInterventionClamps(norm.diagnostics)).toEqual([
      { option_id: 'cut', reason: 'intervention_clamped', factor_id: 'hires', stated: -2, applied: 0 },
    ]);
  });
});
