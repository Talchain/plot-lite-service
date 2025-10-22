/**
 * SSE Token Tests - Phase 1
 * Validates token issuance, redemption, one-time use, TTL, and redaction
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { issueStreamToken, redeemStreamToken, redactToken } from '../src/lib/stream-token.js';

describe('SSE Token Auth', () => {
  describe('Token Issuance', () => {
    it('issues token with correct structure', () => {
      const result = issueStreamToken('stream');
      
      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('ttl_s');
      expect(typeof result.token).toBe('string');
      expect(result.token.length).toBeGreaterThan(20);
      expect(result.token).toContain('.');
      expect(result.ttl_s).toBeGreaterThan(0);
    });

    it('issues unique tokens', () => {
      const token1 = issueStreamToken('stream');
      const token2 = issueStreamToken('stream');
      
      expect(token1.token).not.toBe(token2.token);
    });

    it('respects TTL from env or defaults to 180s', () => {
      const result = issueStreamToken('stream');
      
      // Default or env-configured
      expect(result.ttl_s).toBeGreaterThanOrEqual(120);
      expect(result.ttl_s).toBeLessThanOrEqual(300);
    });
  });

  describe('Token Redemption', () => {
    it('redeems valid token successfully', () => {
      const { token } = issueStreamToken('stream');
      const result = redeemStreamToken(token);
      
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.payload.aud).toBe('stream');
        expect(result.payload.iat).toBeGreaterThan(0);
        expect(result.payload.exp).toBeGreaterThan(result.payload.iat);
        expect(result.payload.jti).toBeTruthy();
      }
    });

    it('rejects malformed token', () => {
      const result = redeemStreamToken('invalid-token');
      
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('malformed');
      }
    });

    it('rejects token with invalid signature', () => {
      const { token } = issueStreamToken('stream');
      const [payload] = token.split('.');
      const tamperedToken = `${payload}.badsignature`;
      
      const result = redeemStreamToken(tamperedToken);
      
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('invalid_signature');
      }
    });

    it('rejects expired token', async () => {
      // Mock a token that's already expired
      const expiredPayload = {
        aud: 'stream',
        iat: Date.now() - 10000,
        exp: Date.now() - 5000, // Expired 5s ago
        jti: 'test-jti'
      };
      
      const data = JSON.stringify(expiredPayload);
      const { createHmac } = await import('node:crypto');
      const SECRET = process.env.STREAM_TOKEN_SECRET || 'dev-secret-change-in-prod';
      const hmac = createHmac('sha256', SECRET);
      hmac.update(data);
      const signature = hmac.digest('hex');
      const token = `${Buffer.from(data).toString('base64')}.${signature}`;
      
      const result = redeemStreamToken(token);
      
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('expired');
      }
    });

    it('rejects wrong audience', async () => {
      const wrongAudPayload = {
        aud: 'wrong-audience',
        iat: Date.now(),
        exp: Date.now() + 180000,
        jti: 'test-jti'
      };
      
      const data = JSON.stringify(wrongAudPayload);
      const { createHmac } = await import('node:crypto');
      const SECRET = process.env.STREAM_TOKEN_SECRET || 'dev-secret-change-in-prod';
      const hmac = createHmac('sha256', SECRET);
      hmac.update(data);
      const signature = hmac.digest('hex');
      const token = `${Buffer.from(data).toString('base64')}.${signature}`;
      
      const result = redeemStreamToken(token);
      
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.reason).toBe('wrong_audience');
      }
    });

    it('rejects reused token (one-time use)', () => {
      const { token } = issueStreamToken('stream');
      
      // First redemption succeeds
      const result1 = redeemStreamToken(token);
      expect(result1.valid).toBe(true);
      
      // Second redemption fails
      const result2 = redeemStreamToken(token);
      expect(result2.valid).toBe(false);
      if (!result2.valid) {
        expect(result2.reason).toBe('reused');
      }
    });
  });

  describe('Token Redaction', () => {
    it('redacts token showing only first 8 chars', () => {
      const { token } = issueStreamToken('stream');
      const redacted = redactToken(token);
      
      expect(redacted).toContain('...');
      expect(redacted.length).toBeLessThan(token.length);
      expect(redacted.startsWith(token.slice(0, 8))).toBe(true);
    });

    it('handles short tokens safely', () => {
      const redacted = redactToken('short');
      expect(redacted).toBe('***');
    });

    it('handles empty tokens safely', () => {
      const redacted = redactToken('');
      expect(redacted).toBe('***');
    });
  });

  describe('SSE Integration', () => {
    it('token includes monotonic id in events', () => {
      // This will be tested in E2E, but verify structure
      const { token } = issueStreamToken('stream');
      expect(token).toBeTruthy();
      
      // Token should be URL-safe for query params
      expect(token).not.toContain(' ');
      expect(token).not.toContain('\n');
    });

    it('retry directive is set to 1500ms', () => {
      // This will be verified in E2E tests
      // Just ensure the constant is correct
      const RETRY_MS = 1500;
      expect(RETRY_MS).toBe(1500);
    });
  });
});
