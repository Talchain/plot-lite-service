/**
 * /v2/run route-level contract: the RESOLVED SEED reaches the ISL analysis call.
 *
 * ⚠ REWORKED BY ROADMAP 2.228-F3 — READ THIS BEFORE COMPARING WITH GIT HISTORY.
 * This file used to be titled "flip-threshold probes carry the resolved seed"
 * and asserted the seed on every `__flip` PROBE body. PLoT's bisection flip
 * probe is RETIRED on /v2/run (flip values now arrive closed-form on the ISL
 * envelope as `factor_flip_values`), so there are no probe bodies left to
 * assert about, and four passing tests would otherwise have been deleted
 * outright.
 *
 * They are kept because the guarantee UNDER them survives the retirement — the
 * seed still has to travel from the request through PLoT's resolution to the
 * ISL call, and the falsy-zero trap it guards (`seed: 0` surviving
 * `resolveSeed` → `String()` → the wire) is exactly as live as it was. Each
 * case now asserts the same seed on the MAIN analysis body instead of the probe
 * bodies, and a fifth case pins that the probe traffic is genuinely GONE rather
 * than merely unobserved.
 *
 * ISL is mocked in-process; the mock captures every analyze/v2 body, so the
 * probe-absence assertion is made by an instrument that can see presence.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// ISL Mock — captures every analyze/v2 request body (main + flip probes)
// ---------------------------------------------------------------------------

const capturedBodies: any[] = [];

function optionComparison(options: any[]) {
  return options.map((opt: any, idx: number) => ({
    option_id: opt.id,
    win_probability: 0.6 - idx * 0.2, // distinct winner (opt1 > opt2)
    outcome: { mean: 0.65 + idx * 0.12, std: 0.08, p10: 0.45, p50: 0.65, p90: 0.85, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
    rank: idx + 1,
  }));
}

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high',
      adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock validation', reasoning: 'Test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return {
      options: optionComparison(options),
      edges: [
        { from: 'factor-a', to: 'goal', sensitivity: 0.5, confidence: 0.8, direction: 'positive' },
        { from: 'factor-b', to: 'goal', sensitivity: -0.3, confidence: 0.7, direction: 'negative' },
      ],
      edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factors: [
        { node_id: 'factor-a', sensitivity: 0.5, confidence: 0.8, direction: 'positive' },
        { node_id: 'factor-b', sensitivity: -0.3, confidence: 0.7, direction: 'negative' },
      ],
      value_of_information: [],
      factors_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      factor_sensitivity_status: 'available' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.82,
      fragile_edges: [], robust_edges: [],
      latency_ms: 42, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.82, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    capturedBodies.push(body);
    const options = body.options || [];
    return {
      data: {
        options: optionComparison(options),
        edges: [
          { from: 'factor-a', to: 'goal', sensitivity: 0.5, confidence: 0.8, direction: 'positive' },
          { from: 'factor-b', to: 'goal', sensitivity: -0.3, confidence: 0.7, direction: 'negative' },
        ],
        factors: [
          { node_id: 'factor-a', sensitivity: 0.5, confidence: 0.8, direction: 'positive' },
          { node_id: 'factor-b', sensitivity: -0.3, confidence: 0.7, direction: 'negative' },
        ],
        value_of_information: [],
        overall_robustness: 'robust', robustness_score: 0.82,
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

// ---------------------------------------------------------------------------
// Fixtures — two factors, each intervened by a DIFFERENT option. (Under the
// retired probe this shape was what kept both factors out of the
// overridden-by-all exclusion so the probe path would run; it is retained so
// the request is byte-comparable with the pre-retirement history.)
// ---------------------------------------------------------------------------

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'factor-a', kind: 'factor', label: 'Marketing Spend', observed_state: { value: 0.6 } },
    { id: 'factor-b', kind: 'factor', label: 'Customer Churn', observed_state: { value: 0.5 } },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
    { from: 'factor-b', to: 'goal', strength: { mean: -0.3, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt1', label: 'Increase Marketing', interventions: { 'factor-a': 0.8 } },
  { id: 'opt2', label: 'Reduce Churn', interventions: { 'factor-b': 0.3 } },
];

/** Probe requests carried request_id `<rid>__flip_<factorId>`. Must now be empty. */
function flipProbeBodies() {
  return capturedBodies.filter((b) => typeof b?.request_id === 'string' && b.request_id.includes('__flip'));
}

