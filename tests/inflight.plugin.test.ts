/**
 * Inflight Plugin Regression Tests
 * 
 * Ensures createServer() works standalone (without main.ts) and provides
 * correct inflight accounting via the plugin.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('Inflight Plugin: standalone createServer()', () => {
  let app: FastifyInstance;
  const PORT = 4399;
  const BASE = `http://127.0.0.1:${PORT}`;

  // Capture original env to restore after suite
  const prevEnv = {
    TEST_ROUTES: process.env.TEST_ROUTES,
    FEATURE_STREAM: process.env.FEATURE_STREAM,
  };

  beforeAll(async () => {
    // Boot via createServer() only (no main.ts) with test routes enabled
    process.env.TEST_ROUTES = '1';
    process.env.FEATURE_STREAM = '1';
    app = await createServer({ enableTestRoutes: true });
    await app.listen({ port: PORT, host: '127.0.0.1' });
  });

  afterAll(async () => {
    if (app) await app.close();
    
    // Restore env to original state (including undefined)
    if (prevEnv.TEST_ROUTES === undefined) delete process.env.TEST_ROUTES;
    else process.env.TEST_ROUTES = prevEnv.TEST_ROUTES;

    if (prevEnv.FEATURE_STREAM === undefined) delete process.env.FEATURE_STREAM;
    else process.env.FEATURE_STREAM = prevEnv.FEATURE_STREAM;
  });

  it('provides /test/inflight probe with auth', async () => {
    const res = await fetch(`${BASE}/test/inflight`, {
      headers: { 'X-Test-Auth': '1' }
    });
    
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    
    const data = await res.json();
    expect(data).toHaveProperty('inflight');
    expect(typeof data.inflight).toBe('number');
  });

  it('requires X-Test-Auth header for probes', async () => {
    const res = await fetch(`${BASE}/test/inflight`);
    expect(res.status).toBe(403);
    
    const data = await res.json();
    expect(data).toEqual({ error: 'forbidden' });
  });

  it('provides /test/inflight_stats probe', async () => {
    const res = await fetch(`${BASE}/test/inflight_stats`, {
      headers: { 'X-Test-Auth': '1' }
    });
    
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('count');
    expect(data).toHaveProperty('underflows');
    expect(typeof data.count).toBe('number');
    expect(typeof data.underflows).toBe('number');
  });

  it('P0: SSE stream does not cause underflow (0→1→0)', async () => {
    // Get initial state
    const before = await fetch(`${BASE}/test/inflight`, {
      headers: { 'X-Test-Auth': '1' }
    }).then(r => r.json());
    expect(before.inflight).toBe(0);

    // Open SSE stream and close normally
    const res = await fetch(`${BASE}/stream?sleepMs=0`);
    expect(res.status).toBe(200);
    await res.text(); // Read to completion

    // Wait for cleanup
    await new Promise(r => setTimeout(r, 100));

    // Verify back to zero with no underflows
    const after = await fetch(`${BASE}/test/inflight`, {
      headers: { 'X-Test-Auth': '1' }
    }).then(r => r.json());
    expect(after.inflight).toBe(0);

    const stats = await fetch(`${BASE}/test/inflight_stats`, {
      headers: { 'X-Test-Auth': '1' }
    }).then(r => r.json());
    expect(stats.underflows).toBe(0);
  });

  it('P0: client abort does not cause underflow', async () => {
    const before = await fetch(`${BASE}/test/inflight_stats`, {
      headers: { 'X-Test-Auth': '1' }
    }).then(r => r.json());

    const controller = new AbortController();
    const streamPromise = fetch(`${BASE}/stream?sleepMs=50`, {
      signal: controller.signal
    });

    // Wait for stream to start, then abort
    await new Promise(r => setTimeout(r, 25));
    controller.abort();
    try { await streamPromise; } catch {}

    // Wait for cleanup
    await new Promise(r => setTimeout(r, 200));

    const after = await fetch(`${BASE}/test/inflight_stats`, {
      headers: { 'X-Test-Auth': '1' }
    }).then(r => r.json());

    expect(after.count).toBe(0);
    expect(after.underflows).toBe(before.underflows); // No new underflows
  });

  it('P0: probe calls do not increment inflight', async () => {
    // Call probe twice consecutively
    const first = await fetch(`${BASE}/test/inflight`, {
      headers: { 'X-Test-Auth': '1' }
    }).then(r => r.json());

    const second = await fetch(`${BASE}/test/inflight`, {
      headers: { 'X-Test-Auth': '1' }
    }).then(r => r.json());

    // Should return same value (probes excluded from accounting by plugin)
    expect(second.inflight).toBe(first.inflight);

    // Stats probe should also not count
    const stats1 = await fetch(`${BASE}/test/inflight_stats`, {
      headers: { 'X-Test-Auth': '1' }
    }).then(r => r.json());

    const stats2 = await fetch(`${BASE}/test/inflight_stats`, {
      headers: { 'X-Test-Auth': '1' }
    }).then(r => r.json());

    expect(stats2.count).toBe(stats1.count);
  });

  it('P0: 10 mixed SSE cycles end with no underflows', async () => {
    const initial = await fetch(`${BASE}/test/inflight_stats`, {
      headers: { 'X-Test-Auth': '1' }
    }).then(r => r.json());

    // Run 10 mixed cycles (normal, abort, cancel)
    for (let i = 0; i < 10; i++) {
      const cycleType = i % 3;

      if (cycleType === 0) {
        // Normal close
        const res = await fetch(`${BASE}/stream?sleepMs=0`);
        await res.text();
      } else if (cycleType === 1) {
        // Client abort
        const controller = new AbortController();
        const promise = fetch(`${BASE}/stream?sleepMs=10`, {
          signal: controller.signal
        });
        await new Promise(r => setTimeout(r, 5));
        controller.abort();
        try { await promise; } catch {}
      } else {
        // Server cancel
        const id = `plugin-test-${i}`;
        fetch(`${BASE}/stream?id=${id}&sleepMs=20`).catch(() => {});
        await new Promise(r => setTimeout(r, 5));
        await fetch(`${BASE}/stream/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
        await new Promise(r => setTimeout(r, 20));
      }
    }

    // Wait for all cleanup
    await new Promise(r => setTimeout(r, 300));

    const final = await fetch(`${BASE}/test/inflight_stats`, {
      headers: { 'X-Test-Auth': '1' }
    }).then(r => r.json());

    expect(final.count).toBe(0);
    expect(final.underflows).toBe(initial.underflows); // No new underflows
  });
});
