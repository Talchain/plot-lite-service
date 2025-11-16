/**
 * Backend header coverage tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Backend header coverage', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer({ profile: 'fallback' }); });
  afterAll(async () => { await server.kill(); });

  const minimalGraph = {
    nodes: [{ id: 'A', label: 'Node A' }],
    edges: []
  };

  it('/v1/run returns X-Olumi-Backend header', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: minimalGraph, seed: 4242 })
    });

    expect(res.headers.get('x-olumi-backend')).toBeDefined();
    const backend = res.headers.get('x-olumi-backend');
    expect(['fallback', 'scm_lite']).toContain(backend);
  });

  it('/v1/run returns model_card.backend in body', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: minimalGraph, seed: 4242 })
    });

    const body = await res.json();
    expect(body.model_card.backend).toBeDefined();
    expect(['fallback', 'scm_lite']).toContain(body.model_card.backend);
  });

  it('/v1/counterfactual returns X-Olumi-Backend header', async () => {
    const res = await fetch(`${server.baseUrl}/v1/counterfactual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        intervention: { node_id: 'A', value: 1.0 },
        outcome_node: 'A',
        seed: 4242
      })
    });

    expect(res.headers.get('x-olumi-backend')).toBeDefined();
  });

  it('/v1/critique returns X-Olumi-Backend header', async () => {
    const res = await fetch(`${server.baseUrl}/v1/critique`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: minimalGraph })
    });

    expect(res.headers.get('x-olumi-backend')).toBeDefined();
  });

  it('/v1/score returns X-Olumi-Backend header', async () => {
    const res = await fetch(`${server.baseUrl}/v1/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        targets: ['A'],
        seed: 4242
      })
    });

    expect(res.headers.get('x-olumi-backend')).toBeDefined();
  });
});
