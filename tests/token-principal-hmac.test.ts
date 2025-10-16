import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractPrincipal } from '../src/lib/token-principal.js';

describe('Token Principal HMAC (F2)', () => {
  let origRL: string | undefined;
  let origSecret: string | undefined;

  beforeEach(() => {
    origRL = process.env.TOKEN_RL_ENABLE;
    origSecret = process.env.TOKEN_HMAC_SECRET;
  });

  afterEach(() => {
    if (origRL) process.env.TOKEN_RL_ENABLE = origRL; else delete process.env.TOKEN_RL_ENABLE;
    if (origSecret) process.env.TOKEN_HMAC_SECRET = origSecret; else delete process.env.TOKEN_HMAC_SECRET;
  });

  it('HMAC 64-hex principal', () => {
    process.env.TOKEN_RL_ENABLE = '1';
    process.env.TOKEN_HMAC_SECRET = 'test-secret';
    
    const req = { ip: '127.0.0.1', headers: { authorization: 'Bearer token123' } };
    const p = extractPrincipal(req);
    
    expect(p).toMatch(/^token:[0-9a-f]{64}$/);
  });

  it('same token same principal', () => {
    process.env.TOKEN_RL_ENABLE = '1';
    process.env.TOKEN_HMAC_SECRET = 'secret';
    
    const req1 = { ip: '1.1.1.1', headers: { authorization: 'Bearer abc' } };
    const req2 = { ip: '2.2.2.2', headers: { authorization: 'Bearer abc' } };
    
    expect(extractPrincipal(req1)).toBe(extractPrincipal(req2));
  });

  it('different tokens different principals', () => {
    process.env.TOKEN_RL_ENABLE = '1';
    process.env.TOKEN_HMAC_SECRET = 'secret';
    
    const req1 = { ip: '127.0.0.1', headers: { authorization: 'Bearer token-a' } };
    const req2 = { ip: '127.0.0.1', headers: { authorization: 'Bearer token-b' } };
    
    expect(extractPrincipal(req1)).not.toBe(extractPrincipal(req2));
  });

  it('no token uses canonicalized IP', () => {
    process.env.TOKEN_RL_ENABLE = '1';
    
    const req = { ip: '::1', headers: {} };
    const p = extractPrincipal(req);
    
    expect(p).toContain('ip:');
  });
});
