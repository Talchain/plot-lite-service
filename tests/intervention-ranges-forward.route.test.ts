/**
 * TEMPORAL step 2 — PLoT forwards each option's stated duration RANGE to ISL, and FAILS CLOSED
 * when ISL does not confirm it sampled it.
 *
 * Brief: olumi-programme-docs `dl/claude-27fbe09b` → `dl-claude-27fbe09b/briefs/TEMPORAL.md`.
 * ISL half: Inference-Service-Layer #216 (R3 KEEP #75 5911436566; AIQ PASS 5912321226).
 *
 * THE DEFECT (pristine). A per-option range sent to /v2/run is dropped three times before ISL
 * (normalizeOptions, normalizeInterventions, normaliseOptions), so ISL scores the option at its
 * ONE number and a downtime limit reads exactly 100% or 0%.
 *
 * THE CONTRACT this file pins:
 *   F1  absent → the ISL request carries no `intervention_ranges` key anywhere (byte-identical).
 *   F2  present → forwarded as {low, high, meaning, normalisation: {raw_at_zero, raw_at_one}} in
 *       RAW units, where normalisation is the SAME affine map PLoT used for the option's point.
 *   F3  R3 5911436566 (3): the node's frame is widened so it sits strictly above the range's
 *       fitted P99 (quartile lognormal), and the limit is normalised on that same frame.
 *   F4  ISL echoes the range → the option's limit probability is delivered.
 *   F5  ISL does NOT echo it (an older ISL drops the field silently: `extra: ignore`) → that
 *       option's probability for every limit on the ranged node, and its joint, are WITHHELD with
 *       a typed record. Never the point-based 100% / 0% in its place. Other options unaffected.
 *   F6  malformed ranges are refused at the boundary (422), never forwarded half-formed.
 *   F7  the freshness hash moves when only the range moves (it hashes the effective ISL request).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

let capturedISLRequestBody: any = null;
/** When false, the mock behaves like an ISL that silently drops the field (no echo). */
let islEchoesRanges = true;
/** The coverage the mock ISL echoes (ISL's RATIFIED_COVERAGE is 0.5). */
let islEchoCoverage = 0.5;

const PROB: Record<string, number> = { opt_liftshift: 0.628, opt_phased: 0.905, opt_booked: 0.0 };

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [],
      backdoor_paths: [], issues: [], explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    capturedISLRequestBody = JSON.parse(JSON.stringify(body));
    const constraints = body.goal_constraints || [];
    return {
      data: {
        options: (body.options || []).map((opt: any, idx: number) => {
          const ranged = opt.intervention_ranges ? Object.entries(opt.intervention_ranges) : [];
          return {
            option_id: opt.id,
            outcome: { mean: 0.1 + idx * 0.02, std: 0.05, p10: 0.04, p50: 0.1, p90: 0.16, n_samples: 2000, n_valid_samples: 2000, validity_ratio: 1.0 },
            win_probability: 1 / (body.options.length || 1),
            rank: idx + 1,
            ...(islEchoesRanges && ranged.length > 0
              ? {
                  sampled_intervention_ranges: ranged.map(([nodeId, r]: [string, any]) => ({
                    node_id: nodeId, meaning: r.meaning, family: 'lognormal', coverage: islEchoCoverage, low: r.low, high: r.high,
                  })),
                }
              : {}),
            ...(constraints.length > 0
              ? {
                  constraint_analysis: {
                    joint_probability: PROB[opt.id] ?? 0.5,
                    constraints: constraints.map((c: any) => ({
                      constraint_id: c.constraint_id, node_id: c.node_id, operator: c.operator,
                      threshold: c.value, prob_satisfied: PROB[opt.id] ?? 0.5,
                    })),
                  },
                }
              : {}),
          };
        }),
        factor_sensitivity: [],
        robustness: { label: 'moderate', score: 0.6, fragile_edges: [], robust_edges: [] },
        inference_warnings: [],
      } as T,
      error: null,
    };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

const { createServer } = await import('../src/createServer.js');

// ---------------------------------------------------------------------------
// Witness: AWS → GCP, "keep migration downtime within 14 days" (raw days).
//   fac_downtime  factor ROOT -> goal_uptime
//   fac_cost      factor ROOT -> goal_uptime
// lift-and-shift sets downtime to 10 d with a likely range 5–20 d; phased sets it to √6 ≈ 2.449 d
// with a range 1–6 d; "booked" is a point at 21 d with no range.
// ---------------------------------------------------------------------------
const Z75 = 0.6744897501960817;
const Z99 = 2.3263478740408408;
const p99 = (low: number, high: number) => {
  const sigma = Math.log(high / low) / (2 * Z75);
  return Math.exp(0.5 * (Math.log(low) + Math.log(high)) + Z99 * sigma);
};

