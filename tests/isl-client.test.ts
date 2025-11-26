/**
 * ISL Client Unit Tests
 *
 * Tests the HTTP client behavior including retry logic, timeout handling,
 * error classification, and configuration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ISLClient, getISLClientConfig, isISLConfigured, type ISLClientConfig } from '../src/integrations/isl/client.js';
import { ISLHttpError, ISLNetworkError, ISLTimeoutError, isRetryableError } from '../src/integrations/isl/errors.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ISLClient', () => {
  let client: ISLClient;
  const defaultConfig: ISLClientConfig = {
    baseUrl: 'https://isl-staging.onrender.com',
    apiKey: 'test-api-key',
    timeoutMs: 5000,
    maxRetries: 3,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    client = new ISLClient(defaultConfig);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('request', () => {
    it('should make successful POST request', async () => {
      const mockResponse = { status: 'identifiable', robustness: 'high' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.request({
        endpoint: '/api/v1/causal/validate',
        body: { dag: {}, treatment: 'A', outcome: 'B' },
        requestId: 'req-123',
      });

      expect(result).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://isl-staging.onrender.com/api/v1/causal/validate',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-API-Key': 'test-api-key',
            'X-Request-Id': 'req-123',
          }),
        })
      );
    });

    it('should throw ISLHttpError on 4xx response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve('{"error": "Invalid DAG"}'),
      });

      await expect(
        client.request({
          endpoint: '/api/v1/causal/validate',
          body: {},
          requestId: 'req-123',
        })
      ).rejects.toThrow(ISLHttpError);
    });

    it('should retry on 5xx response', async () => {
      // First two calls fail with 503, third succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          text: () => Promise.resolve('Service unavailable'),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          text: () => Promise.resolve('Service unavailable'),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true }),
        });

      const requestPromise = client.request({
        endpoint: '/api/v1/test',
        body: {},
        requestId: 'req-retry',
      });

      // Advance timers for backoff delays
      await vi.advanceTimersByTimeAsync(1000); // First backoff
      await vi.advanceTimersByTimeAsync(2000); // Second backoff

      const result = await requestPromise;

      expect(result).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should retry on 429 rate limit', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: () => Promise.resolve('Rate limited'),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ retried: true }),
        });

      const requestPromise = client.request({
        endpoint: '/api/v1/test',
        body: {},
        requestId: 'req-rate-limit',
      });

      await vi.advanceTimersByTimeAsync(1000);

      const result = await requestPromise;

      expect(result).toEqual({ retried: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should not retry on 4xx client error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad request'),
      });

      await expect(
        client.request({
          endpoint: '/api/v1/test',
          body: {},
          requestId: 'req-400',
        })
      ).rejects.toThrow(ISLHttpError);

      // Should only try once, no retries
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should exhaust retries on persistent failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal error'),
      });

      let error: Error | null = null;
      const requestPromise = client.request({
        endpoint: '/api/v1/test',
        body: {},
        requestId: 'req-exhaust',
      }).catch((e) => { error = e; });

      // Advance through all backoff delays
      await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000);
      await requestPromise;

      expect(error).toBeInstanceOf(ISLHttpError);
      expect(mockFetch).toHaveBeenCalledTimes(3); // maxRetries = 3
    });

    it('should use exponential backoff with cap', async () => {
      // Test with more retries to verify cap
      const clientWithMoreRetries = new ISLClient({
        ...defaultConfig,
        maxRetries: 5,
      });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server error'),
      });

      let error: Error | null = null;
      const requestPromise = clientWithMoreRetries.request({
        endpoint: '/api/v1/test',
        body: {},
        requestId: 'req-backoff',
      }).catch((e) => { error = e; });

      // Backoff: 1s, 2s, 4s, 5s (capped), 5s (capped)
      await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000 + 5000 + 5000);
      await requestPromise;

      expect(error).toBeInstanceOf(ISLHttpError);
      expect(mockFetch).toHaveBeenCalledTimes(5);
    });
  });

  describe('healthCheck', () => {
    it('should return true for healthy service', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const healthy = await client.healthCheck();

      expect(healthy).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://isl-staging.onrender.com/health',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'X-API-Key': 'test-api-key',
          }),
        })
      );
    });

    it('should return false for unhealthy service', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

      const healthy = await client.healthCheck();

      expect(healthy).toBe(false);
    });

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      const healthy = await client.healthCheck();

      expect(healthy).toBe(false);
    });
  });
});

describe('Error Classes', () => {
  describe('ISLHttpError', () => {
    it('should be retryable for 5xx status', () => {
      expect(new ISLHttpError(500, '', '/test').isRetryable()).toBe(true);
      expect(new ISLHttpError(502, '', '/test').isRetryable()).toBe(true);
      expect(new ISLHttpError(503, '', '/test').isRetryable()).toBe(true);
    });

    it('should be retryable for 429 status', () => {
      expect(new ISLHttpError(429, '', '/test').isRetryable()).toBe(true);
    });

    it('should not be retryable for 4xx status', () => {
      expect(new ISLHttpError(400, '', '/test').isRetryable()).toBe(false);
      expect(new ISLHttpError(401, '', '/test').isRetryable()).toBe(false);
      expect(new ISLHttpError(404, '', '/test').isRetryable()).toBe(false);
    });

    it('should format error message correctly', () => {
      const error = new ISLHttpError(404, 'Not found', '/api/v1/test');
      expect(error.message).toContain('/api/v1/test');
      expect(error.message).toContain('404');
    });
  });

  describe('isRetryableError', () => {
    it('should return true for retryable ISLHttpError', () => {
      expect(isRetryableError(new ISLHttpError(500, '', '/test'))).toBe(true);
    });

    it('should return false for non-retryable ISLHttpError', () => {
      expect(isRetryableError(new ISLHttpError(400, '', '/test'))).toBe(false);
    });

    it('should return true for ISLNetworkError', () => {
      expect(isRetryableError(new ISLNetworkError('/test'))).toBe(true);
    });

    it('should return true for ISLTimeoutError', () => {
      expect(isRetryableError(new ISLTimeoutError('/test', 5000))).toBe(true);
    });

    it('should return true for AbortError', () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      expect(isRetryableError(abortError)).toBe(true);
    });

    it('should return false for unknown errors', () => {
      expect(isRetryableError(new Error('Unknown'))).toBe(false);
      expect(isRetryableError('string error')).toBe(false);
      expect(isRetryableError(null)).toBe(false);
    });
  });
});

describe('Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getISLClientConfig', () => {
    it('should read configuration from environment', () => {
      process.env.ISL_BASE_URL = 'https://custom-isl.example.com';
      process.env.ISL_API_KEY = 'custom-key';
      process.env.ISL_TIMEOUT_MS = '10000';
      process.env.ISL_MAX_RETRIES = '5';

      const config = getISLClientConfig();

      expect(config.baseUrl).toBe('https://custom-isl.example.com');
      expect(config.apiKey).toBe('custom-key');
      expect(config.timeoutMs).toBe(10000);
      expect(config.maxRetries).toBe(5);
    });

    it('should use defaults for missing environment variables', () => {
      delete process.env.ISL_BASE_URL;
      delete process.env.ISL_API_KEY;
      delete process.env.ISL_TIMEOUT_MS;
      delete process.env.ISL_MAX_RETRIES;

      const config = getISLClientConfig();

      expect(config.baseUrl).toBe('');
      expect(config.apiKey).toBe('');
      expect(config.timeoutMs).toBe(15000);
      expect(config.maxRetries).toBe(3);
    });

    it('should trim whitespace from string values', () => {
      process.env.ISL_BASE_URL = '  https://isl.example.com  ';
      process.env.ISL_API_KEY = '  key-with-spaces  ';

      const config = getISLClientConfig();

      expect(config.baseUrl).toBe('https://isl.example.com');
      expect(config.apiKey).toBe('key-with-spaces');
    });
  });

  describe('isISLConfigured', () => {
    it('should return true when both URL and API key are set', () => {
      process.env.ISL_BASE_URL = 'https://isl.example.com';
      process.env.ISL_API_KEY = 'valid-key';

      expect(isISLConfigured()).toBe(true);
    });

    it('should return false when URL is missing', () => {
      delete process.env.ISL_BASE_URL;
      process.env.ISL_API_KEY = 'valid-key';

      expect(isISLConfigured()).toBe(false);
    });

    it('should return false when API key is missing', () => {
      process.env.ISL_BASE_URL = 'https://isl.example.com';
      delete process.env.ISL_API_KEY;

      expect(isISLConfigured()).toBe(false);
    });

    it('should return false for empty strings', () => {
      process.env.ISL_BASE_URL = '';
      process.env.ISL_API_KEY = '';

      expect(isISLConfigured()).toBe(false);
    });

    it('should return false for whitespace-only strings', () => {
      process.env.ISL_BASE_URL = '   ';
      process.env.ISL_API_KEY = '   ';

      expect(isISLConfigured()).toBe(false);
    });
  });
});

/**
 * Legacy ISL Stub Tests (retained for backwards compatibility)
 * These test the older isl-client.js stub module
 */
