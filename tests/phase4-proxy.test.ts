/**
 * Phase 4 Proxy Endpoints Tests
 *
 * Tests for Phase 4 sequential graph support endpoints:
 * - POST /v1/analysis/conditional-recommend
 * - POST /v1/analysis/sequential
 * - POST /v1/analysis/policy-tree
 * - POST /v1/recommend/generate
 * - POST /v1/narrate/conditions
 * - POST /v1/explain/policy
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerConditionalRecommendRoute } from '../src/routes/v1/analysis-conditional-recommend.js';
import { registerSequentialAnalysisRoute } from '../src/routes/v1/analysis-sequential.js';
import { registerPolicyTreeRoute } from '../src/routes/v1/analysis-policy-tree.js';
import { registerGenerateRecommendationRoute } from '../src/routes/v1/recommend-generate.js';
import { registerNarrateConditionsRoute } from '../src/routes/v1/narrate-conditions.js';
import { registerExplainPolicyRoute } from '../src/routes/v1/explain-policy.js';

describe('POST /v1/analysis/conditional-recommend', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await registerConditionalRecommendRoute(app);
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    delete process.env.ISL_CONDITIONAL_RECOMMEND_ENABLE;
    delete process.env.ISL_ENABLE;
  });

  it('returns 400 when graph is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/analysis/conditional-recommend',
      payload: {
        conditions: [],
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.code).toBe('BAD_INPUT');
  });

  it('returns 400 when conditions are missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/analysis/conditional-recommend',
      payload: {
        graph: {
          nodes: [
            { id: 'A', label: 'Option A', kind: 'option', value: 0.5 },
            { id: 'B', label: 'Outcome', kind: 'outcome' },
          ],
          edges: [{ from: 'A', to: 'B' }],
        },
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.message).toContain('conditions');
  });

  it('returns recommendation with fallback when ISL disabled', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/analysis/conditional-recommend',
      payload: {
        graph: {
          nodes: [
            { id: 'A', label: 'Option A', kind: 'option', value: 0.7 },
            { id: 'B', label: 'Option B', kind: 'option', value: 0.3 },
            { id: 'O', label: 'Outcome', kind: 'outcome' },
          ],
          edges: [
            { from: 'A', to: 'O', weight: 0.8 },
            { from: 'B', to: 'O', weight: 0.6 },
          ],
        },
        conditions: [{ node_id: 'A', operator: 'eq', value: 0.8 }],
        seed: 4242,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.schema).toBe('conditional_recommend.v1');
    expect(body.recommendation).toBeDefined();
    expect(body.provenance).toBe('plot_fallback');
    expect(body.model_card.conditions_count).toBe(1);
  });
});

describe('POST /v1/analysis/sequential', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await registerSequentialAnalysisRoute(app);
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    // Enable the feature flag for tests
    process.env.ENABLE_SEQUENTIAL_ANALYSIS = '1';
    delete process.env.ISL_SEQUENTIAL_ENABLE;
    delete process.env.ISL_ENABLE;
  });

  it('returns 400 when graph is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/analysis/sequential',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for invalid discount factor', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/analysis/sequential',
      payload: {
        graph: {
          nodes: [{ id: 'A', label: 'Node A', kind: 'decision' }],
          edges: [],
        },
        discount_factor: 1.5,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.message).toContain('discount_factor');
  });

  it('returns sequential analysis with fallback', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/analysis/sequential',
      payload: {
        graph: {
          nodes: [
            { id: 'D1', label: 'Decision 1', kind: 'decision', stage: 0, value: 0.7 },
            { id: 'D2', label: 'Decision 2', kind: 'decision', stage: 1, value: 0.5 },
            { id: 'O', label: 'Outcome', kind: 'outcome', stage: 1 },
          ],
          edges: [
            { from: 'D1', to: 'D2', weight: 0.8 },
            { from: 'D2', to: 'O', weight: 0.6 },
          ],
          sequential_metadata: {
            is_sequential: true,
            stages: [
              { index: 0, label: 'Stage 1', decisions: ['D1'], resolved_uncertainties: [] },
              { index: 1, label: 'Stage 2', decisions: ['D2'], resolved_uncertainties: [] },
            ],
          },
        },
        seed: 4242,
        discount_factor: 0.95,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.schema).toBe('sequential_analysis.v1');
    expect(body.validation).toBeDefined();
    expect(body.validation.valid).toBe(true);
    expect(body.provenance).toBe('plot_fallback');
    expect(body.model_card.discount_factor).toBe(0.95);
  });
});

describe('POST /v1/analysis/policy-tree', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await registerPolicyTreeRoute(app);
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    delete process.env.ISL_POLICY_TREE_ENABLE;
    delete process.env.ISL_ENABLE;
  });

  it('returns 400 when graph is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/analysis/policy-tree',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns policy tree with fallback', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/analysis/policy-tree',
      payload: {
        graph: {
          nodes: [
            { id: 'D1', label: 'Decision 1', kind: 'decision', stage: 0, value: 0.7 },
            { id: 'O', label: 'Outcome', kind: 'outcome', stage: 1 },
          ],
          edges: [{ from: 'D1', to: 'O', weight: 0.8 }],
        },
        seed: 4242,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.schema).toBe('policy_tree.v1');
    expect(body.tree).toBeDefined();
    expect(body.tree.root_id).toBeDefined();
    expect(body.tree.nodes).toBeInstanceOf(Array);
    expect(body.provenance).toBe('plot_fallback');
  });
});

describe('POST /v1/recommend/generate', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await registerGenerateRecommendationRoute(app);
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    delete process.env.CEE_GENERATE_RECOMMENDATION_ENABLE;
    delete process.env.CEE_ORCHESTRATOR_ENABLE;
  });

  it('returns 400 when analysis_results is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recommend/generate',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(body.message).toContain('analysis_results');
  });

  it('returns generated recommendation with fallback', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recommend/generate',
      payload: {
        analysis_results: {
          winner: 'option_a',
          winner_label: 'Option A',
          winner_p50: 0.75,
          margin: 0.15,
          ranking_confidence: 'high',
          alternatives: [{ label: 'Option B', p50: 0.6 }],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.schema).toBe('generate_recommendation.v1');
    expect(body.recommendation).toBeDefined();
    expect(body.recommendation.recommendation).toContain('Option A');
    expect(body.recommendation.confidence).toBeDefined();
    expect(body.provenance).toBe('plot_fallback');
  });
});

describe('POST /v1/narrate/conditions', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await registerNarrateConditionsRoute(app);
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    delete process.env.CEE_NARRATE_CONDITIONS_ENABLE;
    delete process.env.CEE_ORCHESTRATOR_ENABLE;
  });

  it('returns 400 when conditions are missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/narrate/conditions',
      payload: {
        graph: { nodes: [], edges: [] },
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when graph is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/narrate/conditions',
      payload: {
        conditions: [],
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns narrated conditions with fallback', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/narrate/conditions',
      payload: {
        conditions: [
          { node_id: 'market_growth', operator: 'gt', value: 0.05 },
          { node_id: 'competition', operator: 'eq', value: 'low' },
        ],
        graph: {
          nodes: [
            { id: 'market_growth', label: 'Market Growth Rate' },
            { id: 'competition', label: 'Competitive Pressure' },
          ],
          edges: [],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.schema).toBe('narrate_conditions.v1');
    expect(body.narration).toBeDefined();
    expect(body.narration.narrative).toBeDefined();
    expect(body.narration.condition_explanations).toHaveLength(2);
    expect(body.conditions_count).toBe(2);
    expect(body.provenance).toBe('plot_fallback');
  });
});

describe('POST /v1/explain/policy', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await registerExplainPolicyRoute(app);
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    delete process.env.CEE_EXPLAIN_POLICY_ENABLE;
    delete process.env.CEE_ORCHESTRATOR_ENABLE;
  });

  it('returns 400 when policy_tree is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/explain/policy',
      payload: {
        graph: { nodes: [], edges: [] },
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when graph is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/explain/policy',
      payload: {
        policy_tree: {
          root_id: 'root',
          nodes: [],
          depth: 0,
          terminal_count: 0,
          policy_summary: 'Empty policy',
        },
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns policy explanation with fallback', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/explain/policy',
      payload: {
        policy_tree: {
          root_id: 'root',
          nodes: [
            {
              id: 'root',
              type: 'decision',
              label: 'Start',
              stage: 0,
              expected_value: 100,
              children: ['d1'],
            },
            {
              id: 'd1',
              type: 'decision',
              label: 'Launch Now',
              stage: 0,
              action: 'launch',
              expected_value: 100,
              children: [],
            },
          ],
          depth: 1,
          terminal_count: 1,
          policy_summary: 'Launch Now (EV: 100)',
        },
        graph: {
          nodes: [
            { id: 'launch', label: 'Launch Decision', kind: 'decision', stage: 0 },
            { id: 'outcome', label: 'Revenue', kind: 'outcome', stage: 1 },
          ],
          edges: [{ from: 'launch', to: 'outcome' }],
          sequential_metadata: {
            is_sequential: true,
            stages: [
              { index: 0, label: 'Launch', decisions: ['launch'], resolved_uncertainties: [] },
              { index: 1, label: 'Outcome', decisions: [], resolved_uncertainties: [] },
            ],
          },
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.schema).toBe('explain_policy.v1');
    expect(body.explanation).toBeDefined();
    expect(body.explanation.summary).toBeDefined();
    expect(body.provenance).toBe('plot_fallback');
  });
});
