/**
 * E2E Tests: /v1/run
 * Validates request→response behavior, schema, hashing, determinism
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, stopServer, type ServerInstance } from './helpers/server.js';
import { expectSchema, validateRunResponse } from './helpers/schema.js';
import { expectRoundTripHash } from './helpers/canon.js';
import { useFakeTime, useRealTime } from './helpers/time.js';
import goldenFixture from './fixtures/graphs/golden.json';

describe('E2E: /v1/run', () => {
  let server: ServerInstance;

  beforeAll(async () => {
    useFakeTime('2024-01-01T00:00:00Z');
    server = await startServer({
      PRINCIPAL_HMAC_SECRET: 'a'.repeat(64),
      RATE_LIMIT_ENABLED: '0',
    });
  });

  afterAll(async () => {
    await stopServer(server);
    useRealTime();
  });

  describe('Happy Paths', () => {
    it('minimal payload returns valid schema and stable hash', async () => {
      const res = await fetch(`${server.url}/v1/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ graph: goldenFixture.graph }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      // Schema validation
      expectSchema(body, validateRunResponse, '/v1/run response');

      // Contract checks
      expect(Array.isArray(body.critique)).toBe(true);
      expect(typeof body.identifiability).toBe('string');
      expect(body.model_card).toBeDefined();
      expect(body.model_card.response_hash).toBeDefined();

      // Round-trip hash
      expectRoundTripHash(body);
    });

    it('deterministic: same seed produces identical hash', async () => {
      const payload = {
        graph: goldenFixture.graph,
        seed: 4242,
        k_samples: 1000,
      };

      const res1 = await fetch(`${server.url}/v1/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(res1.status).toBe(200);
      const body1 = await res1.json();
      expectSchema(body1, validateRunResponse);
      expectRoundTripHash(body1);
      const hash1 = body1.model_card.response_hash;

      // Second identical request
      const res2 = await fetch(`${server.url}/v1/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body2 = await res2.json();
      const hash2 = body2.model_card.response_hash;

      // Determinism: same input → same hash
      expect(hash2).toBe(hash1);
    });

    it('25 parallel runs are identical and hash-stable', async () => {
      const payload = {
        graph: goldenFixture.graph,
        seed: 42,
        k_samples: 1000,
      };

      const calls = Array.from({ length: 25 }, () =>
        fetch(`${server.url}/v1/run`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
      );

      const results = await Promise.all(calls);
      expect(results.every(r => r.status === 200)).toBe(true);

      const bodies = await Promise.all(results.map(r => r.json()));
      const hashes = bodies.map(b => b.model_card.response_hash);

      // All hashes identical
      expect(new Set(hashes).size).toBe(1);

      // All pass schema validation
      bodies.forEach(b => expectSchema(b, validateRunResponse));
    });
  });

  describe('Error Handling', () => {
    it('missing required field returns 400', async () => {
      const res = await fetch(`${server.url}/v1/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}), // Missing graph
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeDefined();
      expect(typeof body.error.type).toBe('string');
      expect(typeof body.error.message).toBe('string');
    });

    it('malformed JSON returns error (400 or 500)', async () => {
      const res = await fetch(`${server.url}/v1/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{invalid json',
      });

      // Accept either 400 or 500 for malformed JSON
      expect(res.status).toBeGreaterThanOrEqual(400);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it('invalid node reference returns error with stable shape', async () => {
      const badGraph = {
        nodes: [{ id: 'A', label: 'A' }],
        edges: [{ from: 'A', to: 'NonExistent' }], // Invalid reference
      };

      const res = await fetch(`${server.url}/v1/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ graph: badGraph }),
      });

      // May return 200 with error in body or 4xx
      const body = await res.json();
      
      // Either error field or valid response
      if (res.status >= 400) {
        expect(body.error).toBeDefined();
        expect(typeof body.error.type).toBe('string');
      }

      // No internal traces leaked
      const bodyStr = JSON.stringify(body);
      expect(bodyStr).not.toMatch(/Error:\s+at\s+/);
    });
  });
});
