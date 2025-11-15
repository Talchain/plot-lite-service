import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Evidence audit trail', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer(); });
  afterAll(async () => { await server.kill(); });

  const basePayload = {
    graph: {
      nodes: [
        { id: 'A', label: 'A' },
        { id: 'B', label: 'B' }
      ],
      edges: [{ from: 'A', to: 'B', weight: 0.5 }]
    },
    seed: 4242
  };

  it('echoes sanitized evidence in meta.evidence_applied', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...basePayload,
        evidence: [
          { 
            node_id: 'A', 
            source: 'survey_2024', 
            note: 'This is a sensitive note that should not appear in response',
            weight: 0.8 
          },
          { 
            node_id: 'B', 
            source: 'expert_panel',
            weight: 0.9 
          }
        ]
      })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    
    // Check meta.evidence_applied exists
    expect(data.meta).toBeDefined();
    expect(data.meta.evidence_applied).toBeDefined();
    expect(Array.isArray(data.meta.evidence_applied)).toBe(true);
    expect(data.meta.evidence_applied.length).toBe(2);
    
    // Check first evidence item (sanitized - no note)
    expect(data.meta.evidence_applied[0]).toEqual({
      node_id: 'A',
      source: 'survey_2024',
      weight: 0.8
    });
    expect(data.meta.evidence_applied[0].note).toBeUndefined();
    
    // Check second evidence item
    expect(data.meta.evidence_applied[1]).toEqual({
      node_id: 'B',
      source: 'expert_panel',
      weight: 0.9
    });
  });

  it('does not include meta.evidence_applied when no evidence provided', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...basePayload
      })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    
    // meta should not exist or evidence_applied should not exist
    expect(data.meta?.evidence_applied).toBeUndefined();
  });

  it('accepts request with evidence (audit trail recorded internally)', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...basePayload,
        evidence: [
          { node_id: 'A', source: 'test1' },
          { node_id: 'B', source: 'test2' }
        ]
      })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    
    // Verify evidence is echoed in meta
    expect(data.meta.evidence_applied).toBeDefined();
    expect(data.meta.evidence_applied.length).toBe(2);
    
    // Note: evidence_count is recorded in audit trail (internal ring buffer)
    // but not exposed via API endpoint in this version
  });

  it('sanitizes evidence without weight field', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...basePayload,
        evidence: [
          { node_id: 'A', source: 'no_weight_source', note: 'secret note' }
        ]
      })
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.meta.evidence_applied[0]).toEqual({
      node_id: 'A',
      source: 'no_weight_source'
    });
    expect(data.meta.evidence_applied[0].weight).toBeUndefined();
    expect(data.meta.evidence_applied[0].note).toBeUndefined();
  });
});
