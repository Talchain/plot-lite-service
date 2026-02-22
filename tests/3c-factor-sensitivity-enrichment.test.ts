/**
 * 3C: Factor Sensitivity Source-Scoping + Identifiability Hash Policy
 *
 * T1: enrichGraphFactorsWithISL3C is a no-op — 3C fields NOT copied to graph entries
 * T2: Backward compat — ISL without 3C fields → clean omission, no nulls
 * T3: Graph entries never carry 3C fields, even when ISL match exists
 * T-inv: Invariant — attribution_stability="negligible" requires |elasticity| < 0.01
 * T4: Hash insensitive to 3C changes (factor_sensitivity not in hash)
 * T5: Hash includes identifiability (different status → different hash)
 * T6: Route-level — /v2/run graph-based entries do NOT carry ISL 3C fields
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { canonicaliseRequest, computeResponseHash } from '../src/normalisation/canonicalise.js';
import { enrichGraphFactorsWithISL3C } from '../src/lib/factor-influence.js';
import type { RunRequestV3, EngineGraphV3, IdentifiabilityAssessment, FactorSensitivityResultV3 } from '../src/types/engine-v3.js';

// ---------------------------------------------------------------------------
// Fixtures for unit tests (T1–T5)
// ---------------------------------------------------------------------------

const GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'factor-a', kind: 'factor', label: 'Marketing Spend', observed_state: { value: 0.6 } },
    { id: 'factor-b', kind: 'factor', label: 'Brand Awareness', observed_state: { value: 0.5 } },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
    { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt1', label: 'Option A', interventions: { 'factor-a': { value: 10, source: 'user_specified' } } },
  { id: 'opt2', label: 'Option B', interventions: { 'factor-b': { value: 5, source: 'user_specified' } } },
];

function makeRequest(overrides: Partial<RunRequestV3> = {}): RunRequestV3 {
  return {
    graph: GRAPH,
    options: OPTIONS,
    goal_node_id: 'goal',
    seed: '42',
    ...overrides,
  } as RunRequestV3;
}

// ---------------------------------------------------------------------------
// T1–T3: enrichGraphFactorsWithISL3C — now a no-op guard
// ---------------------------------------------------------------------------

/** Minimal graph factor for testing */
function graphFactor(id: string, overrides: Partial<FactorSensitivityResultV3> = {}): FactorSensitivityResultV3 {
  return {
    factor_id: id,
    factor_label: id,
    sensitivity_score: 0.5,
    influence_score: 0.5,
    elasticity: 0.5,
    direction: 'positive',
    importance_rank: 1,
    influence_rank: 1,
    confidence: 0.7,
    value_of_information: 0,
    source: 'graph',
    ...overrides,
  };
}

/** Minimal ISL factor for testing */
function islFactor(id: string, overrides: Partial<FactorSensitivityResultV3> = {}): FactorSensitivityResultV3 {
  return {
    factor_id: id,
    factor_label: id,
    sensitivity_score: 0.5,
    influence_score: null as any,
    elasticity: null as any,
    direction: 'positive',
    importance_rank: 1,
    influence_rank: null as any,
    confidence: null as any,
    value_of_information: null as any,
    source: 'isl',
    ...overrides,
  };
}

const THREE_C_FIELDS = ['elasticity_std', 'attribution_stability', 'rank_flip_rate', 'stability_method'] as const;