const iv = (value: number) => ({ value, source: 'user_specified' });
const LIKELY = (low: number, high: number) => ({ low, high, meaning: 'likely_range' });

function graph() {
  return {
    nodes: [
      { id: 'goal_uptime', kind: 'goal', label: 'Service uptime' },
      { id: 'fac_downtime', kind: 'factor', label: 'Migration downtime (days)', observed_state: { value: 10 } },
      { id: 'fac_cost', kind: 'factor', label: 'Migration cost', observed_state: { value: 0.5 } },
    ],
    edges: [
      { from: 'fac_downtime', to: 'goal_uptime', exists_probability: 0.95, strength: { mean: -0.6, std: 0.1 } },
      { from: 'fac_cost', to: 'goal_uptime', exists_probability: 0.95, strength: { mean: -0.2, std: 0.1 } },
    ],
  };
}

function options(ranges: boolean = true, overrides: Record<string, any> = {}) {
  const base: any[] = [
    {
      id: 'opt_liftshift', label: 'Lift-and-shift',
      interventions: { fac_downtime: iv(10), fac_cost: iv(0.4) },
      ...(ranges ? { intervention_ranges: { fac_downtime: LIKELY(5, 20) } } : {}),
    },
    {
      id: 'opt_phased', label: 'Phased re-platform',
      interventions: { fac_downtime: iv(Math.sqrt(6)), fac_cost: iv(0.7) },
      ...(ranges ? { intervention_ranges: { fac_downtime: LIKELY(1, 6) } } : {}),
    },
    { id: 'opt_booked', label: 'Cut-over booked at 21 days', interventions: { fac_downtime: iv(21), fac_cost: iv(0.5) } },
  ];
  return base.map((o) => ({ ...o, ...(overrides[o.id] ?? {}) }));
}

const LIMIT = { constraint_id: 'gc_downtime', node_id: 'fac_downtime', operator: '<=', value: 14, label: 'Migration downtime', value_frame: 'level' };

function body(opts: any[] = options()) {
  return {
    request_id: 'temporal-forward',
    graph: graph(),
    options: opts,
    goal_node_id: 'goal_uptime',
    goal_constraints: [LIMIT],
    seed: 42,
  };
}

function islOption(id: string): any {
  const found = (capturedISLRequestBody?.options ?? []).find((o: any) => o.id === id);
  expect(found, `ISL request carries option ${id}`).toBeDefined();
  return found;
}

function served(res: any, id: string): any {
  const rows = (res.option_comparison ?? []).filter((o: any) => o.option_id === id);
  expect(rows.length).toBe(1);
  return rows[0];
}

