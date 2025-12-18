/**
 * P1-B: SSE Helper Demo Tests
 * Demonstrates new helper functions for SSE testing
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { connectStream, waitForHeartbeat, collectEventsUntil } from './helpers/sse.js';

async function waitForServer(url: string, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`Server not ready at ${url}`);
}

describe('P1-B: SSE Helper Functions', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4355';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['dist/main.js'], {
      env: {
        ...process.env,
        PORT,
        TEST_ROUTES: '0',
        RATE_LIMIT_ENABLED: '0',
        DEMO_MODE_ENABLED: '1',
      },
      stdio: 'ignore'
    });
    
    await waitForServer(`${BASE}/health`, 10000);
  }, 15000);

  afterAll(async () => {
    if (child?.pid) {
      try {
        process.kill(child.pid, 'SIGTERM');
        await new Promise(r => setTimeout(r, 500));
      } catch {}
    }
  });

  it('connectStream() establishes SSE connection', async () => {
    const { response, reader, controller } = await connectStream({
      baseUrl: BASE,
      route: '/v1/stream?demo=1',
      timeoutMs: 5000
    });

    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    
    // Read one chunk to verify stream works
    const { value, done } = await reader.read();
    expect(done).toBe(false);
    expect(value).toBeDefined();
    
    try {
      await reader.cancel();
      controller.abort();
    } catch (err) {
      // Ignore abort errors during cleanup
    }
  });

  it('connectStream() supports custom headers', async () => {
    const { response, reader, controller } = await connectStream({
      baseUrl: BASE,
      route: '/v1/stream?demo=1',
      headers: { 'X-Enable-Enhanced-Stream': '1' },
      timeoutMs: 5000
    });

    expect(response.ok).toBe(true);
    
    try {
      await reader.cancel();
      controller.abort();
    } catch (err) {
      // Ignore abort errors during cleanup
    }
  });

  it('collectEventsUntil() stops on predicate', async () => {
    const { reader, controller } = await connectStream({
      baseUrl: BASE,
      route: '/v1/stream?demo=1',
      timeoutMs: 5000
    });

    // Collect until we have 2 events
    const events = await collectEventsUntil(
      reader,
      (events) => events.length >= 2,
      3000
    );

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]).toHaveProperty('data');
    
    try {
      await reader.cancel();
      controller.abort();
    } catch (err) {
      // Ignore abort errors during cleanup
    }
  });

  it('collectEventsUntil() respects timeout', async () => {
    const { reader, controller } = await connectStream({
      baseUrl: BASE,
      route: '/v1/stream?demo=1',
      timeoutMs: 5000
    });

    // Collect with impossible predicate and short timeout
    const events = await collectEventsUntil(
      reader,
      () => false, // Never satisfied
      1000 // 1 second timeout
    );

    // Should return whatever events were collected
    expect(Array.isArray(events)).toBe(true);
    
    try {
      await reader.cancel();
      controller.abort();
    } catch (err) {
      // Ignore abort errors during cleanup
    }
  });
});
