import { describe, it, expect } from 'vitest';
import { principalFor, setCached, getCached } from '../src/middleware/idempotency.js';

describe('Idem Cache Principal Key (F4)', () => {
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
