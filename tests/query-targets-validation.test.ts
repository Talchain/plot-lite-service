/**
 * Test query.targets validation to ensure malformed requests are rejected
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('query.targets validation', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer({ profile: 'fallback' }); });
  afterAll(async () => { await server.kill(); });

  const minimalGraph = {
    nodes: [
      { id: 'A', label: 'Node A' },
      { id: 'B', label: 'Node B' }
    ],
    edges: [
      { id: 'e1', from: 'A', to: 'B', weight: 0.7 }
    ]
  };

  it('rejects query.targets as string (not array)', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        query: { targets: 'A' }  // Should be array, not string
      })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.type).toBe('BAD_INPUT');
  });

  it('rejects query.targets as number', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        query: { targets: 123 }  // Should be array
      })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.type).toBe('BAD_INPUT');
  });

  it('rejects query.targets as empty array', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        query: { targets: [] }  // minItems: 1
      })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.type).toBe('BAD_INPUT');
  });

  it('rejects query object with unknown properties', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        query: { 
          targets: ['A'],
          unknownField: 'value'  // additionalProperties: false
        }
      })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.type).toBe('BAD_INPUT');
  });

  it('accepts valid query.targets array', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        query: { targets: ['B'] },
        seed: 4242
      })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schema).toBe('run.v1');
    expect(body.result).toBeDefined();
  });

  it('canonical targets field works correctly', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        targets: ['B'],  // Canonical field
        seed: 4242
      })
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schema).toBe('run.v1');
    expect(body.result).toBeDefined();
  });
});
