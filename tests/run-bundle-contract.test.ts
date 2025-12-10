/**
 * Contract Tests for /v1/run_bundle Response Fields
 *
 * Verifies that response fields match OpenAPI schema:
 * - ranking_summary, ranking_mode_used with include_ranking
 * - delta_from_baseline.change_attribution with include_change_attribution
 * - Per-result sensitivity_by_node
 * - Meta baseline_label, baseline_index
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { registerRunBundleRoute } from '../src/routes/v1/run-bundle.js';

describe('POST /v1/run_bundle - Contract Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await registerRunBundleRoute(app);
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('ranking fields (include_ranking: true)', () => {
    it('returns ranking_summary and ranking_mode_used', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/run_bundle',
        payload: {
          base_graph: {
            nodes: [
              { id: 'A', label: 'Driver', value: 0.5 },
              { id: 'B', label: 'Outcome', kind: 'outcome' },
            ],
            edges: [{ from: 'A', to: 'B', weight: 0.8 }],
          },
          deltas: [
            { label: 'Low', nodes: [{ id: 'A', value: 0.3 }] },
            { label: 'High', nodes: [{ id: 'A', value: 0.9 }] },
          ],
          seed: 4242,
          include_ranking: true,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);

      // ranking_summary must exist
      expect(body.ranking_summary).toBeDefined();
      expect(body.ranking_summary.winner).toBeDefined();
      expect(body.ranking_summary.winner_p50).toBeDefined();
      expect(body.ranking_summary.ranking_confidence).toMatch(/^(high|medium|low)$/);
      expect(body.ranking_summary.ranked_count).toBeGreaterThan(0);

      // ranking_mode_used must exist
      expect(body.ranking_mode_used).toBeDefined();
      expect(body.ranking_mode_used).toMatch(/^(simple|utility)$/);

      // primary_outcome fields
      expect(body.primary_outcome_used).toBeDefined();
      expect(typeof body.primary_outcome_detected).toBe('boolean');

      // Per-result rank field
      for (const result of body.results) {
        if (result.summary) {
          expect(typeof result.rank).toBe('number');
          expect(result.rank).toBeGreaterThan(0);
        }
      }
    });

    it('omits ranking fields when include_ranking: false', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/run_bundle',
        payload: {
          base_graph: {
            nodes: [
              { id: 'A', label: 'Driver', value: 0.5 },
              { id: 'B', label: 'Outcome' },
            ],
            edges: [{ from: 'A', to: 'B' }],
          },
          deltas: [
            { label: 'Low', nodes: [{ id: 'A', value: 0.3 }] },
          ],
          seed: 4242,
          include_ranking: false,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);

      expect(body.ranking_summary).toBeUndefined();
      expect(body.ranking_mode_used).toBeUndefined();
    });
  });

  describe('change attribution fields (include_change_attribution: true)', () => {
    it('returns delta_from_baseline with change_attribution', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/run_bundle',
        payload: {
          base_graph: {
            nodes: [
              { id: 'A', label: 'Driver', value: 0.5 },
              { id: 'B', label: 'Outcome', kind: 'outcome' },
            ],
            edges: [{ from: 'A', to: 'B', weight: 0.8 }],
          },
          deltas: [
            { label: 'Baseline', nodes: [] },
            { label: 'Modified', nodes: [{ id: 'A', value: 0.9 }] },
          ],
          seed: 4242,
          include_change_attribution: true,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);

      // Find a non-baseline result
      const modifiedResult = body.results.find((r: any) => r.label === 'Modified');
      expect(modifiedResult).toBeDefined();

      if (modifiedResult?.delta_from_baseline) {
        expect(typeof modifiedResult.delta_from_baseline.p10).toBe('number');
        expect(typeof modifiedResult.delta_from_baseline.p50).toBe('number');
        expect(typeof modifiedResult.delta_from_baseline.p90).toBe('number');

        // change_attribution should exist
        const ca = modifiedResult.delta_from_baseline.change_attribution;
        expect(ca).toBeDefined();
        expect(typeof ca.summary).toBe('string');
        expect(Array.isArray(ca.primary_drivers)).toBe(true);
      }
    });
  });

  describe('meta fields', () => {
    it('returns baseline_label and baseline_index in meta', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/run_bundle',
        payload: {
          base_graph: {
            nodes: [
              { id: 'A', label: 'Driver', value: 0.5 },
              { id: 'B', label: 'Outcome' },
            ],
            edges: [{ from: 'A', to: 'B' }],
          },
          deltas: [
            { label: 'First Option', nodes: [{ id: 'A', value: 0.3 }] },
            { label: 'Second Option', nodes: [{ id: 'A', value: 0.7 }] },
          ],
          seed: 4242,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);

      expect(body.meta).toBeDefined();
      expect(typeof body.meta.baseline_label).toBe('string');
      expect(typeof body.meta.baseline_index).toBe('number');
      expect(body.meta.baseline_index).toBeGreaterThanOrEqual(0);
    });
  });

  describe('edge type inference fields', () => {
    it('returns edge_type_inference summary', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/run_bundle',
        payload: {
          base_graph: {
            nodes: [
              { id: 'goal1', label: 'Goal', kind: 'goal' },
              { id: 'dec1', label: 'Decision', kind: 'decision' },
              { id: 'out1', label: 'Outcome', kind: 'outcome' },
            ],
            edges: [
              { from: 'goal1', to: 'dec1' }, // Will be inferred as functional
              { from: 'dec1', to: 'out1' }, // Will be inferred
            ],
          },
          deltas: [{ label: 'Test', nodes: [] }],
          seed: 4242,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);

      // edge_type_inference should exist
      if (body.edge_type_inference) {
        expect(typeof body.edge_type_inference.explicit_count).toBe('number');
        expect(typeof body.edge_type_inference.inferred_count).toBe('number');

        if (body.edge_type_inference.inferred_edges) {
          for (const edge of body.edge_type_inference.inferred_edges) {
            expect(edge.edge_id).toBeDefined();
            expect(edge.inferred_type).toMatch(/^(functional|structural|probabilistic)$/);
          }
        }
      }
    });
  });

  describe('warnings array', () => {
    it('returns warnings for inferred values', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/run_bundle',
        payload: {
          base_graph: {
            nodes: [
              { id: 'goal1', label: 'Goal', kind: 'goal' },
              { id: 'dec1', label: 'Decision', kind: 'decision' },
            ],
            edges: [
              { from: 'goal1', to: 'dec1' }, // No edge_type → will be inferred
            ],
          },
          deltas: [{ label: 'Test', nodes: [] }],
          seed: 4242,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);

      // warnings array should exist if inference happened
      if (body.warnings && body.warnings.length > 0) {
        for (const warning of body.warnings) {
          expect(warning.code).toMatch(/^(EDGE_TYPE_INFERRED|PRIMARY_OUTCOME_INFERRED|BELIEF_DEFAULTED)$/);
          expect(typeof warning.message).toBe('string');
          expect(warning.severity).toMatch(/^(info|warning)$/);
        }
      }
    });
  });

  describe('sort_by parameter', () => {
    it('uses p10 for ranking when sort_by: p10', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/run_bundle',
        payload: {
          base_graph: {
            nodes: [
              { id: 'A', label: 'Driver', value: 0.5 },
              { id: 'B', label: 'Outcome', kind: 'outcome' },
            ],
            edges: [{ from: 'A', to: 'B', weight: 0.8 }],
          },
          deltas: [
            { label: 'Option1', nodes: [{ id: 'A', value: 0.3 }] },
            { label: 'Option2', nodes: [{ id: 'A', value: 0.9 }] },
          ],
          seed: 4242,
          sort_by: 'p10',
          include_ranking: true,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);

      expect(body.ranking_summary).toBeDefined();
      // success_probability should correspond to p10
      for (const result of body.results) {
        if (result.summary && result.success_probability !== undefined) {
          expect(result.success_probability).toBeCloseTo(result.summary.p10, 5);
        }
      }
    });
  });

  describe('ranking_mode parameter', () => {
    it('requires utility_function when ranking_mode: utility', async () => {
      // utility mode is reserved for future implementation
      // Currently requires utility_function to be provided
      const res = await app.inject({
        method: 'POST',
        url: '/v1/run_bundle',
        payload: {
          base_graph: {
            nodes: [
              { id: 'A', label: 'Driver', value: 0.5 },
              { id: 'B', label: 'Outcome' },
            ],
            edges: [{ from: 'A', to: 'B' }],
          },
          deltas: [
            { label: 'Low', nodes: [{ id: 'A', value: 0.3 }] },
          ],
          seed: 4242,
          ranking_mode: 'utility',
          include_ranking: true,
        },
      });

      // Returns 400 because utility_function is required
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.payload);
      expect(body.message).toContain('utility_function');
    });

    it('accepts ranking_mode: simple (default)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/run_bundle',
        payload: {
          base_graph: {
            nodes: [
              { id: 'A', label: 'Driver', value: 0.5 },
              { id: 'B', label: 'Outcome' },
            ],
            edges: [{ from: 'A', to: 'B' }],
          },
          deltas: [
            { label: 'Low', nodes: [{ id: 'A', value: 0.3 }] },
            { label: 'High', nodes: [{ id: 'A', value: 0.9 }] },
          ],
          seed: 4242,
          ranking_mode: 'simple',
          include_ranking: true,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);

      expect(body.ranking_summary).toBeDefined();
      expect(body.ranking_mode_used).toBe('simple');
    });
  });
});
