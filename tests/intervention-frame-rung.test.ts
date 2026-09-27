/**
 * A3 "one unit and frame" — AN INTERVENTION IS SCALED ON ITS NODE'S OWN FRAME.
 *
 * THE DEFECT (WIRE, MG capture `paul-own-a295e4a1`, 27 Sep; AIQ trace
 * olumi-programme-docs#70 5855100592; MG claim 5855108689). CEE's egress sends
 * option interventions in RAW user scale (churn 2.5, new subscribers 90). The
 * churn and new-subscriber factors are CEE's "capless framed pair" —
 * `{value: 0.03, raw_value: 3}` / `{value: 0.075, raw_value: 75}`, with
 * `scale_frame` 100 / 1000 on the raw node — and carry NO `cap`. `deriveRange`
 * never read the frame, so they fell to `inferred_baseline` / `inferred_value`
 * = [0, 2 × the NORMALISED value] = [0, 0.06] / [0, 0.15], and 2.5 / 90
 * clamped to 1.0. "Cut churn to 2.5%" ran as churn = 100%. Nothing said so.
 *
 * THE FIX. `deriveRange` reads the node's frame — the SAME ladder the '%'
 * limit rung reads (`observed_state.cap` → the raw node's `scale_frame` → the
 * `{value, raw_value}` pair), through ONE helper (`resolveNodeFrame`) — for an
 * INTERVENED factor, before the inferred rungs. Any intervention that still
 * clamps emits a typed `action: 'clamped'` repair.
 *
 * The fixture `tests/fixtures/paul-own-a295e4a1-20260927/cee-to-plot.request.json`
 * is MG's capture of the CEE→PLoT `/v2/run` body, byte-for-byte (sha256
 * 8bc6f257…): CEE's REAL run loader + run_analysis handler driven over Paul's
 * persisted graph a295e4a1, with a fake PLoT client capturing the payload. It is
 * NOT authored here.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  deriveRange,
  buildNormalisationContext,
  normaliseOptionsForISL,
  collectScaleFrameByNodeId,
  resolveNodeFrame,
  resolvePercentTargetFrame,
} from '../src/lib/intervention-normaliser.js';
import type { EngineNodeV3, OptionV3 } from '../src/types/engine-v3.js';

const FIXTURE = resolve(__dirname, 'fixtures/paul-own-a295e4a1-20260927/cee-to-plot.request.json');

function paulRequest(): any {
  return JSON.parse(readFileSync(FIXTURE, 'utf8'));
}

/** The request's options in the OptionV3 shape the route hands the normaliser. */
function optionsOf(req: any): OptionV3[] {
  return req.options.map((o: any) => ({
    id: o.id,
    label: o.label,
    interventions: Object.fromEntries(
      Object.entries(o.interventions as Record<string, number>).map(([k, v]) => [k, { value: v, source: 'user_specified' as const }]),
    ),
  }));
}

/** Graph nodes as the normaliser sees them (canonical factor/goal nodes; the raw node's `scale_frame` travels separately). */
function nodesOf(req: any): EngineNodeV3[] {
  return req.graph.nodes as EngineNodeV3[];
}

function normalisedLevel(result: ReturnType<typeof normaliseOptionsForISL>, optionId: string, factorId: string): number {
  const opt = result.options.find((o) => o.id === optionId);
  expect(opt, `option ${optionId} must be normalised`).toBeDefined();
  const iv = opt!.interventions[factorId];
  expect(iv, `option ${optionId} must intervene on ${factorId}`).toBeDefined();
  return iv.value;
}

function diagnosticOf(result: ReturnType<typeof normaliseOptionsForISL>, optionId: string, factorId: string) {
  const d = result.diagnostics.find((x) => x.option_id === optionId && x.factor_id === factorId);
  expect(d, `diagnostic for ${optionId}/${factorId}`).toBeDefined();
  return d!;
}

const RETENTION = 'ca47b368';
const CONVERSION = '6dbac00d';
const CHURN = 'monthly_churn';
const NEW_SUBS = 'monthly_new_pro_subscribers';

function run(req: any) {
  return normaliseOptionsForISL(
    optionsOf(req),
    nodesOf(req),
    req.goal_node_id,
    undefined,
    collectScaleFrameByNodeId(req.graph.nodes),
  );
}

