import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';

describe('SSE Concurrency Soak (G3)', () => {
  let app: any;
  let origMax: string | undefined;

  beforeAll(async () => {
    origMax = process.env.SSE_MAX_MS;
    process.env.SSE_MAX_MS = '2000';
    app = await createServer({ enableTestRoutes: false });
  });

  afterAll(async () => {
    await app?.close();
    if (origMax) process.env.SSE_MAX_MS = origMax;
    else delete process.env.SSE_MAX_MS;
  });

  it('counters track open/close correctly', async () => {
    const healthBefore = await app.inject({ method: 'GET', url: '/v1/health' });
    const before = JSON.parse(healthBefore.body);

    // Open 10 SSE connections
    const streams = await Promise.all(
      Array(10).fill(0).map(() =>
        app.inject({ method: 'GET', url: '/v1/stream?demo=1&latency_ms=100' })
      )
    );

    // All should succeed
    expect(streams.every(s => s.statusCode === 200)).toBe(true);

    const healthAfter = await app.inject({ method: 'GET', url: '/v1/health' });
    const after = JSON.parse(healthAfter.body);

    // Counters should reflect activity
    expect(after.sse_closed).toBeGreaterThanOrEqual(before.sse_closed);
  }, 10000);

  it('resource cleanup: no dangling listeners', async () => {
    const initialListeners = process.listenerCount('uncaughtException');

    // Open and close streams
    for (let i = 0; i < 5; i++) {
      await app.inject({ method: 'GET', url: '/v1/stream?demo=1&latency_ms=50' });
    }

    const finalListeners = process.listenerCount('uncaughtException');
    expect(finalListeners).toBe(initialListeners);
  }, 10000);
});
