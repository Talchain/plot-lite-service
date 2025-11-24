/**
 * Tests for log sanitizer utilities
 * Ensures PII/secrets are properly masked in logs
 */

import { describe, it, expect } from 'vitest';
import { sanitizeUrl, sanitizeQueryParams, sanitizeBody } from '../src/lib/log-sanitizer.js';

describe('Log Sanitizer', () => {
  describe('sanitizeUrl', () => {
    it('removes query parameters', () => {
      const url = '/v1/run?api_key=secret123&user=alice';
      const result = sanitizeUrl(url);
      expect(result).toBe('/v1/run');
      expect(result).not.toContain('secret123');
      expect(result).not.toContain('api_key');
    });

    it('preserves path for debugging', () => {
      const url = '/v1/stream?token=abc123';
      const result = sanitizeUrl(url);
      expect(result).toBe('/v1/stream');
    });

    it('truncates very long paths', () => {
      const longPath = '/v1/' + 'a'.repeat(200);
      const result = sanitizeUrl(longPath, 100);
      expect(result.length).toBeLessThanOrEqual(103); // 100 + '...'
      expect(result).toMatch(/\.\.\.$/);
    });

    it('handles malformed URLs gracefully', () => {
      const malformed = 'not a url at all!@#$%';
      const result = sanitizeUrl(malformed);
      expect(result).toBeTruthy();
      expect(result.length).toBeLessThanOrEqual(100);
    });

    it('handles empty/null URLs', () => {
      expect(sanitizeUrl('')).toBe('');
      expect(sanitizeUrl(null as any)).toBe('');
    });
  });

  describe('sanitizeQueryParams', () => {
    it('redacts params with sensitive key names', () => {
      const params = {
        api_key: 'secret123',
        token: 'abc123',
        password: 'hunter2',
        normal_param: 'safe_value'
      };

      const result = sanitizeQueryParams(params);

      expect(result.api_key).toBe('[REDACTED]');
      expect(result.token).toBe('[REDACTED]');
      expect(result.password).toBe('[REDACTED]');
      expect(result.normal_param).toBe('safe_value');
    });

    it('redacts values that look like secrets', () => {
      const params = {
        id: 'very_long_alphanumeric_string_that_looks_like_a_token_123456789012345678901234567890',
        user_id: '123', // Short, not a secret
        session: 'abcdefghijklmnopqrstuvwxyz1234567890' // Long alphanumeric
      };

      const result = sanitizeQueryParams(params);

      expect(result.id).toBe('[REDACTED]');
      expect(result.user_id).toBe('123');
      expect(result.session).toBe('[REDACTED]');
    });

    it('truncates long non-secret values', () => {
      const params = {
        description: 'a'.repeat(200)
      };

      const result = sanitizeQueryParams(params);

      expect(result.description.length).toBeLessThanOrEqual(103);
      expect(result.description).toMatch(/\.\.\.$/);
    });

    it('handles various sensitive key patterns', () => {
      const params = {
        authorization: 'Bearer token',
        bearer: 'token',
        secret: 'shh',
        api_key: 'key',
        access_token: 'token',
        ACCESS_TOKEN: 'token', // uppercase
        'api-key': 'key' // hyphen variant
      };

      const result = sanitizeQueryParams(params);

      Object.values(result).forEach(value => {
        expect(value).toBe('[REDACTED]');
      });
    });
  });

  describe('sanitizeBody', () => {
    it('returns metadata for objects without exposing content', () => {
      const body = {
        password: 'secret',
        username: 'alice',
        api_key: 'token123',
        data: { nested: 'value' }
      };

      const result = sanitizeBody(body);

      expect(result.type).toBe('object');
      expect(result.size).toBe(4); // 4 keys
      expect(result.hasKeys).toEqual(['password', 'username', 'api_key', 'data']);
      // Ensure no actual values are in the result
      expect(JSON.stringify(result)).not.toContain('secret');
      expect(JSON.stringify(result)).not.toContain('token123');
    });

    it('returns metadata for strings without content', () => {
      const body = 'This string contains password=secret123';

      const result = sanitizeBody(body);

      expect(result.type).toBe('string');
      expect(result.size).toBe(body.length);
      expect(JSON.stringify(result)).not.toContain('password');
      expect(JSON.stringify(result)).not.toContain('secret');
    });

    it('only shows first 5 keys for large objects', () => {
      const body = {
        a: 1, b: 2, c: 3, d: 4, e: 5,
        f: 6, g: 7, h: 8
      };

      const result = sanitizeBody(body);

      expect(result.hasKeys).toHaveLength(5);
      expect(result.size).toBe(8); // Total keys
    });

    it('handles null/undefined bodies', () => {
      expect(sanitizeBody(null)).toEqual({ type: 'null', size: 0 });
      expect(sanitizeBody(undefined)).toEqual({ type: 'null', size: 0 });
    });

    it('handles arrays', () => {
      const body = [1, 2, 3, 'secret'];

      const result = sanitizeBody(body);

      expect(result.type).toBe('array');
      expect(JSON.stringify(result)).not.toContain('secret');
    });
  });
});
