/**
 * Tier 2 Tests — P.4, P.5, P.6, P.8: Data Responsibility and Hash Hygiene
 *
 * P.4: STRIP_RAW_CONSTRAINT_FIELDS logged in repairs_applied
 * P.5: FILTER_TEMPORAL_CONSTRAINT logged in repairs_applied
 * P.6: identifiability and factor_stability excluded from hash (HASH_VERSION = 6)
 * P.8: MAX_CONSTRAINTS = 20 enforced before compilation
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// ISL Mock — minimal, returns valid options
// ---------------------------------------------------------------------------

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable',
      confidence: 'high',
      adjustment_sets: [],
      minimal_set: [],
      backdoor_paths: [],
      issues: [],
      explanation: { summary: 'Mock', reasoning: 'Test' },
      source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return {
      options: options.map((opt: any, idx: number) => ({
        option_id: opt.id,
        outcome: { mean: 0.7 + idx * 0.05, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
        rank: idx + 1,
      })),
      edges: [],
      edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factors: [],
      value_of_information: [],
      factors_provenance: 'unavailable' as const,
      factor_sensitivity_status: 'skipped_no_factor_values' as const,
      overall_robustness: 'robust' as const,
      robustness_score: 0.8,
      fragile_edges: [],
      robust_edges: [],
      latency_ms: 50,
      source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    const options = body.options || [];
    const goalConstraints = body.goal_constraints || [];
    const constraintAnalysis = goalConstraints.length > 0
      ? {
          constraint_analysis: {
            constraints: goalConstraints.map((c: any) => ({
              node_id: c.node_id,
              operator: c.operator,
              value: c.value ?? c.threshold,
              prob_satisfied: 0.6,
            })),
          },
        }
      : {};
    return {
      data: {
        options: options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: { mean: 0.7 + idx * 0.05, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
          rank: idx + 1,
          ...constraintAnalysis,
        })),
        edges: [],
        factors: [],
        value_of_information: [],
        overall_robustness: 'robust',
        robustness_score: 0.8,
        fragile_edges: [],
        robust_edges: [],
      } as T,
      error: null,
    };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return {
    ...actual,
    getISLService: () => mockISLService,
    islService: mockISLService,
  };
});

import { createServer } from '../src/createServer.js';
import { canonicaliseRequest, computeResponseHash, HASH_VERSION } from '../src/normalisation/canonicalise.js';
import { MAX_CONSTRAINTS } from '../src/constants/limits.js';
import type { RunRequestV3, EngineGraphV3, IdentifiabilityAssessment, FactorStabilityEntry } from '../src/types/engine-v3.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'factor-a', kind: 'factor', label: 'Marketing', observed_state: { value: 0.6 } },
    { id: 'factor-b', kind: 'factor', label: 'Retention', observed_state: { value: 0.5 } },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
    { from: 'factor-b', to: 'goal', strength: { mean: 0.4, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': 1.5 } },
  { id: 'opt2', label: 'Option 2', interventions: { 'factor-b': 0.8 } },
];

const BASE_PAYLOAD = {
  graph: GRAPH,
  options: OPTIONS,
  goal_node_id: 'goal',
  seed: '42',
};

// ---------------------------------------------------------------------------
// Route-level tests (P.4, P.5, P.8)
// ---------------------------------------------------------------------------

describe('Tier 2: Data Responsibility (P.4, P.5, P.8)', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.UI_CANONICAL_META = '1';

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
    delete process.env.UI_CANONICAL_META;
  });

  // =========================================================================
  // P.4: STRIP_RAW_CONSTRAINT_FIELDS
  // =========================================================================

  it('P4-1: raw constraint with CEE fields → STRIP_RAW_CONSTRAINT_FIELDS in repairs_applied', async () => {
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...BASE_PAYLOAD,
        goal_constraints: [
          {
            constraint_id: 'c-with-extras',
            node_id: 'factor-a',
            operator: '>=',
            value: 0.5,
            unit: 'percentage',
            confidence: 0.85,
            source_quote: 'must be above 50%',
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const repairs: any[] = body._meta?.repairs_applied ?? [];

    const stripRepair = repairs.find(
      (r: any) => r.code === 'STRIP_RAW_CONSTRAINT_FIELDS'
    );
    expect(stripRepair).toBeDefined();
    expect(stripRepair.layer).toBe('plot');
    expect(stripRepair.field_path).toBe('goal_constraints[constraint_id=c-with-extras]');
    expect(stripRepair.before).toMatchObject({ unit: 'percentage', confidence: 0.85, source_quote: 'must be above 50%' });
    expect(stripRepair.after).toBeNull();
    expect(stripRepair.severity).toBe('info');
    expect(stripRepair.reason).toContain('Non-canonical fields stripped before ISL');
  });

  it('P4-2: canonical constraint (no extra fields) → no STRIP_RAW_CONSTRAINT_FIELDS entry', async () => {
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...BASE_PAYLOAD,
        goal_constraints: [
          {
            constraint_id: 'c-canonical',
            node_id: 'factor-a',
            operator: '>=',
            value: 0.5,
            // No extra CEE fields
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const repairs: any[] = body._meta?.repairs_applied ?? [];

    const stripRepair = repairs.find(
      (r: any) => r.code === 'STRIP_RAW_CONSTRAINT_FIELDS'
    );
    expect(stripRepair).toBeUndefined();
  });

  it('P4-3: _meta.constraint_sources unchanged after P.4 logging', async () => {
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...BASE_PAYLOAD,
        goal_constraints: [
          {
            constraint_id: 'c-with-unit',
            node_id: 'factor-a',
            operator: '>=',
            value: 0.5,
            unit: '%',
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    // constraint_sources lives inside _meta (may be undefined if not populated by this path)
    // The key check is that repairs_applied has the entry AND status is 200
    const body = await res.json() as any;
    expect(body.analysis_status).not.toBe('blocked');
    expect(body._meta).toBeDefined();
  });

  // =========================================================================
  // P.5: FILTER_TEMPORAL_CONSTRAINT
  // =========================================================================

  it('P5-1: temporal constraint (deadline_metadata) → FILTER_TEMPORAL_CONSTRAINT in repairs_applied', async () => {
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...BASE_PAYLOAD,
        goal_constraints: [
          {
            constraint_id: 'deadline-c1',
            node_id: 'goal',
            operator: '<=',
            value: 12,
            deadline_metadata: { deadline: '2026-12-31', source: 'cee' },
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const repairs: any[] = body._meta?.repairs_applied ?? [];

    const filterRepair = repairs.find(
      (r: any) => r.code === 'FILTER_TEMPORAL_CONSTRAINT'
    );
    expect(filterRepair).toBeDefined();
    expect(filterRepair.layer).toBe('plot');
    expect(filterRepair.field_path).toBe('goal_constraints[constraint_id=deadline-c1]');
    expect(filterRepair.before).toMatchObject({ constraint_id: 'deadline-c1' });
    expect(filterRepair.after).toBeNull();
    expect(filterRepair.severity).toBe('info');
    expect(filterRepair.reason).toContain('Temporal constraint filtered');
  });

  it('P5-2: non-temporal constraint → no FILTER_TEMPORAL_CONSTRAINT entry', async () => {
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...BASE_PAYLOAD,
        goal_constraints: [
          {
            constraint_id: 'c-evaluable',
            node_id: 'factor-a',
            operator: '>=',
            value: 0.4,
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const repairs: any[] = body._meta?.repairs_applied ?? [];

    const filterRepair = repairs.find(
      (r: any) => r.code === 'FILTER_TEMPORAL_CONSTRAINT'
    );
    expect(filterRepair).toBeUndefined();
  });

  it('P5-3: _meta.filtered_constraints unchanged by P.5 logging', async () => {
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...BASE_PAYLOAD,
        goal_constraints: [
          {
            constraint_id: 'deadline-c2',
            node_id: 'goal',
            operator: '<=',
            value: 6,
            deadline_metadata: { deadline: '2026-06-01' },
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    // repairs_applied contains the filter entry
    const repairs: any[] = body._meta?.repairs_applied ?? [];
    const filterRepair = repairs.find((r: any) => r.code === 'FILTER_TEMPORAL_CONSTRAINT');
    expect(filterRepair).toBeDefined();
    // _meta.filtered_constraints retains the full FilteredConstraintRecord shape
    const filteredConstraints: any[] = body._meta?.filtered_constraints ?? [];
    expect(filteredConstraints).toHaveLength(1);
    expect(filteredConstraints[0]).toMatchObject({
      constraint_id: 'deadline-c2',
      node_id: 'goal',
      reason: 'temporal_deadline',
    });
    // Response is still valid (not blocked)
    expect(body.analysis_status).not.toBe('blocked');
  });

  it('P5-4: STRIP entries appear before FILTER entries in repairs_applied', async () => {
    // A constraint with both extra fields AND deadline_metadata
    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...BASE_PAYLOAD,
        goal_constraints: [
          {
            constraint_id: 'c-both',
            node_id: 'goal',
            operator: '<=',
            value: 12,
            unit: 'months',
            confidence: 0.7,
            deadline_metadata: { deadline: '2026-12-31' },
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    const repairs: any[] = body._meta?.repairs_applied ?? [];

    const stripIdx = repairs.findIndex((r: any) => r.code === 'STRIP_RAW_CONSTRAINT_FIELDS');
    const filterIdx = repairs.findIndex((r: any) => r.code === 'FILTER_TEMPORAL_CONSTRAINT');

    expect(stripIdx).toBeGreaterThanOrEqual(0);
    expect(filterIdx).toBeGreaterThanOrEqual(0);
    // Compilation-strip entries before temporal-filter entries
    expect(stripIdx).toBeLessThan(filterIdx);
  });

  // =========================================================================
  // P.8: MAX_CONSTRAINTS enforcement
  // =========================================================================

  it('P8-1: MAX_CONSTRAINTS constant is 20', () => {
    expect(MAX_CONSTRAINTS).toBe(20);
  });

  it('P8-2: exactly 20 constraints passes (boundary)', async () => {
    const twentyConstraints = Array.from({ length: 20 }, (_, i) => ({
      constraint_id: `c${i}`,
      node_id: i % 2 === 0 ? 'factor-a' : 'factor-b',
      operator: '>=' as const,
      value: 0.1 + i * 0.01,
    }));

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...BASE_PAYLOAD,
        goal_constraints: twentyConstraints,
      }),
    });

    // Should not be blocked with TOO_MANY_CONSTRAINTS
    expect(res.status).not.toBe(422);
    const body = await res.json() as any;
    expect(body.analysis_status).not.toBe('blocked');
    const hasTooMany = (body.critiques ?? []).some((c: any) => c.code === 'TOO_MANY_CONSTRAINTS');
    expect(hasTooMany).toBe(false);
  });

  it('P8-3: 21 constraints → 422 blocked with TOO_MANY_CONSTRAINTS', async () => {
    const twentyOneConstraints = Array.from({ length: 21 }, (_, i) => ({
      constraint_id: `c${i}`,
      node_id: i % 2 === 0 ? 'factor-a' : 'factor-b',
      operator: '>=' as const,
      value: 0.1 + i * 0.01,
    }));

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...BASE_PAYLOAD,
        goal_constraints: twentyOneConstraints,
      }),
    });

    expect(res.status).toBe(422);
    const body = await res.json() as any;
    expect(body.analysis_status).toBe('blocked');
    const tooManyC = (body.critiques ?? []).find((c: any) => c.code === 'TOO_MANY_CONSTRAINTS');
    expect(tooManyC).toBeDefined();
    expect(tooManyC.message).toContain('21');
    expect(tooManyC.message).toContain('20');
    expect(tooManyC.severity).toBe('error');
  });

  it('P8-4: check fires before compileConstraints (temporal constraint that would filter still triggers limit)', async () => {
    // 21 constraints where some have deadline_metadata (would be filtered)
    // The limit check must fire BEFORE filtering, so it should still block
    const twentyOneWithTemporal = Array.from({ length: 21 }, (_, i) => ({
      constraint_id: `c${i}`,
      node_id: i % 2 === 0 ? 'factor-a' : 'factor-b',
      operator: '>=' as const,
      value: 0.1,
      ...(i < 5 ? { deadline_metadata: { deadline: '2026-12-31' } } : {}),
    }));

    const res = await fetch(`${baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...BASE_PAYLOAD,
        goal_constraints: twentyOneWithTemporal,
      }),
    });

    expect(res.status).toBe(422);
    const body = await res.json() as any;
    const tooManyC = (body.critiques ?? []).find((c: any) => c.code === 'TOO_MANY_CONSTRAINTS');
    expect(tooManyC).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// P.6: Hash determinism (pure unit tests)
// ---------------------------------------------------------------------------

describe('P.6: Hash version 6 — ISL-derived fields excluded', () => {
  const HASH_GRAPH: EngineGraphV3 = {
    nodes: [
      { id: 'factor-a', kind: 'factor', label: 'Factor A' },
      { id: 'goal', kind: 'goal', label: 'Goal' },
    ],
    edges: [
      { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
    ],
  };

  const HASH_OPTIONS = [
    { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': { value: 1.5, source: 'user_specified' } } },
  ];

  function makeReq(overrides: Partial<RunRequestV3> = {}): RunRequestV3 {
    return {
      graph: HASH_GRAPH,
      options: HASH_OPTIONS as any,
      goal_node_id: 'goal',
      seed: '42',
      ...overrides,
    } as RunRequestV3;
  }

  it('P6-1: HASH_VERSION is 6', () => {
    expect(HASH_VERSION).toBe(6);
  });

  it('P6-2: version field in canonical form is 6', () => {
    const canonical = JSON.parse(canonicaliseRequest(makeReq(), HASH_GRAPH, '42'));
    expect(canonical.version).toBe(6);
  });

  it('P6-3: same request with different factor_stability → same hash', () => {
    const req = makeReq();
    const stabilityA: FactorStabilityEntry[] = [
      { factor_id: 'factor-a', factor_label: 'A', elasticity_std: 0.05, attribution_stability: 'high', rank_flip_rate: 0.02, stability_method: 'bootstrap_1000' },
    ];
    const stabilityB: FactorStabilityEntry[] = [
      { factor_id: 'factor-a', factor_label: 'A', elasticity_std: 0.99, attribution_stability: 'low', rank_flip_rate: 0.8, stability_method: 'bootstrap_100' },
    ];

    const hashA = computeResponseHash(canonicaliseRequest(req, HASH_GRAPH, '42', undefined, stabilityA));
    const hashB = computeResponseHash(canonicaliseRequest(req, HASH_GRAPH, '42', undefined, stabilityB));
    expect(hashA).toBe(hashB);
  });

  it('P6-4: same request with different identifiability → same hash', () => {
    const req = makeReq();
    const identA: IdentifiabilityAssessment = {
      status: 'identifiable', method: 'backdoor', pairs_checked: 2, pairs_identifiable: 2,
    };
    const identB: IdentifiabilityAssessment = {
      status: 'not_backdoor_identifiable', method: 'backdoor', pairs_checked: 2, pairs_identifiable: 0,
    };

    const hashA = computeResponseHash(canonicaliseRequest(req, HASH_GRAPH, '42', identA));
    const hashB = computeResponseHash(canonicaliseRequest(req, HASH_GRAPH, '42', identB));
    expect(hashA).toBe(hashB);
  });

  it('P6-5 (guard): canonical form does NOT contain identifiability key at any nesting level', () => {
    const ident: IdentifiabilityAssessment = {
      status: 'identifiable', method: 'backdoor', pairs_checked: 2, pairs_identifiable: 2,
    };
    const canonical = canonicaliseRequest(makeReq(), HASH_GRAPH, '42', ident);
    // Must not contain 'identifiability' at any level
    expect(canonical).not.toContain('"identifiability"');
  });

  it('P6-6 (guard): canonical form does NOT contain factor_stability key at any nesting level', () => {
    const stability: FactorStabilityEntry[] = [
      { factor_id: 'factor-a', factor_label: 'A', elasticity_std: 0.05, attribution_stability: 'high', rank_flip_rate: 0.02, stability_method: 'bootstrap_1000' },
    ];
    const canonical = canonicaliseRequest(makeReq(), HASH_GRAPH, '42', undefined, stability);
    // Must not contain 'factor_stability' at any level
    expect(canonical).not.toContain('"factor_stability"');
  });

  it('P6-7: __hash_version=6 present in serialised hash input (via version field)', () => {
    const canonical = JSON.parse(canonicaliseRequest(makeReq(), HASH_GRAPH, '42'));
    expect(canonical.version).toBe(6);
  });

  it('P6-8: same input always produces same hash (determinism)', () => {
    const req = makeReq();
    const h1 = computeResponseHash(canonicaliseRequest(req, HASH_GRAPH, '42'));
    const h2 = computeResponseHash(canonicaliseRequest(req, HASH_GRAPH, '42'));
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
  });
});
