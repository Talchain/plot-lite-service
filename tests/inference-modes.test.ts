import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Inference modes', () => {
  let server: ServerHandle;
  const g = { 
    nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }], 
    edges: [{ from: 'A', to: 'B', weight: 1 }] 
  };

  beforeAll(async () => { server = await spawnServer({ env: { RATE_LIMIT_ENABLED: '0' } }); });
  afterAll(async () => { await server.kill(); });

  it('defaults to model_based', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: g })
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.meta.inference_mode).toBe('model_based');
  });

  it('accepts model_of_inference', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: g, inference_mode: 'model_of_inference' })
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.meta.inference_mode).toBe('model_of_inference');
  });

  it('returns meta_reasoning for model_of_inference', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: g, inference_mode: 'model_of_inference' })
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    // Verify meta_reasoning is present and has expected structure
    expect(data.meta_reasoning).toBeDefined();

    // Quality assessment
    expect(data.meta_reasoning.quality_assessment).toBeDefined();
    expect(data.meta_reasoning.quality_assessment.overall_score).toBeGreaterThanOrEqual(0);
    expect(data.meta_reasoning.quality_assessment.overall_score).toBeLessThanOrEqual(1);
    expect(['high', 'medium', 'low']).toContain(data.meta_reasoning.quality_assessment.confidence_level);
    expect(typeof data.meta_reasoning.quality_assessment.identifiable).toBe('boolean');
    expect(typeof data.meta_reasoning.quality_assessment.in_linear_range).toBe('boolean');
    expect(typeof data.meta_reasoning.quality_assessment.graph_quality).toBe('number');

    // Diagnostics
    expect(data.meta_reasoning.diagnostics).toBeDefined();
    expect(Array.isArray(data.meta_reasoning.diagnostics.issues)).toBe(true);
    expect(Array.isArray(data.meta_reasoning.diagnostics.warnings)).toBe(true);
    expect(Array.isArray(data.meta_reasoning.diagnostics.suggestions)).toBe(true);

    // Reliability
    expect(data.meta_reasoning.reliability).toBeDefined();
    expect(['stable', 'moderate', 'volatile']).toContain(data.meta_reasoning.reliability.estimate_stability);
    expect(typeof data.meta_reasoning.reliability.sensitivity_flag).toBe('boolean');
    expect(['converged', 'marginal', 'not_converged']).toContain(data.meta_reasoning.reliability.convergence_status);
  });

  it('does NOT return meta_reasoning for model_based', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: g, inference_mode: 'model_based' })
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    // model_based should NOT include meta_reasoning
    expect(data.meta_reasoning).toBeUndefined();
  });

  it('rejects invalid mode', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: g, inference_mode: 'bad' })
    });
    expect(res.status).toBe(400);
  });
});
