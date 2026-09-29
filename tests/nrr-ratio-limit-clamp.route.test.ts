/**
 * A RATIO LIMIT ABOVE 1 IS NEVER PUBLISHED CLAMPED TO 1 (AIQ #72 5884454738 item 3; R3-B measurement 5884593270,
 * AIQ ACK 5884802000).
 *
 * THE RISK. The shipped pricing starter states "net revenue retention above 110%" as `NRR >= 1.1` (unit `fraction`).
 * `normaliseFiniteValue` clamps a threshold to [0,1] of its target's range, so on a DEFAULT [0,1] range the limit reaches
 * ISL as 1.0 ("NRR >= 100%"). A published P for that row would answer a different question with a confident number.
 *
 * WHAT HOLDS TODAY (measured on 14 framings, olumi-programme-docs r3b/clamp-probe-20260929):
 *   - default range  → the clamped 1.0 may reach the wire, but B5 withholds the limit (never published);
 *   - a real range the limit lies beyond → the A3 refusal (`threshold_clamped`) keeps it off the wire;
 *   - a cap frames the target → the limit rescales exactly (1.1 / 1.5) and is scored (the control).
 * These rows pin all three, so relaxing B5's withhold or the A3 refusal cannot silently publish "NRR >= 100%".
 *
 * Every row goes through the real `POST /v2/run` route with ISL mocked; the mock scores every row it is sent at 0.9, so a
 * published P measures PLoT's gate, not ISL's arithmetic. The input is AI Quality's served starter request (UI staging
 * 6eea3254 `pricing-model.draft.json`, captured 29 Sep 05:45Z), with only `out_nrr` and the limit's frame varied.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Every `goal_constraints` array ISL was handed, in call order. THE WIRE. */
let islRequests: any[][] = [];

function optionResults(options: any[], goalConstraints: any[] | undefined) {
  return options.map((opt: any, idx: number) => ({
    option_id: opt.id,
    status: 'computed',
    win_probability: 1 / options.length,
    outcome: {
      mean: 0.7 + idx * 0.01, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9,
      n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0,
    },
    rank: idx + 1,
    ...(goalConstraints && goalConstraints.length > 0 && {
      constraint_analysis: {
        constraints: goalConstraints.map((c: any) => ({
          constraint_id: c.constraint_id, node_id: c.node_id, operator: c.operator, value: c.value,
          prob_satisfied: 0.9, near_miss_fraction: 0.1, binding: false,
        })),
        joint_probability: 0.9,
      },
    }),
  }));
}

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [],
      backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock validation', reasoning: 'Test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[], _t?: any, constraints?: any[]) {
    islRequests.push(constraints ?? []);
    return {
      options: optionResults(options, constraints),
      edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factors: [], value_of_information: [], factors_provenance: 'unavailable' as const,
      factor_sensitivity_status: 'skipped_no_factor_values' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.8,
      fragile_edges: [], robust_edges: [], latency_ms: 50, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return {
      factors: [], value_of_information: [], robustness_label: 'robust' as const,
      robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const,
    };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    islRequests.push(body.goal_constraints ?? []);
    return {
      data: {
        options: optionResults(body.options || [], body.goal_constraints),
        edges: [], factors: [], value_of_information: [],
        overall_robustness: 'robust', robustness_score: 0.8,
        fragile_edges: [], robust_edges: [],
      } as T,
      error: null,
    };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';

const STARTER = resolve(__dirname, 'fixtures/r3b-nrr-clamp-20260929/starter-pricing.request.json');
const NRR_LIMIT = 'constraint_out_nrr_min';
const NRR = 'out_nrr';

/** The served starter with `out_nrr` re-shaped; `root` drops NRR's parents (a stated quantity, not a computed one). */
function starter(opts: { root?: boolean; node?: Record<string, unknown>; level?: boolean }): any {
  const req = JSON.parse(readFileSync(STARTER, 'utf8'));
  const nrr = req.graph.nodes.find((n: any) => n.id === NRR);
  expect(nrr, 'out_nrr must exist in the starter').toBeDefined();
  Object.assign(nrr, opts.node ?? {});
  if (opts.root) {
    nrr.kind = 'factor';
    req.graph.edges = req.graph.edges.filter((e: any) => e.to !== NRR);
  }
  const limit = req.goal_constraints.find((c: any) => c.constraint_id === NRR_LIMIT);
  expect(limit, 'the NRR limit must exist in the starter').toMatchObject({ node_id: NRR, operator: '>=', value: 1.1, unit: 'fraction' });
  if (opts.level) limit.value_frame = 'level';
  return req;
}

/** The NRR limit's row on every ISL call (undefined where it was not sent). */
function wireRows(): Array<any | undefined> {
  expect(islRequests.length).toBeGreaterThan(0);
  return islRequests.map((batch) => batch.find((c: any) => c.constraint_id === NRR_LIMIT));
}

/** Each option's published P for the NRR limit (undefined where it is not published). */
function publishedP(body: any): Array<number | undefined> {
  const rows = body.option_comparison ?? [];
  expect(rows.length).toBe(4);
  return rows.map((o: any) => o.constraint_probabilities?.[NRR_LIMIT]);
}

describe('an NRR >= 1.1 (fraction) limit is never published clamped to 1.0', () => {
  let app: FastifyInstance;
  let baseUrl = '';

  async function run(payload: any) {
    islRequests = [];
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(200);
    return res.json();
  }

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each([
    ['the served starter (computed NRR, no state, no frame)', { level: false }],
    ['a root NRR framed by scale_frame alone (a non-intervened node ignores it), level-stamped', { root: true, node: { scale_frame: 1.5 }, level: true }],
  ])('default range — the clamped 1.0 reaches the wire but is never published: %s', async (_name, shape) => {
    const body = await run(starter(shape));
    // Discriminating precondition: the clamp DID happen on this shape.
    for (const row of wireRows()) expect(row?.value).toBe(1);
    expect(publishedP(body)).toEqual([undefined, undefined, undefined, undefined]);
    expect(body.joint_withheld).toMatchObject({ reason: 'limit_unscored' });
    expect(body.joint_withheld.constraint_ids).toContain(NRR_LIMIT);
  });

  it('a real range the limit lies beyond — refused before the wire (threshold_clamped)', async () => {
    // Today 0.45 → range [0, 0.9]; 1.1 lies beyond it.
    const body = await run(starter({ root: true, node: { observed_state: { value: 0.45 } }, level: true }));
    for (const row of wireRows()) expect(row).toBeUndefined();
    const refused = (body._meta?.filtered_constraints ?? []).filter((f: any) => f.constraint_id === NRR_LIMIT);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ constraint_id: NRR_LIMIT, reason: 'threshold_clamped' });
    expect(publishedP(body)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('control — a cap frames the target: the limit rescales exactly and is scored', async () => {
    const body = await run(starter({ root: true, node: { observed_state: { value: 1.05, cap: 1.5 } }, level: true }));
    for (const row of wireRows()) expect(row?.value).toBeCloseTo(1.1 / 1.5, 12);
    expect(publishedP(body)).toEqual([0.9, 0.9, 0.9, 0.9]);
    const results = (body.constraint_results ?? []).filter((r: any) => r.constraint_id === NRR_LIMIT);
    expect(results).toHaveLength(1);
    expect(results[0].scale_provenance).toMatchObject({ source: 'explicit_cap', decision_grade: true });
    expect(body.joint_withheld).toBeUndefined();
  });
});
