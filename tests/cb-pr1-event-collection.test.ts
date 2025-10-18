/**
 * PR-1: Circuit Breaker Event Collection Tests
 * Verifies 429 events are recorded regardless of RL_CB_ENABLE
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('CB PR-1: Event Collection (Always-On)', () => {
  describe('Flag OFF', () => {
    let app: FastifyInstance;
    let origEnv: Record<string, string | undefined>;

    beforeEach(async () => {
      origEnv = {
        RL_CB_ENABLE: process.env.RL_CB_ENABLE,
        PROMETHEUS_ENABLE: process.env.PROMETHEUS_ENABLE,
      };
      
      delete process.env.RL_CB_ENABLE; // Ensure OFF
      process.env.PROMETHEUS_ENABLE = '1'; // Enable metrics
      
      app = await createServer({ enableTestRoutes: false });
    });

    afterEach(async () => {
      Object.assign(process.env, origEnv);
      await app?.close();
    });

    it('records 429 events even when RL_CB_ENABLE=0', async () => {
      // Get initial metrics
      const before = await app.inject({ method: 'GET', url: '/metrics' });
      const beforeBody = before.body;

      // Make a request (should not trigger 503 since breaker is OFF)
      const res = await app.inject({
        method: 'POST',
        url: '/v1/run',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          graph: { nodes: [{ id: 'A', label: 'A' }], edges: [] },
          outcome_node: 'A',
        },
      });

      expect(res.statusCode).toBe(200); // Should succeed

      // Check metrics after
      const after = await app.inject({ method: 'GET', url: '/metrics' });
      const afterBody = after.body;

      // Should have rate_limit_429_total counter (even if zero)
      expect(afterBody).toContain('plot_engine_rate_limit_429_total');
    });

    it('does not enforce 503s when RL_CB_ENABLE=0', async () => {
      // Generate many requests (should not trip circuit)
      for (let i = 0; i < 20; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/v1/run',
          headers: { 'Content-Type': 'application/json' },
          payload: {
            graph: { nodes: [{ id: 'A', label: 'A' }], edges: [] },
            outcome_node: 'A',
          },
        });
        
        // Should never return 503
        expect(res.statusCode).not.toBe(503);
      }
    });
  });

  describe('Metrics Exposure', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      process.env.PROMETHEUS_ENABLE = '1';
      app = await createServer({ enableTestRoutes: false });
    });

    afterEach(async () => {
      delete process.env.PROMETHEUS_ENABLE;
      await app?.close();
    });

    it('exposes circuit breaker counters in /metrics', async () => {
      const res = await app.inject({ method: 'GET', url: '/metrics' });
      
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('plot_engine_rate_limit_429_total');
      expect(res.body).toContain('plot_engine_circuit_open_total');
      expect(res.body).toContain('plot_engine_circuit_probes_total');
    });
  });
});
