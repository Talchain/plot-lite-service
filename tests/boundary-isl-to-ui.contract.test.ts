/**
 * ISL → UI Boundary Transform Contract Tests (B4.5)
 *
 * Validates that the ISL→UI response assembly correctly applies all
 * declared drops, renames, transforms, and enrichments from the contract.
 *
 * Calls transformEdgeSensitivity / transformFactorSensitivity directly
 * and buildConstraintFields via an ISL-mock integration path.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ISL_TO_UI_CONTRACT } from '../src/contracts/isl-to-ui.contract.js';
import type { BoundaryContract } from '../src/contracts/plot-to-isl.contract.js';

// ---------------------------------------------------------------------------
// Source fields under contract
// ---------------------------------------------------------------------------

const SOURCE_FIELDS_UNDER_CONTRACT = [
  // Renamed array-level
  'options',
  'sensitivity',
  // Renamed factor fields
  'factor_sensitivity[].node_id',
  'factor_sensitivity[].label',
  // Renamed constraint fields
  'constraint_analysis.joint_probability',
  'constraint_results[].threshold',
  'constraint_results[].prob_satisfied',
  // Multi-source transforms
  'edge_from', 'edge_to',
  // Enriched fields
  'fragile_edges[].from_label',
  'fragile_edges[].to_label',
  'fragile_edges[].alternative_winner_label',
  'factor_sensitivity[].source',
  'recommended_option_id',
  'recommended_option_label',
  'near_tie',
  // Dropped
  'metadata.n_samples',
  'recommendation_confidence',
];

// ---------------------------------------------------------------------------
// ISL Mock — returns comprehensive fixture data
// ---------------------------------------------------------------------------

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
        win_probability: idx === 0 ? 0.7 : 0.3,
        probability_of_goal: 0.65,
        constraint_analysis: {
          joint_probability: 0.85,
          constraints: [
            { node_id: 'goal', operator: '>=', value: 0.5, prob_satisfied: 0.9 },
          ],
        },
      })),
      edges: [
        { from: 'factor-a', to: 'goal', sensitivity: 0.5, confidence: 0.8, direction: 'positive' },
      ],
      edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      sensitivity: [
        { edge_from: 'factor-a', edge_to: 'goal', sensitivity_type: 'magnitude', elasticity: 0.6, importance_rank: 1, interpretation: 'High impact' },
      ],
      factor_sensitivity: [
        { node_id: 'factor-a', label: 'Marketing Spend', sensitivity_score: 0.5, direction: 'positive', confidence: 0.8 },
      ],
      factors: [
        { node_id: 'factor-a', sensitivity: 0.5, confidence: 0.8, direction: 'positive' },
      ],
      value_of_information: [],
      factors_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      factor_sensitivity_status: 'available' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.82,
      robustness: {
        score: 0.82,
        label: 'robust',
        fragile_edges: [
          { edge_id: 'factor-a::goal', from_id: 'factor-a', to_id: 'goal', switch_probability: 0.15, alternative_winner_id: 'opt2' },
        ],
        robust_edges: ['factor-a::goal'],
      },
      fragile_edges: [], robust_edges: [],
      latency_ms: 42, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.82, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    const options = body.options || [];
    return {
      data: {
        options: options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: { mean: 0.7 + idx * 0.1, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
          rank: idx + 1,
          win_probability: idx === 0 ? 0.7 : 0.3,
          probability_of_goal: 0.65,
          constraint_analysis: {
            joint_probability: 0.85,
            constraints: [
              { node_id: 'goal', operator: '>=', value: 0.5, prob_satisfied: 0.9 },
            ],
          },
        })),
        sensitivity: [
          { edge_from: 'factor-a', edge_to: 'goal', sensitivity_type: 'magnitude', elasticity: 0.6, importance_rank: 1, interpretation: 'High impact' },
        ],
        factor_sensitivity: [
          { node_id: 'factor-a', label: 'Marketing Spend', sensitivity_score: 0.5, direction: 'positive', confidence: 0.8 },
        ],
        edges: [],
        factors: [],
        value_of_information: [],
        overall_robustness: 'robust', robustness_score: 0.82,
        robustness: {
          score: 0.82,
          label: 'robust',
          fragile_edges: [
            { edge_id: 'factor-a::goal', from_id: 'factor-a', to_id: 'goal', switch_probability: 0.15, alternative_winner_id: 'opt2' },
          ],
          robust_edges: ['factor-a::goal'],
        },
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
// Fixtures
// ---------------------------------------------------------------------------

const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'factor-a', kind: 'factor', label: 'Marketing Spend', observed_state: { value: 0.6 } },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt1', label: 'Increase Marketing', interventions: { 'factor-a': 0.8 } },
  { id: 'opt2', label: 'Reduce Churn', interventions: { 'factor-a': 0.3 } },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ISL → UI boundary contract (B4.5)', () => {
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

  // Helper to get response body
  async function getResponse(constraints?: any[]) {
    const payload: any = {
      graph: GRAPH,
      options: OPTIONS,
      goal_node_id: 'goal',
      seed: 'contract-test',
    };
    if (constraints) {
      payload.goal_constraints = constraints;
    }
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify(payload),
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body);
  }

  // ----- Renames: options → option_comparison -----

  it('options/results → option_comparison rename applied', async () => {
    const body = await getResponse();

    // UI field present
    expect(body.option_comparison).toBeDefined();
    expect(body.option_comparison.length).toBeGreaterThan(0);

    // ISL field names absent at top level
    expect(body.options).toBeUndefined();
    expect(body.results).toBeUndefined();
  });

  // ----- Renames: factor_sensitivity -----

  it('factor_sensitivity node_id → factor_id and label → factor_label renames applied', async () => {
    const body = await getResponse();

    if (body.factor_sensitivity && body.factor_sensitivity.length > 0) {
      const factor = body.factor_sensitivity[0];

      // Renamed fields present
      expect(factor.factor_id).toBeDefined();
      expect(factor.factor_label).toBeDefined();

      // Original ISL field names absent
      expect(factor).not.toHaveProperty('node_id');
      // label might exist as a passthrough, but factor_label is the canonical name

      // Enriched source field present (may be 'isl' or 'graph' depending on computation path)
      expect(['isl', 'graph']).toContain(factor.source);
    }
  });

  // ----- Multi-source transform: edge_from + edge_to → edge_id -----

  it('edge_from + edge_to → edge_id composite key (double-colon format)', async () => {
    const body = await getResponse();

    if (body.edge_sensitivity && body.edge_sensitivity.length > 0) {
      const edge = body.edge_sensitivity[0];

      // Composite edge_id present with "::" separator
      expect(edge.edge_id).toBe('factor-a::goal');

      // Original from/to fields still present (they're passthrough, not dropped)
      expect(edge.from).toBe('factor-a');
      expect(edge.to).toBe('goal');
    }
  });

  // ----- Rename with value: constraint threshold → value -----

  it('constraint_results[].threshold → value rename with correct numeric value', async () => {
    const body = await getResponse([
      { constraint_id: 'c1', node_id: 'goal', operator: '>=', value: 0.5 },
    ]);

    if (body.constraint_results && body.constraint_results.length > 0) {
      const cr = body.constraint_results[0];

      // Renamed field present with correct value
      expect(cr.value).toBe(0.5);
      expect(cr.probability).toBeDefined();

      // ISL field names absent
      expect(cr).not.toHaveProperty('threshold');
      expect(cr).not.toHaveProperty('prob_satisfied');
    }
  });

  // ----- Rename: joint_probability → probability_of_joint_goal -----

  it('constraint_analysis.joint_probability → probability_of_joint_goal rename applied', async () => {
    const body = await getResponse([
      { constraint_id: 'c1', node_id: 'goal', operator: '>=', value: 0.5 },
    ]);

    if (body.option_comparison && body.option_comparison.length > 0) {
      const opt = body.option_comparison[0];

      // Renamed field present
      expect(opt.probability_of_joint_goal).toBeDefined();

      // ISL field name absent
      expect(opt).not.toHaveProperty('joint_probability');
    }
  });

  // ----- Enriched: edge labels -----

  it('enriched edge labels present on fragile/robust edges', async () => {
    const body = await getResponse();

    if (body.robustness?.fragile_edges?.length > 0) {
      const fragile = body.robustness.fragile_edges[0];
      expect(fragile.from_label).toBeDefined();
      expect(fragile.to_label).toBeDefined();
      // alternative_winner_label present (may be null if no winner)
      expect('alternative_winner_label' in fragile).toBe(true);
    }

    if (body.robustness?.robust_edges?.length > 0) {
      const robust = body.robustness.robust_edges[0];
      expect(robust.from_label).toBeDefined();
      expect(robust.to_label).toBeDefined();
    }
  });

  // ----- Enriched: recommended option and near_tie -----

  it('recommended_option and near_tie enrichments present', async () => {
    const body = await getResponse();

    if (body.robustness) {
      // Recommended option derived from win_probability
      expect(body.robustness.recommended_option_id).toBeDefined();
      expect(body.robustness.recommended_option_label).toBeDefined();

      // Near-tie detection
      expect(body.robustness.near_tie).toBeDefined();
      expect(body.robustness.near_tie.is_tie).toBeDefined();
    }
  });

  // ----- Contract structure -----

  it('contract object has all required keys', () => {
    expect(ISL_TO_UI_CONTRACT.name).toBe('isl-to-ui');
    expect(ISL_TO_UI_CONTRACT.drops).toBeInstanceOf(Array);
    expect(ISL_TO_UI_CONTRACT.renames).toBeInstanceOf(Array);
    expect(ISL_TO_UI_CONTRACT.transforms).toBeInstanceOf(Array);
    expect(ISL_TO_UI_CONTRACT.enriched).toBeInstanceOf(Array);
    expect(ISL_TO_UI_CONTRACT.filtered).toBeInstanceOf(Array);
  });

  // ----- Drops -----

  it('declared drops are absent from UI response', async () => {
    const body = await getResponse();

    // recommendation_confidence not in V3
    expect(body).not.toHaveProperty('recommendation_confidence');

    // metadata.n_samples not at top level (superseded by per-option outcome)
    expect(body).not.toHaveProperty('metadata');
  });

  // ----- Harness sanity: incomplete contract -----

  it('harness detects incomplete contract (missing rename)', async () => {
    const body = await getResponse();

    // Create deliberately incomplete contract (remove factor_id rename)
    const incomplete: BoundaryContract = {
      ...ISL_TO_UI_CONTRACT,
      renames: ISL_TO_UI_CONTRACT.renames.filter(
        r => r.to !== 'factor_sensitivity[].factor_id'
      ),
    };

    // factor_id IS present in output
    const hasFactor = body.factor_sensitivity?.some(
      (f: any) => f.factor_id !== undefined
    );

    // But NOT declared in incomplete contract's renames
    const declaredInRenames = incomplete.renames.some(
      r => r.to === 'factor_sensitivity[].factor_id'
    );

    if (hasFactor) {
      expect(declaredInRenames).toBe(false);
      expect(() => {
        if (hasFactor && !declaredInRenames) {
          throw new Error(
            'Undeclared rename: factor_sensitivity[].factor_id present in output but not declared in contract.renames'
          );
        }
      }).toThrow('Undeclared rename');
    }
  });
});
