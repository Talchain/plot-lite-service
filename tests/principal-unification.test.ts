/**
 * P0.1: Principal Unification Test
 * Verifies principalFor() and extractPrincipal() return identical values
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { principalFor } from '../src/middleware/idempotency.js';
import { extractPrincipal } from '../src/lib/token-principal.js';

describe('Principal Unification (P0.1)', () => {
  let origTokenRL: string | undefined;
  let origSecret: string | undefined;

  beforeAll(() => {
    origTokenRL = process.env.TOKEN_RL_ENABLE;
    origSecret = process.env.TOKEN_HMAC_SECRET;
  });

  afterAll(() => {
    if (origTokenRL) process.env.TOKEN_RL_ENABLE = origTokenRL;
    else delete process.env.TOKEN_RL_ENABLE;
    if (origSecret) process.env.TOKEN_HMAC_SECRET = origSecret;
    else delete process.env.TOKEN_HMAC_SECRET;
  });

  it('returns identical principals for IP-based requests (token RL OFF)', () => {
    delete process.env.TOKEN_RL_ENABLE;
    
    const mockReq = {
      ip: '192.168.1.100',
      headers: {}
    } as any;

    const principal1 = principalFor(mockReq);
    const principal2 = extractPrincipal(mockReq);

    expect(principal1).toBe(principal2);
    expect(principal1).toMatch(/^ip:/);
  });

  it('returns identical principals for token-based requests (token RL ON)', () => {
    process.env.TOKEN_RL_ENABLE = '1';
    process.env.TOKEN_HMAC_SECRET = 'test-secret-for-unification';
    
    const mockReq = {
      ip: '192.168.1.100',
      headers: {
        authorization: 'Bearer test-token-123'
      }
    } as any;

    const principal1 = principalFor(mockReq);
    const principal2 = extractPrincipal(mockReq);

    expect(principal1).toBe(principal2);
    expect(principal1).toMatch(/^token:[a-f0-9]{64}$/);
    expect(principal1).not.toContain('test-token-123'); // No raw token
  });

  it('returns identical principals for IPv6 addresses', () => {
    delete process.env.TOKEN_RL_ENABLE;
    
    const mockReq = {
      ip: '2001:0db8:0000:0000:0000:0000:0000:0001',
      headers: {}
    } as any;

    const principal1 = principalFor(mockReq);
    const principal2 = extractPrincipal(mockReq);

    expect(principal1).toBe(principal2);
    expect(principal1).toMatch(/^ip:/);
    // Should be canonicalized (expanded to full form)
    expect(principal1).toBe('ip:2001:0db8:0000:0000:0000:0000:0000:0001');
  });

  it('returns identical principals for requests without Bearer token (token RL ON)', () => {
    process.env.TOKEN_RL_ENABLE = '1';
    process.env.TOKEN_HMAC_SECRET = 'test-secret-for-unification';
    
    const mockReq = {
      ip: '10.0.0.1',
      headers: {}
    } as any;

    const principal1 = principalFor(mockReq);
    const principal2 = extractPrincipal(mockReq);

    expect(principal1).toBe(principal2);
    expect(principal1).toMatch(/^ip:/);
  });

  it('handles missing IP gracefully', () => {
    delete process.env.TOKEN_RL_ENABLE;
    
    const mockReq = {
      headers: {}
    } as any;

    const principal1 = principalFor(mockReq);
    const principal2 = extractPrincipal(mockReq);

    expect(principal1).toBe(principal2);
    expect(principal1).toMatch(/^ip:/);
  });
});
