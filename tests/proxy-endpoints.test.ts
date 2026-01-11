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

  describe('POST /v1/analysis/dominance', () => {
    it('returns 400 for missing graph', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/dominance',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('graph.nodes required');
    });

    it('returns 400 for insufficient options', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/dominance',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [{ from: 'opt1', to: 'out1' }],
          },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('At least 2 option or action nodes');
    });

    it('returns successful response with multiple options', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/dominance',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Conservative', kind: 'option' },
              { id: 'opt2', label: 'Aggressive', kind: 'option' },
              { id: 'out1', label: 'Return', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.8 },
              { from: 'opt2', to: 'out1', weight: 0.4 },
            ],
          },
          seed: 42,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.schema).toBe('dominance.v1');
      expect(body.analysis).toBeDefined();
      expect(body.analysis.pareto_optimal).toBeInstanceOf(Array);
      expect(body.analysis.dominated).toBeInstanceOf(Array);
      expect(body.option_results).toBeInstanceOf(Array);
      expect(body.option_results.length).toBe(2);
      expect(body.provenance).toBe('plot_fallback');
    });

    it('normalizes scores to 0-1 range', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/dominance',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option A', kind: 'option' },
              { id: 'opt2', label: 'Option B', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.9 },
              { from: 'opt2', to: 'out1', weight: 0.1 },
            ],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      for (const option of body.option_results) {
        expect(option.score).toBeGreaterThanOrEqual(0);
        expect(option.score).toBeLessThanOrEqual(1);
      }
    });

    it('detects dominance relationships', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/dominance',
        payload: {
          graph: {
            nodes: [
              { id: 'good', label: 'Good Option', kind: 'option' },
              { id: 'bad', label: 'Bad Option', kind: 'option' },
              { id: 'out1', label: 'Success', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'good', to: 'out1', weight: 0.95 },
              { from: 'bad', to: 'out1', weight: 0.05 },
            ],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      // Good option should dominate or be Pareto-optimal
      expect(body.analysis.pareto_optimal.length).toBeGreaterThan(0);
    });

    it('includes distribution in option results', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/dominance',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option' },
              { id: 'opt2', label: 'Option 2', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.5 },
              { from: 'opt2', to: 'out1', weight: 0.5 },
            ],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      for (const option of body.option_results) {
        expect(option.distribution).toHaveProperty('p10');
        expect(option.distribution).toHaveProperty('p50');
        expect(option.distribution).toHaveProperty('p90');
      }
    });

    it('includes model_card with options_analyzed', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/dominance',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option' },
              { id: 'opt2', label: 'Option 2', kind: 'option' },
              { id: 'opt3', label: 'Option 3', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.7 },
              { from: 'opt2', to: 'out1', weight: 0.5 },
              { from: 'opt3', to: 'out1', weight: 0.3 },
            ],
          },
          seed: 456,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.model_card.seed).toBe(456);
      expect(body.model_card.options_analyzed).toBe(3);
    });

    it('handles action nodes as options', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/dominance',
        payload: {
          graph: {
            nodes: [
              { id: 'act1', label: 'Action 1', kind: 'action' },
              { id: 'act2', label: 'Action 2', kind: 'action' },
              { id: 'out1', label: 'Result', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'act1', to: 'out1', weight: 0.6 },
              { from: 'act2', to: 'out1', weight: 0.4 },
            ],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.option_results.length).toBe(2);
      expect(body.option_results.some((o: any) => o.option_id === 'act1')).toBe(true);
      expect(body.option_results.some((o: any) => o.option_id === 'act2')).toBe(true);
    });
  });

  // ============================================================================
  // Pareto Analysis Tests
  // ============================================================================

  describe('POST /v1/analysis/pareto', () => {
    it('returns 400 for missing graph', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/pareto',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('graph.nodes required');
    });

    it('returns 400 for insufficient options', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/pareto',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [{ from: 'opt1', to: 'out1' }],
          },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('At least 2 option or action nodes');
    });

    it('returns successful response with Pareto frontier', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/pareto',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Conservative', kind: 'option' },
              { id: 'opt2', label: 'Aggressive', kind: 'option' },
              { id: 'out1', label: 'Return', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.8 },
              { from: 'opt2', to: 'out1', weight: 0.6 },
            ],
          },
          seed: 42,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.schema).toBe('pareto.v1');
      expect(body.analysis).toBeDefined();
      expect(body.analysis.frontier).toBeInstanceOf(Array);
      expect(body.analysis.dominated).toBeInstanceOf(Array);
      expect(body.analysis.frontier_size).toBeGreaterThan(0);
      expect(body.option_results).toBeInstanceOf(Array);
      expect(body.provenance).toBe('plot_fallback');
    });

    it('identifies dominated options', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/pareto',
        payload: {
          graph: {
            nodes: [
              { id: 'best', label: 'Best Option', kind: 'option' },
              { id: 'worst', label: 'Worst Option', kind: 'option' },
              { id: 'out1', label: 'Success', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'best', to: 'out1', weight: 0.95 },
              { from: 'worst', to: 'out1', weight: 0.05 },
            ],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      // Best should be on frontier
      expect(body.analysis.frontier).toContain('best');
      // At least one option should be analyzed
      expect(body.option_results.length).toBe(2);
    });

    it('generates trade-off descriptions for frontier options', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/pareto',
        payload: {
          graph: {
            nodes: [
              { id: 'risky', label: 'High Risk High Reward', kind: 'option' },
              { id: 'safe', label: 'Low Risk Low Reward', kind: 'option' },
              { id: 'medium', label: 'Medium Risk', kind: 'option' },
              { id: 'out1', label: 'Return', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'risky', to: 'out1', weight: 0.9 },
              { from: 'safe', to: 'out1', weight: 0.3 },
              { from: 'medium', to: 'out1', weight: 0.6 },
            ],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      // Should have trade-offs if multiple options on frontier
      if (body.analysis.frontier.length > 1) {
        expect(body.analysis.trade_offs).toBeInstanceOf(Array);
      }
    });

    it('normalizes scores to 0-1 range', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/pareto',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option A', kind: 'option' },
              { id: 'opt2', label: 'Option B', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.9 },
              { from: 'opt2', to: 'out1', weight: 0.1 },
            ],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      for (const option of body.option_results) {
        expect(option.score).toBeGreaterThanOrEqual(0);
        expect(option.score).toBeLessThanOrEqual(1);
      }
    });

    it('includes model_card with options_analyzed', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/pareto',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option' },
              { id: 'opt2', label: 'Option 2', kind: 'option' },
              { id: 'opt3', label: 'Option 3', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.7 },
              { from: 'opt2', to: 'out1', weight: 0.5 },
              { from: 'opt3', to: 'out1', weight: 0.3 },
            ],
          },
          seed: 789,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.model_card.seed).toBe(789);
      expect(body.model_card.options_analyzed).toBe(3);
    });
  });

  // ============================================================================
  // Multi-Criteria Analysis Tests
  // ============================================================================

  describe('POST /v1/analysis/multi-criteria', () => {
    it('returns 400 for missing graph', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/multi-criteria',
        payload: {
          criteria: [{ id: 'c1', name: 'Criterion 1', weight: 1.0, outcome_node: 'out1' }],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('graph.nodes required');
    });

    it('returns 400 for missing criteria', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/multi-criteria',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [{ from: 'opt1', to: 'out1' }],
          },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('criteria');
    });

    it('returns 400 for weights not summing to 1.0', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/multi-criteria',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option' },
              { id: 'opt2', label: 'Option 2', kind: 'option' },
              { id: 'out1', label: 'Revenue', kind: 'outcome', value: 100 },
              { id: 'out2', label: 'Cost', kind: 'outcome', value: 50 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.7 },
              { from: 'opt2', to: 'out1', weight: 0.5 },
            ],
          },
          criteria: [
            { id: 'revenue', name: 'Revenue', weight: 0.3, outcome_node: 'out1' },
            { id: 'cost', name: 'Cost', weight: 0.3, outcome_node: 'out2' },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('Criteria weights must sum to 1.0');
    });

    it('returns 400 for insufficient options', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/multi-criteria',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [{ from: 'opt1', to: 'out1' }],
          },
          criteria: [{ id: 'c1', name: 'Criterion 1', weight: 1.0, outcome_node: 'out1' }],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('At least 2 option or action nodes');
    });

    it('returns successful response with aggregated rankings', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/multi-criteria',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Conservative', kind: 'option' },
              { id: 'opt2', label: 'Aggressive', kind: 'option' },
              { id: 'revenue', label: 'Revenue', kind: 'outcome', value: 100 },
              { id: 'risk', label: 'Risk', kind: 'outcome', value: 50 },
            ],
            edges: [
              { from: 'opt1', to: 'revenue', weight: 0.6 },
              { from: 'opt1', to: 'risk', weight: 0.2 },
              { from: 'opt2', to: 'revenue', weight: 0.9 },
              { from: 'opt2', to: 'risk', weight: 0.8 },
            ],
          },
          criteria: [
            { id: 'maximize_revenue', name: 'Maximize Revenue', weight: 0.6, outcome_node: 'revenue' },
            { id: 'minimize_risk', name: 'Minimize Risk', weight: 0.4, outcome_node: 'risk' },
          ],
          seed: 42,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.schema).toBe('multi_criteria.v1');
      expect(body.aggregation).toBeDefined();
      expect(body.aggregation.aggregated_rankings).toBeInstanceOf(Array);
      expect(body.aggregation.aggregated_rankings.length).toBe(2);
      expect(body.provenance).toBe('plot_fallback');
    });

    it('uses weighted_sum aggregation by default', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/multi-criteria',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option' },
              { id: 'opt2', label: 'Option 2', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.7 },
              { from: 'opt2', to: 'out1', weight: 0.5 },
            ],
          },
          criteria: [{ id: 'c1', name: 'Criterion 1', weight: 1.0, outcome_node: 'out1' }],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.model_card.aggregation_method).toBe('weighted_sum');
    });

    it('supports weighted_product aggregation', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/multi-criteria',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option' },
              { id: 'opt2', label: 'Option 2', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.7 },
              { from: 'opt2', to: 'out1', weight: 0.5 },
            ],
          },
          criteria: [{ id: 'c1', name: 'Criterion 1', weight: 1.0, outcome_node: 'out1' }],
          aggregation_method: 'weighted_product',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.model_card.aggregation_method).toBe('weighted_product');
    });

    it('includes criterion_results in response', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/multi-criteria',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option' },
              { id: 'opt2', label: 'Option 2', kind: 'option' },
              { id: 'out1', label: 'Revenue', kind: 'outcome', value: 100 },
              { id: 'out2', label: 'Cost', kind: 'outcome', value: 50 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.7 },
              { from: 'opt2', to: 'out1', weight: 0.5 },
              { from: 'opt1', to: 'out2', weight: 0.3 },
              { from: 'opt2', to: 'out2', weight: 0.6 },
            ],
          },
          criteria: [
            { id: 'rev', name: 'Revenue', weight: 0.5, outcome_node: 'out1' },
            { id: 'cost', name: 'Cost', weight: 0.5, outcome_node: 'out2' },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.criterion_results).toBeInstanceOf(Array);
      expect(body.criterion_results.length).toBe(2);

      for (const cr of body.criterion_results) {
        expect(cr.criterion_id).toBeDefined();
        expect(cr.option_scores).toBeInstanceOf(Array);
        expect(cr.option_scores.length).toBe(2);
      }
    });

    it('includes timing information', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/multi-criteria',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option' },
              { id: 'opt2', label: 'Option 2', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.7 },
              { from: 'opt2', to: 'out1', weight: 0.5 },
            ],
          },
          criteria: [{ id: 'c1', name: 'Criterion 1', weight: 1.0, outcome_node: 'out1' }],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.timing).toBeDefined();
      expect(typeof body.timing.inference_ms).toBe('number');
      expect(typeof body.timing.total_ms).toBe('number');
    });

    it('aggregated scores are sorted by rank', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/multi-criteria',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option' },
              { id: 'opt2', label: 'Option 2', kind: 'option' },
              { id: 'out1', label: 'Outcome 1', kind: 'outcome', value: 100 },
              { id: 'out2', label: 'Outcome 2', kind: 'outcome', value: 200 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.9 },
              { from: 'opt2', to: 'out1', weight: 0.1 },
              { from: 'opt1', to: 'out2', weight: 0.1 },
              { from: 'opt2', to: 'out2', weight: 0.9 },
            ],
          },
          criteria: [
            { id: 'c1', name: 'Criterion 1', weight: 0.5, outcome_node: 'out1' },
            { id: 'c2', name: 'Criterion 2', weight: 0.5, outcome_node: 'out2' },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      // Rankings should be sorted by score descending (rank 1 = best)
      for (let i = 0; i < body.aggregation.aggregated_rankings.length - 1; i++) {
        const current = body.aggregation.aggregated_rankings[i];
        const next = body.aggregation.aggregated_rankings[i + 1];
        expect(current.aggregated_score).toBeGreaterThanOrEqual(next.aggregated_score);
        expect(current.rank).toBeLessThan(next.rank);
      }
    });
  });

  // ============================================================================
  // Risk Tolerance Elicitation Tests
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

  describe('POST /v1/analysis/risk-adjust', () => {
    it('returns 400 for missing graph', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/risk-adjust',
        payload: { risk_coefficient: 0 },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('graph.nodes required');
    });

    it('returns 400 for missing risk_coefficient', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/risk-adjust',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option' },
              { id: 'opt2', label: 'Option 2', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.7 },
              { from: 'opt2', to: 'out1', weight: 0.5 },
            ],
          },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('risk_coefficient');
    });

    it('returns 400 for insufficient options', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/risk-adjust',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [{ from: 'opt1', to: 'out1' }],
          },
          risk_coefficient: 0,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('At least 2 option');
    });

    it('returns successful response with risk-neutral coefficient', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/risk-adjust',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Low Risk', kind: 'option' },
              { id: 'opt2', label: 'High Risk', kind: 'option' },
              { id: 'out1', label: 'Return', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.8 },
              { from: 'opt2', to: 'out1', weight: 0.4 },
            ],
          },
          risk_coefficient: 0,
          seed: 42,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.schema).toBe('risk_adjust.v1');
      expect(body.analysis).toBeDefined();
      expect(body.analysis.adjusted_scores).toBeInstanceOf(Array);
      expect(body.analysis.adjusted_scores.length).toBe(2);
      expect(body.analysis.interpretation).toContain('neutral');
      expect(body.risk_parameters.risk_coefficient).toBe(0);
      expect(body.provenance).toBe('plot_fallback');
    });

    it('applies risk-averse adjustment with negative coefficient', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/risk-adjust',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Safe', kind: 'option' },
              { id: 'opt2', label: 'Risky', kind: 'option' },
              { id: 'out1', label: 'Return', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.7 },
              { from: 'opt2', to: 'out1', weight: 0.5 },
            ],
          },
          risk_coefficient: -1,
          risk_type: 'linear',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.risk_parameters.risk_coefficient).toBe(-1);
      expect(body.risk_parameters.risk_type).toBe('linear');
      expect(body.analysis.interpretation).toContain('averse');
    });

    it('applies risk-seeking adjustment with positive coefficient', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/risk-adjust',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Conservative', kind: 'option' },
              { id: 'opt2', label: 'Aggressive', kind: 'option' },
              { id: 'out1', label: 'Payoff', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.6 },
              { from: 'opt2', to: 'out1', weight: 0.5 },
            ],
          },
          risk_coefficient: 1,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.risk_parameters.risk_coefficient).toBe(1);
      expect(body.analysis.interpretation).toContain('seeking');
    });

    it('includes distribution in adjusted scores', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/risk-adjust',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option' },
              { id: 'opt2', label: 'Option 2', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.7 },
              { from: 'opt2', to: 'out1', weight: 0.5 },
            ],
          },
          risk_coefficient: 0,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      for (const score of body.analysis.adjusted_scores) {
        expect(score.distribution).toHaveProperty('p10');
        expect(score.distribution).toHaveProperty('p50');
        expect(score.distribution).toHaveProperty('p90');
        expect(score.original_rank).toBeGreaterThan(0);
        expect(score.adjusted_rank).toBeGreaterThan(0);
      }
    });
  });

  // ============================================================================
  // Threshold Identification Tests
  // ============================================================================

  describe('POST /v1/analysis/thresholds', () => {
    it('returns 400 for missing graph', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/thresholds',
        payload: {
          sweeps: [{ node_id: 'n1', parameter: 'value', values: [0, 1] }],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('graph.nodes required');
    });

    it('returns 400 for missing sweeps', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/thresholds',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option' },
              { id: 'opt2', label: 'Option 2', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.7 },
              { from: 'opt2', to: 'out1', weight: 0.5 },
            ],
          },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('sweeps');
    });

    it('returns 400 for too many sweeps', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/thresholds',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option' },
              { id: 'opt2', label: 'Option 2', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [{ from: 'opt1', to: 'out1' }],
          },
          sweeps: [
            { node_id: 'out1', parameter: 'value', values: [1, 2] },
            { node_id: 'out1', parameter: 'value', values: [1, 2] },
            { node_id: 'out1', parameter: 'value', values: [1, 2] },
            { node_id: 'out1', parameter: 'value', values: [1, 2] },
            { node_id: 'out1', parameter: 'value', values: [1, 2] },
            { node_id: 'out1', parameter: 'value', values: [1, 2] },
          ],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('sweeps');
    });

    it('returns 400 for insufficient options', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/thresholds',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [{ from: 'opt1', to: 'out1' }],
          },
          sweeps: [{ node_id: 'out1', parameter: 'value', values: [50, 100, 150] }],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('At least 2 option');
    });

    it('returns successful response with threshold analysis', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/thresholds',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option A', kind: 'option' },
              { id: 'opt2', label: 'Option B', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.7 },
              { from: 'opt2', to: 'out1', weight: 0.5 },
            ],
          },
          sweeps: [{ node_id: 'out1', parameter: 'value', values: [50, 100, 150] }],
          seed: 42,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.schema).toBe('thresholds.v1');
      expect(body.analysis).toBeDefined();
      expect(body.analysis.thresholds).toBeInstanceOf(Array);
      expect(body.analysis.sensitivity_ranking).toBeInstanceOf(Array);
      expect(body.sweep_results).toBeInstanceOf(Array);
      expect(body.sweep_results.length).toBe(1);
      expect(body.provenance).toBe('plot_fallback');
    });

    it('includes sweep_results with scores at each value', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/thresholds',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option' },
              { id: 'opt2', label: 'Option 2', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.8 },
              { from: 'opt2', to: 'out1', weight: 0.4 },
            ],
          },
          sweeps: [{ node_id: 'out1', parameter: 'value', values: [50, 75, 100, 125] }],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      const sweepResult = body.sweep_results[0];
      expect(sweepResult.node_id).toBe('out1');
      expect(sweepResult.parameter).toBe('value');
      expect(sweepResult.scores.length).toBe(4);

      for (const score of sweepResult.scores) {
        expect(score.option_scores.length).toBe(2);
      }
    });

    it('includes timing information', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/thresholds',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option' },
              { id: 'opt2', label: 'Option 2', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.7 },
              { from: 'opt2', to: 'out1', weight: 0.5 },
            ],
          },
          sweeps: [{ node_id: 'out1', parameter: 'value', values: [50, 100] }],
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.timing).toBeDefined();
      expect(typeof body.timing.inference_ms).toBe('number');
      expect(typeof body.timing.total_ms).toBe('number');
    });

    it('includes model_card with total_evaluations', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/analysis/thresholds',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option 1', kind: 'option' },
              { id: 'opt2', label: 'Option 2', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.7 },
              { from: 'opt2', to: 'out1', weight: 0.5 },
            ],
          },
          sweeps: [{ node_id: 'out1', parameter: 'value', values: [50, 100, 150] }],
          seed: 123,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.model_card.seed).toBe(123);
      expect(body.model_card.sweeps_count).toBe(1);
      // 3 values * 2 options = 6 evaluations
      expect(body.model_card.total_evaluations).toBe(6);
    });
  });
});
