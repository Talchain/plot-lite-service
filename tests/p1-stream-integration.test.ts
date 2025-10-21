import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('P1: Stream Integration Tests', () => {
  let app: FastifyInstance;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    process.env.STREAM_PARITY_ENABLE = '1';
    process.env.SSE_HEARTBEAT_MS = '1000'; // 1s for faster tests
    process.env.PROMETHEUS_ENABLE = '1';
    process.env.PRINCIPAL_HMAC_SECRET_ACTIVE = 'a'.repeat(64);
    app = await createServer();
    await app.listen({ port: 0 }); // Listen on random available port
  });

  afterAll(async () => {
    await app.close();
    process.env = originalEnv;
  });

  it('enhanced route emits heartbeat within 2s', async () => {
    const controller = new AbortController();
    const response = await fetch(`http://localhost:${(app.server.address() as any).port}/v1/stream?demo=0&latency_ms=0`, {
      signal: controller.signal,
      headers: { 'Authorization': 'Bearer test-token' }
    });

    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body!.getReader();
    
    // Use SSE helper to collect events until heartbeat
    const events = await collectEventsUntil(
      reader,
      (evts) => evts.some(e => e.event === 'heartbeat'),
      2500
    );

    // Cleanup
    try {
      await reader.cancel();
    } catch (err) {
      if ((err as Error).name !== 'AbortError') throw err;
    }
    controller.abort();

    const initSeen = events.some(e => e.event === 'init');
    const heartbeatSeen = events.some(e => e.event === 'heartbeat');

    expect(initSeen).toBe(true);
    expect(heartbeatSeen).toBe(true);
  }, 5000);

  it('feature flag toggle activates enhanced route', async () => {
    // Enhanced route should be active (STREAM_PARITY_ENABLE=1)
    const response = await fetch(`http://localhost:${(app.server.address() as any).port}/v1/stream?demo=1`, {
      headers: { 'Authorization': 'Bearer test-token' }
    });

    const text = await response.text();
    // Enhanced route uses stream.init.v1 schema
    expect(text).toContain('stream.init.v1');
  });
});
