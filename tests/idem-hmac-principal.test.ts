import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { principalFor, setCached, getCached } from '../src/middleware/idempotency.js';
import { createServer } from '../src/createServer.js';
import { __resetTokenSecret } from '../src/lib/token-principal.js';

// P2: Secret must be ≥64 hex chars (32 bytes) per security requirements
const VALID_SECRET = 'abc123456789012345678901234567890123456789012345678901234567890123';

describe('Idempotency HMAC Principal (F5)', () => {
  let origSecret: string | undefined;
  let origRL: string | undefined;

  beforeEach(() => {
    origSecret = process.env.TOKEN_HMAC_SECRET;
    origRL = process.env.TOKEN_RL_ENABLE;
    __resetTokenSecret();
    process.env.TOKEN_HMAC_SECRET = VALID_SECRET;
    process.env.TOKEN_RL_ENABLE = '1';
  });

  afterEach(() => {
    if (origSecret) process.env.TOKEN_HMAC_SECRET = origSecret;
    else delete process.env.TOKEN_HMAC_SECRET;
    if (origRL) process.env.TOKEN_RL_ENABLE = origRL;
    else delete process.env.TOKEN_RL_ENABLE;
    __resetTokenSecret();
  });

  it('same token identical replay', () => {
    const req1 = { headers: { authorization: 'Bearer abc123' }, ip: '1.1.1.1' } as any;
    const req2 = { headers: { authorization: 'Bearer abc123' }, ip: '2.2.2.2' } as any;
    
    const p1 = principalFor(req1);
    const p2 = principalFor(req2);
    
    expect(p1).toBe(p2);
    expect(p1).toMatch(/^token:[0-9a-f]{64}$/);
    
    setCached(p1, 'key1', 200, { result: 'cached' });
    expect(getCached(p2, 'key1')?.body.result).toBe('cached');
  });

  it('different tokens isolated caches', () => {
    const req1 = { headers: { authorization: 'Bearer token-a' }, ip: '127.0.0.1' } as any;
    const req2 = { headers: { authorization: 'Bearer token-b' }, ip: '127.0.0.1' } as any;
    
    const p1 = principalFor(req1);
    const p2 = principalFor(req2);
    
    expect(p1).not.toBe(p2);
    
    setCached(p1, 'k1', 200, { data: 'a' });
    setCached(p2, 'k1', 200, { data: 'b' });
    
    expect(getCached(p1, 'k1')?.body.data).toBe('a');
    expect(getCached(p2, 'k1')?.body.data).toBe('b');
  });

  it('no token uses canonicalized IP', () => {
    const req = { headers: {}, ip: '::1' } as any;
    const p = principalFor(req);
    
    expect(p).toContain('ip:');
    expect(p).not.toContain('token:');
  });

  it('no raw tokens in logs', async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(' '));
    
    const app = await createServer({ enableTestRoutes: false });
    await app.inject({
      method: 'POST',
      url: '/v1/run',
      headers: { 
        'authorization': 'Bearer secret-token-12345',
        'idempotency-key': 'test-key-f5'
      },
      payload: {
        seed: 4242,
        graph: { nodes: [{ id: 'A', label: 'A' }], edges: [] },
        outcome_node: 'A'
      }
    });
    
    await app.close();
    console.log = originalLog;
    
    const rawTokenFound = logs.some(log => 
      log.includes('secret-token-12345') && !log.includes('token:[0-9a-f]{64}')
    );
    
    expect(rawTokenFound).toBe(false);
  });
});