describe("A3 — Paul's own graph (a295e4a1): framed interventions reach ISL on the node's frame", () => {
  it('PRECONDITION — the capture is the capless framed pair, raw-scale interventions', () => {
    const req = paulRequest();
    const churn = req.graph.nodes.find((n: any) => n.id === CHURN);
    const subs = req.graph.nodes.find((n: any) => n.id === NEW_SUBS);
    expect(churn.observed_state).toMatchObject({ value: 0.03, raw_value: 3 });
    expect(churn.observed_state.cap).toBeUndefined();
    expect(churn.scale_frame).toBe(100);
    expect(subs.observed_state).toMatchObject({ value: 0.075, raw_value: 75 });
    expect(subs.observed_state.cap).toBeUndefined();
    expect(subs.scale_frame).toBe(1000);
    expect(req.options.find((o: any) => o.id === RETENTION).interventions).toEqual({ [CHURN]: 2.5 });
    expect(req.options.find((o: any) => o.id === CONVERSION).interventions).toEqual({ [NEW_SUBS]: 90 });
  });

  it("RED→GREEN — retention: churn 2.5 (%) normalises to 0.025, not the 1.0 rail", () => {
    const result = run(paulRequest());
    expect(normalisedLevel(result, RETENTION, CHURN)).toBe(0.025);
    const d = diagnosticOf(result, RETENTION, CHURN);
    expect(d.clamped).toBe(false);
    expect(d.range).toEqual({ min: 0, max: 100, source: 'scale_frame' });
  });

  it('RED→GREEN — conversion: new subscribers 90 normalises to 0.09, not the 1.0 rail', () => {
    const result = run(paulRequest());
    expect(normalisedLevel(result, CONVERSION, NEW_SUBS)).toBe(0.09);
    const d = diagnosticOf(result, CONVERSION, NEW_SUBS);
    expect(d.clamped).toBe(false);
    expect(d.range).toEqual({ min: 0, max: 1000, source: 'scale_frame' });
  });

  it("RED→GREEN — with NO stored scale_frame the PAIR alone carries the frame (3/0.03 → 100, 75/0.075 → 1000)", () => {
    const req = paulRequest();
    for (const n of req.graph.nodes) delete n.scale_frame;
    const result = run(req);
    expect(normalisedLevel(result, RETENTION, CHURN)).toBe(0.025);
    expect(normalisedLevel(result, CONVERSION, NEW_SUBS)).toBe(0.09);
    expect(diagnosticOf(result, RETENTION, CHURN).range).toEqual({ min: 0, max: 100, source: 'pair_frame' });
    expect(diagnosticOf(result, CONVERSION, NEW_SUBS).range).toEqual({ min: 0, max: 1000, source: 'pair_frame' });
  });

  it('the level ISL receives IS the level CEE persisted on the option (value = raw / frame)', () => {
    // Runtime 5855059571: the option nodes store {value: 0.025, raw_value: 2.5}
    // and {value: 0.09, raw_value: 90}. The normalised level must equal it.
    const req = paulRequest();
    const result = run(req);
    for (const [optId, factorId] of [[RETENTION, CHURN], [CONVERSION, NEW_SUBS]] as const) {
      const optionNode = req.graph.nodes.find((n: any) => n.id === optId);
      expect(normalisedLevel(result, optId, factorId)).toBe(optionNode.interventions[factorId].value);
    }
  });

  it('no intervention on the graph clamps, so no clamp repair is emitted', () => {
    const result = run(paulRequest());
    expect(result.diagnostics.filter((d) => d.clamped)).toEqual([]);
    expect(result.repairs.filter((r) => r.action === 'clamped')).toEqual([]);
  });

  it('CONTRAST — the price options (explicit_cap 200) are unchanged: 0.245 / 0.295 / 0.27, source explicit_cap', () => {
    const result = run(paulRequest());
    const want: Record<string, number> = {
      keep_current_49_price: 0.245,
      increase_price_to_59: 0.295,
      increase_price_to_54: 0.27,
      '146aa89d': 0.295,
    };
    for (const [optId, level] of Object.entries(want)) {
      expect(normalisedLevel(result, optId, 'pro_plan_price')).toBe(level);
      expect(diagnosticOf(result, optId, 'pro_plan_price').range).toEqual({ min: 0, max: 200, source: 'explicit_cap' });
    }
    const priceRepair = result.repairs.find((r) => r.field === 'intervention.value.pro_plan_price');
    expect(priceRepair).toEqual({
      field: 'intervention.value.pro_plan_price',
      action: 'normalised',
      from_value: 49,
      to_value: 0.245,
      reason: 'normalised range=[0,200] source=explicit_cap',
    });
  });

  it('SCOPE — a framed factor NO option intervenes on keeps its range (the rung is for interventions only)', () => {
    const req = paulRequest();
    const ctx = buildNormalisationContext(nodesOf(req), req.goal_node_id, undefined, optionsOf(req), collectScaleFrameByNodeId(req.graph.nodes));
    // pro_paying_subscribers: {0.15, 1500}, scale_frame 10000 — not intervened.
    expect(ctx.factors.get('pro_paying_subscribers')?.range).toEqual({ min: 0, max: 0.3, source: 'inferred_value' });
    // other_mrr_growth: {0.02, 1000}, scale_frame 50000 — not intervened.
    expect(ctx.factors.get('other_mrr_growth')?.range).toEqual({ min: 0, max: 0.04, source: 'inferred_value' });
    // The goal (cap 125000) is unchanged.
    expect(ctx.goal_context?.range).toEqual({ min: 0, max: 125000, source: 'explicit_cap' });
  });

  it("SCOPE — deriveRange(node) with no intervention values (the constraint rung 6 / flip callers) is unchanged", () => {
    const req = paulRequest();
    const churn = nodesOf(req).find((n) => n.id === CHURN)!;
    expect(deriveRange(churn)).toEqual({ min: 0, max: 0.06, source: 'inferred_baseline' });
    expect(deriveRange(churn, undefined, undefined, 100)).toEqual({ min: 0, max: 0.06, source: 'inferred_baseline' });
  });
});

