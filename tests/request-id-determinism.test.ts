/**
 * Request ID Determinism Isolation Test
 *
 * Proves that request_id does NOT affect deterministic outputs
 * (response_hash, bands, drivers, etc.)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

describe('request_id determinism isolation', () => {
  let app: FastifyInstance;
  let port: number;
  const prevTestRoutes = process.env.TEST_ROUTES;
  const prevAuthEnabled = process.env.AUTH_ENABLED;

  const testGraph = {
    nodes: [
      { id: 'decision', kind: 'decision', label: 'Decision' },
      { id: 'optionA', kind: 'option', label: 'Option A' },
      { id: 'optionB', kind: 'option', label: 'Option B' },
      { id: 'outcome', kind: 'goal', label: 'Outcome' },
    ],
    edges: [
      { from: 'decision', to: 'optionA', weight: 0.6, belief: 0.8 },
      { from: 'decision', to: 'optionB', weight: 0.4, belief: 0.7 },
      { from: 'optionA', to: 'outcome', weight: 0.8, belief: 0.9 },
      { from: 'optionB', to: 'outcome', weight: 0.5, belief: 0.6 },
    ],
  };

  beforeAll(async () => {
    process.env.TEST_ROUTES = '1';
    process.env.AUTH_ENABLED = '0';
    app = await createServer({ enableTestRoutes: true });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterAll(async () => {
    await app.close();
    if (prevTestRoutes === undefined) delete process.env.TEST_ROUTES;
    else process.env.TEST_ROUTES = prevTestRoutes;
    if (prevAuthEnabled === undefined) delete process.env.AUTH_ENABLED;
    else process.env.AUTH_ENABLED = prevAuthEnabled;
  });

  async function runWithRequestId(requestId: string) {
    const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
      },
      body: JSON.stringify({
        graph: testGraph,
        seed: 42,
        baseline_value: 100,
      }),
    });
    expect(res.status).toBe(200);
    return res.json();
  }

  it('changing only request_id does not change response_hash', async () => {
    const response1 = await runWithRequestId('determinism-test-id-1');
    const response2 = await runWithRequestId('determinism-test-id-2');

    // Response hashes must be identical (same graph, same seed)
    expect(response1.model_card?.response_hash).toBe(response2.model_card?.response_hash);

    // Request IDs must be different (proves we're testing correctly)
    expect(response1.request_id).toBe('determinism-test-id-1');
    expect(response2.request_id).toBe('determinism-test-id-2');
    expect(response1.request_id).not.toBe(response2.request_id);
  });

  it('changing only request_id does not change result bands', async () => {
    const response1 = await runWithRequestId('determinism-bands-1');
    const response2 = await runWithRequestId('determinism-bands-2');

    // Result bands must be identical
    expect(response1.result?.summary).toEqual(response2.result?.summary);
    expect(response1.results).toEqual(response2.results);
  });

  it('changing only request_id does not change drivers', async () => {
    const response1 = await runWithRequestId('determinism-drivers-1');
    const response2 = await runWithRequestId('determinism-drivers-2');

    // Top edge drivers must be identical
    const sortById = (arr: any[]) => [...arr].sort((a, b) => a.edge_id?.localeCompare(b.edge_id) || a.id?.localeCompare(b.id));
    expect(sortById(response1.explain_delta?.top_edge_drivers || [])).toEqual(
      sortById(response2.explain_delta?.top_edge_drivers || [])
    );

    // DriversPayload must be identical (excluding any timestamp-like fields)
    expect(response1.drivers_payload?.status).toBe(response2.drivers_payload?.status);
    expect(response1.drivers_payload?.informative).toBe(response2.drivers_payload?.informative);
    expect(sortById(response1.drivers_payload?.drivers || [])).toEqual(
      sortById(response2.drivers_payload?.drivers || [])
    );
  });

  it('changing only request_id does not change discrimination signal', async () => {
    const response1 = await runWithRequestId('determinism-discrimination-1');
    const response2 = await runWithRequestId('determinism-discrimination-2');

    expect(response1.discrimination).toEqual(response2.discrimination);
  });

  it('request_id is echoed in response body', async () => {
    const requestId = 'echo-test-uuid-123';
    const response = await runWithRequestId(requestId);
    expect(response.request_id).toBe(requestId);
  });

  it('request_id is echoed in X-Request-Id header', async () => {
    const requestId = 'header-echo-test-456';
    const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
      },
      body: JSON.stringify({
        graph: testGraph,
        seed: 42,
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBe(requestId);
  });

  it('generates request_id when not provided', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: testGraph,
        seed: 42,
      }),
    });
    expect(res.status).toBe(200);
    const response = await res.json();
    // Should be a UUID format
    expect(response.request_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
