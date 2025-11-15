/**
 * P0: /v1/run accepts targets: string[] (canonical) and query.targets (legacy)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer } from './utils.js';
import type { ChildProcess } from 'node:child_process';

describe('P0: /v1/run targets field', () => {
  let app: ChildProcess;
  let baseUrl: string;

  beforeAll(async () => {
    const server = await spawnServer({ profile: 'fallback' });
    app = server.child;
    baseUrl = server.baseUrl;
  });

  afterAll(() => {
    try { if (app?.pid) process.kill(app.pid, 'SIGTERM'); } catch {}
  });

  const minimalGraph = {
    nodes: [
      { id: 'A', label: 'Driver', belief: 0.6 },
      { id: 'B', label: 'Outcome' }
    ],
    edges: [
      { id: 'e1', from: 'A', to: 'B', weight: 0.7, rationale: 'A pushes B' }
    ]
  };

  it('accepts canonical targets: ["B"] with seed 4242', async () => {
    const res = await fetch(`${baseUrl}/v1/run`, {
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
    
    // Verify response structure
    expect(body.model_card).toBeDefined();
    expect(body.model_card.seed).toBe(4242);
    expect(body.model_card.response_hash).toBeDefined();
    expect(body.model_card.backend).toBe('fallback');
    expect(body.results || body.result).toBeDefined();
    
    // Verify backend header
    expect(res.headers.get('x-olumi-backend')).toBe('fallback');
  });

  it('accepts legacy query.targets: ["B"] with seed 4242', async () => {
    const res = await fetch(`${baseUrl}/v1/run`, {
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
    
    // Verify response structure
    expect(body.model_card).toBeDefined();
    expect(body.model_card.seed).toBe(4242);
    expect(body.model_card.response_hash).toBeDefined();
    expect(body.model_card.backend).toBe('fallback');
    expect(body.results || body.result).toBeDefined();
  });

  it('rejects unknown top-level field with 400 flat error.v1', async () => {
    const res = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        targets: ['B'],
        bogus: 1
      })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    
    // Verify flat error.v1 shape
    expect(body.schema).toBe('error.v1');
    expect(body.code).toBe('BAD_INPUT');
    expect(body.message).toContain('bogus');
    expect(body.field).toBe('bogus');
    
    // Verify legacy nested error shape
    expect(body.error).toBeDefined();
    expect(body.error.type).toBe('BAD_INPUT');
    expect(body.error.message).toContain('bogus');
  });

  it('rejects invalid targets (empty array) with 400', async () => {
    const res = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        targets: []
      })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.schema).toBe('error.v1');
    expect(body.code).toBe('BAD_INPUT');
  });

  it('rejects invalid targets (non-unique) with 400', async () => {
    const res = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: minimalGraph,
        targets: ['B', 'B']
      })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.schema).toBe('error.v1');
    expect(body.code).toBe('BAD_INPUT');
  });
});
