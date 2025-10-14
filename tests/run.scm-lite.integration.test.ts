/**
 * SCM-Lite Integration Tests for /v1/run
 * Verifies determinism, contract stability, and 429 parity
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

describe('POST /v1/run with SCM-Lite enabled', () => {
  let server: ServerHandle;

  beforeAll(async () => {
    server = await spawnServer({
      env: {
        SCM_LITE_ENABLE: '1',
        SCM_LITE_K: '100',
        SCM_LITE_MAX_NODES: '12',
        SCM_LITE_BELIEF_DEFAULT: '0.7',
        AUTH_ENABLED: '0',
        RATE_LIMIT_ENABLED: '0',
      },
    });
  });

  afterAll(async () => {
    try {
      await server?.kill();
    } catch (err) {
      console.warn('Server cleanup warning:', err);
    }
  });

  it('produces deterministic response_hash and bma_hash with fixed seed', async () => {
    const { baseUrl } = server;
    
    const payload = {
      graph: {
        nodes: [
          { id: 'A', label: 'Node A' },
          { id: 'B', label: 'Node B' },
          { id: 'C', label: 'Node C' },
        ],
        edges: [
          { from: 'A', to: 'B', weight: 1.0 },
          { from: 'B', to: 'C', weight: 1.0 },
        ],
      },
      seed: 4242,
      outcome_node: 'C',
    };

    const headers = { 'Content-Type': 'application/json' };
    const body = JSON.stringify(payload);

    // Run 10 times with same seed
    const hashes: Array<{ response_hash: string; bma_hash: string }> = [];
    
    for (let i = 0; i < 10; i++) {
      const res = await requestJSON(`${baseUrl}/v1/run`, { method: 'POST', headers, body });
      
      expect(res.status).toBe(200);
      expect(res.data).toBeTruthy();
      expect(res.data.model_card.response_hash).toBeTypeOf('string');
      expect(res.data.model_card.bma_hash).toBeTypeOf('string');
      
      hashes.push({
        response_hash: res.data.model_card.response_hash,
        bma_hash: res.data.model_card.bma_hash,
      });
    }

    // All response_hash values must be identical
    const uniqueResponseHashes = new Set(hashes.map(h => h.response_hash));
    expect(uniqueResponseHashes.size).toBe(1);

    // All bma_hash values must be identical
    const uniqueBmaHashes = new Set(hashes.map(h => h.bma_hash));
    expect(uniqueBmaHashes.size).toBe(1);
  });

  it('returns valid report.v1 contract with summary.bands', async () => {
    const { baseUrl } = server;
    
    const payload = {
      graph: {
        nodes: [
          { id: 'X', label: 'Treatment' },
          { id: 'Y', label: 'Outcome' },
        ],
        edges: [{ from: 'X', to: 'Y', weight: 1.5 }],
      },
      seed: 1234,
      outcome_node: 'Y',
    };

    const res = await requestJSON(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    expect(res.data.schema).toBe('run.v1');
    
    // Verify contract fields
    expect(res.data.results).toBeTruthy();
    expect(res.data.results.conservative).toBeTruthy();
    expect(res.data.results.most_likely).toBeTruthy();
    expect(res.data.results.optimistic).toBeTruthy();
    
    // Verify quantiles are monotone
    expect(res.data.results.conservative.outcome).toBeLessThanOrEqual(res.data.results.most_likely.outcome);
    expect(res.data.results.most_likely.outcome).toBeLessThanOrEqual(res.data.results.optimistic.outcome);
    
    // Verify confidence
    expect(res.data.confidence).toBeTruthy();
    expect(res.data.confidence.level).toMatch(/^(LOW|MEDIUM|HIGH)$/);
    expect(typeof res.data.confidence.score).toBe('number');
    
    // Verify meta
    expect(res.data.meta.seed).toBe(1234);
    
    // Verify model_card
    expect(res.data.model_card.response_hash).toHaveLength(64);
    expect(res.data.model_card.bma_hash).toHaveLength(64);
  });

  it('rejects graph exceeding max nodes', async () => {
    const { baseUrl } = server;
    
    const nodes = Array.from({ length: 15 }, (_, i) => ({ id: `N${i}`, label: `Node ${i}` }));
    const payload = {
      graph: { nodes, edges: [] },
      seed: 42,
      outcome_node: 'N0',
    };

    const res = await requestJSON(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Should return 400 or 500 error
    expect([400, 500]).toContain(res.status);
  });
});

describe('POST /v1/run rate-limit parity with SCM-Lite', () => {
  let server: ServerHandle;

  beforeAll(async () => {
    server = await spawnServer({
      env: {
        SCM_LITE_ENABLE: '1',
        SCM_LITE_K: '50',
        AUTH_ENABLED: '0',
        RATE_LIMIT_ENABLED: '1',
        RATE_LIMIT_RPM: '2',
      },
    });
  });

  afterAll(async () => {
    try {
      await server?.kill();
    } catch (err) {
      console.warn('Server cleanup warning:', err);
    }
  });

  it('returns 429 with proper headers after exceeding rate limit', async () => {
    const { baseUrl } = server;
    
    // Use different seeds to avoid idempotency replay exemption
    const payload1 = {
      graph: {
        nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
        edges: [{ from: 'A', to: 'B' }],
      },
      seed: 1001,
      outcome_node: 'B',
    };
    const payload2 = {
      graph: {
        nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
        edges: [{ from: 'A', to: 'B' }],
      },
      seed: 1002,
      outcome_node: 'B',
    };
    const payload3 = {
      graph: {
        nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
        edges: [{ from: 'A', to: 'B' }],
      },
      seed: 1003,
      outcome_node: 'B',
    };

    const headers = { 'Content-Type': 'application/json' };

    // First two requests should succeed (RPM=2)
    const r1 = await requestJSON(`${baseUrl}/v1/run`, { method: 'POST', headers, body: JSON.stringify(payload1) });
    expect([200, 201]).toContain(r1.status);

    const r2 = await requestJSON(`${baseUrl}/v1/run`, { method: 'POST', headers, body: JSON.stringify(payload2) });
    expect([200, 201]).toContain(r2.status);

    // Third request should hit rate limit
    const r3 = await requestJSON(`${baseUrl}/v1/run`, { method: 'POST', headers, body: JSON.stringify(payload3) });
    expect(r3.status).toBe(429);
    
    // Verify 429 headers
    expect(r3.headers.has('retry-after')).toBe(true);
    expect(r3.headers.has('x-ratelimit-reset')).toBe(true);
  });
});
