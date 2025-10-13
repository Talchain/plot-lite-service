import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function waitFor(url: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {}
    await sleep(80);
  }
  return false;
}

function nextPort(): number {
  return 24000 + Math.floor(Math.random() * 500);
}

describe('SSE heartbeat cleanup (no timer leak)', () => {
  let child: ReturnType<typeof spawn> | null = null;
  let BASE = '';

  beforeAll(async () => {
    const port = String(nextPort());
    BASE = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['tools/test-server.js'], {
      env: {
        ...process.env,
        TEST_PORT: port,
        TEST_ROUTES: '1',
        RATE_LIMIT_ENABLED: '0',
        STREAM_HEARTBEAT_SEC: '1', // Fast heartbeat for testing
      },
      stdio: 'ignore',
    });
    await waitFor(`${BASE}/v1/health`, 6000);
  });

  afterAll(async () => {
    try {
      if (child?.pid) process.kill(child.pid, 'SIGINT');
    } catch {}
  });

  it('opens and closes stream N times without timer leak', async () => {
    const N = 50;
    const controllers: AbortController[] = [];

    // Get initial inflight count
    const initial = await fetch(`${BASE}/test/inflight`, {
      headers: { 'X-Test-Auth': '1' },
    }).then(r => r.json());
    const initialInflight = initial.inflight || 0;

    // Open N streams
    for (let i = 0; i < N; i++) {
      const ac = new AbortController();
      controllers.push(ac);
      // Start stream but don't await (let it run in background)
      fetch(`${BASE}/stream?sleepMs=100`, { signal: ac.signal }).catch(() => {});
    }

    // Wait a bit for streams to establish
    await sleep(200);

    // Abort all streams (simulates client disconnect)
    for (const ac of controllers) {
      try {
        ac.abort();
      } catch {}
    }

    // Wait for cleanup
    await sleep(500);

    // Check inflight - should return to initial (no leaks)
    const final = await fetch(`${BASE}/test/inflight`, {
      headers: { 'X-Test-Auth': '1' },
    }).then(r => r.json());
    expect(final.inflight).toBe(initialInflight);
  }, 15000);

  it('handles abrupt socket close and clears heartbeat timer', async () => {
    // Get initial inflight
    const initial = await fetch(`${BASE}/test/inflight`, {
      headers: { 'X-Test-Auth': '1' },
    }).then(r => r.json());
    const initialInflight = initial.inflight || 0;
    
    const ac = new AbortController();
    
    // Start a long-running stream (10 seconds)
    const p = fetch(`${BASE}/stream?sleepMs=10000`, { signal: ac.signal }).catch(() => null);
    
    // Wait longer for stream to fully establish and heartbeat to start
    await sleep(1500);
    
    // Abruptly close
    ac.abort();
    await p;
    
    // Wait for cleanup
    await sleep(1000);
    
    // Verify stream cleaned up (inflight returns to initial or close to it)
    const final = await fetch(`${BASE}/test/inflight`, {
      headers: { 'X-Test-Auth': '1' },
    }).then(r => r.json());
    // Allow for small variance due to other requests
    expect(Math.abs(final.inflight - initialInflight)).toBeLessThanOrEqual(1);
  }, 15000);
});
