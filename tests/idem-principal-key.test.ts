import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { principalFor, setCached, getCached } from '../src/middleware/idempotency.js';
import { __resetTokenSecret } from '../src/lib/token-principal.js';

// P2: Secret must be ≥64 hex chars (32 bytes) per security requirements
const VALID_SECRET = 'abc123456789012345678901234567890123456789012345678901234567890123';

describe('Idem Cache Principal Key (F4)', () => {
  let origTokenRL: string | undefined;
  let origSecret: string | undefined;

  beforeAll(() => {
    origTokenRL = process.env.TOKEN_RL_ENABLE;
    origSecret = process.env.TOKEN_HMAC_SECRET;
    __resetTokenSecret();
    process.env.TOKEN_RL_ENABLE = '1';
    process.env.TOKEN_HMAC_SECRET = VALID_SECRET;
  });

  afterAll(() => {
    if (origTokenRL) process.env.TOKEN_RL_ENABLE = origTokenRL;
    else delete process.env.TOKEN_RL_ENABLE;
    if (origSecret) process.env.TOKEN_HMAC_SECRET = origSecret;
    else delete process.env.TOKEN_HMAC_SECRET;
    __resetTokenSecret();
  });

  it('different tokens isolated', () => {
    const req1 = { headers: { authorization: 'Bearer token-a' }, ip: '127.0.0.1' } as any;
    const req2 = { headers: { authorization: 'Bearer token-b' }, ip: '127.0.0.1' } as any;
    
    const p1 = principalFor(req1);
    const p2 = principalFor(req2);
    
    expect(p1).not.toBe(p2);
    
    setCached(p1, 'key1', 200, { data: 'a' });
    setCached(p2, 'key1', 200, { data: 'b' });
    
    expect(getCached(p1, 'key1')?.body.data).toBe('a');
    expect(getCached(p2, 'key1')?.body.data).toBe('b');
  });

  it('same token same cache', () => {
    const req1 = { headers: { authorization: 'Bearer xyz' }, ip: '1.1.1.1' } as any;
    const req2 = { headers: { authorization: 'Bearer xyz' }, ip: '2.2.2.2' } as any;
    
    const p1 = principalFor(req1);
    const p2 = principalFor(req2);
    
    expect(p1).toBe(p2);
  });
});
