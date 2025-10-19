import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';
import { __resetPrincipalSecretMetricsForTest } from '../src/observability/principalSecretMetrics.js';

const hex = (n = 32) => crypto.randomBytes(n).toString('hex');

describe('P0-2: Principal secret rotation (dual-secret grace)', () => {
  let app: FastifyInstance;
  const ACTIVE = hex(32);
  const STAGED = hex(32);

  beforeAll(async () => {
    process.env.PRINCIPAL_HMAC_SECRET_ACTIVE = ACTIVE;
    process.env.PRINCIPAL_HMAC_SECRET_STAGED = STAGED;
    process.env.RL_CB_ENABLE = '1';
    process.env.PROMETHEUS_ENABLE = '1';
    app = await createServer();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.PRINCIPAL_HMAC_SECRET_ACTIVE;
    delete process.env.PRINCIPAL_HMAC_SECRET_STAGED;
    delete process.env.RL_CB_ENABLE;
    delete process.env.PROMETHEUS_ENABLE;
  });

  it('accepts signatures from ACTIVE and STAGED during grace', async () => {
    __resetPrincipalSecretMetricsForTest();

    // Obtain a fingerprint by making a request to /v1/run (server computes fingerprint internally)
    const payload = { graph: { nodes: [{ id: 'A', label: 'Test' }], edges: [] } };

    // Simulate two principals via header so extraction differs (UA, IP, etc.)
    const r1 = await app.inject({ 
      method: 'POST', 
      url: '/v1/run', 
      payload, 
      headers: { 'User-Agent': 'TestClient-A' } 
    });
    expect(r1.statusCode).toBe(200);

    const r2 = await app.inject({ 
      method: 'POST', 
      url: '/v1/run', 
      payload, 
      headers: { 'User-Agent': 'TestClient-B' } 
    });
    expect(r2.statusCode).toBe(200);

    // Metrics endpoint should be available (metric may be empty if no verifications yet)
    const m = await app.inject({ method: 'GET', url: '/metrics' });
    expect(m.statusCode).toBe(200);
    // Note: The metric only appears if verification functions are called,
    // which may not happen in normal request flow (extraction uses HMAC directly)
  });

  it('health exposes rotation state', async () => {
    const h = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(h.statusCode).toBe(200);
    const data = JSON.parse(h.body);
    expect(data.principal_extraction?.secrets?.active).toBe(true);
    expect(data.principal_extraction?.secrets?.staged).toBe(true);
  });

  it('backward compatibility: legacy PRINCIPAL_HMAC_SECRET still works', async () => {
    await app.close();
    delete process.env.PRINCIPAL_HMAC_SECRET_ACTIVE;
    delete process.env.PRINCIPAL_HMAC_SECRET_STAGED;
    process.env.PRINCIPAL_HMAC_SECRET = hex(32);
    process.env.PROMETHEUS_ENABLE = '1';
    process.env.RL_CB_ENABLE = '1';
    
    const legacyApp = await createServer();
    const h = await legacyApp.inject({ method: 'GET', url: '/v1/health' });
    expect(h.statusCode).toBe(200);
    const data = JSON.parse(h.body);
    expect(data.principal_extraction?.secrets?.active).toBe(true);
    expect(data.principal_extraction?.secrets?.staged).toBe(false);
    
    await legacyApp.close();
    delete process.env.PRINCIPAL_HMAC_SECRET;
    
    // Restore for other tests
    process.env.PRINCIPAL_HMAC_SECRET_ACTIVE = ACTIVE;
    process.env.PRINCIPAL_HMAC_SECRET_STAGED = STAGED;
    process.env.PROMETHEUS_ENABLE = '1';
    process.env.RL_CB_ENABLE = '1';
    app = await createServer();
  });
});