// A second factor with a cap opens the Phase-4a gate the way Paul's price does.
const PRICE: EngineNodeV3 = { id: 'price', kind: 'factor', label: 'Price', observed_state: { value: 0.245, raw_value: 49, cap: 200 } };
const GOAL: EngineNodeV3 = { id: 'goal', kind: 'goal', label: 'Goal', observed_state: { value: 0.5, cap: 100 } };

function opt(id: string, interventions: Record<string, number>): OptionV3 {
  return {
    id,
    label: id,
    interventions: Object.fromEntries(Object.entries(interventions).map(([k, v]) => [k, { value: v, source: 'user_specified' as const }])),
  };
}

describe('A3 — the frame rung: precedence, domain and the clamp disclosure', () => {
  it("CONTRAST — a stored scale_frame the pair CONTRADICTS: the stored scale_frame WINS (the '%' rung's documented order)", () => {
    // scale_frame 100 says 2.5 → 0.025; the pair {0.03, 30} encodes 1000 (2.5 → 0.0025).
    // `resolvePercentTargetFrame` doc: rungs 1–2 do NOT test a stored frame
    // against the pair — "a disagreeing pair is outranked, not refused".
    const churn: EngineNodeV3 = { id: 'churn', kind: 'factor', label: 'Churn', observed_state: { value: 0.03, raw_value: 30, unit: '% per month' } };
    const result = normaliseOptionsForISL(
      [opt('a', { price: 49, churn: 2.5 })],
      [PRICE, churn, GOAL],
      'goal',
      undefined,
      new Map([['churn', 100]]),
    );
    expect(normalisedLevel(result, 'a', 'churn')).toBe(0.025);
    expect(diagnosticOf(result, 'a', 'churn').range).toEqual({ min: 0, max: 100, source: 'scale_frame' });
    // Same verdict from the ONE helper both callers read.
    expect(resolveNodeFrame(churn.observed_state, 100)).toEqual({ frame: 100, carrier: 'scale_frame' });
  });

  it('CONTRAST — a capless factor with NO frame and NO pair keeps today\'s ladder (inferred_value)', () => {
    const plain: EngineNodeV3 = { id: 'plain', kind: 'factor', label: 'Plain', observed_state: { value: 0.3 } };
    const result = normaliseOptionsForISL([opt('a', { price: 49, plain: 0.45 })], [PRICE, plain, GOAL], 'goal');
    expect(diagnosticOf(result, 'a', 'plain').range).toEqual({ min: 0, max: 0.6, source: 'inferred_value' });
    expect(normalisedLevel(result, 'a', 'plain')).toBeCloseTo(0.75, 12);
    expect(result.repairs.filter((r) => r.action === 'clamped')).toEqual([]);
  });

  it('CLAMP DISCLOSED — one option clamps on the frameless ladder: exactly one repair, bound to that option', () => {
    const plain: EngineNodeV3 = { id: 'plain', kind: 'factor', label: 'Plain', observed_state: { value: 0.3 } };
    const result = normaliseOptionsForISL([opt('only', { price: 49, plain: 0.9 })], [PRICE, plain, GOAL], 'goal');
    const d = diagnosticOf(result, 'only', 'plain');
    expect(d.range).toEqual({ min: 0, max: 0.6, source: 'inferred_value' });
    expect(d.clamped).toBe(true);
    expect(normalisedLevel(result, 'only', 'plain')).toBe(1);
    expect(result.repairs.filter((r) => r.action === 'clamped')).toEqual([
      {
        field: 'intervention.value.plain',
        action: 'clamped',
        from_value: 0.9,
        to_value: 1,
        reason: 'option=only normalised range=[0,0.6] source=inferred_value (clamped)',
      },
    ]);
    // The per-factor `normalised` record is unchanged in shape.
    expect(result.repairs.find((r) => r.action === 'normalised' && r.field === 'intervention.value.plain')).toEqual({
      field: 'intervention.value.plain',
      action: 'normalised',
      from_value: 0.9,
      to_value: 1,
      reason: 'normalised range=[0,0.6] source=inferred_value',
    });
  });

  it('CLAMP DISCLOSED — a framed value beyond its own frame (churn 150 on frame 100) clamps AND says so', () => {
    const churn: EngineNodeV3 = { id: 'churn', kind: 'factor', label: 'Churn', observed_state: { value: 0.03, raw_value: 3, unit: '% per month' } };
    const result = normaliseOptionsForISL([opt('x', { price: 49, churn: 150 })], [PRICE, churn, GOAL], 'goal', undefined, new Map([['churn', 100]]));
    expect(normalisedLevel(result, 'x', 'churn')).toBe(1);
    expect(result.repairs.filter((r) => r.action === 'clamped')).toEqual([
      {
        field: 'intervention.value.churn',
        action: 'clamped',
        from_value: 150,
        to_value: 1,
        reason: 'option=x normalised range=[0,100] source=scale_frame (clamped)',
      },
    ]);
  });

  it('D-9 — a NEGATIVE-domain factor carrying a scale_frame still round-trips on the sign-preserving rung (never [0, frame])', () => {
    // value −500 with a stray scale_frame: [0, frame] would pin −500 to 0.
    const neg: EngineNodeV3 = { id: 'neg', kind: 'factor', label: 'Neg', observed_state: { value: -500 } };
    const result = normaliseOptionsForISL([opt('a', { price: 49, neg: -500 })], [PRICE, neg, GOAL], 'goal', undefined, new Map([['neg', 1000]]));
    expect(diagnosticOf(result, 'a', 'neg').range).toEqual({ min: -1000, max: 0, source: 'inferred_value' });
    expect(normalisedLevel(result, 'a', 'neg')).toBe(0.5);
    expect(diagnosticOf(result, 'a', 'neg').clamped).toBe(false);
  });

  it('D-9 — a negative BASELINE also keeps the sign-preserving rung', () => {
    const neg: EngineNodeV3 = { id: 'neg', kind: 'factor', label: 'Neg', observed_state: { value: 0.1, baseline: -0.2 } };
    const result = normaliseOptionsForISL([opt('a', { price: 49, neg: -0.2 })], [PRICE, neg, GOAL], 'goal', undefined, new Map([['neg', 100]]));
    expect(diagnosticOf(result, 'a', 'neg').range.source).toBe('inferred_baseline');
    expect(diagnosticOf(result, 'a', 'neg').clamped).toBe(false);
  });

  it('a cap still outranks every other frame carrier (explicit_cap, unchanged)', () => {
    const capped: EngineNodeV3 = { id: 'c', kind: 'factor', label: 'C', observed_state: { value: 0.2, raw_value: 4, cap: 20 } };
    const result = normaliseOptionsForISL([opt('a', { price: 49, c: 4 })], [PRICE, capped, GOAL], 'goal', undefined, new Map([['c', 100]]));
    expect(diagnosticOf(result, 'a', 'c').range).toEqual({ min: 0, max: 20, source: 'explicit_cap' });
    expect(normalisedLevel(result, 'a', 'c')).toBe(0.2);
  });

  it('state_space.range and extracted hints keep their rank ABOVE the frame', () => {
    const ranged: EngineNodeV3 = { id: 'r', kind: 'factor', label: 'R', observed_state: { value: 0.03, raw_value: 3 }, state_space: { range: { min: 0, max: 10 } } };
    const result = normaliseOptionsForISL([opt('a', { price: 49, r: 2.5 })], [PRICE, ranged, GOAL], 'goal', undefined, new Map([['r', 100]]));
    expect(diagnosticOf(result, 'a', 'r').range).toEqual({ min: 0, max: 10, source: 'explicit' });
  });

  it('the frame OUTRANKS an intervention spread (a raw-value spread is not the node\'s scale)', () => {
    const churn: EngineNodeV3 = { id: 'churn', kind: 'factor', label: 'Churn', observed_state: { value: 0.03, raw_value: 3 } };
    const result = normaliseOptionsForISL(
      [opt('a', { price: 49, churn: 2.5 }), opt('b', { price: 54, churn: 2 })],
      [PRICE, churn, GOAL],
      'goal',
      undefined,
      new Map([['churn', 100]]),
    );
    expect(normalisedLevel(result, 'a', 'churn')).toBe(0.025);
    expect(normalisedLevel(result, 'b', 'churn')).toBe(0.02);
  });
});

