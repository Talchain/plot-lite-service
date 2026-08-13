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

  /**
   * The `/v1/run_timeslices with priors` block was REMOVED on 2026-08-13 when
   * that route was withdrawn (typed 501, see tests/analysis-routes.refusal.test.ts).
   *
   * Its two cases asserted a 200 with `schema: 'run_timeslices.v1'` for valid
   * priors, and a 400 "between 0 and 1" for invalid ones. Neither outcome is
   * reachable any more, and deliberately so: the refusal is UNCONDITIONAL and
   * precedes body validation, because returning 400 for a malformed body would
   * imply a well-formed one would have been answered. The withdrawn route's
   * treatment of a malformed request is pinned in the refusal suite instead.
   *
   * Prior validation itself is unaffected — `validatePriors` keeps live
   * consumers in /v1/run, /v1/optimise and /v1/run_bundle, and the
   * `/v1/run with priors` block above still exercises it end-to-end.
   */
});
