import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('POST /v1/run_bundle - Scenario Bundles', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer(); });
  afterAll(async () => { await server.kill(); });

  it('processes base graph with multiple deltas', async () => {
    const payload = {
      base_graph: {
        nodes: [{ id: 'A', label: 'A', value: 0.5 }],
        edges: []
      },
      deltas: [
        { label: 'Scenario 1', nodes: [{ id: 'A', value: 0.6 }] },
        { label: 'Scenario 2', nodes: [{ id: 'A', value: 0.7 }] }
      ],
      seed: 4242
    };

    const res = await fetch(`${server.baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.schema).toBe('run_bundle.v1');
    expect(data.results).toHaveLength(2);
    expect(data.results[0].label).toBe('Scenario 1');
    expect(data.results[1].label).toBe('Scenario 2');
    expect(data.meta.total_scenarios).toBe(2);
  });

  it('detects duplicate graph content', async () => {
    const payload = {
      base_graph: {
        nodes: [{ id: 'A', label: 'A' }],
        edges: []
      },
      deltas: [
        { label: 'S1', nodes: [{ id: 'A', value: 0.5 }] },
        { label: 'S2', nodes: [{ id: 'A', value: 0.5 }] } // Same graph content
      ],
      seed: 4242
    };

    const res = await fetch(`${server.baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    // Same graph content should produce same summary values
    expect(data.results[0].summary.p50).toBe(data.results[1].summary.p50);
    expect(data.meta.unique_results).toBeLessThanOrEqual(2);
  });

  it('enforces max deltas limit', async () => {
    const deltas = Array.from({ length: 11 }, (_, i) => ({
      label: `S${i}`,
      nodes: [{ id: 'A', value: 0.5 + i * 0.01 }]
    }));

    const payload = {
      base_graph: {
        nodes: [{ id: 'A', label: 'A' }],
        edges: []
      },
      deltas,
      seed: 4242
    };

    const res = await fetch(`${server.baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error.type).toBe('BAD_INPUT');
    expect(data.error.message).toContain('Maximum 10 deltas');
  });

  it('enforces base graph node limit', async () => {
    const nodes = Array.from({ length: 51 }, (_, i) => ({
      id: `N${i}`,
      label: `Node ${i}`
    }));

    const payload = {
      base_graph: { nodes, edges: [] },
      deltas: [{ label: 'S1' }],
      seed: 4242
    };

    const res = await fetch(`${server.baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error.message).toContain('exceeds max 50 nodes');
  });

  it('enforces merged graph node limit', async () => {
    const baseNodes = Array.from({ length: 45 }, (_, i) => ({
      id: `N${i}`,
      label: `Node ${i}`
    }));

    const deltaNodes = Array.from({ length: 10 }, (_, i) => ({
      id: `D${i}`,
      label: `Delta ${i}`
    }));

    const payload = {
      base_graph: { nodes: baseNodes, edges: [] },
      deltas: [{ label: 'S1', nodes: deltaNodes }],
      seed: 4242
    };

    const res = await fetch(`${server.baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error.message).toContain('results in 55 nodes');
  });

  it('requires at least one delta', async () => {
    const payload = {
      base_graph: {
        nodes: [{ id: 'A', label: 'A' }],
        edges: []
      },
      deltas: [],
      seed: 4242
    };

    const res = await fetch(`${server.baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error.field).toBe('deltas');
  });

  it('includes response_hash for each result', async () => {
    const payload = {
      base_graph: {
        nodes: [{ id: 'A', label: 'A' }],
        edges: []
      },
      deltas: [
        { label: 'S1', nodes: [{ id: 'A', value: 0.5 }] }
      ],
      seed: 4242
    };

    const res = await fetch(`${server.baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    expect(data.results[0].model_card.response_hash).toBeDefined();
    expect(data.results[0].model_card.response_hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('deterministic results with same seed', async () => {
    const payload = {
      base_graph: {
        nodes: [{ id: 'A', label: 'A' }],
        edges: []
      },
      deltas: [
        { label: 'S1', nodes: [{ id: 'A', value: 0.5 }] }
      ],
      seed: 9999
    };

    const res1 = await fetch(`${server.baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data1 = await res1.json();

    const res2 = await fetch(`${server.baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data2 = await res2.json();

    expect(data1.results[0].model_card.response_hash).toBe(data2.results[0].model_card.response_hash);
  });

  it('uses real SCM-Lite inference (not hash-based stubs)', async () => {
    const payload = {
      base_graph: {
        nodes: [
          { id: 'A', label: 'Input', value: 100 },
          { id: 'B', label: 'Output' },
        ],
        edges: [{ from: 'A', to: 'B', weight: 1.0 }],
      },
      deltas: [
        { label: 'Base', nodes: [] },
        { label: 'Increased Weight', edges: [{ from: 'A', to: 'B', weight: 1.5 }] },
      ],
      seed: 4242,
      baseline_value: 100,
    };

    const res = await fetch(`${server.baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.results).toHaveLength(2);

    // Each scenario should have unique seed
    expect(data.results[0].model_card.seed).toBe(4243); // seed + 0 + 1
    expect(data.results[1].model_card.seed).toBe(4244); // seed + 1 + 1

    // Top-level model_card should indicate SCM-Lite backend
    expect(data.model_card.backend).toBe('scm_lite');
    expect(data.model_card.detail_level).toBe('standard');

    // Meta should indicate inference mode
    expect(data.meta.inference_mode).toBe('model_based');

    // Results should have proper p10/p50/p90 (not hash-based fixed ratios)
    // With real inference, p10 < p50 < p90 but not necessarily 0.8x and 1.2x
    const r0 = data.results[0].summary;
    const r1 = data.results[1].summary;
    expect(r0.p10).toBeLessThanOrEqual(r0.p50);
    expect(r0.p50).toBeLessThanOrEqual(r0.p90);
    expect(r1.p10).toBeLessThanOrEqual(r1.p50);
    expect(r1.p50).toBeLessThanOrEqual(r1.p90);
  });

  it('supports detail_level parameter', async () => {
    const payload = {
      base_graph: {
        nodes: [{ id: 'A', label: 'A' }],
        edges: [],
      },
      deltas: [{ label: 'S1' }],
      seed: 4242,
      detail_level: 'quick',
    };

    const res = await fetch(`${server.baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.model_card.detail_level).toBe('quick');
    expect(data.results[0].model_card.detail_level).toBe('quick');
  });

  it('rejects invalid detail_level', async () => {
    const payload = {
      base_graph: {
        nodes: [{ id: 'A', label: 'A' }],
        edges: [],
      },
      deltas: [{ label: 'S1' }],
      seed: 4242,
      detail_level: 'invalid',
    };

    const res = await fetch(`${server.baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error.type).toBe('BAD_INPUT');
    expect(data.error.message).toContain('Invalid detail_level');
    expect(data.error.field).toBe('detail_level');
  });

  it('rejects delta without label', async () => {
    const payload = {
      base_graph: {
        nodes: [{ id: 'A', label: 'A' }],
        edges: [],
      },
      deltas: [{ nodes: [{ id: 'A', value: 0.5 }] }], // Missing label
      seed: 4242,
    };

    const res = await fetch(`${server.baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error.type).toBe('BAD_INPUT');
    expect(data.error.message).toContain('missing required');
    expect(data.error.message).toContain('label');
    expect(data.error.field).toBe('deltas[0].label');
  });
});
