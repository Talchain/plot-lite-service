/**
 * PR-3: Principal Extraction Unit Tests
 * Verifies determinism, anti-spoofing, and no PII leakage
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractPrincipal, isPrincipalExtractionEnabled, getPrincipalExtractionMode } from '../src/lib/extractPrincipal.js';
import type { FastifyRequest } from 'fastify';

// Mock request helper
function mockRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
    ...overrides,
  } as FastifyRequest;
}

describe('PR-3: Principal Extraction', () => {
  let origEnv: Record<string, string | undefined>;

  beforeEach(() => {
    origEnv = {
      PRINCIPAL_HMAC_SECRET: process.env.PRINCIPAL_HMAC_SECRET,
      TRUST_PROXY: process.env.TRUST_PROXY,
      TRUST_PROXY_HOPS: process.env.TRUST_PROXY_HOPS,
      RL_CB_ENABLE: process.env.RL_CB_ENABLE,
    };
  });

  afterEach(() => {
    Object.assign(process.env, origEnv);
  });

  describe('Determinism', () => {
    it('same auth id → same principal', () => {
      process.env.PRINCIPAL_HMAC_SECRET = 'test-secret';
      
      const req1 = mockRequest({ user: { id: 'user123' } } as any);
      const req2 = mockRequest({ user: { id: 'user123' } } as any);
      
      const p1 = extractPrincipal(req1);
      const p2 = extractPrincipal(req2);
      
      expect(p1).toBe(p2);
      expect(p1).toMatch(/^auth:/);
    });

    it('different auth id → different principal', () => {
      process.env.PRINCIPAL_HMAC_SECRET = 'test-secret';
      
      const req1 = mockRequest({ user: { id: 'userA' } } as any);
      const req2 = mockRequest({ user: { id: 'userB' } } as any);
      
      const p1 = extractPrincipal(req1);
      const p2 = extractPrincipal(req2);
      
      expect(p1).not.toBe(p2);
      expect(p1).toMatch(/^auth:/);
      expect(p2).toMatch(/^auth:/);
    });

    it('no auth: same canonical remote + same UA → same principal', () => {
      process.env.PRINCIPAL_HMAC_SECRET = 'test-secret';
      process.env.TRUST_PROXY = '0';
      
      const req1 = mockRequest({
        ip: '192.168.1.1',
        headers: { 'user-agent': 'TestBot/1.0' },
      });
      const req2 = mockRequest({
        ip: '192.168.1.1',
        headers: { 'user-agent': 'TestBot/1.0' },
      });
      
      const p1 = extractPrincipal(req1);
      const p2 = extractPrincipal(req2);
      
      expect(p1).toBe(p2);
      expect(p1).toMatch(/^anon:/);
    });

    it('no auth: different remote → different principal', () => {
      process.env.PRINCIPAL_HMAC_SECRET = 'test-secret';
      process.env.TRUST_PROXY = '0';
      
      const req1 = mockRequest({ ip: '192.168.1.1' });
      const req2 = mockRequest({ ip: '192.168.1.2' });
      
      const p1 = extractPrincipal(req1);
      const p2 = extractPrincipal(req2);
      
      expect(p1).not.toBe(p2);
    });
  });

  describe('Anti-Spoofing', () => {
    it('forged X-Forwarded-For changes nothing when TRUST_PROXY=0', () => {
      process.env.PRINCIPAL_HMAC_SECRET = 'test-secret';
      process.env.TRUST_PROXY = '0';
      
      const req1 = mockRequest({
        ip: '192.168.1.1',
        headers: {},
      });
      const req2 = mockRequest({
        ip: '192.168.1.1',
        headers: { 'x-forwarded-for': '1.2.3.4' },
      });
      
      const p1 = extractPrincipal(req1);
      const p2 = extractPrincipal(req2);
      
      // Should be identical (XFF ignored)
      expect(p1).toBe(p2);
    });

    it('with TRUST_PROXY=1, rightmost hop affects canonical addr', () => {
      process.env.PRINCIPAL_HMAC_SECRET = 'test-secret';
      process.env.TRUST_PROXY = '1';
      process.env.TRUST_PROXY_HOPS = '1';
      
      const req1 = mockRequest({
        ip: '192.168.1.1',
        headers: { 'x-forwarded-for': '10.0.0.1, 9.9.9.9' },
      });
      const req2 = mockRequest({
        ip: '192.168.1.1',
        headers: { 'x-forwarded-for': '10.0.0.1, 8.8.8.8' },
      });
      
      const p1 = extractPrincipal(req1);
      const p2 = extractPrincipal(req2);
      
      // Should be different (rightmost hop differs)
      expect(p1).not.toBe(p2);
    });
  });

  describe('No PII', () => {
    it('principals are opaque strings (no IP substrings)', () => {
      process.env.PRINCIPAL_HMAC_SECRET = 'test-secret';
      process.env.TRUST_PROXY = '0';
      
      const req = mockRequest({
        ip: '192.168.1.100',
        headers: { 'user-agent': 'MyBrowser/1.0' },
      });
      
      const principal = extractPrincipal(req);
      
      // Should not contain raw IP
      expect(principal).not.toContain('192.168.1.100');
      expect(principal).not.toContain('192.168');
      
      // Should not contain raw UA
      expect(principal).not.toContain('MyBrowser');
      
      // Should be opaque
      expect(principal).toMatch(/^(auth|anon):[A-Za-z0-9_-]+$/);
    });

    it('auth principals do not leak user IDs', () => {
      process.env.PRINCIPAL_HMAC_SECRET = 'test-secret';
      
      const req = mockRequest({ user: { id: 'user-12345-secret' } } as any);
      const principal = extractPrincipal(req);
      
      // Should not contain raw user ID
      expect(principal).not.toContain('user-12345-secret');
      expect(principal).not.toContain('12345');
      
      // Should be opaque
      expect(principal).toMatch(/^auth:[A-Za-z0-9_-]+$/);
    });
  });

  describe('Configuration', () => {
    it('isPrincipalExtractionEnabled returns true when secret set', () => {
      process.env.PRINCIPAL_HMAC_SECRET = 'test-secret';
      expect(isPrincipalExtractionEnabled()).toBe(true);
    });

    it('isPrincipalExtractionEnabled returns false when no secret', () => {
      delete process.env.PRINCIPAL_HMAC_SECRET;
      expect(isPrincipalExtractionEnabled()).toBe(false);
    });

    it('getPrincipalExtractionMode returns degraded when CB enabled but no secret', () => {
      process.env.RL_CB_ENABLE = '1';
      delete process.env.PRINCIPAL_HMAC_SECRET;
      
      expect(getPrincipalExtractionMode()).toBe('degraded');
    });

    it('getPrincipalExtractionMode returns fallback when secret set', () => {
      process.env.PRINCIPAL_HMAC_SECRET = 'test-secret';
      
      expect(getPrincipalExtractionMode()).toBe('fallback');
    });
  });
});
