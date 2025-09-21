import { describe, it, expect } from 'vitest';
import { scrubPayload, createLoggablePayload, isCredentialKey, isCredentialValue } from './payload-scrubber.js';

describe('Payload Scrubber', () => {
  describe('scrubPayload', () => {
    it('should redact common credential keys', () => {
      const payload = {
        apiKey: 'secret-api-key',
        password: 'my-password',
        token: 'auth-token',
        normal_field: 'normal-value',
      };

      const result = scrubPayload(payload);

      expect(result).toEqual({
        apiKey: '[REDACTED]',
        password: '[REDACTED]',
        token: '[REDACTED]',
        normal_field: 'normal-value',
      });
    });

    it('should redact values that look like credentials', () => {
      const payload = {
        some_field: 'sk-abcdef1234567890',
        another_field: 'Bearer xyz123',
        base64_field: 'QWxhZGRpbjpvcGVuIHNlc2FtZQ==',
        hex_field: 'a1b2c3d4e5f6789012345678901234567890abcd',
        normal_field: 'just a normal string',
        short_field: 'abc',
      };

      const result = scrubPayload(payload);

      expect(result).toEqual({
        some_field: '[REDACTED]',
        another_field: '[REDACTED]',
        base64_field: '[REDACTED]',
        hex_field: '[REDACTED]',
        normal_field: 'just a normal string',
        short_field: 'abc',
      });
    });

    it('should handle nested objects', () => {
      const payload = {
        user: {
          id: 123,
          credentials: {
            apiKey: 'secret-key',
            refresh_token: 'refresh123',
          },
          profile: {
            name: 'John Doe',
            email: 'john@example.com',
          },
        },
        config: {
          database_password: 'db-secret',
          host: 'localhost',
        },
      };

      const result = scrubPayload(payload);

      expect(result).toEqual({
        user: {
          id: 123,
          credentials: '[REDACTED]', // 'credentials' key matches pattern
          profile: {
            name: 'John Doe',
            email: 'john@example.com',
          },
        },
        config: {
          database_password: '[REDACTED]',
          host: 'localhost',
        },
      });
    });

    it('should handle arrays', () => {
      const payload = {
        items: [
          { id: 1, secret: 'secret1' },
          { id: 2, secret: 'secret2' },
        ],
        tokens: ['token1', 'token2'],
      };

      const result = scrubPayload(payload);

      expect(result).toEqual({
        items: [
          { id: 1, secret: '[REDACTED]' },
          { id: 2, secret: '[REDACTED]' },
        ],
        tokens: '[REDACTED]', // 'tokens' key matches pattern
      });
    });

    it('should respect maxDepth option', () => {
      const payload = {
        level1: {
          level2: {
            level3: {
              secret: 'should-be-redacted',
            },
          },
        },
      };

      const result = scrubPayload(payload, { maxDepth: 2 });

      expect(result).toEqual({
        level1: {
          level2: {
            level3: '[MAX_DEPTH_EXCEEDED]',
          },
        },
      });
    });

    it('should handle custom key patterns', () => {
      const payload = {
        myCustomSecret: 'secret-value',
        normalField: 'normal-value',
      };

      const result = scrubPayload(payload, {
        customKeyPatterns: [/myCustom.*$/i],
      });

      expect(result).toEqual({
        myCustomSecret: '[REDACTED]',
        normalField: 'normal-value',
      });
    });

    it('should handle custom value patterns', () => {
      const payload = {
        field1: 'CUSTOM-123-SECRET',
        field2: 'normal-value',
      };

      const result = scrubPayload(payload, {
        customValuePatterns: [/^CUSTOM-\d+-SECRET$/],
      });

      expect(result).toEqual({
        field1: '[REDACTED]',
        field2: 'normal-value',
      });
    });

    it('should disable value-based scrubbing when scrubByValue is false', () => {
      const payload = {
        apiKey: 'secret-api-key', // Should still be redacted (key-based)
        someField: 'sk-abcdef1234567890', // Should NOT be redacted (value-based)
      };

      const result = scrubPayload(payload, { scrubByValue: false });

      expect(result).toEqual({
        apiKey: '[REDACTED]',
        someField: 'sk-abcdef1234567890',
      });
    });

    it('should handle null and undefined values', () => {
      const payload = {
        nullField: null,
        undefinedField: undefined,
        apiKey: 'secret',
      };

      const result = scrubPayload(payload);

      expect(result).toEqual({
        nullField: null,
        undefinedField: undefined,
        apiKey: '[REDACTED]',
      });
    });

    it('should handle primitives', () => {
      expect(scrubPayload('sk-abcdef1234567890')).toBe('[REDACTED]');
      expect(scrubPayload('normal string')).toBe('normal string');
      expect(scrubPayload(123)).toBe(123);
      expect(scrubPayload(true)).toBe(true);
    });
  });

  describe('createLoggablePayload', () => {
    it('should return formatted JSON string of scrubbed payload', () => {
      const payload = {
        apiKey: 'secret-key',
        data: { value: 42 },
      };

      const result = createLoggablePayload(payload);
      const expected = JSON.stringify({
        apiKey: '[REDACTED]',
        data: { value: 42 },
      }, null, 2);

      expect(result).toBe(expected);
    });

    it('should handle circular references gracefully', () => {
      const payload: any = { name: 'test' };
      payload.self = payload; // Create circular reference

      const result = createLoggablePayload(payload);
      // The scrubber should handle circular references within maxDepth
      // If it doesn't throw an error, the result should be valid JSON
      expect(() => JSON.parse(result)).not.toThrow();
      expect(result).toContain('name');
      expect(result).toContain('test');
    });
  });

  describe('isCredentialKey', () => {
    it('should identify credential keys', () => {
      expect(isCredentialKey('apiKey')).toBe(true);
      expect(isCredentialKey('api_key')).toBe(true);
      expect(isCredentialKey('password')).toBe(true);
      expect(isCredentialKey('secret')).toBe(true);
      expect(isCredentialKey('token')).toBe(true);
      expect(isCredentialKey('authorization')).toBe(true);
      expect(isCredentialKey('private_key')).toBe(true);
      expect(isCredentialKey('database_password')).toBe(true);
    });

    it('should not flag normal keys', () => {
      expect(isCredentialKey('username')).toBe(false);
      expect(isCredentialKey('email')).toBe(false);
      expect(isCredentialKey('id')).toBe(false);
      expect(isCredentialKey('name')).toBe(false);
      expect(isCredentialKey('data')).toBe(false);
    });
  });

  describe('isCredentialValue', () => {
    it('should identify credential-like values', () => {
      expect(isCredentialValue('sk-abcdef1234567890')).toBe(true);
      expect(isCredentialValue('Bearer xyz123token')).toBe(true);
      expect(isCredentialValue('QWxhZGRpbjpvcGVuIHNlc2FtZQ==')).toBe(true);
      expect(isCredentialValue('a1b2c3d4e5f6789012345678901234567890abcd')).toBe(true);
      expect(isCredentialValue('ABCDEF1234567890GHIJKLMNOP')).toBe(true);
    });

    it('should not flag normal values', () => {
      expect(isCredentialValue('john@example.com')).toBe(false);
      expect(isCredentialValue('John Doe')).toBe(false);
      expect(isCredentialValue('localhost')).toBe(false);
      expect(isCredentialValue('123')).toBe(false);
      expect(isCredentialValue('abc')).toBe(false); // Too short
    });
  });
});