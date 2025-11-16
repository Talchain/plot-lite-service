/**
 * Simple seed determinism tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Seed determinism (simple)', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer({ profile: 'fallback' }); });
  afterAll(async () => { await server.kill(); });

  const minimalGraph = {
    nodes: [
      { id: 'A', label: 'Node A', belief: 0.5 },
      { id: 'B', label: 'Node B' }
    ],
    edges: [{ id: 'e1', from: 'A', to: 'B', weight: 0.7 }]
  };

  it('/v1/run: same seed produces identical response_hash', async () => {
    const res1 = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: minimalGraph, seed: 4242 })
    });
    const body1 = await res1.json();

    const res2 = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: minimalGraph, seed: 4242 })
    });
    const body2 = await res2.json();

    expect(body1.model_card.response_hash).toBe(body2.model_card.response_hash);
  });

  it('/v1/run: different seeds produce different response_hash', async () => {
    const res1 = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: minimalGraph, seed: 1111 })
    });
    const body1 = await res1.json();

    const res2 = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: minimalGraph, seed: 2222 })
    });
    const body2 = await res2.json();

    expect(body1.model_card.response_hash).not.toBe(body2.model_card.response_hash);
  });

  it('/v1/run: omitting seed still produces response_hash', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: minimalGraph })
    });
    const body = await res.json();

    expect(body.model_card.response_hash).toBeDefined();
    expect(typeof body.model_card.response_hash).toBe('string');
    expect(body.model_card.response_hash.length).toBeGreaterThan(0);
  });
});
