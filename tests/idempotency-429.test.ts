import { beforeEach, afterEach, expect, it, describe } from 'vitest';
import { createServer } from '../src/createServer.js';

let app: any;

beforeEach(async () => {
  process.env.RATE_LIMIT_ENABLED = '1';
  process.env.RATE_LIMIT_RPM = '1';
  app = await createServer();
  await app.ready();
});

afterEach(async () => {
  if (app) await app.close();
  delete process.env.RATE_LIMIT_ENABLED;
  delete process.env.RATE_LIMIT_RPM;
});

describe('idempotency + 429 interaction', () => {
  it('clears inflight on 429 so retry is still rate-limited', async () => {
    const payload = {
      graph: { nodes: [{ id: 'A', label: 'A' }], edges: [] },
      seed: 4242,
    };

    // Exhaust quota with a request WITHOUT idempotency key
    const r0 = await app.inject({ 
      method: 'POST', 
      url: '/v1/run', 
      headers: { 'content-type': 'application/json' },
      payload 
    });
    expect(r0.statusCode).toBe(200);

    // Now send a request WITH idempotency key - should get 429
    const headers = {
      'content-type': 'application/json',
      'idempotency-key': 'test-429-key',
    };
    
    const r1 = await app.inject({ method: 'POST', url: '/v1/run', headers, payload });
    expect(r1.statusCode).toBe(429);

    // Retry with same key - should STILL get 429 (not bypass as cached replay)
    const r2 = await app.inject({ method: 'POST', url: '/v1/run', headers, payload });
    expect(r2.statusCode).toBe(429);
  });
});