describe('3C: Factor sensitivity source-scoping (enrichGraphFactorsWithISL3C is no-op)', () => {
  describe('T1: 3C fields are NOT copied from ISL to graph entries', () => {
    it('graph entries remain clean even when ISL provides all 4 stability fields', () => {
      const graph = [graphFactor('factor-a'), graphFactor('factor-b')];
      const isl = [
        islFactor('factor-a', {
          elasticity_std: 0.042,
          attribution_stability: 'high',
          rank_flip_rate: 0.03,
          stability_method: 'bootstrap_1000',
        }),
        islFactor('factor-b', {
          elasticity_std: 0.11,
          attribution_stability: 'moderate',
          rank_flip_rate: 0.15,
          stability_method: 'bootstrap_1000',
        }),
      ];

      const result = enrichGraphFactorsWithISL3C(graph, isl);

      expect(result).toHaveLength(2);

      // Neither factor should have 3C fields
      for (const entry of result) {
        expect(entry.source).toBe('graph');
        for (const field of THREE_C_FIELDS) {
          expect(field in entry).toBe(false);
        }
      }
    });

    it('preserves all original graph fields (scores, direction, source)', () => {
      const graph = [graphFactor('factor-a', { sensitivity_score: 0.9, direction: 'negative', confidence: 0.85 })];
      const isl = [islFactor('factor-a', { elasticity_std: 0.05, attribution_stability: 'high' })];

      const result = enrichGraphFactorsWithISL3C(graph, isl);

      expect(result[0].sensitivity_score).toBe(0.9);
      expect(result[0].direction).toBe('negative');
      expect(result[0].confidence).toBe(0.85);
      expect(result[0].source).toBe('graph');
      // 3C fields NOT present
      for (const field of THREE_C_FIELDS) {
        expect(field in result[0]).toBe(false);
      }
    });
  });

  describe('T2: Backward compat — ISL without 3C fields → clean omission', () => {
    it('returns graph factors unchanged when ISL provides no 3C fields', () => {
      const graph = [graphFactor('factor-a')];
      const isl = [islFactor('factor-a')]; // no 3C fields

      const result = enrichGraphFactorsWithISL3C(graph, isl);

      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('graph');
      for (const field of THREE_C_FIELDS) {
        expect(field in result[0]).toBe(false);
      }
    });

    it('returns graph factors unchanged when ISL array is undefined', () => {
      const graph = [graphFactor('factor-a')];

      const result = enrichGraphFactorsWithISL3C(graph, undefined);

      // Should return same array reference (short-circuit)
      expect(result).toBe(graph);
    });

    it('returns graph factors unchanged when ISL array is empty', () => {
      const graph = [graphFactor('factor-a')];

      const result = enrichGraphFactorsWithISL3C(graph, []);

      expect(result).toBe(graph);
    });
  });

  describe('T3: Graph entries never carry 3C fields, even when ISL match exists', () => {
    it('matched and unmatched graph factors both lack 3C fields', () => {
      const graph = [graphFactor('factor-a'), graphFactor('factor-c')];
      const isl = [
        islFactor('factor-a', {
          elasticity_std: 0.05,
          attribution_stability: 'high',
          rank_flip_rate: 0.03,
          stability_method: 'bootstrap_1000',
        }),
      ];

      const result = enrichGraphFactorsWithISL3C(graph, isl);

      // Both factors: no 3C fields
      for (const entry of result) {
        expect(entry.source).toBe('graph');
        for (const field of THREE_C_FIELDS) {
          expect(field in entry).toBe(false);
        }
      }

      // Original data preserved
      expect(result[0].factor_id).toBe('factor-a');
      expect(result[1].factor_id).toBe('factor-c');
    });
  });
});

// ---------------------------------------------------------------------------
// T-inv: Scale mismatch invariant
// ---------------------------------------------------------------------------

