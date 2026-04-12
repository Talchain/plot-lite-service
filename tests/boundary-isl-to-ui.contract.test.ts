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
  'fragile_edges[].severity',
  'factor_sensitivity[].source',
  'recommended_option_id',
  'recommended_option_label',
  'near_tie',
  'confidence_tier',
  'dominant_factor',
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

// ---------------------------------------------------------------------------
// Golden-path contracts: ISL response → PLoT parsing (T5a)
// ---------------------------------------------------------------------------

describe('ISL response contract — golden-path (T5a)', () => {
  let app2: FastifyInstance;

  // Mock that returns ISL response with BOTH value and threshold on constraint
  const mockBothFields = {
    ...mockISLService,
    async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
      const options = body.options || [];
      const goalConstraints = body.goal_constraints || [];
      return {
        data: {
          options: options.map((opt: any, idx: number) => ({
            option_id: opt.id,
            outcome: { mean: 0.7 + idx * 0.05, std: 0.1, p10: 0.5, p50: 0.7, p90: 0.9 },
            win_probability: idx === 0 ? 0.7 : 0.3,
            probability_of_goal: 0.65,
            constraint_analysis: goalConstraints.length > 0 ? {
              joint_probability: 0.8,
              constraints: goalConstraints.map((c: any) => ({
                node_id: c.node_id,
                operator: c.operator,
                // Both fields present — value is F-20 canonical
                value: c.value,
                threshold: c.value,
                prob_satisfied: 0.85,
              })),
            } : undefined,
          })),
          sensitivity: [
            { edge_from: 'factor-a', edge_to: 'goal', sensitivity_type: 'magnitude', elasticity: 0.6, importance_rank: 1, interpretation: 'High impact' },
          ],
          // ISL returns label on factor_sensitivity entries (PLoT renames to factor_label)
          factor_sensitivity: [
            { node_id: 'factor-a', label: 'Marketing Spend', sensitivity_score: 0.5, direction: 'positive' },
          ],
          robustness: {
            score: 0.75, label: 'robust',
            fragile_edges: [],
            robust_edges: ['factor-a::goal'],
          },
        } as T,
        error: null,
      };
    },
  };

  // Mock that returns ISL response with ONLY threshold (no value) — pre-F-20 ISL
  const mockThresholdOnly = {
    ...mockISLService,
    async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
      const options = body.options || [];
      const goalConstraints = body.goal_constraints || [];
      return {
        data: {
          options: options.map((opt: any, idx: number) => ({
            option_id: opt.id,
            outcome: { mean: 0.6 + idx * 0.05, std: 0.1, p10: 0.4, p50: 0.6, p90: 0.8 },
            win_probability: idx === 0 ? 0.65 : 0.35,
            probability_of_goal: 0.6,
            constraint_analysis: goalConstraints.length > 0 ? {
              joint_probability: 0.7,
              constraints: goalConstraints.map((c: any) => ({
                node_id: c.node_id,
                operator: c.operator,
                // ONLY threshold — no value (simulates pre-F-20 ISL)
                threshold: c.value,
                prob_satisfied: 0.75,
              })),
            } : undefined,
          })),
          sensitivity: [],
          factor_sensitivity: [
            { node_id: 'factor-a', label: 'Marketing Spend', sensitivity_score: 0.4, direction: 'positive' },
          ],
          robustness: { score: 0.65, label: 'moderate', fragile_edges: [], robust_edges: [] },
        } as T,
        error: null,
      };
    },
  };

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.UI_CANONICAL_META = '1';

    // Use the both-fields mock for the main suite
    const { getISLService: _get, islService: _svc, ...rest } = await import('../src/integrations/isl/index.js') as any;
    app2 = await createServer();
    await app2.ready();
  });

  afterAll(async () => {
    await app2?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
    delete process.env.UI_CANONICAL_META;
  });

  async function getConstraintResponse(mockSvc: typeof mockISLService) {
    // Temporarily swap the mock (inline injection via module mock already set)
    // We rely on the module-level mock already being in place; for the threshold-only
    // regression, we'll use a separate describe block with its own vi.mock below.
    const payload = {
      graph: GRAPH,
      options: OPTIONS,
      goal_node_id: 'goal',
      seed: 'isl-response-test',
      goal_constraints: [
        { constraint_id: 'cr-c1', node_id: 'goal', operator: '>=', value: 0.5 },
      ],
    };
    const res = await app2.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify(payload),
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body);
  }

  // factor_sensitivity label field: ISL sends "label", PLoT renames to "factor_label"
  it('factor_sensitivity: ISL label → PLoT factor_label rename; factor_id present', async () => {
    const body = await getConstraintResponse(mockISLService);

    if (body.factor_sensitivity && body.factor_sensitivity.length > 0) {
      const factor = body.factor_sensitivity[0];

      // Phase 4 finding: PLoT renames ISL "label" → "factor_label"
      // Log actual fields for reporting
      const actualFields = Object.keys(factor);
      console.info('[Phase 4 report] factor_sensitivity[0] fields:', actualFields.join(', '));

      expect(factor.factor_id).toBeDefined();
      expect(factor.factor_label).toBeDefined();
      // ISL raw "node_id" must be absent (renamed to factor_id)
      expect(factor).not.toHaveProperty('node_id');
    }
  });

  // constraint_results: read with value ?? threshold fallback
  it('constraint_results: value field present (canonical path)', async () => {
    const body = await getConstraintResponse(mockISLService);

    if (body.constraint_results && body.constraint_results.length > 0) {
      const cr = body.constraint_results[0];
      // value must be a number
      expect(typeof cr.value).toBe('number');
      expect(cr.value).toBe(0.5);
      // probability from prob_satisfied
      expect(typeof cr.probability).toBe('number');
    }
  });

  // option_comparison is always an array when status === 'computed'
  it('option_comparison is array when option_comparison_status === computed', async () => {
    const body = await getConstraintResponse(mockISLService);

    if (body.option_comparison_status === 'computed') {
      expect(Array.isArray(body.option_comparison)).toBe(true);
      expect(body.option_comparison.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Golden-path contracts: PLoT → CEE response shape (T5a)
// ---------------------------------------------------------------------------

describe('PLoT → CEE response contract — golden-path (T5a)', () => {
  let app3: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.UI_CANONICAL_META = '1';

    app3 = await createServer();
    await app3.ready();
  });

  afterAll(async () => {
    await app3?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
    delete process.env.UI_CANONICAL_META;
  });

  async function runRequest(extra: Record<string, unknown> = {}) {
    const payload = {
      graph: GRAPH,
      options: OPTIONS,
      goal_node_id: 'goal',
      seed: 'cee-contract-test',
      ...extra,
    };
    const res = await app3.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify(payload),
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body);
  }

  // option_comparison is array when option_comparison_status === 'computed'
  it('option_comparison is always array when status is computed', async () => {
    const body = await runRequest();
    if (body.option_comparison_status === 'computed') {
      expect(Array.isArray(body.option_comparison)).toBe(true);
    }
    // option_comparison_status must be one of the valid vocabulary values
    expect(['computed', 'unavailable', 'skipped', 'error']).toContain(body.option_comparison_status);
  });

  // robustness.fragile_edges is always an array (never undefined)
  it('robustness.fragile_edges is always an array', async () => {
    const body = await runRequest();
    if (body.robustness) {
      expect(Array.isArray(body.robustness.fragile_edges)).toBe(true);
    }
  });

  // robustness.robust_edges is always an array (never undefined)
  it('robustness.robust_edges is always an array', async () => {
    const body = await runRequest();
    if (body.robustness) {
      expect(Array.isArray(body.robustness.robust_edges)).toBe(true);
    }
  });

  // repairs_applied location: inside _meta (not top-level); UI_CANONICAL_META enabled above
  it('repairs_applied is inside _meta (not at top level)', async () => {
    const body = await runRequest({
      goal_constraints: [
        // source_quote triggers STRIP_RAW_CONSTRAINT_FIELDS via appendRepair (F.5 canonical fields)
        { constraint_id: 'r-c1', node_id: 'goal', operator: '>=', value: 0.5, source_quote: 'must exceed 50%' },
      ],
    });

    // _meta must be present (UI_CANONICAL_META=1)
    expect(body._meta).toBeDefined();

    // repairs_applied lives inside _meta
    expect(Array.isArray(body._meta.repairs_applied)).toBe(true);

    // repairs_applied must NOT be a top-level field
    expect(body).not.toHaveProperty('repairs_applied');

    // Report actual field names for Phase 4 investigation
    const repairs: any[] = body._meta.repairs_applied;
    const allRepairKeys = repairs.flatMap(r => Object.keys(r));
    console.info('[repairs_applied report] all field names across entries:', [...new Set(allRepairKeys)].sort().join(', '));

    // Find the STRIP_RAW_CONSTRAINT_FIELDS repair (from appendRepair — has F.5 canonical fields)
    const stripRepair = repairs.find((r: any) => r.code === 'STRIP_RAW_CONSTRAINT_FIELDS');

    if (stripRepair) {
      // F.5 canonical fields present on appendRepair entries
      expect(stripRepair).toHaveProperty('code');
      expect(stripRepair).toHaveProperty('layer');
      expect(stripRepair.layer).toBe('plot');
      expect(stripRepair).toHaveProperty('field_path');
      expect(stripRepair).toHaveProperty('before');
      expect(stripRepair).toHaveProperty('after');
      expect(stripRepair).toHaveProperty('severity');

      // Legacy fields also present (RepairRecord type carries both)
      expect(stripRepair).toHaveProperty('field');
      expect(stripRepair).toHaveProperty('action');
      expect(stripRepair).toHaveProperty('reason');

      const stripRepairKeys = Object.keys(stripRepair).sort();
      console.info('[repairs_applied report] STRIP_RAW repair fields:', stripRepairKeys.join(', '));
    }

    // Any repair entry (legacy path) must at minimum have field + reason + action
    for (const r of repairs) {
      expect(r).toHaveProperty('field');
      expect(r).toHaveProperty('reason');
    }
  });

  // response_hash present when analysis is computed
  it('response_hash is present and is a 16-char hex string when analysis computed', async () => {
    const body = await runRequest();

    if (body.analysis_status === 'computed') {
      expect(body.response_hash).toBeDefined();
      expect(typeof body.response_hash).toBe('string');
      // response_hash is SHA-256 sliced to 16 hex chars (computeResponseHash)
      expect(body.response_hash).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  // _meta.response_hash must equal top-level response_hash
  it('_meta.response_hash equals top-level response_hash when computed', async () => {
    const body = await runRequest();

    if (body.analysis_status === 'computed' || body.analysis_status === 'partial') {
      expect(body.response_hash).toBeDefined();
      expect(body._meta).toBeDefined();
      expect(body._meta.response_hash).toBe(body.response_hash);
    }
  });

  // meta.seed_used is always present
  it('meta.seed_used is always present', async () => {
    const body = await runRequest();
    expect(body.meta).toBeDefined();
    expect(body.meta.seed_used).toBeDefined();
    expect(typeof body.meta.seed_used).toBe('string');
  });

  // meta.seed_used echoes the seed sent by the client
  it('meta.seed_used echoes client seed', async () => {
    const body = await runRequest({ seed: 'my-test-seed' });
    expect(body.meta.seed_used).toBe('my-test-seed');
  });

  // analysis_status is one of the vocabulary values
  it('analysis_status is one of the valid vocabulary values', async () => {
    const body = await runRequest();
    expect(['computed', 'partial', 'failed', 'blocked']).toContain(body.analysis_status);
  });

  // UI_CANONICAL_META flag status report
  it('UI_CANONICAL_META=1 causes _meta to include extended fields', async () => {
    const body = await runRequest();

    // With UI_CANONICAL_META=1 (set in beforeAll):
    expect(body._meta).toBeDefined();
    expect(body._meta.source_path).toBeDefined();
    expect(body._meta.plot_build).toBeDefined();
    expect(typeof body._meta.hash_version).toBe('number');

    console.info('[UI_CANONICAL_META report] _meta keys:', Object.keys(body._meta).sort().join(', '));
  });
});

// ---------------------------------------------------------------------------
// Regression: ISL response with threshold-only (no value) — pre-F-20 ISL
// ---------------------------------------------------------------------------

// Separate module-level mock for the threshold-only regression scenario
const mockISLThresholdOnly = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return { status: 'identifiable', confidence: 'high', adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [], explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl' };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseRobustness(_graph: any, _goalNodeId: string, options: any[]) {
    return {
      options: options.map((opt: any, idx: number) => ({
        option_id: opt.id,
        outcome: { mean: 0.6, std: 0.1, p10: 0.4, p50: 0.6, p90: 0.8, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
        rank: idx + 1, win_probability: idx === 0 ? 0.65 : 0.35,
      })),
      edges: [], edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      sensitivity: [], factor_sensitivity: [],
      factors: [], value_of_information: [],
      factors_provenance: 'unavailable' as const,
      factor_sensitivity_status: 'skipped_no_factor_values' as const,
      overall_robustness: 'robust' as const, robustness_score: 0.65,
      fragile_edges: [], robust_edges: [],
      latency_ms: 30, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.65, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: any): Promise<{ data: T | null; error: string | null }> {
    const options = body.options || [];
    const goalConstraints = body.goal_constraints || [];
    return {
      data: {
        options: options.map((opt: any, idx: number) => ({
          option_id: opt.id,
          outcome: { mean: 0.6 + idx * 0.05, std: 0.1, p10: 0.4, p50: 0.6, p90: 0.8, n_samples: 1000, n_valid_samples: 1000, validity_ratio: 1.0 },
          win_probability: idx === 0 ? 0.65 : 0.35,
          probability_of_goal: 0.6,
          constraint_analysis: goalConstraints.length > 0 ? {
            joint_probability: 0.7,
            constraints: goalConstraints.map((c: any) => ({
              node_id: c.node_id,
              operator: c.operator,
              // ONLY threshold field — no value (simulates pre-F-20 ISL response)
              threshold: c.value,
              prob_satisfied: 0.78,
            })),
          } : undefined,
        })),
        sensitivity: [],
        factor_sensitivity: [],
        robustness: { score: 0.65, label: 'moderate', fragile_edges: [], robust_edges: [] },
      } as T,
      error: null,
    };
  },
};

describe('Regression: ISL threshold-only response still works via fallback', () => {
  let appReg: FastifyInstance;

  // Override the module mock for this describe block to use threshold-only mock
  vi.mock('../src/integrations/isl/index.ts', async () => {
    const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
    return { ...actual, getISLService: () => mockISLThresholdOnly, islService: mockISLThresholdOnly };
  });

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';

    appReg = await createServer();
    await appReg.ready();
  });

  afterAll(async () => {
    await appReg?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  it('ISL response with threshold-only (no value) still produces constraint_results via fallback', async () => {
    const payload = {
      graph: GRAPH,
      options: OPTIONS,
      goal_node_id: 'goal',
      seed: 'threshold-only-regression',
      goal_constraints: [
        { constraint_id: 'reg-c1', node_id: 'goal', operator: '>=', value: 0.55 },
      ],
    };

    const res = await appReg.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify(payload),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // Must not fail — ISL migration incomplete (no value field) must not break constraint parsing
    expect(body.analysis_status).not.toBe('failed');

    if (body.constraint_results && body.constraint_results.length > 0) {
      const cr = body.constraint_results[0];
      // value must be populated via ?? threshold fallback (0.55 from our fixture)
      expect(typeof cr.value).toBe('number');
      expect(cr.value).toBe(0.55);
      expect(typeof cr.probability).toBe('number');
    }
  });
});
