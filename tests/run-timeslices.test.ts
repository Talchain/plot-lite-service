import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('POST /v1/run_timeslices', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer(); });
  afterAll(async () => { await server.kill(); });

  it('processes 3 timeslices deterministically', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run_timeslices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'A', label: 'A' },
            { id: 'B', label: 'B' },
            { id: 'C', label: 'C' }
          ],
          edges: [
            { from: 'A', to: 'B', weight: 0.5 },
            { from: 'B', to: 'C', weight: 0.7 }
          ]
        },
        timeslices: ['2025-Q1', '2025-Q2', '2025-Q3'],
        seed: 4242
      })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.schema).toBe('run_timeslices.v1');
    expect(data.results).toHaveLength(3);
    expect(data.results[0].slice).toBe('2025-Q1');
    expect(data.results[1].slice).toBe('2025-Q2');
    expect(data.results[2].slice).toBe('2025-Q3');
    
    // Each result should have summary and confidence
    for (const result of data.results) {
      expect(result.summary).toBeDefined();
      expect(result.summary.p10).toBeDefined();
      expect(result.summary.p50).toBeDefined();
      expect(result.summary.p90).toBeDefined();
      expect(result.confidence).toBeDefined();
    }
    
    // Model card
    expect(data.model_card.seed).toBe(4242);
    expect(data.model_card.timeslices_count).toBe(3);
  });

  it('processes 12 timeslices (max limit)', async () => {
    const timeslices = Array.from({ length: 12 }, (_, i) => `2025-M${i + 1}`);
    
    const res = await fetch(`${server.baseUrl}/v1/run_timeslices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'X', label: 'X' }],
          edges: []
        },
        timeslices,
        seed: 4242
      })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results).toHaveLength(12);
  });

  it('rejects 13 timeslices (exceeds limit)', async () => {
    const timeslices = Array.from({ length: 13 }, (_, i) => `2025-M${i + 1}`);
    
    const res = await fetch(`${server.baseUrl}/v1/run_timeslices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'X', label: 'X' }],
          edges: []
        },
        timeslices,
        seed: 4242
      })
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.message).toContain('12');
    expect(data.error.field).toBe('timeslices');
  });

  it('is deterministic with same seed', async () => {
    const payload = {
      graph: {
        nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
        edges: [{ from: 'A', to: 'B', weight: 0.5 }]
      },
      timeslices: ['T1', 'T2'],
      seed: 9999
    };

    const res1 = await fetch(`${server.baseUrl}/v1/run_timeslices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const res2 = await fetch(`${server.baseUrl}/v1/run_timeslices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    
    const data1 = await res1.json();
    const data2 = await res2.json();
    
    // Same seed should produce identical results
    expect(data1.results).toEqual(data2.results);
    expect(data1.model_card.response_hash).toBe(data2.model_card.response_hash);
  });

  it('applies slice_overrides correctly', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run_timeslices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'A', label: 'A', value: 1.0 }],
          edges: []
        },
        timeslices: ['T1', 'T2'],
        slice_overrides: [
          {
            slice: 'T2',
            nodes: [{ id: 'A', value: 2.0 }]
          }
        ],
        seed: 4242
      })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results).toHaveLength(2);
    // T1 and T2 should have different results due to override
    expect(data.results[0].summary).not.toEqual(data.results[1].summary);
  });

  it('rejects slice_override for unknown slice', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run_timeslices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'A', label: 'A' }],
          edges: []
        },
        timeslices: ['T1', 'T2'],
        slice_overrides: [
          { slice: 'T3', nodes: [] }  // T3 not in timeslices
        ],
        seed: 4242
      })
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.message).toContain('T3');
    expect(data.error.field).toBe('slice_overrides[].slice');
  });
});