describe('3C: Scale mismatch invariant', () => {
  it('attribution_stability="negligible" requires |elasticity| < 0.01 on the same entry', () => {
    // This invariant catches the bug: graph-derived elasticity=1.0 should
    // never coexist with ISL's attribution_stability="negligible" on the
    // same factor_sensitivity entry.
    const entries: FactorSensitivityResultV3[] = [
      graphFactor('factor-a', { elasticity: 1.0 }),
      graphFactor('factor-b', { elasticity: 0.005, attribution_stability: 'negligible' }),
      islFactor('factor-c', { elasticity: 0.0, attribution_stability: 'negligible' }),
    ];

    for (const entry of entries) {
      if (entry.attribution_stability === 'negligible') {
        expect(
          Math.abs(entry.elasticity ?? 0),
          `factor ${entry.factor_id}: attribution_stability="negligible" but |elasticity|=${Math.abs(entry.elasticity ?? 0)} >= 0.01 — scale mismatch`
        ).toBeLessThan(0.01);
      }
    }
  });

  it('graph-derived entry with high elasticity must not have negligible stability', () => {
    // Simulates the bug scenario from debug bundles 739a0444 / e5d9aba1
    const graphEntry = graphFactor('price', { elasticity: 1.0 });

    // This is what the OLD code would have done — copy ISL's "negligible"
    // onto a graph row with elasticity=1.0. Verify the invariant catches it.
    const badEntry = { ...graphEntry, attribution_stability: 'negligible' as const };

    // Invariant violation: elasticity=1.0 with attribution_stability="negligible"
    if (badEntry.attribution_stability === 'negligible') {
      expect(Math.abs(badEntry.elasticity ?? 0)).not.toBeLessThan(0.01);
    }
  });
});

// ---------------------------------------------------------------------------
// T4–T5: Hash policy tests
// ---------------------------------------------------------------------------

describe('3C: Response hash policy', () => {
  describe('T4: Hash is insensitive to 3C field changes (factor_sensitivity not in hash)', () => {
    it('identical requests produce same hash regardless of factor_sensitivity content', () => {
      const req = makeRequest();

      // Compute hash — canonicaliseRequest only uses graph/options/seed/goal/identifiability
      const hash1 = computeResponseHash(canonicaliseRequest(req, GRAPH, '42'));
      const hash2 = computeResponseHash(canonicaliseRequest(req, GRAPH, '42'));

      // Same request → same hash (factor_sensitivity is NOT in canonical form)
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{16}$/);

      // Verify factor_sensitivity is NOT in canonical form
      const canonical = JSON.parse(canonicaliseRequest(req, GRAPH, '42'));
      expect(canonical).not.toHaveProperty('factor_sensitivity');
    });
  });

  describe('T5: Hash includes identifiability (v4)', () => {
    it('different identifiability status produces different hash', () => {
      const req = makeRequest();

      const identIdentifiable: IdentifiabilityAssessment = {
        status: 'identifiable',
        method: 'backdoor',
        pairs_checked: 2,
        pairs_identifiable: 2,
      };

      const identNotIdentifiable: IdentifiabilityAssessment = {
        status: 'not_backdoor_identifiable',
        method: 'backdoor',
        pairs_checked: 2,
        pairs_identifiable: 0,
      };

      const hashA = computeResponseHash(canonicaliseRequest(req, GRAPH, '42', identIdentifiable));
      const hashB = computeResponseHash(canonicaliseRequest(req, GRAPH, '42', identNotIdentifiable));

      expect(hashA).not.toBe(hashB);
    });

    it('identifiability is included in canonical form', () => {
      const req = makeRequest();
      const ident: IdentifiabilityAssessment = {
        status: 'identifiable',
        method: 'backdoor',
        pairs_checked: 2,
        pairs_identifiable: 2,
      };

      const canonical = JSON.parse(canonicaliseRequest(req, GRAPH, '42', ident));

      expect(canonical.identifiability).toBeDefined();
      expect(canonical.identifiability.status).toBe('identifiable');
      expect(canonical.identifiability.pairs_checked).toBe(2);
      expect(canonical.identifiability.pairs_identifiable).toBe(2);
    });

    it('absent identifiability produces different hash from present', () => {
      const req = makeRequest();
      const ident: IdentifiabilityAssessment = {
        status: 'identifiable',
        method: 'backdoor',
        pairs_checked: 2,
        pairs_identifiable: 2,
      };

      const hashWithIdent = computeResponseHash(canonicaliseRequest(req, GRAPH, '42', ident));
      const hashWithout = computeResponseHash(canonicaliseRequest(req, GRAPH, '42'));

      expect(hashWithIdent).not.toBe(hashWithout);
    });

    it('hash version is 4', () => {
      const req = makeRequest();
      const canonical = JSON.parse(canonicaliseRequest(req, GRAPH, '42'));
      expect(canonical.version).toBe(4);
    });
  });
});

