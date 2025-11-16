/**
 * Priors validation coverage tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Priors validation coverage', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer({ profile: 'fallback' }); });
  afterAll(async () => { await server.kill(); });

  const minimalGraph = {
    nodes: [
      { id: 'A', label: 'Node A' },
      { id: 'B', label: 'Node B' }
    ],
    edges: [{ id: 'e1', from: 'A', to: 'B', weight: 0.7 }]
  };

  it('accepts request with no priors', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        seed: 4242
      })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schema).toBe('run.v1');
  });

  it('accepts valid priors (scalar)', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        priors: { A: 0.8 },
        seed: 4242
      })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schema).toBe('run.v1');
  });

  it('accepts valid priors (distribution)', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        priors: { A: { mean: 0.6, sd: 0.1 } },
        seed: 4242
      })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schema).toBe('run.v1');
  });

  it('rejects priors with non-existent node', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        priors: { NonExistent: 0.5 },
        seed: 4242
      })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.type).toBe('BAD_INPUT');
  });
});
