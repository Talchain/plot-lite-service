/**
 * Simple smoke tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Simple smoke tests', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer({ profile: 'fallback' }); });
  afterAll(async () => { await server.kill(); });

  it('server is running', async () => {
    const res = await fetch(`${server.baseUrl}/v1/health`);
    expect(res.status).toBe(200);
  });

  it('health endpoint returns JSON', async () => {
    const res = await fetch(`${server.baseUrl}/v1/health`);
    const body = await res.json();
    expect(body).toBeDefined();
    expect(typeof body).toBe('object');
  });

  it('limits endpoint returns JSON', async () => {
    const res = await fetch(`${server.baseUrl}/v1/limits`);
    const body = await res.json();
    expect(body).toBeDefined();
    expect(typeof body).toBe('object');
  });

  it('run endpoint accepts minimal graph', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: { nodes: [{ id: 'A', label: 'Node A' }], edges: [] },
        seed: 1
      })
    });
    expect(res.status).toBe(200);
  });

  it('run endpoint returns valid JSON response', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: { nodes: [{ id: 'A', label: 'Node A' }], edges: [] },
        seed: 1
      })
    });
    const body = await res.json();
    expect(body.schema).toBeDefined();
  });

  it('HEAD /v1/run returns 204', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'HEAD'
    });
    expect(res.status).toBe(204);
  });

  it('health status is ok', async () => {
    const res = await fetch(`${server.baseUrl}/v1/health`);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('limits has schema field', async () => {
    const res = await fetch(`${server.baseUrl}/v1/limits`);
    const body = await res.json();
    expect(body.schema).toBe('limits.v1');
  });

  it('run with seed returns meta.seed', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: { nodes: [{ id: 'A', label: 'Node A' }], edges: [] },
        seed: 999
      })
    });
    const body = await res.json();
    expect(body.meta.seed).toBe(999);
  });

  it('run returns model_card', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: { nodes: [{ id: 'A', label: 'Node A' }], edges: [] },
        seed: 1
      })
    });
    const body = await res.json();
    expect(body.model_card).toBeDefined();
  });

  it('run returns result', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: { nodes: [{ id: 'A', label: 'Node A' }], edges: [] },
        seed: 1
      })
    });
    const body = await res.json();
    expect(body.result).toBeDefined();
  });
});
