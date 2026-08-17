/**
 * Fragile edges must leave PLoT in FRAGILITY ORDER on every outbound path —
 * including the two CEE-facing ones.
 *
 * ISL emits `fragile_edges` in an order that is not fragility order. Live on
 * plot-lite-service-staging build 1dd45b6 the array came back with
 * switch_probability [0.075, 0.281, 0.375, 0.487, 0.569, 0.61, 0.307]: `[0]`
 * was the LEAST fragile of seven and the maximum sat at index 5.
 *
 * PLoT fixed that inside `normalizeFragileEdges`, which feeds the /v2/run
 * RESPONSE body. Two CEE-facing builders never called it and forwarded ISL's
 * raw order, so one /v2/run request emitted fragile edges in fragility order
 * to the UI and in ISL's arbitrary order to CEE:
 *
 *   1. buildRobustnessDataForCee  (robustness-enrichment.ts, live at run.ts:6440)
 *   2. buildDecisionReviewRequest (decision-review-request.ts, live at run.ts:7023)
 *
 * Downstream CEE reads position [0] — `decompose.ts` `fragileEdges[0]` becomes
 * `stabilityHint.top_fragile_edge` — so an unsorted array does not merely look
 * untidy, it NAMES THE WRONG EDGE as the one most likely to flip the decision.
 *
 * Builder (2) additionally defaulted a missing `switch_probability` to 0,
 * reintroducing the exact fabrication the response path was fixed to avoid: an
 * unmeasured edge was published as "0% chance of switching", i.e. maximally
 * robust, which is a claim rather than an absence.
 *
 * RED evidence, recorded on d27fe16 before the fix:
 *   buildRobustnessDataForCee  → [0.075, 0.61, 0.307]      (ISL order, verbatim)
 *   buildDecisionReviewRequest → [0.075, 0.61, 0.307, 0]    (ISL order + fabricated 0)
 * Both "most fragile first" assertions failed; both named e_least (0.075).
 */
import { describe, it, expect } from 'vitest';
import { buildRobustnessDataForCee } from '../src/integrations/isl/adapters/robustness-enrichment.js';
import { buildDecisionReviewRequest } from '../src/cee/decision-review-request.js';

/**
 * ISL's wire order, deliberately wrong: the least fragile edge first, the
 * maximum in the middle, and one edge with NO switch_probability at all.
 */
const ISL_FRAGILE_EDGES = [
  { edge_id: 'least->outcome', from_id: 'least', to_id: 'outcome', switch_probability: 0.075 },
  { edge_id: 'most->outcome', from_id: 'most', to_id: 'outcome', switch_probability: 0.61 },
  { edge_id: 'mid->outcome', from_id: 'mid', to_id: 'outcome', switch_probability: 0.307 },
  // Unmeasured: ISL returned no switch_probability for this edge.
  { edge_id: 'unmeasured->outcome', from_id: 'unmeasured', to_id: 'outcome' },
];

const graph = {
  nodes: [
    { id: 'least', label: 'Least', kind: 'factor' },
    { id: 'most', label: 'Most', kind: 'factor' },
    { id: 'mid', label: 'Mid', kind: 'factor' },
    { id: 'unmeasured', label: 'Unmeasured', kind: 'factor' },
    { id: 'outcome', label: 'Outcome', kind: 'outcome' },
  ],
  edges: [],
} as any;

const options = [
  { id: 'optA', label: 'A', interventions: { least: 1 } },
  { id: 'optB', label: 'B', interventions: { most: 1 } },
] as any;

const islResult = {
  robustness: { fragile_edges: ISL_FRAGILE_EDGES, robust_edges: [] },
  factor_sensitivity: [],
  // 2.1248: the builder no longer fabricates a winner when ISL returned no
  // analysed options — it returns null. This fixture's subject is fragile-edge
  // ORDER, so it now carries the minimal analysed options a constructible
  // request requires (previously it carried none, and the fabricated
  // `{id:'', win_probability: 0}` winner rode along unnoticed).
  options: [
    { option_id: 'optA', option_label: 'A', win_probability: 0.55 },
    { option_id: 'optB', option_label: 'B', win_probability: 0.45 },
  ],
} as any;

