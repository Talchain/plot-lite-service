/**
 * R3 slice 1 (B2), rung (a) — PLoT carries CEE's `nonlinear_identity` to ISL, verbatim, or refuses.
 *
 * AIQ row R3-3 (ACCEPTANCE-ROWS-R2R3-B5): the declaration reaches ISL — count = 1 per hop. Before this
 * change it was 1 CEE→PLoT and 0 PLoT→ISL (WIRE d65d3a0e): `normaliseNode` and `toISLNode` both rebuild a
 * node from an explicit field list, so the key was silently dropped twice. AIQ #70 5859633012: an unknown
 * `operation` is REJECTED, never dropped (a dropped identity is R3-4's declared-but-not-evaluated case).
 *
 * The request is Paul's own CEE→PLoT capture (`paul-own-a295e4a1-20260927`, sha256 8bc6f257…) with ONE
 * edit: `mrr` declares MRR = price × paying subscribers, as C46's `markProductIdentities` would mint it.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Every ISL analysis body, in call order. THE WIRE. */
let islBodies: any[] = [];

function echoConstraintAnalysis(goalConstraints: any[] | undefined) {
  if (!goalConstraints || goalConstraints.length === 0) return undefined;
  return {
    constraints: goalConstraints.map((c: any) => ({
      constraint_id: c.constraint_id,
      node_id: c.node_id,
      operator: c.operator,
      value: c.value,
      prob_satisfied: 0.8,
      failure_margin_median: 0.01,
      near_miss_fraction: 0.1,
      binding: false,
    })),
    joint_probability: 0.8,
    conditional_probabilities: null,
  };
}

function optionResults(options: any[], goalConstraints?: any[]) {
  const ca = echoConstraintAnalysis(goalConstraints);
  return options.map((opt: any, idx: number) => ({
    option_id: opt.id,
    outcome: {
      mean: 0.6 + idx * 0.01, std: 0.1, p10: 0.5, p50: 0.6, p90: 0.7,
      n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0,
    },
    rank: idx + 1,
    ...(ca && { constraint_analysis: ca }),
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
  async analyseRobustness(graph: any, goalNodeId: string, options: any[], _t?: any, constraints?: any[]) {
    islBodies.push({ graph, goal_node_id: goalNodeId, options, goal_constraints: constraints ?? [] });
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
    islBodies.push(body);
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

import { NormalisationError, normaliseNode, readNonlinearIdentity } from '../src/normalisation/graph-normaliser.js';
import { toISLNode } from '../src/integrations/isl/translator-v3.js';

const FIXTURE_DIR = resolve(__dirname, 'fixtures/paul-own-a295e4a1-20260927');
const PRODUCT = { operation: 'product', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'], stated_in_brief: true };

function paulRequest(identity?: unknown): any {
  const d = JSON.parse(readFileSync(resolve(FIXTURE_DIR, 'cee-to-plot.request.json'), 'utf8'));
  if (identity !== undefined) {
    const mrr = d.graph.nodes.find((n: any) => n.id === 'mrr');
    mrr.nonlinear_identity = identity;
  }
  return d;
}

function occurrences(body: unknown): number {
  return (JSON.stringify(body).match(/"nonlinear_identity"/g) ?? []).length;
}

describe('R3-3 unit — normaliseNode / toISLNode carry the declaration or refuse it', () => {
  const node = { id: 'mrr', kind: 'goal', label: 'MRR', nonlinear_identity: PRODUCT } as any;

  it('carries a valid declaration verbatim through BOTH rebuilds', () => {
    const engine = normaliseNode(node);
    expect(engine.nonlinear_identity).toEqual(PRODUCT);
    expect(toISLNode(engine).nonlinear_identity).toEqual(PRODUCT);
  });

  it('a node that declares nothing is byte-identical to before (no key at all)', () => {
    const plain = toISLNode(normaliseNode({ id: 'f', kind: 'factor', label: 'F' } as any));
    expect('nonlinear_identity' in plain).toBe(false);
  });

  it.each([
    [{ ...PRODUCT, operation: 'ratio' }, 'nonlinear_identity.operation'],
    [{ ...PRODUCT, operation: undefined }, 'nonlinear_identity.operation'],
    [{ ...PRODUCT, factor_ids: [] }, 'nonlinear_identity.factor_ids'],
    [{ ...PRODUCT, factor_ids: ['a', 'a'] }, 'nonlinear_identity.factor_ids'],
    [{ ...PRODUCT, factor_ids: ['a', 3] }, 'nonlinear_identity.factor_ids'],
    [{ ...PRODUCT, stated_in_brief: 'yes' }, 'nonlinear_identity.stated_in_brief'],
    ['product', 'nonlinear_identity'],
  ])('REFUSES a malformed declaration %j — never drops it (field %s)', (identity, field) => {
    let thrown: unknown;
    try {
      readNonlinearIdentity({ id: 'mrr', nonlinear_identity: identity } as any);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(NormalisationError);
    expect((thrown as NormalisationError).field).toBe(field);
  });

  it('`sum` is admitted (AIQ 5859633012: CEE widens the carrier to product | sum)', () => {
    expect(readNonlinearIdentity({ id: 't', nonlinear_identity: { ...PRODUCT, operation: 'sum' } } as any)?.operation).toBe('sum');
  });
});

describe("R3-3 route — Paul's request: the declaration reaches ISL exactly once, or the run is refused", () => {
  let app: FastifyInstance;
  let baseUrl: string;

  async function post(payload: any) {
    islBodies = [];
    return fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  }, 60_000);

  afterAll(async () => { await app?.close(); });

  it('PRECONDITION — CEE→PLoT carries it once', () => {
    expect(occurrences(paulRequest(PRODUCT))).toBe(1);
  });

  it('PLoT→ISL carries it once, on mrr, verbatim (count = 1 per hop)', async () => {
    const res = await post(paulRequest(PRODUCT));
    expect(res.status).toBe(200);
    expect(islBodies.length).toBeGreaterThan(0);
    for (const body of islBodies) {
      expect(occurrences(body)).toBe(1);
      const mrr = body.graph.nodes.find((n: any) => n.id === 'mrr');
      expect(mrr.nonlinear_identity).toEqual(PRODUCT);
    }
  });

  it('CONTROL — the same request without a declaration sends none (ISL body unchanged)', async () => {
    const res = await post(paulRequest());
    expect(res.status).toBe(200);
    for (const body of islBodies) expect(occurrences(body)).toBe(0);
  });

  it('an unknown operation is REFUSED (422, the normalisation-error status), and ISL is never called with it', async () => {
    const res = await post(paulRequest({ ...PRODUCT, operation: 'ratio' }));
    expect(res.status).toBe(422);
    expect(islBodies.length).toBe(0);
    expect(await res.text()).toContain('nonlinear_identity.operation');
  });
});
