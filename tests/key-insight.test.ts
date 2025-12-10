/**
 * Key Insight Endpoint Tests
 *
 * Phase 2: Tests for /v1/assist/key-insight proxy endpoint
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerKeyInsightRoute } from '../src/routes/v1/key-insight.js';

describe('Key Insight Endpoint', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await registerKeyInsightRoute(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/assist/key-insight', () => {
    it('returns 400 for missing graph', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
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
        url: '/v1/assist/key-insight',
        payload: {
          graph: { nodes, edges: [] },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('max 50 nodes');
    });

    it('returns 400 for graph exceeding edge limit', async () => {
      const nodes = [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ];
      const edges = Array.from({ length: 201 }, () => ({
        from: 'a',
        to: 'b',
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: { nodes, edges },
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.error.message).toContain('max 200 edges');
    });

    it('returns successful response with valid graph', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: {
            nodes: [
              { id: 'goal1', label: 'Increase Revenue', kind: 'goal' },
              { id: 'dec1', label: 'Marketing Strategy', kind: 'decision' },
              { id: 'opt1', label: 'Social Media', kind: 'option' },
              { id: 'opt2', label: 'Email Marketing', kind: 'option' },
              { id: 'out1', label: 'Revenue Increase', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'goal1', to: 'dec1' },
              { from: 'dec1', to: 'opt1' },
              { from: 'dec1', to: 'opt2' },
              { from: 'opt1', to: 'out1', weight: 0.6 },
              { from: 'opt2', to: 'out1', weight: 0.4 },
            ],
          },
          seed: 42,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.schema).toBe('key_insight.v1');
      expect(body.insight).toBeDefined();
      expect(body.insight.insight).toBeTruthy();
      expect(body.insight.confidence).toMatch(/high|medium|low/);
      expect(body.ranked_actions).toBeInstanceOf(Array);
      expect(body.ranking_confidence).toMatch(/high|medium|low/);
      expect(body.provenance).toBe('plot_fallback'); // CEE not enabled
      expect(body.model_card).toBeDefined();
      expect(body.model_card.seed).toBe(42);
    });

    it('generates ranked actions from option nodes', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Option A', kind: 'option' },
              { id: 'opt2', label: 'Option B', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'opt1', to: 'out1', weight: 0.7 },
              { from: 'opt2', to: 'out1', weight: 0.3 },
            ],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.ranked_actions.length).toBe(2);
      expect(body.ranked_actions[0].label).toBe('Option A');
      expect(body.ranked_actions[0].rank).toBe(1);
      expect(body.ranked_actions[1].label).toBe('Option B');
      expect(body.ranked_actions[1].rank).toBe(2);

      // Check distribution structure
      expect(body.ranked_actions[0].distribution).toHaveProperty('p10');
      expect(body.ranked_actions[0].distribution).toHaveProperty('p50');
      expect(body.ranked_actions[0].distribution).toHaveProperty('p90');
    });

    it('generates single ranked action for graph without options', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: {
            nodes: [
              { id: 'a', label: 'A', value: 100 },
              { id: 'b', label: 'B', value: 50 },
            ],
            edges: [{ from: 'a', to: 'b', weight: 0.5 }],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.ranked_actions.length).toBe(1);
      expect(body.ranked_actions[0].label).toBe('Overall');
      expect(body.ranked_actions[0].rank).toBe(1);
    });

    it('includes context in response when provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: {
            nodes: [
              { id: 'a', label: 'A', kind: 'goal' },
              { id: 'b', label: 'B', kind: 'outcome', value: 100 },
            ],
            edges: [{ from: 'a', to: 'b' }],
          },
          context: {
            question: 'Should we invest in project X?',
            notes: 'Budget is limited',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      // Context is passed to CEE but response structure is validated
      expect(body.insight).toBeDefined();
    });

    it('uses provided outcome_node for inference', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: {
            nodes: [
              { id: 'a', label: 'A', value: 100 },
              { id: 'b', label: 'B', value: 50 },
              { id: 'c', label: 'C', value: 75 },
            ],
            edges: [
              { from: 'a', to: 'b' },
              { from: 'b', to: 'c' },
            ],
          },
          outcome_node: 'b', // Explicitly specify non-last node
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('generates fallback insight with confidence message', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: {
            nodes: [
              { id: 'opt1', label: 'Low Risk', kind: 'option' },
              { id: 'opt2', label: 'High Risk', kind: 'option' },
              { id: 'out1', label: 'Return', kind: 'outcome', value: 100 },
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

      // Fallback insight mentions options
      expect(body.insight.insight).toContain('Low Risk');
      expect(body.insight.evidence).toBeInstanceOf(Array);
    });

    it('includes model_card with response_hash', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: {
            nodes: [{ id: 'a', label: 'A', value: 100 }],
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
      expect(body.model_card.backend).toBe('scm_lite');
      expect(body.model_card.response_hash).toMatch(/^[a-f0-9]{16}$/);
    });

    it('deterministic response hash for same input', async () => {
      const payload = {
        graph: {
          nodes: [{ id: 'a', label: 'A', value: 100 }],
          edges: [],
        },
        seed: 999,
      };

      const response1 = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload,
      });

      const response2 = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload,
      });

      const body1 = JSON.parse(response1.payload);
      const body2 = JSON.parse(response2.payload);

      expect(body1.model_card.response_hash).toBe(body2.model_card.response_hash);
    });

    it('includes edge type inference warnings when types are inferred', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: {
            nodes: [
              { id: 'goal1', label: 'Goal', kind: 'goal' },
              { id: 'dec1', label: 'Decision', kind: 'decision' },
              { id: 'opt1', label: 'Option', kind: 'option' },
              { id: 'out1', label: 'Outcome', kind: 'outcome', value: 100 },
            ],
            edges: [
              { from: 'goal1', to: 'dec1' },  // functional inferred
              { from: 'dec1', to: 'opt1' },   // structural inferred
              { from: 'opt1', to: 'out1' },   // probabilistic inferred
            ],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.warnings).toBeDefined();
      expect(body.warnings.length).toBeGreaterThanOrEqual(3);

      const edgeTypeWarnings = body.warnings.filter(
        (w: any) => w.code === 'EDGE_TYPE_INFERRED'
      );
      expect(edgeTypeWarnings.length).toBe(3);
      expect(edgeTypeWarnings[0].severity).toBe('info');
    });

    it('includes primary outcome inferred warning', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: {
            nodes: [
              { id: 'a', label: 'A', kind: 'goal' },
              { id: 'b', label: 'B', kind: 'outcome', value: 100 },
            ],
            edges: [{ from: 'a', to: 'b' }],
          },
          // No outcome_node specified - will be inferred
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      const outcomeWarnings = body.warnings?.filter(
        (w: any) => w.code === 'PRIMARY_OUTCOME_INFERRED'
      );
      expect(outcomeWarnings?.length).toBe(1);
    });

    it('does not include edge type warnings when types are explicit', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: {
            nodes: [
              { id: 'goal1', label: 'Goal', kind: 'goal' },
              { id: 'dec1', label: 'Decision', kind: 'decision' },
            ],
            edges: [
              { from: 'goal1', to: 'dec1', edge_type: 'functional' },  // Explicit
            ],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      const edgeTypeWarnings = body.warnings?.filter(
        (w: any) => w.code === 'EDGE_TYPE_INFERRED'
      ) ?? [];
      expect(edgeTypeWarnings.length).toBe(0);
    });

    it('does not include outcome warning when outcome_node is provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/assist/key-insight',
        payload: {
          graph: {
            nodes: [
              { id: 'a', label: 'A', value: 100 },
              { id: 'b', label: 'B', value: 50 },
            ],
            edges: [{ from: 'a', to: 'b' }],
          },
          outcome_node: 'b',  // Explicitly provided
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      const outcomeWarnings = body.warnings?.filter(
        (w: any) => w.code === 'PRIMARY_OUTCOME_INFERRED'
      ) ?? [];
      expect(outcomeWarnings.length).toBe(0);
    });
  });
});
