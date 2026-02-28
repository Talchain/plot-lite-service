/**
 * CEE (Causal Event Engine) Decision Review Integration Tests
 *
 * Tests the integration of CEE orchestrator into /v1/run endpoint:
 * - CEE disabled/misconfigured → no cee* fields, main response unaffected
 * - CEE enabled + healthy with Idempotency-Key → cee* fields present
 * - No Idempotency-Key → CEE not called
 * - CEE error/unhealthy → graceful degradation
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('CEE Integration', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  describe('CEE disabled (default)', () => {
    beforeAll(async () => {
      process.env.CEE_ORCHESTRATOR_ENABLED = '0';
      process.env.RATE_LIMIT_ENABLED = '0';
      app = await createServer();
      await app.listen({ port: 0, host: '127.0.0.1' });
      const addr = app.server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
      await app?.close();
      delete process.env.CEE_ORCHESTRATOR_ENABLED;
      delete process.env.RATE_LIMIT_ENABLED;
    });

    it('does not attach cee* fields when CEE is disabled', async () => {
      const payload = {
        graph: {
          nodes: [
            { id: 'A', label: 'Input' },
            { id: 'B', label: 'Output' }
          ],
          edges: [{ from: 'A', to: 'B', weight: 0.5 }]
        },
        seed: 42,
        outcome_node: 'B'
      };

      const res = await fetch(`${baseUrl}/v1/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'test-key-cee-disabled'
        },
        body: JSON.stringify(payload)
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      // Main response should be present
      expect(body.result).toBeDefined();
      expect(body.model_card).toBeDefined();
      expect(body.results).toBeDefined();

      // CEE fields should NOT be present
      expect(body.ceeReview).toBeUndefined();
      expect(body.ceeTrace).toBeUndefined();
      expect(body.ceeError).toBeUndefined();
    });

    it('works normally without Idempotency-Key', async () => {
      const payload = {
        graph: {
          nodes: [
            { id: 'A', label: 'Input' },
            { id: 'B', label: 'Output' }
          ],
          edges: [{ from: 'A', to: 'B', weight: 0.5 }]
        },
        seed: 43
      };

      const res = await fetch(`${baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.result).toBeDefined();
      expect(body.ceeReview).toBeUndefined();
      expect(body.ceeTrace).toBeUndefined();
      expect(body.ceeError).toBeUndefined();
    });
  });

  describe('CEE enabled with healthy service', () => {
    beforeAll(async () => {
      process.env.CEE_ORCHESTRATOR_ENABLED = '1';
      process.env.CEE_REVIEW_ENABLED = '1';
      process.env.CEE_BASE_URL = 'http://localhost:9999';
      process.env.CEE_API_KEY = 'test-api-key-12345';
      process.env.CEE_TIMEOUT_MS = '1000';
      process.env.RATE_LIMIT_ENABLED = '0';
      app = await createServer();
      await app.listen({ port: 0, host: '127.0.0.1' });
      const addr = app.server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
      await app?.close();
      delete process.env.CEE_ORCHESTRATOR_ENABLED;
      delete process.env.CEE_REVIEW_ENABLED;
      delete process.env.CEE_BASE_URL;
      delete process.env.CEE_API_KEY;
      delete process.env.CEE_TIMEOUT_MS;
      delete process.env.RATE_LIMIT_ENABLED;
    });

    it('attaches cee* fields when Idempotency-Key present', async () => {
      const payload = {
        graph: {
          nodes: [
            { id: 'A', label: 'Input' },
            { id: 'B', label: 'Output' }
          ],
          edges: [{ from: 'A', to: 'B', weight: 0.5 }]
        },
        seed: 44,
        outcome_node: 'B'
      };

      const res = await fetch(`${baseUrl}/v1/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'test-key-cee-enabled'
        },
        body: JSON.stringify(payload)
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      // Main response should be present
      expect(body.result).toBeDefined();
      expect(body.result.response_hash).toBeDefined();
      expect(body.model_card).toBeDefined();
      expect(body.results).toBeDefined();

      // CEE fields should be present (fixture-based when CEE unavailable)
      // Note: The actual values depend on CEE client fixture response
      expect(body.ceeReview !== undefined || body.ceeTrace !== undefined || body.ceeError !== undefined).toBe(true);
    });

    it('does NOT attach cee* fields when Idempotency-Key missing', async () => {
      const payload = {
        graph: {
          nodes: [
            { id: 'A', label: 'Input' },
            { id: 'B', label: 'Output' }
          ],
          edges: [{ from: 'A', to: 'B', weight: 0.5 }]
        },
        seed: 45
      };

      const res = await fetch(`${baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.result).toBeDefined();

      // CEE should NOT be called without Idempotency-Key
      expect(body.ceeReview).toBeUndefined();
      expect(body.ceeTrace).toBeUndefined();
      expect(body.ceeError).toBeUndefined();
    });
  });

  describe('CEE graceful degradation', () => {
    beforeAll(async () => {
      process.env.CEE_ORCHESTRATOR_ENABLED = '1';
      process.env.CEE_REVIEW_ENABLED = '1';
      process.env.CEE_BASE_URL = 'http://localhost:1';
      process.env.CEE_API_KEY = 'test-api-key-degraded';
      process.env.CEE_TIMEOUT_MS = '100';
      process.env.RATE_LIMIT_ENABLED = '0';
      app = await createServer();
      await app.listen({ port: 0, host: '127.0.0.1' });
      const addr = app.server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
      await app?.close();
      delete process.env.CEE_ORCHESTRATOR_ENABLED;
      delete process.env.CEE_REVIEW_ENABLED;
      delete process.env.CEE_BASE_URL;
      delete process.env.CEE_API_KEY;
      delete process.env.CEE_TIMEOUT_MS;
      delete process.env.RATE_LIMIT_ENABLED;
    });

    it('returns successful response even when CEE fails', async () => {
      const payload = {
        graph: {
          nodes: [
            { id: 'A', label: 'Input' },
            { id: 'B', label: 'Output' }
          ],
          edges: [{ from: 'A', to: 'B', weight: 0.5 }]
        },
        seed: 46,
        outcome_node: 'B'
      };

      const res = await fetch(`${baseUrl}/v1/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'test-key-cee-degraded'
        },
        body: JSON.stringify(payload)
      });

      // Should still return 200 even if CEE fails
      expect(res.status).toBe(200);
      const body = await res.json();

      // Main response MUST be present
      expect(body.result).toBeDefined();
      expect(body.result.response_hash).toBeDefined();
      expect(body.model_card).toBeDefined();
      expect(body.results).toBeDefined();

      // CEE might return error view or null values - both are acceptable
      // What matters is the main response is unaffected
    });
  });

  describe('CEE response hash stability', () => {
    beforeAll(async () => {
      process.env.CEE_ORCHESTRATOR_ENABLED = '1';
      process.env.CEE_REVIEW_ENABLED = '1';
      process.env.CEE_BASE_URL = 'http://localhost:9999';
      process.env.CEE_API_KEY = 'test-api-key-hash-stability';
      process.env.RATE_LIMIT_ENABLED = '0';
      app = await createServer();
      await app.listen({ port: 0, host: '127.0.0.1' });
      const addr = app.server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
      await app?.close();
      delete process.env.CEE_ORCHESTRATOR_ENABLED;
      delete process.env.CEE_REVIEW_ENABLED;
      delete process.env.CEE_BASE_URL;
      delete process.env.CEE_API_KEY;
      delete process.env.RATE_LIMIT_ENABLED;
    });

    it('does not include cee* fields in response hash', async () => {
      const payload = {
        graph: {
          nodes: [
            { id: 'A', label: 'Input' },
            { id: 'B', label: 'Output' }
          ],
          edges: [{ from: 'A', to: 'B', weight: 0.5 }]
        },
        seed: 47,
        outcome_node: 'B'
      };

      // Make request WITH Idempotency-Key (CEE enabled)
      const res1 = await fetch(`${baseUrl}/v1/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'test-hash-stability-1'
        },
        body: JSON.stringify(payload)
      });

      expect(res1.status).toBe(200);
      const body1 = await res1.json();
      const hash1 = body1.result?.response_hash;
      expect(hash1).toBeDefined();

      // Make identical request WITHOUT Idempotency-Key (CEE disabled)
      const res2 = await fetch(`${baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      expect(res2.status).toBe(200);
      const body2 = await res2.json();
      const hash2 = body2.result?.response_hash;
      expect(hash2).toBeDefined();

      // Hashes MUST be identical (CEE fields not included in hash)
      expect(hash1).toBe(hash2);
    });

    it('does not include cee* fields in model_card.response_hash', async () => {
      const payload = {
        graph: {
          nodes: [
            { id: 'A', label: 'Input' },
            { id: 'B', label: 'Output' }
          ],
          edges: [{ from: 'A', to: 'B', weight: 0.5 }]
        },
        seed: 48,
        outcome_node: 'B'
      };

      // Make request WITH Idempotency-Key (CEE enabled)
      const res1 = await fetch(`${baseUrl}/v1/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': 'test-model-card-hash-stability-1'
        },
        body: JSON.stringify(payload)
      });

      expect(res1.status).toBe(200);
      const body1 = await res1.json();
      const modelCardHash1 = body1.model_card?.response_hash;
      expect(modelCardHash1).toBeDefined();

      // Make identical request WITHOUT Idempotency-Key (CEE disabled)
      const res2 = await fetch(`${baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      expect(res2.status).toBe(200);
      const body2 = await res2.json();
      const modelCardHash2 = body2.model_card?.response_hash;
      expect(modelCardHash2).toBeDefined();

      // Model card hashes MUST be identical (CEE fields excluded from stampResponseHash)
      expect(modelCardHash1).toBe(modelCardHash2);
    });
  });
});