/** Minimal but complete M1 coaching input — buildDeterministicCoaching maps
 *  evidence_gaps and model_critiques unconditionally. */
const m1Coaching = {
  readiness: 'ready',
  headline_type: 'clear_winner',
  evidence_gaps: [],
  model_critiques: [],
} as any;

describe('buildRobustnessDataForCee — CEE-facing fragile edge order', () => {
  it('POSITIVE CONTROL: the fixture really is in the wrong order', () => {
    // If ISL_FRAGILE_EDGES were already sorted, every assertion below would
    // pass vacuously.
    const raw = ISL_FRAGILE_EDGES.map((e) => e.switch_probability ?? null);
    expect(raw[0]).toBe(0.075);
    expect(Math.max(...(raw.filter((x) => x !== null) as number[]))).toBe(0.61);
    expect(raw[0]).not.toBe(0.61);
  });

  it('emits fragile edges most-fragile-first', () => {
    const out = buildRobustnessDataForCee(
      { fragile_edges: ISL_FRAGILE_EDGES as any, robust_edges: [] },
      [],
      'optA',
      graph,
      options
    );

    const probs = out!.fragile_edges.map((e: any) => e.switch_probability);
    expect(probs).toEqual([0.61, 0.307, 0.075, undefined]);
  });

  it('names the MOST fragile edge at position [0], which is what CEE reads', () => {
    const out = buildRobustnessDataForCee(
      { fragile_edges: ISL_FRAGILE_EDGES as any, robust_edges: [] },
      [],
      'optA',
      graph,
      options
    );

    expect((out!.fragile_edges[0] as any).edge_id).toBe('most->outcome');
  });

  it('sorts the unmeasured edge LAST, never ahead of a measured one', () => {
    const out = buildRobustnessDataForCee(
      { fragile_edges: ISL_FRAGILE_EDGES as any, robust_edges: [] },
      [],
      'optA',
      graph,
      options
    );

    const last = out!.fragile_edges[out!.fragile_edges.length - 1] as any;
    expect(last.edge_id).toBe('unmeasured->outcome');
    expect(last.switch_probability).toBeUndefined();
  });
});

describe('buildDecisionReviewRequest — CEE-facing fragile edge order', () => {
  // 2.1248: non-null asserted via the fixture's analysed options — a request
  // is only constructible when a real winner exists.
  const build = () =>
    buildDecisionReviewRequest('a brief', graph, options, islResult, m1Coaching)!;

  it('is constructible: the fixture carries analysed options, so a real winner exists', () => {
    const request = buildDecisionReviewRequest('a brief', graph, options, islResult, m1Coaching);
    expect(request).not.toBeNull();
    expect(request!.winner.id).toBe('optA');
  });

  it('emits fragile edges most-fragile-first', () => {
    const edges = build().isl_results.fragile_edges;

    expect(edges.map((e) => e.switch_probability)).toEqual([0.61, 0.307, 0.075, undefined]);
  });

  it('names the MOST fragile edge at position [0]', () => {
    expect(build().isl_results.fragile_edges[0].edge_id).toBe('most->outcome');
  });

  it('NEVER fabricates switch_probability 0 for an unmeasured edge', () => {
    const edges = build().isl_results.fragile_edges;
    const unmeasured = edges.find((e) => e.edge_id === 'unmeasured->outcome')!;

    // 0 would be a claim — "this edge will never flip the decision" — where
    // the truth is that ISL did not measure it. Absence must stay absence.
    expect(unmeasured.switch_probability).toBeUndefined();
    expect(unmeasured.switch_probability).not.toBe(0);
  });

  it('the two CEE-facing payloads agree with each other', () => {
    const a = buildRobustnessDataForCee(
      { fragile_edges: ISL_FRAGILE_EDGES as any, robust_edges: [] },
      [],
      'optA',
      graph,
      options
    )!.fragile_edges.map((e: any) => e.edge_id);
    const b = build().isl_results.fragile_edges.map((e) => e.edge_id);

    expect(a).toEqual(b);
  });
});
