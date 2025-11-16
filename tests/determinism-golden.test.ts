/**
 * Phase 5: Determinism Golden Tests
 * Verify seed-based reproducibility across all inference endpoints
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Determinism: Golden Seed Tests', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer({ profile: 'fallback' }); });
  afterAll(async () => { await server.kill(); });

  const goldenSeed = 4242;

  describe('/v1/run', () => {
    const payload = {
      graph: {
        nodes: [
          { id: 'price', label: 'Price', belief: 0.6 },
          { id: 'demand', label: 'Demand' },
          { id: 'revenue', label: 'Revenue' }
        ],
        edges: [
          { id: 'e1', from: 'price', to: 'demand', weight: -0.7 },
          { id: 'e2', from: 'demand', to: 'revenue', weight: 0.9 }
        ]
      },
      seed: goldenSeed
    };

    it('produces identical response_hash with same seed (2 calls)', async () => {
      const res1 = await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const res2 = await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const body1 = await res1.json();
      const body2 = await res2.json();

      expect(body1.model_card.response_hash).toBe(body2.model_card.response_hash);
      expect(body1.result.summary.p50).toBe(body2.result.summary.p50);
    });

    it('with targets: same seed produces same hash', async () => {
      const withTargets = { ...payload, targets: ['revenue'] };

      const res1 = await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withTargets)
      });

      const res2 = await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withTargets)
      });

      const body1 = await res1.json();
      const body2 = await res2.json();

      expect(body1.model_card.response_hash).toBe(body2.model_card.response_hash);
    });
  });

  describe('/v1/optimise', () => {
    const payload = {
      graph: {
        nodes: [
          { id: 'revenue', label: 'Revenue' },
          { id: 'cost', label: 'Cost' }
        ],
        edges: []
      },
      budget: 100,
      actions: [
        { id: 'a1', cost: 50, do: [{ node_id: 'revenue', set_to: 1.2 }] },
        { id: 'a2', cost: 30, do: [{ node_id: 'cost', set_to: 0.8 }] }
      ],
      objective: {
        type: 'utility_linear' as const,
        weights: { revenue: 1.0, cost: -0.5 }
      },
      seed: goldenSeed
    };

    it('produces identical results with same seed (2 calls)', async () => {
      const res1 = await fetch(`${server.baseUrl}/v1/optimise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const res2 = await fetch(`${server.baseUrl}/v1/optimise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const body1 = await res1.json();
      const body2 = await res2.json();

      // Same actions selected
      expect(body1.selected).toEqual(body2.selected);
      // Same utility
      expect(body1.utility.expected).toBe(body2.utility.expected);
      // Same model_card backend
      expect(body1.model_card.backend).toBe(body2.model_card.backend);
    });

    it('with constraints: deterministic selection', async () => {
      const withConstraints = {
        ...payload,
        constraints: { must: ['a1'] }
      };

      const res1 = await fetch(`${server.baseUrl}/v1/optimise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withConstraints)
      });

      const res2 = await fetch(`${server.baseUrl}/v1/optimise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withConstraints)
      });

      const body1 = await res1.json();
      const body2 = await res2.json();

      expect(body1.selected).toEqual(body2.selected);
      expect(body1.selected).toContain('a1'); // Constraint applied
      expect(body1.meta.constraints_applied).toContain('must');
    });
  });

  describe('/v1/run_bundle', () => {
    const payload = {
      base_graph: {
        nodes: [
          { id: 'price', label: 'Price', belief: 0.6 },
          { id: 'demand', label: 'Demand' }
        ],
        edges: [
          { id: 'e1', from: 'price', to: 'demand', weight: -0.7 }
        ]
      },
      deltas: [
        { label: 'low', nodes: [{ id: 'price', value: 0.8 }] },
        { label: 'high', nodes: [{ id: 'price', value: 1.2 }] }
      ],
      seed: goldenSeed
    };

    it('produces identical response_hash with same seed (2 calls)', async () => {
      const res1 = await fetch(`${server.baseUrl}/v1/run_bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const res2 = await fetch(`${server.baseUrl}/v1/run_bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const body1 = await res1.json();
      const body2 = await res2.json();

      // Overall bundle hash
      expect(body1.model_card.response_hash).toBe(body2.model_card.response_hash);
      
      // Per-member hashes
      expect(body1.results.length).toBe(2);
      expect(body2.results.length).toBe(2);
      
      for (let i = 0; i < body1.results.length; i++) {
        expect(body1.results[i].label).toBe(body2.results[i].label);
        expect(body1.results[i].model_card.response_hash).toBe(body2.results[i].model_card.response_hash);
      }
    });

    it('backend header present and matches model_card', async () => {
      const res = await fetch(`${server.baseUrl}/v1/run_bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      expect(res.status).toBe(200);
      const backend = res.headers.get('x-olumi-backend');
      const body = await res.json();

      expect(backend).toBe('fallback');
      expect(body.model_card.backend).toBe('fallback');
    });
  });

  describe('/v1/run_timeslices', () => {
    const payload = {
      graph: {
        nodes: [
          { id: 'demand', label: 'Demand', belief: 0.6 },
          { id: 'revenue', label: 'Revenue' }
        ],
        edges: [
          { id: 'e1', from: 'demand', to: 'revenue', weight: 0.9 }
        ]
      },
      timeslices: ['Q1', 'Q2', 'Q3', 'Q4'],
      seed: goldenSeed
    };

    it('produces identical response_hash with same seed (2 calls)', async () => {
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

      const body1 = await res1.json();
      const body2 = await res2.json();

      // Overall hash
      expect(body1.model_card.response_hash).toBe(body2.model_card.response_hash);
      
      // Per-slice stability
      expect(body1.results.length).toBe(4);
      expect(body2.results.length).toBe(4);
      
      for (let i = 0; i < body1.results.length; i++) {
        expect(body1.results[i].slice).toBe(body2.results[i].slice);
        expect(body1.results[i].summary.p50).toBe(body2.results[i].summary.p50);
      }
    });

    it('with slice_overrides: deterministic per-slice results', async () => {
      const withOverrides = {
        ...payload,
        slice_overrides: [
          { slice: 'Q2', nodes: [{ id: 'demand', value: 1.2 }] }
        ]
      };

      const res1 = await fetch(`${server.baseUrl}/v1/run_timeslices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withOverrides)
      });

      const res2 = await fetch(`${server.baseUrl}/v1/run_timeslices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withOverrides)
      });

      const body1 = await res1.json();
      const body2 = await res2.json();

      expect(body1.model_card.response_hash).toBe(body2.model_card.response_hash);
      
      // Q2 should differ from Q1/Q3/Q4 due to override
      const q1 = body1.results.find((r: any) => r.slice === 'Q1');
      const q2 = body1.results.find((r: any) => r.slice === 'Q2');
      expect(q1.summary.p50).not.toBe(q2.summary.p50);
    });

    it('backend header present and matches model_card', async () => {
      const res = await fetch(`${server.baseUrl}/v1/run_timeslices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      expect(res.status).toBe(200);
      const backend = res.headers.get('x-olumi-backend');
      const body = await res.json();

      expect(backend).toBe('fallback');
      expect(body.model_card.backend).toBe('fallback');
    });
  });
});