describe('ISL Client Stub (Legacy)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getISLConfig', () => {
    it('returns disabled config when env not set', async () => {
      delete process.env.ISL_ENABLE;
      delete process.env.ISL_BASE_URL;
      delete process.env.ISL_API_KEY;

      const { getISLConfig } = await import('../src/integrations/isl-client.js');
      const config = getISLConfig();

      expect(config.enabled).toBe(false);
      expect(config.baseUrl).toBe('');
      expect(config.apiKey).toBe('');
      expect(config.timeoutMs).toBe(5000);
    });

    it('returns disabled if only flag set but no config', async () => {
      process.env.ISL_ENABLE = '1';
      delete process.env.ISL_BASE_URL;
      delete process.env.ISL_API_KEY;

      const { getISLConfig } = await import('../src/integrations/isl-client.js');
      const config = getISLConfig();

      expect(config.enabled).toBe(false);
    });

    it('returns enabled when fully configured', async () => {
      process.env.ISL_ENABLE = '1';
      process.env.ISL_BASE_URL = 'https://isl.example.com';
      process.env.ISL_API_KEY = 'test-key';
      process.env.ISL_TIMEOUT_MS = '3000';

      const { getISLConfig } = await import('../src/integrations/isl-client.js');
      const config = getISLConfig();

      expect(config.enabled).toBe(true);
      expect(config.baseUrl).toBe('https://isl.example.com');
      expect(config.apiKey).toBe('test-key');
      expect(config.timeoutMs).toBe(3000);
    });
  });

  describe('isISLEnabled', () => {
    it('returns false when not configured', async () => {
      delete process.env.ISL_ENABLE;

      const { isISLEnabled } = await import('../src/integrations/isl-client.js');
      expect(isISLEnabled()).toBe(false);
    });

    it('returns true when fully configured', async () => {
      process.env.ISL_ENABLE = '1';
      process.env.ISL_BASE_URL = 'https://isl.example.com';
      process.env.ISL_API_KEY = 'test-key';

      const { isISLEnabled } = await import('../src/integrations/isl-client.js');
      expect(isISLEnabled()).toBe(true);
    });
  });

  describe('ISLClient', () => {
    describe('isAvailable', () => {
      it('returns false when not configured', async () => {
        delete process.env.ISL_ENABLE;

        const { ISLClient } = await import('../src/integrations/isl-client.js');
        const client = new ISLClient();

        expect(client.isAvailable()).toBe(false);
      });

      it('returns true when configured', async () => {
        const { ISLClient } = await import('../src/integrations/isl-client.js');
        const client = new ISLClient({
          enabled: true,
          baseUrl: 'https://isl.example.com',
          apiKey: 'test-key',
          timeoutMs: 5000,
        });

        expect(client.isAvailable()).toBe(true);
      });
    });

    describe('runInference', () => {
      it('returns fallback when ISL disabled', async () => {
        const { ISLClient } = await import('../src/integrations/isl-client.js');
        const client = new ISLClient({ enabled: false });

        const request = {
          nodes: [{ id: 'A' }, { id: 'B' }],
          edges: [{ from: 'A', to: 'B', weight: 1 }],
          targetNode: 'B',
          seed: 42,
          kSamples: 32,
        };

        const fallback = {
          quantiles: { p10: 90, p50: 100, p90: 110 },
          confidence: 'medium' as const,
          hash: 'fallback-hash',
          version: 'fallback',
        };

        const result = await client.runInference(request, fallback);

        expect(result.success).toBe(false);
        expect(result.source).toBe('fallback');
        expect(result.data).toEqual(fallback);
        expect(result.error?.code).toBe('ISL_DISABLED');
      });

      it('returns fallback with ISL_STUB when enabled (stub behavior)', async () => {
        const { ISLClient } = await import('../src/integrations/isl-client.js');
        const client = new ISLClient({
          enabled: true,
          baseUrl: 'https://isl.example.com',
          apiKey: 'test-key',
          timeoutMs: 5000,
        });

        const request = {
          nodes: [{ id: 'A' }, { id: 'B' }],
          edges: [{ from: 'A', to: 'B', weight: 1 }],
          targetNode: 'B',
          seed: 42,
          kSamples: 32,
        };

        const fallback = {
          quantiles: { p10: 90, p50: 100, p90: 110 },
          confidence: 'medium' as const,
          hash: 'fallback-hash',
          version: 'fallback',
        };

        const result = await client.runInference(request, fallback);

        expect(result.success).toBe(false);
        expect(result.source).toBe('fallback');
        expect(result.data).toEqual(fallback);
        expect(result.error?.code).toBe('ISL_STUB');
        expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      });
    });

    describe('healthCheck', () => {
      it('returns unhealthy when not configured', async () => {
        const { ISLClient } = await import('../src/integrations/isl-client.js');
        const client = new ISLClient({ enabled: false });

        const health = await client.healthCheck();

        expect(health.healthy).toBe(false);
        expect(health.error).toContain('not configured');
      });

      it('returns unhealthy when stub (not connected)', async () => {
        const { ISLClient } = await import('../src/integrations/isl-client.js');
        const client = new ISLClient({
          enabled: true,
          baseUrl: 'https://isl.example.com',
          apiKey: 'test-key',
          timeoutMs: 5000,
        });

        const health = await client.healthCheck();

        expect(health.healthy).toBe(false);
        expect(health.error).toContain('stub');
        expect(health.latencyMs).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('getISLClient singleton', () => {
    it('returns same instance', async () => {
      const { getISLClient, resetISLClient } = await import('../src/integrations/isl-client.js');

      resetISLClient();
      const client1 = getISLClient();
      const client2 = getISLClient();

      expect(client1).toBe(client2);
    });

    it('resetISLClient creates new instance', async () => {
      const { getISLClient, resetISLClient } = await import('../src/integrations/isl-client.js');

      const client1 = getISLClient();
      resetISLClient();
      const client2 = getISLClient();

      expect(client1).not.toBe(client2);
    });
  });
});
