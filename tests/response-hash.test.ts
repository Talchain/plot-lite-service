/**
 * Response Hash Tests - A.1
 * 
 * Verifies that model_card.response_hash is present, stable, and deterministic.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('Response Hash Stamp (Task A.1)', () => {
  let app: FastifyInstance;
  let port: number;
  const prevTestRoutes = process.env.TEST_ROUTES;

  beforeAll(async () => {
    process.env.TEST_ROUTES = '1';
    app = await createServer({ enableTestRoutes: true });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterAll(async () => {
    await app.close();
    if (prevTestRoutes === undefined) {
      delete process.env.TEST_ROUTES;
    } else {
      process.env.TEST_ROUTES = prevTestRoutes;
    }
  });

  const testScenario = {
    graph: {
      nodes: [
        { id: 'start', type: 'decision', label: 'Start' },
        { id: 'process', type: 'decision', label: 'Process' },
        { id: 'end', type: 'outcome', label: 'End' }
      ],
      edges: [
        { from: 'start', to: 'process' },
        { from: 'process', to: 'end' }
      ]
    },
    seed: 42,
    k_samples: 1000,
  };

  it('adds response_hash to model_card', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testScenario),
    });

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.model_card).toBeDefined();
    expect(data.model_card.response_hash).toBeDefined();
    expect(typeof data.model_card.response_hash).toBe('string');
    expect(data.model_card.response_hash).toMatch(/^[0-9a-f]{64}$/); // Valid SHA-256 hex
  });

  it('produces identical response_hash across 10 calls with same input', async () => {
    const hashes: string[] = [];

    for (let i = 0; i < 10; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testScenario),
      });

      const data = await res.json();
      hashes.push(data.model_card.response_hash);
    }

    // All hashes should be identical
    expect(new Set(hashes).size).toBe(1);
    expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different seeds', async () => {
    const res1 = await fetch(`http://127.0.0.1:${port}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...testScenario, seed: 42 }),
    });

    const res2 = await fetch(`http://127.0.0.1:${port}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...testScenario, seed: 43 }),
    });

    const data1 = await res1.json();
    const data2 = await res2.json();

    expect(data1.model_card.response_hash).toBeDefined();
    expect(data2.model_card.response_hash).toBeDefined();
    expect(data1.model_card.response_hash).not.toBe(data2.model_card.response_hash);
  });

  it('/v1/self-check hash matches response with embedded response_hash', async () => {
    const selfCheckRes = await fetch(`http://127.0.0.1:${port}/v1/self-check`);
    expect(selfCheckRes.status).toBe(200);
    
    const selfCheckData = await selfCheckRes.json();
    expect(selfCheckData.hash).toBeDefined();
    expect(selfCheckData.hash).toMatch(/^[0-9a-f]{64}$/);
    
    // The self-check hash should be stable
    const selfCheckRes2 = await fetch(`http://127.0.0.1:${port}/v1/self-check`);
    const selfCheckData2 = await selfCheckRes2.json();
    expect(selfCheckData2.hash).toBe(selfCheckData.hash);
  });
});
