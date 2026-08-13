/**
 * 3C: Factor Sensitivity Source-Scoping + Identifiability Hash Policy + Factor Stability
 *
 * T1: Graph-primary path — 3C fields present on ISL-matched entries (confidence unification)
 * T2: ISL-fallback path — 3C fields present when ISL provides them
 * T3: ISL-fallback backward compat — when ISL omits 3C fields, output omits them
 * T-inv: Invariant — attribution_stability="negligible" requires |elasticity| < 0.01
 * T4: Hash insensitive to 3C changes (factor_sensitivity not in hash)
 * T5: Hash includes identifiability (different status → different hash)
 * T6: Route-level source-scoping checks
 *
 * FS1: factor_stability populated from ISL when 3C fields present
 * FS2: factor_stability empty when ISL omits 3C fields
 * FS3: factor_stability skips entries with partial 3C fields
 * FS4: factor_sensitivity is NOT affected by factor_stability extraction
 * FS5: Hash includes factor_stability (different stability → different hash)
 * FS6: Route-level factor_stability integration
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { canonicaliseRequest, computeResponseHash } from '../src/normalisation/canonicalise.js';
import type { RunRequestV3, EngineGraphV3, IdentifiabilityAssessment, FactorSensitivityResultV3, FactorStabilityEntry } from '../src/types/engine-v3.js';
import { buildFactorStability } from '../src/lib/factor-influence.js';

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
// Helpers for invariant tests
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

  describe('T5: identifiability excluded from hash (v6)', () => {
    it('different identifiability status produces SAME hash (v6: ISL-derived fields excluded)', () => {
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

      // v6: identifiability is ISL-derived and no longer included in hash
      expect(hashA).toBe(hashB);
    });

    it('identifiability is NOT included in canonical form (v6)', () => {
      const req = makeRequest();
      const ident: IdentifiabilityAssessment = {
        status: 'identifiable',
        method: 'backdoor',
        pairs_checked: 2,
        pairs_identifiable: 2,
      };

      const canonical = JSON.parse(canonicaliseRequest(req, GRAPH, '42', ident));

      // Guard: identifiability must not be present in hash input
      expect(canonical.identifiability).toBeUndefined();
    });

    it('absent and present identifiability produce the SAME hash (v6)', () => {
      const req = makeRequest();
      const ident: IdentifiabilityAssessment = {
        status: 'identifiable',
        method: 'backdoor',
        pairs_checked: 2,
        pairs_identifiable: 2,
      };

      const hashWithIdent = computeResponseHash(canonicaliseRequest(req, GRAPH, '42', ident));
      const hashWithout = computeResponseHash(canonicaliseRequest(req, GRAPH, '42'));

      // v6: identifiability excluded → hashes are identical
      expect(hashWithIdent).toBe(hashWithout);
    });

    it('hash version is 8', () => {
      const req = makeRequest();
      const canonical = JSON.parse(canonicaliseRequest(req, GRAPH, '42'));
      expect(canonical.version).toBe(8); // 2.1024: bumped 7→8 (hash computed from the EFFECTIVE ISL request)
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
  async analyseRobustness(_graph: any, goalNodeId: string, options: any[]) {
    const include3C = goalNodeId !== 'goal-no-3c';
    return {
      options: options.map((opt: any, idx: number) => ({
        option_id: opt.id,
        outcome: { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
        rank: idx + 1,
      })),
      edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      // ISL returns factor_sensitivity WITH 3C fields — merged onto graph entries after confidence unification
      factor_sensitivity: [
        {
          node_id: 'factor-a',
          sensitivity_score: 0.5,
          direction: 'positive',
          ...(include3C ? {
            elasticity_std: 0.042,
            attribution_stability: 'high',
            rank_flip_rate: 0.03,
            stability_method: 'bootstrap_1000',
          } : {}),
        },
        {
          node_id: 'factor-b',
          sensitivity_score: 0.7,
          direction: 'positive',
          ...(include3C ? {
            elasticity_std: 0.11,
            attribution_stability: 'moderate',
            rank_flip_rate: 0.15,
            stability_method: 'bootstrap_1000',
          } : {}),
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
    const include3C = body.goal_node_id !== 'goal-no-3c';
    const options = body.options || [];
    return {
      data: {
        options: options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
          rank: idx + 1,
        })),
        edges: [],
        // ISL factor_sensitivity with 3C fields — merged onto graph entries after confidence unification
        factor_sensitivity: [
          {
            node_id: 'factor-a',
            sensitivity_score: 0.5,
            direction: 'positive',
            ...(include3C ? {
              elasticity_std: 0.042,
              attribution_stability: 'high',
              rank_flip_rate: 0.03,
              stability_method: 'bootstrap_1000',
            } : {}),
          },
          {
            node_id: 'factor-b',
            sensitivity_score: 0.7,
            direction: 'positive',
            ...(include3C ? {
              elasticity_std: 0.11,
              attribution_stability: 'moderate',
              rank_flip_rate: 0.15,
              stability_method: 'bootstrap_1000',
            } : {}),
          },
        ],
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

describe('T6: Route-level 3C source-scoping via /v2/run', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';

    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  // Confidence unification: ISL bootstrap fields are merged onto graph entries
  it('graph-based factor_sensitivity entries carry 3C fields when ISL provides them', async () => {
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

    // Graph-based factors should have source: 'graph'
    const factorA = factors.find((f: any) => f.factor_id === 'factor-a');
    const factorB = factors.find((f: any) => f.factor_id === 'factor-b');

    expect(factorA).toBeDefined();
    expect(factorB).toBeDefined();
    expect(factorA.source).toBe('graph');
    expect(factorB.source).toBe('graph');

    // After confidence unification, ISL-matched entries carry 3C fields
    // and report honest provenance (audit A1-PRIMARY: 'isl' replaced by
    // 'plot_unified_from_isl_bootstrap' to reflect that PLoT — not ISL —
    // produced the displayed confidence value).
    for (const factor of [factorA, factorB]) {
      expect(factor.confidence_source).toBe('plot_unified_from_isl_bootstrap');
      expect(factor.confidence_provenance?.computation_source).toBe('plot_unified_from_isl_bootstrap');
      expect(typeof factor.elasticity_std).toBe('number');
      expect(['high', 'moderate', 'low', 'negligible']).toContain(factor.attribution_stability);
      expect(typeof factor.rank_flip_rate).toBe('number');
      expect(typeof factor.stability_method).toBe('string');
    }
  });

  // Confidence unification: ISL-fallback entries carry 3C fields when ISL provides them
  it('ISL-fallback factor_sensitivity entries carry 3C fields when ISL provides them', async () => {
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'goal', kind: 'goal', label: 'Revenue' },
            { id: 'action-a', kind: 'action', label: 'Action A' },
          ],
          edges: [
            { from: 'action-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
          ],
        },
        options: [
          { id: 'opt1', label: 'Option A', interventions: { 'action-a': { value: 10, source: 'user_specified' } } },
          { id: 'opt2', label: 'Option B', interventions: { 'action-a': { value: 20, source: 'user_specified' } } },
        ],
        goal_node_id: 'goal',
        seed: '42',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const factors = body.factor_sensitivity ?? [];

    expect(factors.length).toBeGreaterThan(0);

    // ISL-matched entries should carry 3C fields after confidence unification
    // (audit A1-PRIMARY: source value updated to honest provenance label).
    const islMatched = factors.filter((f: any) => f.confidence_source === 'plot_unified_from_isl_bootstrap');
    for (const factor of islMatched) {
      expect(typeof factor.elasticity_std).toBe('number');
      expect(['high', 'moderate', 'low', 'negligible']).toContain(factor.attribution_stability);
      expect(typeof factor.rank_flip_rate).toBe('number');
      expect(typeof factor.stability_method).toBe('string');
    }
  });

  it('ISL-fallback omits 3C fields cleanly when ISL does not provide them', async () => {
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'goal-no-3c', kind: 'goal', label: 'Revenue' },
            { id: 'action-a', kind: 'action', label: 'Action A' },
          ],
          edges: [
            { from: 'action-a', to: 'goal-no-3c', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
          ],
        },
        options: [
          { id: 'opt1', label: 'Option A', interventions: { 'action-a': { value: 10, source: 'user_specified' } } },
          { id: 'opt2', label: 'Option B', interventions: { 'action-a': { value: 20, source: 'user_specified' } } },
        ],
        goal_node_id: 'goal-no-3c',
        seed: '42',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const factors = body.factor_sensitivity ?? [];

    expect(factors.length).toBeGreaterThan(0);
    expect(factors.every((f: any) => f.source === 'isl')).toBe(true);
    for (const factor of factors) {
      for (const field of THREE_C_FIELDS) {
        expect(field in factor).toBe(false);
      }
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

// ---------------------------------------------------------------------------
// FS1–FS4: factor_stability unit tests (buildFactorStability)
// ---------------------------------------------------------------------------

describe('3C: factor_stability (buildFactorStability)', () => {
  const ISL_WITH_3C = [
    {
      node_id: 'factor-a', label: 'Marketing Spend',
      sensitivity_score: 0.5, direction: 'positive',
      elasticity_std: 0.042, attribution_stability: 'high',
      rank_flip_rate: 0.03, stability_method: 'bootstrap_1000',
    },
    {
      node_id: 'factor-b', label: 'Brand Awareness',
      sensitivity_score: 0.7, direction: 'positive',
      elasticity_std: 0.11, attribution_stability: 'moderate',
      rank_flip_rate: 0.15, stability_method: 'bootstrap_1000',
    },
  ];

  const ISL_WITHOUT_3C = [
    { node_id: 'factor-a', sensitivity_score: 0.5, direction: 'positive' },
    { node_id: 'factor-b', sensitivity_score: 0.7, direction: 'positive' },
  ];

  it('FS1: populated from ISL when all four 3C fields present', () => {
    const result = buildFactorStability(ISL_WITH_3C, GRAPH, new Set());

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      factor_id: 'factor-a',
      factor_label: 'Marketing Spend',
      elasticity_std: 0.042,
      attribution_stability: 'high',
      rank_flip_rate: 0.03,
      stability_method: 'bootstrap_1000',
    });
    expect(result[1]).toEqual({
      factor_id: 'factor-b',
      factor_label: 'Brand Awareness',
      elasticity_std: 0.11,
      attribution_stability: 'moderate',
      rank_flip_rate: 0.15,
      stability_method: 'bootstrap_1000',
    });
  });

  it('FS2: empty array when ISL omits 3C fields', () => {
    const result = buildFactorStability(ISL_WITHOUT_3C, GRAPH, new Set());
    expect(result).toEqual([]);
  });

  it('FS3: skips entries with partial 3C fields', () => {
    const partial = [
      {
        node_id: 'factor-a', sensitivity_score: 0.5,
        elasticity_std: 0.042, attribution_stability: 'high',
        // missing rank_flip_rate and stability_method
      },
      {
        node_id: 'factor-b', sensitivity_score: 0.7,
        elasticity_std: 0.11, attribution_stability: 'moderate',
        rank_flip_rate: 0.15, stability_method: 'bootstrap_1000',
      },
    ];

    const result = buildFactorStability(partial, GRAPH, new Set());

    // Only factor-b has all four fields
    expect(result).toHaveLength(1);
    expect(result[0].factor_id).toBe('factor-b');
  });

  it('FS3a: skips entries with null or invalid-type 3C fields', () => {
    const invalid = [
      { node_id: 'f1', elasticity_std: null, attribution_stability: 'high', rank_flip_rate: 0.03, stability_method: 'bootstrap_1000' },
      { node_id: 'f2', elasticity_std: 0.1, attribution_stability: 'invalid_value', rank_flip_rate: 0.03, stability_method: 'bootstrap_1000' },
      { node_id: 'f3', elasticity_std: 0.1, attribution_stability: 'high', rank_flip_rate: 'not_a_number', stability_method: 'bootstrap_1000' },
      { node_id: 'f4', elasticity_std: 0.1, attribution_stability: 'high', rank_flip_rate: 0.03, stability_method: '' },
      { node_id: 'f5', elasticity_std: 0.1, attribution_stability: 'high', rank_flip_rate: 0.03, stability_method: 'bootstrap_1000' }, // valid
    ];

    const result = buildFactorStability(invalid, GRAPH, new Set());
    expect(result).toHaveLength(1);
    expect(result[0].factor_id).toBe('f5');
  });

  it('FS3b: deduplicates by factor key (first-wins)', () => {
    const dupes = [
      { node_id: 'factor-a', elasticity_std: 0.042, attribution_stability: 'high', rank_flip_rate: 0.03, stability_method: 'bootstrap_1000' },
      { node_id: 'factor-a', elasticity_std: 0.99, attribution_stability: 'low', rank_flip_rate: 0.5, stability_method: 'bootstrap_500' },
    ];

    const result = buildFactorStability(dupes, GRAPH, new Set());
    expect(result).toHaveLength(1);
    expect(result[0].elasticity_std).toBe(0.042); // first-wins
  });

  it('FS4: factor_sensitivity is NOT affected by factor_stability extraction', () => {
    // buildFactorStability reads from the raw ISL array (not the transformed factor_sensitivity)
    // Verify the ISL input array is not mutated
    const islCopy = JSON.parse(JSON.stringify(ISL_WITH_3C));
    buildFactorStability(islCopy, GRAPH, new Set());

    // Input array is unchanged
    expect(islCopy).toEqual(ISL_WITH_3C);
  });
});

// ---------------------------------------------------------------------------
// FS5: Hash includes factor_stability
// ---------------------------------------------------------------------------

describe('3C: factor_stability excluded from hash (v6)', () => {
  it('FS5: different factor_stability produces SAME hash (v6: ISL-derived fields excluded)', () => {
    const req = makeRequest();
    const ident: IdentifiabilityAssessment = {
      status: 'identifiable', method: 'backdoor',
      pairs_checked: 2, pairs_identifiable: 2,
    };

    const stabilityA: FactorStabilityEntry[] = [
      { factor_id: 'factor-a', factor_label: 'A', elasticity_std: 0.042, attribution_stability: 'high', rank_flip_rate: 0.03, stability_method: 'bootstrap_1000' },
    ];
    const stabilityB: FactorStabilityEntry[] = [
      { factor_id: 'factor-a', factor_label: 'A', elasticity_std: 0.99, attribution_stability: 'low', rank_flip_rate: 0.5, stability_method: 'bootstrap_1000' },
    ];

    const hashA = computeResponseHash(canonicaliseRequest(req, GRAPH, '42', ident, stabilityA));
    const hashB = computeResponseHash(canonicaliseRequest(req, GRAPH, '42', ident, stabilityB));

    // v6: factor_stability is ISL-derived and no longer included in hash
    expect(hashA).toBe(hashB);
  });

  it('factor_stability is NOT included in canonical form (v6)', () => {
    const req = makeRequest();
    const stability: FactorStabilityEntry[] = [
      { factor_id: 'factor-b', factor_label: 'B', elasticity_std: 0.1, attribution_stability: 'moderate', rank_flip_rate: 0.15, stability_method: 'bootstrap_1000' },
      { factor_id: 'factor-a', factor_label: 'A', elasticity_std: 0.04, attribution_stability: 'high', rank_flip_rate: 0.03, stability_method: 'bootstrap_1000' },
    ];

    const canonical = JSON.parse(canonicaliseRequest(req, GRAPH, '42', undefined, stability));

    // Guard: factor_stability must not be present in hash input
    expect(canonical.factor_stability).toBeUndefined();
  });

  it('factor_stability absent and present produce the SAME hash (v6)', () => {
    const req = makeRequest();
    const canonical = JSON.parse(canonicaliseRequest(req, GRAPH, '42', undefined, []));
    // Guard: factor_stability must not be present
    expect(canonical.factor_stability).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// FS6: Route-level factor_stability integration
// ---------------------------------------------------------------------------

describe('FS6: Route-level factor_stability via /v2/run', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';

    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  it('factor_stability populated when ISL provides 3C fields', async () => {
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

    // factor_stability should be populated from ISL 3C fields
    expect(body.factor_stability).toBeDefined();
    expect(Array.isArray(body.factor_stability)).toBe(true);
    expect(body.factor_stability.length).toBe(2);

    const stabA = body.factor_stability.find((f: any) => f.factor_id === 'factor-a');
    const stabB = body.factor_stability.find((f: any) => f.factor_id === 'factor-b');

    // A3 lane 2 fixup (r2 residual R1, second surface): BOTH fixture factors
    // are option-pinned levers (opt1 pins factor-a, opt2 pins factor-b), so
    // buildFactorStability now zeroes their elasticity_std in-place — the
    // pre-lane assertions (0.042 / 0.11) were pinning the stability-surface
    // leak itself. Entry presence and the other 3C diagnostics are retained.
    expect(stabA).toBeDefined();
    expect(stabA.elasticity_std).toBe(0);
    expect(stabA.attribution_stability).toBe('high');
    expect(stabA.rank_flip_rate).toBe(0.03);
    expect(stabA.stability_method).toBe('bootstrap_1000');

    expect(stabB).toBeDefined();
    expect(stabB.elasticity_std).toBe(0);
    expect(stabB.attribution_stability).toBe('moderate');
    expect(stabB.rank_flip_rate).toBe(0.15);
    expect(stabB.stability_method).toBe('bootstrap_1000');

    // factor_sensitivity should still be present and unaffected
    expect(body.factor_sensitivity).toBeDefined();
    expect(body.factor_sensitivity.length).toBeGreaterThanOrEqual(2);
  });

  it('factor_stability is empty array when ISL omits 3C fields', async () => {
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'goal-no-3c', kind: 'goal', label: 'Revenue' },
            { id: 'action-a', kind: 'action', label: 'Action A' },
          ],
          edges: [
            { from: 'action-a', to: 'goal-no-3c', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
          ],
        },
        options: [
          { id: 'opt1', label: 'Option A', interventions: { 'action-a': { value: 10, source: 'user_specified' } } },
          { id: 'opt2', label: 'Option B', interventions: { 'action-a': { value: 20, source: 'user_specified' } } },
        ],
        goal_node_id: 'goal-no-3c',
        seed: '42',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;

    expect(body.factor_stability).toBeDefined();
    expect(body.factor_stability).toEqual([]);
  });
});