/** The main robustness analysis bodies (everything that is not a retired probe). */
function analysisBodies() {
  return capturedBodies.filter((b) => !(typeof b?.request_id === 'string' && b.request_id.includes('__flip')));
}

describe('V2 Run · the resolved seed reaches the ISL analysis call', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  it('explicit request seed → every flip probe body carries that same seed (= main-call seed_used)', async () => {
    capturedBodies.length = 0;
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({ graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: '4242' }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const seedUsed = body.meta.seed_used;
    expect(seedUsed).toBe('4242');

    const calls = analysisBodies();
    expect(calls.length).toBeGreaterThan(0); // the ISL call actually happened
    for (const c of calls) {
      // ISL request seed is forwarded verbatim; compare as strings to be
      // representation-agnostic (string vs number).
      expect(String(c.seed)).toBe(String(seedUsed));
    }
  });

  it('omitted request seed → probes carry the PLoT-derived resolved seed (same as main-call seed_used)', async () => {
    capturedBodies.length = 0;
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({ graph: GRAPH, options: OPTIONS, goal_node_id: 'goal' }), // no seed
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const seedUsed = body.meta.seed_used;
    // PLoT derived a non-empty seed from the canonical request/graph.
    expect(seedUsed).toBeDefined();
    expect(String(seedUsed).length).toBeGreaterThan(0);
    expect(body.meta.seed_source).toBe('server_generated');

    const calls = analysisBodies();
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.seed).toBeDefined(); // NOT falling back to ISL's graph-hash default
      expect(String(c.seed)).toBe(String(seedUsed)); // derived seed === wire seed
    }
  });

  it('different seeds → flip probe requests carry different seeds (seed is consumed, not inert)', async () => {
    capturedBodies.length = 0;
    await app.inject({
      method: 'POST', url: '/v2/run', headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({ graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: '111' }),
    });
    const seedsRun1 = new Set(analysisBodies().map((c) => String(c.seed)));

    capturedBodies.length = 0;
    await app.inject({
      method: 'POST', url: '/v2/run', headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({ graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: '999' }),
    });
    const seedsRun2 = new Set(analysisBodies().map((c) => String(c.seed)));

    expect(seedsRun1).toEqual(new Set(['111'])); // one seed across the whole run
    expect(seedsRun2).toEqual(new Set(['999']));
    expect(seedsRun1).not.toEqual(seedsRun2);
  });

  it('numeric seed 0 → route normalises to "0" and every probe carries it (falsy seed survives end-to-end)', async () => {
    // Guards the classic falsy-zero trap across the whole /v2/run → ISL chain:
    // resolveSeed(0) → "0" (the public path String()-normalises the number),
    // and that normalised seed must reach the wire rather than being dropped as
    // falsy. Unchanged in substance by the probe retirement — only the body it
    // is read off has moved from the probe to the analysis call.
    capturedBodies.length = 0;
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({ graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: 0 }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.meta.seed_used).toBe('0'); // numeric 0 normalised to "0", not dropped
    expect(body.meta.seed_source).toBe('client_generated');

    const calls = analysisBodies();
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(String(c.seed)).toBe('0'); // the wire carries the normalised resolved seed
    }
  });

  it('THE RETIREMENT: the run issues ZERO flip-probe requests', async () => {
    // ROADMAP 2.228-F3. Under the retired bisection search this same request
    // produced a __flip analyze/v2 body per probe value (Step-0 baseline/min/max
    // plus bisection midpoints, per candidate factor). Closed-form flips add no
    // ISL traffic at all.
    //
    // Positive control FIRST (trap 13): the mock demonstrably captures bodies,
    // so "zero probes" is a measurement rather than a broken instrument.
    capturedBodies.length = 0;
    const res = await app.inject({
      method: 'POST', url: '/v2/run', headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({ graph: GRAPH, options: OPTIONS, goal_node_id: 'goal', seed: '4242' }),
    });
    expect(res.statusCode).toBe(200);
    expect(capturedBodies.length).toBeGreaterThan(0);
    expect(analysisBodies()).toHaveLength(1);
    expect(flipProbeBodies()).toHaveLength(0);
  });
});
