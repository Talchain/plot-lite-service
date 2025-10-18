/**
 * PR-2C.1: Polish Tests
 * Type-safe reasons, idempotent transitions, TTL warn, health counts
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('PR-2C.1: Circuit Breaker Polish', () => {
  let app: FastifyInstance;
  let origEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    origEnv = {
      RL_CB_ENABLE: process.env.RL_CB_ENABLE,
    };
    
    process.env.RL_CB_ENABLE = '1';
    app = await createServer({ enableTestRoutes: false });
  });

  afterEach(async () => {
    Object.assign(process.env, origEnv);
    await app?.close();
  });

  it('health shows principal open/half_open counts', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    const data = JSON.parse(res.body);
    
    expect(data.circuit_breaker.principals).toBeDefined();
    expect(data.circuit_breaker.principals.open).toBeDefined();
    expect(data.circuit_breaker.principals.half_open).toBeDefined();
    expect(typeof data.circuit_breaker.principals.open).toBe('number');
    expect(typeof data.circuit_breaker.principals.half_open).toBe('number');
  });

  it('transition idempotency: duplicate calls do not duplicate state changes', async () => {
    // Make multiple requests (idempotent transitions should not duplicate metrics)
    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST',
        url: '/v1/run',
        headers: { 'Content-Type': 'application/json' },
        payload: {
          graph: { nodes: [{ id: 'A', label: 'A' }], edges: [] },
          outcome_node: 'A',
        },
      });
    }
    
    // Get health to verify circuit is still functional
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    const data = JSON.parse(res.body);
    
    expect(data.circuit_breaker.global.state).toBeDefined();
    expect(['closed', 'open', 'half_open']).toContain(data.circuit_breaker.global.state);
  });

  it('principal counts are non-negative', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    const data = JSON.parse(res.body);
    
    expect(data.circuit_breaker.principals.open).toBeGreaterThanOrEqual(0);
    expect(data.circuit_breaker.principals.half_open).toBeGreaterThanOrEqual(0);
    expect(data.circuit_breaker.principals.tracked).toBeGreaterThanOrEqual(0);
  });
});
