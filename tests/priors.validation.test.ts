import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Priors validation', () => {
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
    k_samples: 1000,
    seed: 4242
  };

  describe('/v1/run with priors', () => {
    it('accepts valid number priors', async () => {
      const res = await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...basePayload,
          priors: { A: 0.6, B: 0.4 }
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.schema).toBe('run.v1');
    });

    it('accepts valid distribution priors', async () => {
      const res = await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...basePayload,
          priors: { 
            A: { mean: 0.5, sd: 0.1 },
            B: { mean: 0.7, sd: 0.05 }
          },
          seed: 4242
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.schema).toBe('run.v1');
    });

    it('rejects prior value < 0', async () => {
      const res = await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...basePayload,
          priors: { A: -0.1 },
          seed: 4242
        })
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('between 0 and 1');
      expect(data.error.field).toContain('priors.A');
    });

    it('rejects prior value > 1', async () => {
      const res = await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...basePayload,
          priors: { A: 1.5 },
          seed: 4242
        })
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('between 0 and 1');
      expect(data.error.field).toContain('priors.A');
    });

    it('rejects distribution with sd <= 0', async () => {
      const res = await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...basePayload,
          priors: { A: { mean: 0.5, sd: 0 } },
          seed: 4242
        })
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('greater than 0');
      expect(data.error.field).toContain('priors.A.sd');
    });

    it('rejects distribution with mean < 0', async () => {
      const res = await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...basePayload,
          priors: { A: { mean: -0.1, sd: 0.1 } },
          seed: 4242
        })
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('between 0 and 1');
      expect(data.error.field).toContain('priors.A.mean');
    });

    it('rejects prior for unknown node', async () => {
      const res = await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...basePayload,
          priors: { Z: 0.5 },  // Z doesn't exist
          seed: 4242
        })
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('unknown node');
      expect(data.error.field).toContain('priors.Z');
    });
  });

  describe('/v1/run_timeslices with priors', () => {
    it('accepts priors in timeslices request', async () => {
      const res = await fetch(`${server.baseUrl}/v1/run_timeslices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...basePayload,
          timeslices: ['T1', 'T2'],
          priors: { A: 0.6 },
          seed: 4242
        })
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.schema).toBe('run_timeslices.v1');
    });

    it('validates priors in timeslices', async () => {
      const res = await fetch(`${server.baseUrl}/v1/run_timeslices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...basePayload,
          timeslices: ['T1'],
          priors: { A: 2.0 },  // Invalid
          seed: 4242
        })
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('between 0 and 1');
    });
  });
});
