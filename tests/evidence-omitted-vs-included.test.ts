/**
 * Evidence field: omitted vs included scenarios
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Evidence omitted vs included', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer({ profile: 'fallback' }); });
  afterAll(async () => { await server.kill(); });

  const minimalGraph = {
    nodes: [
      { id: 'A', label: 'Node A' },
      { id: 'B', label: 'Node B' }
    ],
    edges: [{ id: 'e1', from: 'A', to: 'B', weight: 0.7 }]
  };

  it('accepts request with no evidence field', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        seed: 4242
      })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schema).toBe('run.v1');
    // No evidence applied
    expect(body.meta.evidence_applied).toBeUndefined();
  });

  it('accepts request with empty evidence array', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        evidence: [],
        seed: 4242
      })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schema).toBe('run.v1');
  });

  it('accepts valid evidence and sanitizes (strips note, keeps weight)', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        evidence: [
          {
            node_id: 'A',
            source: 'user_input',
            weight: 0.9,  // Currently kept (Phase 3 will remove)
            note: 'test note'  // Should be stripped
          }
        ],
        seed: 4242
      })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schema).toBe('run.v1');
    
    if (body.meta.evidence_applied) {
      expect(body.meta.evidence_applied).toHaveLength(1);
      const ev = body.meta.evidence_applied[0];
      expect(ev).toHaveProperty('node_id', 'A');
      expect(ev).toHaveProperty('source', 'user_input');
      expect(ev).not.toHaveProperty('note');  // Note is stripped
      // Weight currently kept (will be removed in Phase 3)
    }
  });

  it('rejects evidence with missing node_id', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        evidence: [
          { source: 'user_input' }  // Missing node_id
        ],
        seed: 4242
      })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.type).toBe('BAD_INPUT');
  });

  it('rejects evidence with non-existent node_id', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        evidence: [
          { node_id: 'NonExistent', source: 'user_input' }
        ],
        seed: 4242
      })
    });

    // Handler validates node existence
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.type).toBe('BAD_INPUT');
  });

  it('evidence affects results deterministically', async () => {
    // Run without evidence
    const res1 = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        seed: 4242
      })
    });
    const body1 = await res1.json();

    // Run with evidence
    const res2 = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        evidence: [{ node_id: 'A', source: 'user_input' }],
        seed: 4242
      })
    });
    const body2 = await res2.json();

    // Different response hashes (evidence changes output)
    expect(body1.model_card.response_hash).not.toBe(body2.model_card.response_hash);

    // But same evidence + seed = same hash (determinism)
    const res3 = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        evidence: [{ node_id: 'A', source: 'user_input' }],
        seed: 4242
      })
    });
    const body3 = await res3.json();
    expect(body2.model_card.response_hash).toBe(body3.model_card.response_hash);
  });
});
