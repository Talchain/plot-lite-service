import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('ISL Client Stub (Sprint N Feature 4)', () => {
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

  describe('ISLResult type safety', () => {
    it('has correct structure for success case', async () => {
      const { ISLClient } = await import('../src/integrations/isl-client.js');
      const client = new ISLClient({ enabled: false });

      const fallback = {
        quantiles: { p10: 90, p50: 100, p90: 110 },
        confidence: 'high' as const,
        hash: 'abc123',
        version: '1.0.0',
      };

      const result = await client.runInference(
        { nodes: [], edges: [], targetNode: '', seed: 0, kSamples: 0 },
        fallback
      );

      // Type assertions
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('source');
      expect(['isl', 'fallback']).toContain(result.source);
    });
  });
});
