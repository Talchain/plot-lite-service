/**
 * CEE/ISL Proxy Endpoints Tests
 *
 * Phase 2 Week 2: Tests for belief elicitation, utility weights, and dominance analysis
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerElicitBeliefRoute } from '../src/routes/v1/elicit-belief.js';
import { registerSuggestUtilityWeightsRoute } from '../src/routes/v1/suggest-utility-weights.js';
import { registerDominanceAnalysisRoute } from '../src/routes/v1/analysis-dominance.js';
import { registerParetoAnalysisRoute } from '../src/routes/v1/analysis-pareto.js';
import { registerMultiCriteriaAnalysisRoute } from '../src/routes/v1/analysis-multi-criteria.js';
import { registerElicitRiskToleranceRoute } from '../src/routes/v1/elicit-risk-tolerance.js';
import { registerRiskAdjustRoute } from '../src/routes/v1/analysis-risk-adjust.js';
import { registerThresholdsRoute } from '../src/routes/v1/analysis-thresholds.js';

describe('CEE/ISL Proxy Endpoints', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await registerElicitBeliefRoute(app);
    await registerSuggestUtilityWeightsRoute(app);
    await registerDominanceAnalysisRoute(app);
    await registerParetoAnalysisRoute(app);
    await registerMultiCriteriaAnalysisRoute(app);
    await registerElicitRiskToleranceRoute(app);
    await registerRiskAdjustRoute(app);
    await registerThresholdsRoute(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // ============================================================================
  // Belief Elicitation Tests
  // ============================================================================

  describe('POST /v1/elicit/belief', () => {
    it('returns 400 for missing node_id', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/elicit/belief',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('node_id is required');
    });

    it('returns 400 for invalid current_belief', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/elicit/belief',
        payload: {
          node_id: 'node1',
          current_belief: 1.5, // Invalid: > 1
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('current_belief must be a number between 0 and 1');
    });

    it('returns successful response with node_id only', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/elicit/belief',
        payload: {
          node_id: 'likelihood_of_success',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.schema).toBe('belief_elicitation.v1');
      expect(body.elicitation).toBeDefined();
      expect(body.elicitation.suggested_belief).toBeGreaterThanOrEqual(0);
      expect(body.elicitation.suggested_belief).toBeLessThanOrEqual(1);
      expect(body.node_context.node_id).toBe('likelihood_of_success');
      expect(body.provenance).toBe('plot_fallback'); // CEE not enabled
    });

    it('enriches node label from graph context', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/elicit/belief',
        payload: {
          node_id: 'success_rate',
          graph: {
            nodes: [
              { id: 'success_rate', label: 'Project Success Rate', kind: 'outcome' },
              { id: 'budget', label: 'Budget' },
            ],
            edges: [],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.node_context.node_label).toBe('Project Success Rate');
      expect(body.node_context.node_kind).toBe('outcome');
    });

    it('preserves current_belief in fallback response', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/elicit/belief',
        payload: {
          node_id: 'test_node',
          current_belief: 0.75,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.elicitation.suggested_belief).toBe(0.75);
      expect(body.elicitation.rationale).toContain('0.75');
    });

    it('returns default 0.5 belief when no current_belief', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/elicit/belief',
        payload: {
          node_id: 'new_node',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.elicitation.suggested_belief).toBe(0.5);
    });

    it('includes follow_up_questions in response', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/elicit/belief',
        payload: {
          node_id: 'my_node',
          node_label: 'My Important Node',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.elicitation.follow_up_questions).toBeInstanceOf(Array);
      expect(body.elicitation.follow_up_questions.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // Utility Weight Suggestions Tests
  // ============================================================================

  describe('POST /v1/suggest/utility-weights', () => {
    it('returns 400 for missing graph', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/suggest/utility-weights',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('graph.nodes required');
    });

    it('returns 400 for graph exceeding node limit', async () => {
      const nodes = Array.from({ length: 51 }, (_, i) => ({
        id: `node${i}`,
        label: `Node ${i}`,
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/v1/suggest/utility-weights',
        payload: {
          graph: { nodes, edges: [] },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('max 50 nodes');
    });

    it('returns 400 for graph without outcome nodes', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/suggest/utility-weights',
        payload: {
          graph: {
            nodes: [
              { id: 'a', label: 'A', kind: 'decision' },
              { id: 'b', label: 'B', kind: 'option' },
            ],
            edges: [{ from: 'a', to: 'b' }],
          },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('No outcome or goal nodes');
    });

    it('returns successful response with outcome nodes', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/suggest/utility-weights',
        payload: {
          graph: {
            nodes: [
              { id: 'goal1', label: 'Maximize Revenue', kind: 'goal' },
              { id: 'dec1', label: 'Strategy', kind: 'decision' },
              { id: 'out1', label: 'Revenue', kind: 'outcome' },
              { id: 'out2', label: 'Customer Satisfaction', kind: 'outcome' },
            ],
            edges: [
              { from: 'goal1', to: 'dec1' },
              { from: 'dec1', to: 'out1' },
              { from: 'dec1', to: 'out2' },
            ],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.schema).toBe('utility_weights.v1');
      expect(body.suggestions).toBeDefined();
      expect(body.suggestions.suggestions).toBeInstanceOf(Array);
      expect(body.outcome_nodes).toBeInstanceOf(Array);
      expect(body.provenance).toBe('plot_fallback');
    });

    it('suggests equal weights as fallback', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/suggest/utility-weights',
        payload: {
          graph: {
            nodes: [
              { id: 'out1', label: 'Outcome 1', kind: 'outcome' },
              { id: 'out2', label: 'Outcome 2', kind: 'outcome' },
            ],
            edges: [],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      // Equal weights for 2 outcomes
      expect(body.suggestions.suggestions[0].suggested_weight).toBe(0.5);
      expect(body.suggestions.suggestions[1].suggested_weight).toBe(0.5);
    });

    it('includes goal nodes in outcome detection', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/suggest/utility-weights',
        payload: {
          graph: {
            nodes: [
              { id: 'goal1', label: 'Primary Goal', kind: 'goal' },
            ],
            edges: [],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.outcome_nodes.some((n: any) => n.node_id === 'goal1')).toBe(true);
    });

    it('includes model_card in response', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/suggest/utility-weights',
        payload: {
          graph: {
            nodes: [{ id: 'out1', label: 'Outcome', kind: 'outcome' }],
            edges: [],
          },
          seed: 123,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.model_card.seed).toBe(123);
      expect(body.model_card.nodes).toBe(1);
      expect(body.model_card.edges).toBe(0);
    });
  });

  // ============================================================================
  // Dominance Analysis Tests
  // ============================================================================

  describe('POST /v1/elicit/risk-tolerance', () => {
    it('returns 400 for missing mode', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/elicit/risk-tolerance',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('mode');
    });

    it('returns 400 for invalid mode', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/elicit/risk-tolerance',
        payload: { mode: 'invalid' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('mode');
    });

    it('returns questions when mode is get_questions', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/elicit/risk-tolerance',
        payload: { mode: 'get_questions' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.schema).toBe('risk_tolerance.v1');
      expect(body.mode).toBe('get_questions');
      expect(body.elicitation.questions).toBeInstanceOf(Array);
      expect(body.elicitation.questions.length).toBeGreaterThan(0);
      expect(body.provenance).toBe('plot_fallback');
    });

    it('returns business-specific questions when context is business', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/elicit/risk-tolerance',
        payload: { mode: 'get_questions', context: 'business' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      // Should include business-specific question
      const businessQuestion = body.elicitation.questions.find(
        (q: any) => q.question_id === 'business_risk_1'
      );
      expect(businessQuestion).toBeDefined();
    });

    it('returns 400 for process_responses without responses', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/elicit/risk-tolerance',
        payload: { mode: 'process_responses' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('responses');
    });

    it('returns risk profile when mode is process_responses', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/elicit/risk-tolerance',
        payload: {
          mode: 'process_responses',
          responses: [
            { question_id: 'risk_scenario_1', answer: 'guaranteed' },
            { question_id: 'risk_scale_1', answer: 3 },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.schema).toBe('risk_tolerance.v1');
      expect(body.mode).toBe('process_responses');
      expect(body.elicitation.risk_profile).toBeDefined();
      expect(body.elicitation.risk_profile.risk_attitude).toBe('risk_neutral');
      expect(body.elicitation.risk_profile.confidence).toBe('low'); // Fallback
      expect(body.provenance).toBe('plot_fallback');
    });

    it('returns risk_averse profile when preset is risk_averse', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/elicit/risk-tolerance',
        payload: { preset: 'risk_averse' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.schema).toBe('risk_tolerance.v1');
      expect(body.mode).toBe('preset');
      expect(body.elicitation.risk_profile).toBeDefined();
      expect(body.elicitation.risk_profile.risk_attitude).toBe('risk_averse');
      expect(body.elicitation.risk_profile.risk_coefficient).toBeLessThan(0);
      expect(body.elicitation.risk_profile.confidence).toBe('high');
      expect(body.provenance).toBe('plot_fallback');
    });

    it('returns neutral profile when preset is neutral', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/elicit/risk-tolerance',
        payload: { preset: 'neutral' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.schema).toBe('risk_tolerance.v1');
      expect(body.mode).toBe('preset');
      expect(body.elicitation.risk_profile).toBeDefined();
      expect(body.elicitation.risk_profile.risk_attitude).toBe('risk_neutral');
      expect(body.elicitation.risk_profile.risk_coefficient).toBe(0);
      expect(body.elicitation.risk_profile.confidence).toBe('high');
      expect(body.provenance).toBe('plot_fallback');
    });

    it('returns risk_seeking profile when preset is risk_seeking', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/elicit/risk-tolerance',
        payload: { preset: 'risk_seeking' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.schema).toBe('risk_tolerance.v1');
      expect(body.mode).toBe('preset');
      expect(body.elicitation.risk_profile).toBeDefined();
      expect(body.elicitation.risk_profile.risk_attitude).toBe('risk_seeking');
      expect(body.elicitation.risk_profile.risk_coefficient).toBeGreaterThan(0);
      expect(body.elicitation.risk_profile.confidence).toBe('high');
      expect(body.provenance).toBe('plot_fallback');
    });

    it('returns 400 for invalid preset value', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/elicit/risk-tolerance',
        payload: { preset: 'invalid_preset' },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('preset');
    });
  });

  // ============================================================================
  // Risk Adjustment Tests
  // ============================================================================

});
