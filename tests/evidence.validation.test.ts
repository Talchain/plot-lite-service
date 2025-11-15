import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Evidence validation', () => {
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

  describe('/v1/run with evidence', () => {
    it('accepts valid evidence', async () => {
      const res = await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...basePayload,
          evidence: [
            { node_id: 'A', source: 'survey_2024', weight: 0.8 },
            { node_id: 'B', source: 'expert_panel', note: 'High confidence', weight: 0.9 }
          ]
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.schema).toBe('run.v1');
    });

    it('rejects evidence with missing node_id', async () => {
      const res = await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...basePayload,
          evidence: [{ source: 'test' }]
        })
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('node_id');
      expect(data.error.field).toContain('evidence[0].node_id');
    });

    it('rejects evidence with missing source', async () => {
      const res = await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...basePayload,
          evidence: [{ node_id: 'A' }]
        })
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('source');
      expect(data.error.field).toContain('evidence[0].source');
    });

    it('rejects evidence for unknown node', async () => {
      const res = await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...basePayload,
          evidence: [{ node_id: 'Z', source: 'test' }]
        })
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('unknown node');
      expect(data.error.field).toContain('evidence[0].node_id');
    });

    it('rejects evidence with invalid weight', async () => {
      const res = await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...basePayload,
          evidence: [{ node_id: 'A', source: 'test', weight: 1.5 }]
        })
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('between 0 and 1');
      expect(data.error.field).toContain('evidence[0].weight');
    });

    it('rejects evidence with source too long', async () => {
      const res = await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...basePayload,
          evidence: [{ node_id: 'A', source: 'x'.repeat(201) }]
        })
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('200 characters');
      expect(data.error.field).toContain('evidence[0].source');
    });

    it('rejects evidence with note too long', async () => {
      const res = await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...basePayload,
          evidence: [{ node_id: 'A', source: 'test', note: 'x'.repeat(501) }]
        })
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('500 characters');
      expect(data.error.field).toContain('evidence[0].note');
    });
  });
});
