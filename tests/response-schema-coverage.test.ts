/**
 * Response schema coverage tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Response schema coverage', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer({ profile: 'fallback' }); });
  afterAll(async () => { await server.kill(); });

  const minimalGraph = {
    nodes: [{ id: 'A', label: 'Node A' }],
    edges: []
  };

  it('/v1/run response has required top-level fields', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: minimalGraph, seed: 4242 })
    });

    const body = await res.json();
    expect(body.schema).toBe('run.v1');
    expect(body.result).toBeDefined();
    expect(body.meta).toBeDefined();
    expect(body.model_card).toBeDefined();
  });

  it('/v1/run model_card has required fields', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: minimalGraph, seed: 4242 })
    });

    const body = await res.json();
    expect(body.model_card.response_hash).toBeDefined();
    expect(body.model_card.backend).toBeDefined();
    expect(typeof body.model_card.response_hash).toBe('string');
  });

  it('/v1/run meta has seed', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: minimalGraph, seed: 4242 })
    });

    const body = await res.json();
    expect(body.meta.seed).toBe(4242);
  });

  it('/v1/run result has response_hash', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: minimalGraph, seed: 4242 })
    });

    const body = await res.json();
    expect(body.result.response_hash).toBeDefined();
    expect(typeof body.result.response_hash).toBe('string');
  });

  it('/v1/health returns expected fields', async () => {
    const res = await fetch(`${server.baseUrl}/v1/health`);
    const body = await res.json();

    expect(body.status).toBe('ok');
    expect(body.json_429_count).toBeDefined();
    expect(body.sse_429_count).toBeDefined();
    expect(typeof body.json_429_count).toBe('number');
  });

  it('/v1/limits returns expected fields', async () => {
    const res = await fetch(`${server.baseUrl}/v1/limits`);
    const body = await res.json();

    expect(body.schema).toBe('limits.v1');
    expect(body.max_nodes).toBeDefined();
    expect(body.max_edges).toBeDefined();
    expect(body.max_nodes).toBeGreaterThan(0);
    expect(body.max_edges).toBeGreaterThan(0);
  });
});
