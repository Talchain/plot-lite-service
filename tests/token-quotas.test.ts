import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../src/createServer.js';

describe('Token-Scoped Rate Limits (E1)', () => {
  let origEnv: string | undefined;

  beforeEach(() => {
    origEnv = process.env.TOKEN_RL_ENABLE;
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.TOKEN_RL_ENABLE = origEnv;
    } else {
      delete process.env.TOKEN_RL_ENABLE;
    }
  });

  it('uses IP principal when flag OFF', async () => {
    delete process.env.TOKEN_RL_ENABLE;
    const { extractPrincipal } = await import('../src/lib/token-principal.js');
    
    const req = { ip: '127.0.0.1', headers: {} };
    const principal = extractPrincipal(req);
    
    expect(principal).toContain('ip:');
  });

  it('uses token principal when flag ON', async () => {
    process.env.TOKEN_RL_ENABLE = '1';
    const { extractPrincipal } = await import('../src/lib/token-principal.js');
    
    const req = {
      ip: '127.0.0.1',
      headers: { authorization: 'Bearer test-token-123' }
    };
    const principal = extractPrincipal(req);
    
    expect(principal).toContain('token:');
  });

  it('falls back to IP when no token', async () => {
    process.env.TOKEN_RL_ENABLE = '1';
    const { extractPrincipal } = await import('../src/lib/token-principal.js');
    
    const req = { ip: '192.168.1.1', headers: {} };
    const principal = extractPrincipal(req);
    
    expect(principal).toContain('ip:');
  });

  it('different tokens get different buckets', async () => {
    process.env.TOKEN_RL_ENABLE = '1';
    const { extractPrincipal } = await import('../src/lib/token-principal.js');
    
    const req1 = { ip: '127.0.0.1', headers: { authorization: 'Bearer token-a' } };
    const req2 = { ip: '127.0.0.1', headers: { authorization: 'Bearer token-b' } };
    
    const p1 = extractPrincipal(req1);
    const p2 = extractPrincipal(req2);
    
    expect(p1).not.toBe(p2);
  });
});
