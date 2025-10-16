import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';

const payload = { 
  seed: 4242, 
  graph: { 
    nodes: [{ id: 'X', label: 'X' }], 
    edges: [] 
  }, 
  outcome_node: 'X' 
};

describe('Principal Unification (F6)', () => {
  let app: any;
  
  beforeAll(async () => {
    process.env.TOKEN_RL_ENABLE = '1';
    process.env.TOKEN_HMAC_SECRET = 'test-secret-f6';
    app = await createServer({ enableTestRoutes: false });
  });
  
  afterAll(async () => { 
    await app?.close(); 
    delete process.env.TOKEN_RL_ENABLE;
    delete process.env.TOKEN_HMAC_SECRET;
  });

  it('same HMAC principal for RL and idempotency', async () => {
    const authA = { authorization: 'Bearer tok-A' };
    const idemHdr = { 'Idempotency-Key': 'unify-test-1' };

    const r1 = await app.inject({ 
      method: 'POST', 
      url: '/v1/run', 
      headers: { ...authA, ...idemHdr }, 
      payload 
    });
    expect(r1.statusCode).toBe(200);

    // Replay with same token hits cache
    const r2 = await app.inject({ 
      method: 'POST', 
      url: '/v1/run', 
      headers: { ...authA, ...idemHdr }, 
      payload 
    });
    expect(r2.statusCode).toBe(200);
  });

  it('different tokens isolated', async () => {
    const authA = { authorization: 'Bearer tok-alpha' };
    const authB = { authorization: 'Bearer tok-beta' };
    const idemHdr = { 'Idempotency-Key': 'unify-test-2' };

    const r1 = await app.inject({ 
      method: 'POST', 
      url: '/v1/run', 
      headers: { ...authA, ...idemHdr }, 
      payload 
    });
    expect(r1.statusCode).toBe(200);

    // Different token, same idem key => different principal
    const r2 = await app.inject({ 
      method: 'POST', 
      url: '/v1/run', 
      headers: { ...authB, ...idemHdr }, 
      payload 
    });
    expect(r2.statusCode).toBe(200);
  });
});
