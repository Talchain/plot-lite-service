/**
 * Phase 4 Proxy Endpoints Tests
 *
 * Tests for Phase 4 sequential graph support endpoints.
 *
 * NOTE (26 Jul 2026): POST /v1/analysis/sequential and POST
 * /v1/analysis/policy-tree were deleted as vacuous, and their describe blocks
 * were deleted with them — they tested deleted behaviour. Remaining:
 * - POST /v1/analysis/conditional-recommend
 * - POST /v1/recommend/generate
 * - POST /v1/narrate/conditions
 * - POST /v1/explain/policy
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerConditionalRecommendRoute } from '../src/routes/v1/analysis-conditional-recommend.js';
import { registerGenerateRecommendationRoute } from '../src/routes/v1/recommend-generate.js';
import { registerNarrateConditionsRoute } from '../src/routes/v1/narrate-conditions.js';
import { registerExplainPolicyRoute } from '../src/routes/v1/explain-policy.js';

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
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
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
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
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
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
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