describe('TEMPORAL step 2 — PLoT forwards per-option duration ranges and fails closed without the ISL echo', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    app = await createServer();
    await app.ready();
  }, 120_000);

  afterAll(async () => { await app.close(); });

  async function run(payload: any) {
    capturedISLRequestBody = null;
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload });
    return { status: res.statusCode, json: res.json() };
  }

  it('F1: no range → no intervention_ranges key reaches ISL', async () => {
    islEchoesRanges = true;
    const { status } = await run(body(options(false)));
    expect(status).toBe(200);
    expect(JSON.stringify(capturedISLRequestBody)).not.toContain('intervention_ranges');
  });

  it('F2/F3: the range is forwarded in raw units with the SAME affine map as the point, widened above P99', async () => {
    islEchoesRanges = true;
    const { status } = await run(body());
    expect(status).toBe(200);
    const lift = islOption('opt_liftshift');
    const r = lift.intervention_ranges?.fac_downtime;
    expect(r).toBeDefined();
    expect({ low: r.low, high: r.high, meaning: r.meaning }).toEqual(LIKELY(5, 20));
    const { raw_at_zero: lo, raw_at_one: hi } = r.normalisation;
    // The point went through the same map (positive control that the map IS the point's).
    expect(lift.interventions.fac_downtime).toBeCloseTo((10 - lo) / (hi - lo), 9);
    // Never truncated: the frame's top is strictly above every ranged option's fitted P99.
    expect(hi).toBeGreaterThan(p99(5, 20));
    expect(hi).toBeGreaterThan(p99(1, 6));
    expect(lo).toBeLessThanOrEqual(1);
    // The phased option shares the node's one map.
    expect(islOption('opt_phased').intervention_ranges.fac_downtime.normalisation).toEqual(r.normalisation);
    // A point-only option forwards no range.
    expect(islOption('opt_booked').intervention_ranges).toBeUndefined();
    // The limit is normalised on that same frame.
    const limit = capturedISLRequestBody.goal_constraints.find((c: any) => c.constraint_id === 'gc_downtime');
    expect(limit.value).toBeCloseTo((14 - lo) / (hi - lo), 9);
  });

  it('F4: ISL echoes the range → the option\'s limit probability is delivered', async () => {
    islEchoesRanges = true;
    const { json } = await run(body());
    expect(served(json, 'opt_liftshift').constraint_probabilities?.gc_downtime).toBeCloseTo(0.628, 9);
    expect(served(json, 'opt_liftshift').range_limits_withheld).toBeUndefined();
  });

  it('F5: no echo → that option\'s limit probability and joint are withheld with a typed record; point options unaffected', async () => {
    islEchoesRanges = false;
    const { json } = await run(body());
    for (const id of ['opt_liftshift', 'opt_phased']) {
      const row = served(json, id);
      expect(row.constraint_probabilities?.gc_downtime, id).toBeUndefined();
      expect(row.probability_of_joint_goal, id).toBeUndefined();
      expect(row.range_limits_withheld, id).toEqual([
        { constraint_id: 'gc_downtime', node_id: 'fac_downtime', reason: 'range_not_sampled' },
      ]);
    }
    // Control: the point-only option keeps its figure.
    expect(served(json, 'opt_booked').constraint_probabilities?.gc_downtime).toBe(0);
    expect(served(json, 'opt_booked').range_limits_withheld).toBeUndefined();
    islEchoesRanges = true;
  });

  it('F5b: an echo read at another coverage than the frame was widened for is withheld (R3 on #424)', async () => {
    islEchoesRanges = true;
    islEchoCoverage = 0.8;
    const { json } = await run(body());
    const row = served(json, 'opt_liftshift');
    expect(row.constraint_probabilities?.gc_downtime).toBeUndefined();
    expect(row.probability_of_joint_goal).toBeUndefined();
    expect(row.range_limits_withheld).toEqual([
      { constraint_id: 'gc_downtime', node_id: 'fac_downtime', reason: 'range_reading_mismatch' },
    ]);
    expect(served(json, 'opt_booked').constraint_probabilities?.gc_downtime).toBe(0);
    islEchoCoverage = 0.5;
  });

  it.each([
    ['low >= high', { low: 20, high: 5, meaning: 'likely_range' }],
    ['low <= 0', { low: 0, high: 5, meaning: 'likely_range' }],
    ['non-finite', { low: 5, high: 'x', meaning: 'likely_range' }],
    ['missing meaning', { low: 5, high: 20 }],
  ])('F6: a malformed range (%s) is refused 422', async (_name, bad) => {
    const { status, json } = await run(
      body(options(true, { opt_liftshift: { intervention_ranges: { fac_downtime: bad } } })),
    );
    expect(status).toBe(422);
    expect(JSON.stringify(json)).toContain('INVALID_INTERVENTION_RANGE');
    expect(capturedISLRequestBody).toBeNull();
  });

  it('F6b: a range on a node the option does not set is refused 422', async () => {
    const { status, json } = await run(
      body(options(true, { opt_booked: { intervention_ranges: { fac_cost: LIKELY(0.2, 0.6) }, interventions: { fac_downtime: iv(21) } } })),
    );
    expect(status).toBe(422);
    expect(JSON.stringify(json)).toContain('INVALID_INTERVENTION_RANGE');
  });

  it('F7: the freshness hash moves when only a range moves', async () => {
    islEchoesRanges = true;
    const a = await run(body());
    const b = await run(body(options(true, { opt_liftshift: { intervention_ranges: { fac_downtime: LIKELY(5, 25) } } })));
    const c = await run(body());
    const hash = (r: any) => r.json._meta?.response_hash;
    expect(hash(a)).toBeDefined();
    expect(hash(a)).toBe(hash(c));
    expect(hash(a)).not.toBe(hash(b));
  });
});
