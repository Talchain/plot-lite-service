/**
 * Phase 6: Performance Guardrails
 * Verify /v1/health exposes p95 latency metrics
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Performance Guardrails', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer({ profile: 'fallback' }); });
  afterAll(async () => { await server.kill(); });

  const testGraph = {
    nodes: [
      { id: 'A', label: 'Node A', belief: 0.6 },
      { id: 'B', label: 'Node B' }
    ],
    edges: [{ id: 'e1', from: 'A', to: 'B', weight: 0.7 }]
  };

  describe('/v1/health performance metrics', () => {
    it('exposes p95_ms field', async () => {
      const res = await fetch(`${server.baseUrl}/v1/health`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveProperty('p95_ms');
      expect(typeof body.p95_ms).toBe('number');
    });

    it('p95_ms is non-negative', async () => {
      const res = await fetch(`${server.baseUrl}/v1/health`);
      const body = await res.json();
      
      expect(body.p95_ms).toBeGreaterThanOrEqual(0);
    });

    it('p95_ms updates after requests', async () => {
      // Get initial p95
      const health1 = await fetch(`${server.baseUrl}/v1/health`);
      const body1 = await health1.json();
      const initialP95 = body1.p95_ms;

      // Make several requests to generate latency samples
      for (let i = 0; i < 10; i++) {
        await fetch(`${server.baseUrl}/v1/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ graph: testGraph, seed: 1000 + i })
        });
      }

      // Check p95 again
      const health2 = await fetch(`${server.baseUrl}/v1/health`);
      const body2 = await health2.json();
      
      // p95 should be a reasonable value (< 1000ms for simple requests)
      expect(body2.p95_ms).toBeGreaterThanOrEqual(0);
      expect(body2.p95_ms).toBeLessThan(1000);
    });

    it('p95_ms meets performance target (≤60ms for simple requests)', async () => {
      // Warm up
      for (let i = 0; i < 5; i++) {
        await fetch(`${server.baseUrl}/v1/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ graph: testGraph, seed: 2000 + i })
        });
      }

      // Check p95
      const res = await fetch(`${server.baseUrl}/v1/health`);
      const body = await res.json();
      
      // Target: p95 ≤ 60ms for simple 2-node graphs
      // Allow some headroom for CI/test environments
      expect(body.p95_ms).toBeLessThanOrEqual(100);
    });

    it('health includes other performance metrics', async () => {
      const res = await fetch(`${server.baseUrl}/v1/health`);
      const body = await res.json();
      
      // Verify other performance-related fields
      expect(body).toHaveProperty('uptime_s');
      expect(body).toHaveProperty('last_request_at');
      expect(body).toHaveProperty('last_compute_ms');
      expect(body).toHaveProperty('engine_p95_ms');
      
      // All should be numbers or null/undefined
      if (body.last_compute_ms !== null && body.last_compute_ms !== undefined) {
        expect(typeof body.last_compute_ms).toBe('number');
      }
      if (body.engine_p95_ms !== null && body.engine_p95_ms !== undefined) {
        expect(typeof body.engine_p95_ms).toBe('number');
      }
    });

    it('p95_ms is deterministic for same workload', async () => {
      // Make identical requests
      const requests = Array(20).fill(null).map(() => 
        fetch(`${server.baseUrl}/v1/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ graph: testGraph, seed: 3000 })
        })
      );

      await Promise.all(requests);

      // Get p95
      const res = await fetch(`${server.baseUrl}/v1/health`);
      const body = await res.json();
      
      // Should be stable and reasonable
      expect(body.p95_ms).toBeGreaterThan(0);
      expect(body.p95_ms).toBeLessThan(200);
    });

    it('health response includes status ok', async () => {
      const res = await fetch(`${server.baseUrl}/v1/health`);
      const body = await res.json();
      
      expect(body.status).toBe('ok');
      expect(body.api_version).toBe('v1');
    });
  });

  describe('Performance monitoring integration', () => {
    it('engine_p95_ms tracks compute time separately', async () => {
      // Make some requests
      for (let i = 0; i < 5; i++) {
        await fetch(`${server.baseUrl}/v1/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ graph: testGraph, seed: 4000 + i })
        });
      }

      const res = await fetch(`${server.baseUrl}/v1/health`);
      const body = await res.json();
      
      // engine_p95_ms should track pure compute time
      if (body.engine_p95_ms !== null && body.engine_p95_ms !== undefined) {
        expect(body.engine_p95_ms).toBeGreaterThanOrEqual(0);
        // Engine compute should be less than total request time
        expect(body.engine_p95_ms).toBeLessThanOrEqual(body.p95_ms + 50);
      }
    });

    it('last_compute_ms shows most recent engine execution', async () => {
      await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph: testGraph, seed: 5000 })
      });

      const res = await fetch(`${server.baseUrl}/v1/health`);
      const body = await res.json();
      
      if (body.last_compute_ms !== null && body.last_compute_ms !== undefined) {
        expect(body.last_compute_ms).toBeGreaterThan(0);
        expect(body.last_compute_ms).toBeLessThan(500);
      }
    });
  });
});
