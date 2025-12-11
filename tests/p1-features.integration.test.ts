/**
 * P1 Features Integration Tests
 *
 * Tests that P1 features (insights, graph_quality, sensitivity_summary)
 * are correctly included in /v1/run responses with proper structure.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';

describe('P1 Features Integration', () => {
  let app: any;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    const { registerRunRoute } = await import('../src/routes/v1/run.js');
    await registerRunRoute(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // Test graph with multiple edges for meaningful sensitivity analysis
  const testGraph = {
    nodes: [
      { id: 'A', label: 'Input A' },
      { id: 'B', label: 'Intermediate B' },
      { id: 'C', label: 'Output C' },
    ],
    edges: [
      { from: 'A', to: 'B', weight: 0.7, belief: 0.9, provenance: 'expert' },
      { from: 'B', to: 'C', weight: 0.5, belief: 0.8, provenance: 'data' },
      { from: 'A', to: 'C', weight: 0.3, belief: 0.7, provenance: 'template' },
    ],
  };

  describe('insights block', () => {
    it('should include insights in standard mode response', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/run',
        payload: { graph: testGraph, detail_level: 'standard' },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.insights).toBeDefined();
      expect(typeof body.insights.summary).toBe('string');
      expect(body.insights.summary.length).toBeLessThanOrEqual(200);
      expect(Array.isArray(body.insights.risks)).toBe(true);
      expect(body.insights.risks.length).toBeLessThanOrEqual(5);
      expect(Array.isArray(body.insights.next_steps)).toBe(true);
      expect(body.insights.next_steps.length).toBeLessThanOrEqual(3);
    });

    it('should include insights in deep mode response', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/run',
        payload: { graph: testGraph, detail_level: 'deep' },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.insights).toBeDefined();
      expect(typeof body.insights.summary).toBe('string');
    });

    it('should include insights in quick mode response', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/run',
        payload: { graph: testGraph, detail_level: 'quick' },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      // Insights should still be included in quick mode
      expect(body.insights).toBeDefined();
      expect(typeof body.insights.summary).toBe('string');
    });

    it('should truncate risk strings to 100 chars', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/run',
        payload: { graph: testGraph, detail_level: 'standard' },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      for (const risk of body.insights.risks) {
        expect(risk.length).toBeLessThanOrEqual(100);
      }
    });

    it('should truncate next_steps strings to 150 chars', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/run',
        payload: { graph: testGraph, detail_level: 'standard' },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      for (const step of body.insights.next_steps) {
        expect(step.length).toBeLessThanOrEqual(150);
      }
    });
  });

  describe('graph_quality block', () => {
    it('should include graph_quality in standard mode response', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/run',
        payload: { graph: testGraph, detail_level: 'standard' },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.graph_quality).toBeDefined();
      expect(typeof body.graph_quality.score).toBe('number');
      expect(body.graph_quality.score).toBeGreaterThanOrEqual(0);
      expect(body.graph_quality.score).toBeLessThanOrEqual(1);
      expect(typeof body.graph_quality.completeness).toBe('number');
      expect(typeof body.graph_quality.evidence_coverage).toBe('number');
      expect(typeof body.graph_quality.balance).toBe('number');
      expect(typeof body.graph_quality.issues_count).toBe('number');
    });

    it('should calculate evidence_coverage excluding template provenance', async () => {
      // Graph with 2 edges with provenance (expert, data) and 1 template
      const response = await app.inject({
        method: 'POST',
        url: '/v1/run',
        payload: { graph: testGraph, detail_level: 'standard' },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      // 2 out of 3 edges have non-template provenance
      expect(body.graph_quality.evidence_coverage).toBeCloseTo(2 / 3, 1);
    });

    it('should include recommendation when score is low', async () => {
      // Graph with no evidence (all template provenance)
      const lowQualityGraph = {
        nodes: [
          { id: 'A', label: 'Input' },
          { id: 'B', label: 'Output' },
        ],
        edges: [{ from: 'A', to: 'B', weight: 0.5 }], // No provenance = template default
      };

      const response = await app.inject({
        method: 'POST',
        url: '/v1/run',
        payload: { graph: lowQualityGraph, detail_level: 'standard' },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      // Low quality graphs should have recommendation
      if (body.graph_quality.score < 0.7) {
        expect(body.graph_quality.recommendation).toBeDefined();
      }
    });
  });

  describe('sensitivity_summary block', () => {
    it('should include sensitivity_summary in standard mode', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/run',
        payload: { graph: testGraph, detail_level: 'standard' },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.sensitivity_summary).toBeDefined();
      expect(['high', 'medium', 'diffuse']).toContain(body.sensitivity_summary.concentration);
      expect(typeof body.sensitivity_summary.top_n_explain_pct).toBe('number');
      expect(body.sensitivity_summary.top_n_explain_pct).toBeGreaterThanOrEqual(0);
      expect(body.sensitivity_summary.top_n_explain_pct).toBeLessThanOrEqual(100);
      expect(typeof body.sensitivity_summary.top_n).toBe('number');
      expect(typeof body.sensitivity_summary.interpretation).toBe('string');
    });

    it('should NOT include sensitivity_summary in quick mode', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/run',
        payload: { graph: testGraph, detail_level: 'quick' },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      // Quick mode should skip sensitivity analysis
      expect(body.sensitivity_summary).toBeUndefined();
    });

    it('should include sensitivity_summary in deep mode', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/run',
        payload: { graph: testGraph, detail_level: 'deep' },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(body.sensitivity_summary).toBeDefined();
      expect(['high', 'medium', 'diffuse']).toContain(body.sensitivity_summary.concentration);
    });
  });

  describe('compute budget enforcement', () => {
    it('should enforce budget when k_samples exceeds soft cap', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/run',
        payload: {
          graph: testGraph,
          k_samples: 10000, // Exceeds soft_cap_k of 5000
          detail_level: 'standard',
        },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      // Should be downgraded to soft cap
      expect(body.model_card.compute_budget.downgraded).toBe(true);
      expect(body.model_card.compute_budget.k_samples).toBeLessThanOrEqual(5000);
    });

    it('should use detail_level default K when not specified', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/run',
        payload: { graph: testGraph, detail_level: 'quick' },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      // Quick mode default is K=16
      expect(body.model_card.parameters?.K).toBeLessThanOrEqual(16);
    });
  });

  describe('determinism', () => {
    it('should produce identical results for identical inputs', async () => {
      const payload = {
        graph: testGraph,
        seed: 42,
        detail_level: 'standard',
        baseline_value: 100,
      };

      const response1 = await app.inject({
        method: 'POST',
        url: '/v1/run',
        payload,
      });
      const response2 = await app.inject({
        method: 'POST',
        url: '/v1/run',
        payload,
      });

      expect(response1.statusCode).toBe(200);
      expect(response2.statusCode).toBe(200);

      const body1 = JSON.parse(response1.payload);
      const body2 = JSON.parse(response2.payload);

      // Core results should be identical
      expect(body1.result.most_likely).toEqual(body2.result.most_likely);
      expect(body1.insights).toEqual(body2.insights);
      expect(body1.graph_quality).toEqual(body2.graph_quality);
      expect(body1.sensitivity_summary).toEqual(body2.sensitivity_summary);
    });
  });

  describe('response schema compliance', () => {
    it('should have all required top-level fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/run',
        payload: { graph: testGraph, detail_level: 'standard' },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      // Required P0 fields
      expect(body.schema).toBe('run.v1');
      expect(body.model_card).toBeDefined();
      expect(body.confidence).toBeDefined();
      expect(body.result).toBeDefined();

      // Required P1 fields
      expect(body.insights).toBeDefined();
      expect(body.graph_quality).toBeDefined();
      expect(body.linearity_warning).toBeDefined();

      // Optional P1 fields (present in standard/deep)
      expect(body.sensitivity_summary).toBeDefined();
    });

    it('should have correct confidence structure', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/run',
        payload: { graph: testGraph, detail_level: 'standard' },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);

      expect(['high', 'medium', 'low']).toContain(body.confidence.level);
      expect(typeof body.confidence.score).toBe('number');
      expect(body.confidence.score).toBeGreaterThanOrEqual(0);
      expect(body.confidence.score).toBeLessThanOrEqual(1);
      expect(typeof body.confidence.reason).toBe('string');
      expect(body.confidence.factors).toBeDefined();
    });
  });
});
