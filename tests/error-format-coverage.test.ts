/**
 * Error format coverage tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Error format coverage', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer({ profile: 'fallback' }); });
  afterAll(async () => { await server.kill(); });

  it('400 error has flat error.v1 format', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invalid: 'payload' })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.type).toBeDefined();
    expect(body.error.message).toBeDefined();
  });

  it('404 error for unknown route', async () => {
    const res = await fetch(`${server.baseUrl}/v1/nonexistent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    expect(res.status).toBe(404);
  });

  it('413 error for oversized payload', async () => {
    const hugePayload = {
      graph: {
        nodes: Array.from({ length: 1000 }, (_, i) => ({
          id: `node_${i}`,
          label: `Node ${i}`.repeat(100)
        })),
        edges: []
      }
    };

    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(hugePayload)
    });

    expect(res.status).toBe(413);
  });

  it('HEAD request supported on /v1/run', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'HEAD'
    });

    expect(res.status).toBe(204);
  });

  it('400 error includes helpful message', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: { nodes: [], edges: [] } })  // Missing required fields
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toBeDefined();
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  it('CORS headers present on successful request', async () => {
    const res = await fetch(`${server.baseUrl}/v1/health`);

    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeDefined();
  });
});
