/**
 * PR-3: Principal Extraction Integration Tests
 * Verifies circuit breaker integration and degraded mode
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('PR-3: Principal Extraction Integration', () => {
  let app: FastifyInstance;
  let origEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    origEnv = {
      RL_CB_ENABLE: process.env.RL_CB_ENABLE,
      PRINCIPAL_HMAC_SECRET: process.env.PRINCIPAL_HMAC_SECRET,
      TRUST_PROXY: process.env.TRUST_PROXY,
    };
    
    process.env.RL_CB_ENABLE = '1';
    process.env.PRINCIPAL_HMAC_SECRET = 'test-secret-for-integration';
    process.env.TRUST_PROXY = '0';
    
    app = await createServer({ enableTestRoutes: false });
  });

  afterEach(async () => {
    Object.assign(process.env, origEnv);
    await app?.close();
  });

  it('health exposes principal_extraction stats', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    const data = JSON.parse(res.body);
    
    expect(data.principal_extraction).toBeDefined();
    expect(data.principal_extraction.enabled).toBe(true);
    expect(data.principal_extraction.trust_proxy).toBe(false);
    expect(data.principal_extraction.hops).toBe(1);
    expect(data.principal_extraction.mode).toBe('fallback');
  });

  it('health shows no PII in circuit breaker stats', async () => {
    // Make a request
    await app.inject({
      method: 'POST',
      url: '/v1/run',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'TestBot/1.0',
      },
      payload: {
        graph: { nodes: [{ id: 'A', label: 'A' }], edges: [] },
        outcome_node: 'A',
      },
    });
    
    // Get health
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    const body = res.body;
    
    // Should not contain raw IPs or UAs
    expect(body).not.toContain('127.0.0.1');
    expect(body).not.toContain('TestBot');
    expect(body).not.toContain('192.168');
  });

  it('degraded mode: RL_CB_ENABLE=1 & no secret → health shows degraded', async () => {
    await app.close();
    
    // Restart without secret
    delete process.env.PRINCIPAL_HMAC_SECRET;
    process.env.RL_CB_ENABLE = '1';
    
    app = await createServer({ enableTestRoutes: false });
    
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    const data = JSON.parse(res.body);
    
    expect(data.principal_extraction).toBeDefined();
    expect(data.principal_extraction.enabled).toBe(false);
    expect(data.principal_extraction.mode).toBe('degraded');
  });

  it('circuit breaker still works in degraded mode (global only)', async () => {
    await app.close();
    
    // Restart without secret
    delete process.env.PRINCIPAL_HMAC_SECRET;
    process.env.RL_CB_ENABLE = '1';
    
    app = await createServer({ enableTestRoutes: false });
    
    // Make requests (should still track global circuit)
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
    
    // Health should show circuit breaker is active
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    const data = JSON.parse(res.body);
    
    expect(data.circuit_breaker).toBeDefined();
    expect(data.circuit_breaker.global).toBeDefined();
    expect(data.circuit_breaker.global.state).toBeDefined();
  });
});
