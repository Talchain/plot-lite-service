/**
 * HTTP-Level Normalisation Parity Tests
 *
 * Verifies that /v1/validate-patch and /v2/run produce identical normalised
 * graphs when given the same input. Catches wrapper drift — pre/post-normaliser
 * transforms, input canonicalisation differences, or extra defaults applied by
 * one endpoint but not the other.
 *
 * Strategy:
 *   - Mock ISL to capture the graph /v2/run sends downstream
 *   - Call /v1/validate-patch with the same starting graph
 *   - Assert the normalised graphs match on all key fields (ids, kinds, labels, coefficients)
 *
 * Only 2 test cases: the goal is wrapper drift detection, not re-testing
 * the normaliser.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// ISL mock — captures the graph sent to ISL by /v2/run
// ---------------------------------------------------------------------------

let capturedISLGraph: any = null;

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high',
      adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return {
      options: options.map((opt: any, idx: number) => ({
        option_id: opt.id,
        outcome: { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
        rank: idx + 1,
      })),
      edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factor_sensitivity: [],
      factors: [], value_of_information: [],
      factors_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      factor_sensitivity_status: 'available' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.8,
      fragile_edges: [], robust_edges: [], latency_ms: 50, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null; isl_echoed_request_id?: string }> {
    // Capture the graph from the ISL request
    capturedISLGraph = body.graph;

    const options = body.options || [];
    return {
      data: {
        options: options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
          rank: idx + 1,
        })),
        edges: [],
        factor_sensitivity: [],
        overall_robustness: 'robust', robustness_score: 0.8,
        fragile_edges: [], robust_edges: [],
      } as T,
      error: null,
    };
  },
};

vi.mock('../src/integrations/isl/index.js', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.js');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';
import { registerValidatePatchRoute } from '../src/routes/v1/validate-patch.js';
import Fastify from 'fastify';

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe('HTTP normalisation parity: /v2/run vs /v1/validate-patch', () => {
  let runApp: FastifyInstance;
  let runBaseUrl: string;
  let vpApp: FastifyInstance;

  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    // Save previous values so afterAll restores (not clobbers) them
    for (const key of ['RATE_LIMIT_ENABLED', 'CEE_ORCHESTRATOR_ENABLE', 'ENABLE_VALIDATE_PATCH']) {
      savedEnv[key] = process.env[key];
    }
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLE = '0';
    process.env.ENABLE_VALIDATE_PATCH = '1';

    // Full server for /v2/run (needs ISL mock, full middleware stack)
    runApp = await createServer();
    await runApp.listen({ port: 0, host: '127.0.0.1' });
    const addr = runApp.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    runBaseUrl = `http://127.0.0.1:${port}`;

    // Lightweight Fastify for /v1/validate-patch (no ISL needed)
    vpApp = Fastify();
    await registerValidatePatchRoute(vpApp);
    await vpApp.ready();
  });

  afterAll(async () => {
    await runApp?.close();
    await vpApp?.close();
    // Restore previous env values (not delete — avoids clobbering pre-existing values)
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  // =========================================================================
  // Test 1: Graph with repair-triggering fields
  // =========================================================================

  it('normalised graphs match for a graph with missing exists_probability and direction inference', async () => {
    // Graph deliberately triggers DEFAULT_EXISTS_PROBABILITY and INFER_EFFECT_DIRECTION.
    // No option/decision nodes — so v2/run's filteredGraph === normalizedGraph.
    const graph = {
      nodes: [
        { id: 'risk1', kind: 'risk', label: 'Risk Factor' },
        { id: 'factor1', kind: 'factor', label: 'Factor' },
        { id: 'goal', kind: 'goal', label: 'Goal', observed_state: { value: 0.5 } },
      ],
      edges: [
        // Missing exists_probability → DEFAULT_EXISTS_PROBABILITY repair
        // risk node → INFER_EFFECT_DIRECTION (negative)
        { from: 'risk1', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
        // Well-formed edge (no repairs)
        { from: 'factor1', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.15 } },
      ],
    };

    // --- /v2/run: capture normalised graph via ISL mock ---
    capturedISLGraph = null;
    const runRes = await fetch(`${runBaseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph,
        options: [
          { id: 'opt1', label: 'Option A', interventions: { factor1: { value: 0.8, source: 'user_specified' } } },
          { id: 'opt2', label: 'Option B', interventions: { factor1: { value: 0.3, source: 'user_specified' } } },
        ],
        goal_node_id: 'goal',
        seed: '42',
      }),
    });
    expect(runRes.status).toBe(200);
    expect(capturedISLGraph).not.toBeNull();

    // --- /v1/validate-patch: get normalised graph from response ---
    const vpRes = await vpApp.inject({
      method: 'POST',
      url: '/v1/validate-patch',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        graph,
        operations: [],  // No-op patch — just normalise the graph
      },
    });
    expect(vpRes.statusCode).toBe(200);
    const vpBody = vpRes.json();
    expect(vpBody.status).toBe('applied');

    // --- Compare normalised graphs ---
    // Sort nodes and edges by id/from+to for stable comparison
    const sortNodes = (nodes: any[]) => [...nodes].sort((a, b) => a.id.localeCompare(b.id));
    const sortEdges = (edges: any[]) => [...edges].sort((a, b) =>
      `${a.from}->${a.to}`.localeCompare(`${b.from}->${b.to}`)
    );

    const islNodes = sortNodes(capturedISLGraph.nodes);
    const islEdges = sortEdges(capturedISLGraph.edges);
    const vpNodes = sortNodes(vpBody.normalised_graph.nodes);
    const vpEdges = sortEdges(vpBody.normalised_graph.edges);

    // Node-level parity: same ids, kinds, labels
    expect(islNodes.map((n: any) => n.id)).toEqual(vpNodes.map((n: any) => n.id));
    expect(islNodes.map((n: any) => n.kind)).toEqual(vpNodes.map((n: any) => n.kind));
    expect(islNodes.map((n: any) => n.label)).toEqual(vpNodes.map((n: any) => n.label));

    // Edge-level parity: same from/to, identical normalised coefficients
    expect(islEdges.length).toBe(vpEdges.length);
    for (let i = 0; i < islEdges.length; i++) {
      expect(islEdges[i].from).toBe(vpEdges[i].from);
      expect(islEdges[i].to).toBe(vpEdges[i].to);
      expect(islEdges[i].exists_probability).toBe(vpEdges[i].exists_probability);
      expect(islEdges[i].strength.mean).toBe(vpEdges[i].strength.mean);
      expect(islEdges[i].strength.std).toBe(vpEdges[i].strength.std);
    }
  });

  // =========================================================================
  // Test 2: Graph triggering multiple repair codes
  // =========================================================================

  it('normalised graphs match for a graph triggering multiple repairs', async () => {
    // Graph triggers: CLAMP_EXISTS_PROBABILITY, CLAMP_STRENGTH_MEAN,
    // CLAMP_STRENGTH_STD, CLEAN_LABEL_ANNOTATION, DEFAULT_STRENGTH_STD.
    const graph = {
      nodes: [
        { id: 'a', kind: 'factor', label: 'Factor A (0-1)' },  // CLEAN_LABEL_ANNOTATION
        { id: 'b', kind: 'factor', label: 'Factor B' },
        { id: 'goal', kind: 'goal', label: 'Goal', observed_state: { value: 0.5 } },
      ],
      edges: [
        // exists_probability > 1 → CLAMP_EXISTS_PROBABILITY
        // mean > 1 → CLAMP_STRENGTH_MEAN
        // std < 0.05 → CLAMP_STRENGTH_STD
        { from: 'a', to: 'goal', exists_probability: 1.5, strength: { mean: 2.0, std: 0.001 } },
        // Missing std → DEFAULT_STRENGTH_STD
        { from: 'b', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5 } },
      ],
    };

    // --- /v2/run ---
    capturedISLGraph = null;
    const runRes = await fetch(`${runBaseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph,
        options: [
          { id: 'opt1', label: 'Option A', interventions: { a: { value: 0.5, source: 'user_specified' } } },
          { id: 'opt2', label: 'Option B', interventions: { b: { value: 0.5, source: 'user_specified' } } },
        ],
        goal_node_id: 'goal',
        seed: '42',
      }),
    });
    expect(runRes.status).toBe(200);
    expect(capturedISLGraph).not.toBeNull();

    // --- /v1/validate-patch ---
    const vpRes = await vpApp.inject({
      method: 'POST',
      url: '/v1/validate-patch',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        graph,
        operations: [],
      },
    });
    expect(vpRes.statusCode).toBe(200);
    const vpBody = vpRes.json();

    // --- Compare normalised nodes (includes label cleaning parity) ---
    const sortNodes = (nodes: any[]) => [...nodes].sort((a, b) => a.id.localeCompare(b.id));
    const islNodes = sortNodes(capturedISLGraph.nodes);
    const vpNodes = sortNodes(vpBody.normalised_graph.nodes);

    expect(islNodes.map((n: any) => n.id)).toEqual(vpNodes.map((n: any) => n.id));
    expect(islNodes.map((n: any) => n.kind)).toEqual(vpNodes.map((n: any) => n.kind));
    expect(islNodes.map((n: any) => n.label)).toEqual(vpNodes.map((n: any) => n.label));

    // --- Compare normalised edge coefficients ---
    const sortEdges = (edges: any[]) => [...edges].sort((a, b) =>
      `${a.from}->${a.to}`.localeCompare(`${b.from}->${b.to}`)
    );

    const islEdges = sortEdges(capturedISLGraph.edges);
    const vpEdges = sortEdges(vpBody.normalised_graph.edges);

    expect(islEdges.length).toBe(vpEdges.length);
    for (let i = 0; i < islEdges.length; i++) {
      expect(islEdges[i].from).toBe(vpEdges[i].from);
      expect(islEdges[i].to).toBe(vpEdges[i].to);
      expect(islEdges[i].exists_probability).toBe(vpEdges[i].exists_probability);
      expect(islEdges[i].strength.mean).toBe(vpEdges[i].strength.mean);
      expect(islEdges[i].strength.std).toBe(vpEdges[i].strength.std);
    }

    // Verify repairs were actually triggered (not just comparing two no-op paths)
    expect(vpBody.repairs_applied.length).toBeGreaterThanOrEqual(4);
  });
});
