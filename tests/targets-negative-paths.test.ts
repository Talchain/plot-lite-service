/**
 * Targets field negative paths and edge cases
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Targets negative paths', () => {
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

  it('accepts targets even with non-existent node ID (validation happens in handler)', async () => {
    // Note: Schema validation doesn't check node existence, handler does
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        targets: ['NonExistent'],
        seed: 4242
      })
    });

    // Currently passes schema validation (will add handler validation in Phase 1)
    expect(res.status).toBe(200);
  });

  it('rejects targets with duplicate IDs', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        targets: ['A', 'A'],  // Duplicate
        seed: 4242
      })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.type).toBe('BAD_INPUT');
  });

  it('rejects targets with empty string', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        targets: [''],
        seed: 4242
      })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.type).toBe('BAD_INPUT');
  });

  it('accepts single valid target', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        targets: ['B'],
        seed: 4242
      })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schema).toBe('run.v1');
  });

  it('accepts multiple valid targets', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        targets: ['A', 'B'],
        seed: 4242
      })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schema).toBe('run.v1');
  });

  it('omitting targets is valid (runs all nodes)', async () => {
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
});