// ---------------------------------------------------------------------------
// T6: Route-level integration test
// ---------------------------------------------------------------------------

// ISL mock that returns factor_sensitivity WITH 3C fields
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
      // ISL returns factor_sensitivity WITH 3C fields — these must NOT bleed into graph-source entries
      factor_sensitivity: [
        {
          node_id: 'factor-a',
          sensitivity_score: 0.5,
          direction: 'positive',
          elasticity_std: 0.042,
          attribution_stability: 'high',
          rank_flip_rate: 0.03,
          stability_method: 'bootstrap_1000',
        },
        {
          node_id: 'factor-b',
          sensitivity_score: 0.7,
          direction: 'positive',
          elasticity_std: 0.11,
          attribution_stability: 'moderate',
          rank_flip_rate: 0.15,
          stability_method: 'bootstrap_1000',
        },
      ],
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
    const options = body.options || [];
    return {
      data: {
        options: options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
          rank: idx + 1,
        })),
        edges: [],
        // ISL factor_sensitivity with 3C fields — must NOT appear on graph-source entries
        factor_sensitivity: [
          {
            node_id: 'factor-a',
            sensitivity_score: 0.5,
            direction: 'positive',
            elasticity_std: 0.042,
            attribution_stability: 'high',
            rank_flip_rate: 0.03,
            stability_method: 'bootstrap_1000',
          },
          {
            node_id: 'factor-b',
            sensitivity_score: 0.7,
            direction: 'positive',
            elasticity_std: 0.11,
            attribution_stability: 'moderate',
            rank_flip_rate: 0.15,
            stability_method: 'bootstrap_1000',
          },
        ],
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

describe('T6: Route-level 3C source-scoping via /v2/run', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLE = '0';

    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLE;
  });

  it('graph-based factor_sensitivity entries do NOT carry ISL 3C fields', async () => {
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: GRAPH,
        options: OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;

    // factor_sensitivity should be present (graph computes it for this graph)
    const factors = body.factor_sensitivity;
    expect(factors).toBeDefined();
    expect(Array.isArray(factors)).toBe(true);
    expect(factors.length).toBeGreaterThanOrEqual(2);

    // Graph-based factors should have source: 'graph' and NO 3C fields
    const factorA = factors.find((f: any) => f.factor_id === 'factor-a');
    const factorB = factors.find((f: any) => f.factor_id === 'factor-b');

    expect(factorA).toBeDefined();
    expect(factorB).toBeDefined();
    expect(factorA.source).toBe('graph');
    expect(factorB.source).toBe('graph');

    // 3C fields must NOT be present on graph-source entries
    for (const factor of [factorA, factorB]) {
      expect(factor.elasticity_std).toBeUndefined();
      expect(factor.attribution_stability).toBeUndefined();
      expect(factor.rank_flip_rate).toBeUndefined();
      expect(factor.stability_method).toBeUndefined();
    }
  });

  it('response includes identifiability and response_hash', async () => {
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: GRAPH,
        options: OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;

    // Identifiability should be present
    expect(body.identifiability).toBeDefined();
    expect(body.identifiability.status).toBeDefined();
    expect(body.identifiability.pairs_checked).toBeGreaterThanOrEqual(0);

    // Response hash should be present (16-char hex)
    const hash = body.model_card?.response_hash ?? body.response_hash;
    expect(hash).toBeDefined();
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
});
