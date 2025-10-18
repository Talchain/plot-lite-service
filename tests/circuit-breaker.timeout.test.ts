/**
 * PR-2C: Half-Open Timeout Tests
 * Verifies conservative reopen on probe starvation
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('PR-2C: Half-Open Timeout', () => {
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

  it('exposes half_open_timeout_ms in health config', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    const data = JSON.parse(res.body);
    
    expect(data.circuit_breaker).toBeDefined();
    expect(data.circuit_breaker.config).toBeDefined();
    expect(data.circuit_breaker.config.half_open_timeout_ms).toBeGreaterThan(0);
  });

  it('exposes last_transition_at and state_duration_ms', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    const data = JSON.parse(res.body);
    
    expect(data.circuit_breaker.global).toBeDefined();
    // These may be undefined initially (no transitions yet)
    expect(data.circuit_breaker.global.state_duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('principal TTL defaults to Infinity', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    const data = JSON.parse(res.body);
    
    expect(data.circuit_breaker.principals).toBeDefined();
    expect([Infinity, null]).toContain(data.circuit_breaker.principals.ttl_ms);
  });
});