describe('A3 — ONE frame reader, two callers', () => {
  const shapes: Array<{ name: string; observed: EngineNodeV3['observed_state']; scaleFrame?: number; frame: number | undefined }> = [
    { name: 'cap', observed: { value: 0.2, raw_value: 4, cap: 20 }, scaleFrame: 100, frame: 20 },
    { name: 'scale_frame', observed: { value: 0.2 }, scaleFrame: 20, frame: 20 },
    { name: 'pair', observed: { value: 0.2, raw_value: 4 }, frame: 20 },
    { name: 'pair coheres with 100', observed: { value: 0.07, raw_value: 7 }, frame: 100 },
    { name: 'stored beats contradicting pair', observed: { value: 0.03, raw_value: 30 }, scaleFrame: 100, frame: 100 },
    { name: 'no frame', observed: { value: 0.3 }, frame: undefined },
  ];

  for (const s of shapes) {
    it(`resolveNodeFrame — ${s.name}`, () => {
      expect(resolveNodeFrame(s.observed, s.scaleFrame)?.frame).toBe(s.frame);
    });
  }

  it("the '%' limit rung reads the SAME frame (a '%'-unit target on each non-legacy shape defers to it)", () => {
    for (const s of shapes) {
      if (s.frame === undefined || s.frame === 100) continue;
      const node: EngineNodeV3 = { id: 'n', kind: 'factor', label: 'n', observed_state: { ...s.observed, unit: '%' } };
      const verdict = resolvePercentTargetFrame(node, s.scaleFrame);
      expect(verdict, s.name).toEqual({ verdict: 'deferred', frame: s.frame, percent_extent: s.frame });
    }
  });

  it('deriveRange for an intervened node resolves its max from the same frame', () => {
    for (const s of shapes) {
      if (s.frame === undefined) continue;
      const node: EngineNodeV3 = { id: 'n', kind: 'factor', label: 'n', observed_state: s.observed };
      expect(deriveRange(node, undefined, [1], s.scaleFrame).max, s.name).toBe(s.frame);
    }
  });
});
