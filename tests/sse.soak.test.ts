/**
 * SSE Soak Test - 500 Cycles with Strict Inflight Invariants
 * 
 * Proves stream stability under churn across:
 * - Normal close
 * - Client abort (AbortController)
 * - Server cancel (POST /stream/cancel)
 * 
 * Verifies inflight=0 and underflows=0 every 50 cycles and at end.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('SSE Soak Test (500 cycles)', () => {
  let app: FastifyInstance;
  const PORT = 4398;
  const BASE = `http://127.0.0.1:${PORT}`;
  const CYCLES = 500;
  const CHECK_INTERVAL = 50;

  // Capture original env to restore after suite
  const prevEnv = {
    TEST_ROUTES: process.env.TEST_ROUTES,
    FEATURE_STREAM: process.env.FEATURE_STREAM,
  };

  beforeAll(async () => {
    process.env.TEST_ROUTES = '1';
    process.env.FEATURE_STREAM = '1';
    app = await createServer({ enableTestRoutes: true });
    await app.listen({ port: PORT, host: '127.0.0.1' });
  });

  afterAll(async () => {
    if (app) await app.close();
    
    // Restore env to original state
    if (prevEnv.TEST_ROUTES === undefined) delete process.env.TEST_ROUTES;
    else process.env.TEST_ROUTES = prevEnv.TEST_ROUTES;

    if (prevEnv.FEATURE_STREAM === undefined) delete process.env.FEATURE_STREAM;
    else process.env.FEATURE_STREAM = prevEnv.FEATURE_STREAM;
  }, 15000);

  async function checkInflight(): Promise<{ count: number; underflows: number }> {
    const res = await fetch(`${BASE}/test/inflight_stats`, {
      headers: { 'X-Test-Auth': '1' }
    });
    expect(res.status).toBe(200);
    return await res.json();
  }

  it('500 mixed cycles end with inflight=0, underflows=0', async () => {
    // Initial check
    const initial = await checkInflight();
    expect(initial.count).toBe(0);
    expect(initial.underflows).toBe(0);

    console.log(`\n🔍 SSE Soak Test (${CYCLES} cycles)\n`);

    for (let i = 0; i < CYCLES; i++) {
      const cycleType = i % 3;

      if (cycleType === 0) {
        // Normal close
        const res = await fetch(`${BASE}/stream?sleepMs=0`);
        await res.text(); // Read to completion
      } else if (cycleType === 1) {
        // Client abort
        const controller = new AbortController();
        const promise = fetch(`${BASE}/stream?sleepMs=10`, {
          signal: controller.signal
        });
        await new Promise(r => setTimeout(r, 5));
        controller.abort();
        try { await promise; } catch {}
        await new Promise(r => setTimeout(r, 10)); // Cleanup time
      } else {
        // Server cancel
        const id = `soak-test-${i}`;
        fetch(`${BASE}/stream?id=${id}&sleepMs=20`).catch(() => {});
        await new Promise(r => setTimeout(r, 5));
        await fetch(`${BASE}/stream/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });
        await new Promise(r => setTimeout(r, 20)); // Cleanup time
      }

      // Check inflight every CHECK_INTERVAL cycles
      if ((i + 1) % CHECK_INTERVAL === 0) {
        await new Promise(r => setTimeout(r, 100)); // Allow cleanup
        const stats = await checkInflight();
        console.log(`  ${i + 1}/${CYCLES} cycles complete, inflight: ${stats.count}, underflows: ${stats.underflows}`);
        expect(stats.count).toBe(0);
        expect(stats.underflows).toBe(0);
      }
    }

    // Final check after all cleanup
    await new Promise(r => setTimeout(r, 500));
    const final = await checkInflight();
    
    console.log(`\n📋 Final Stats:`);
    console.log(`  - Cycles: ${CYCLES}`);
    console.log(`  - Final inflight: ${final.count}`);
    console.log(`  - Underflows: ${final.underflows}`);
    
    expect(final.count).toBe(0);
    expect(final.underflows).toBe(0);
    
    console.log(`\n✅ All ${CYCLES} SSE cycles balanced\n`);
  }, 120000); // 2 minute timeout for 500 cycles
});
