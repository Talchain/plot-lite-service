import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Audit Surface', () => {
  let server: ServerHandle;

  beforeAll(async () => { 
    // Spawn with TEST_ROUTES=1 to enable audit endpoint
    server = await spawnServer({ env: { TEST_ROUTES: '1' } }); 
  });
  afterAll(async () => { await server.kill(); });

  it('exposes /__audit__/recent when TEST_ROUTES=1', async () => {
    const res = await fetch(`${server.baseUrl}/__audit__/recent`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.schema).toBe('audit.v1');
    expect(data.events).toBeDefined();
    expect(data.stats).toBeDefined();
    expect(Array.isArray(data.events)).toBe(true);
  });

  // Vehicle route changed from /v1/score to /v1/intervene.
  //
  // These are tests of the AUDIT RING, not of whatever route drives it.
  // /v1/score was withdrawn (typed 501) because its numbers were a closed-form
  // function of the seed and array index, so it no longer records an audit
  // event. /v1/intervene is a surviving audited route that performs real
  // do-operator inference via runKernel, so the audit-ring behaviour under test
  // is unchanged — only the vehicle moved.
  it('records audit events with hashes only (no payloads)', async () => {
    await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }],
          edges: [{ from: 'A', to: 'B', weight: 1.0, belief: 0.9 }]
        },
        actions: [{ node_id: 'A', value: 1 }],
        target: 'B'
      })
    });

    // Check audit log
    const res = await fetch(`${server.baseUrl}/__audit__/recent`);
    const data = await res.json();

    const interveneEvents = data.events.filter((e: any) => e.route === '/v1/intervene');
    expect(interveneEvents.length).toBeGreaterThan(0);

    const event = interveneEvents[interveneEvents.length - 1];
    expect(event.evt).toBe('intervene');
    expect(event.route).toBe('/v1/intervene');
    expect(event.id).toBeDefined();
    expect(event.response_hash).toBeDefined();
    expect(event.status).toBe(200);
    expect(event.ts).toBeDefined();

    // Ensure no payload bodies are present
    expect(event).not.toHaveProperty('graph');
    expect(event).not.toHaveProperty('actions');
    expect(event).not.toHaveProperty('result');
  });

  // The `inference_mode` half of this test is GONE, deliberately.
  //
  // It asserted `event.inference_mode === 'model_based'` on /v1/score — i.e. it
  // pinned the exact fabricated provenance stamp the numerics review of
  // 2026-07-26 flagged. /v1/score ran no inference at all: p10/p50/p90 were
  // weight * (seed + idx * 137) / 10000 plus the constants 0.1/0.5/0.9. That
  // assertion protected a false claim, and it dies with the route that made it.
  // The `seed` half is genuine audit-ring behaviour and is kept, on a
  // surviving audited route.
  it('includes seed in audit', async () => {
    await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: 'X', label: 'X' }, { id: 'Y', label: 'Y' }],
          edges: [{ from: 'X', to: 'Y', weight: 1.0, belief: 0.9 }]
        },
        seed: 9999,
        actions: [{ node_id: 'X', value: 1 }],
        target: 'Y'
      })
    });

    const res = await fetch(`${server.baseUrl}/__audit__/recent`);
    const data = await res.json();

    const interveneEvents = data.events.filter((e: any) => e.route === '/v1/intervene');
    const event = interveneEvents[interveneEvents.length - 1];

    expect(event.seed).toBe(9999);
  });

  it('provides audit stats', async () => {
    const res = await fetch(`${server.baseUrl}/__audit__/recent`);
    const data = await res.json();
    
    expect(data.stats).toBeDefined();
    expect(data.stats.total_entries).toBeGreaterThanOrEqual(0);
    expect(data.stats.max_entries).toBe(100);
  });

  it('respects limit parameter', async () => {
    const res = await fetch(`${server.baseUrl}/__audit__/recent?limit=5`);
    const data = await res.json();
    
    expect(data.events.length).toBeLessThanOrEqual(5);
  });
});
