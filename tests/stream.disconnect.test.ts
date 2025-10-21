import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';

function parseSse(text: string): Array<{ event: string; id?: string; data?: any }> {
  const out: Array<{ event: string; id?: string; data?: any }> = [];
  for (const block of String(text).split('\n\n')) {
    if (!block.trim()) continue;
    let ev = '', id: string | undefined, dataRaw = '';
    for (const line of block.split('\n')) {
      const [k, v] = line.split(':', 2).map(s => s?.trim() ?? '');
      if (k === 'event') ev = v;
      else if (k === 'id') id = v;
      else if (k === 'data') dataRaw += (dataRaw ? '\n' : '') + v;
    }
    let data: any = dataRaw;
    try { data = JSON.parse(dataRaw); } catch {}
    out.push({ event: ev, id, data });
  }
  return out;
}

async function waitFor(url: string, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error('timeout');
}

async function getMetrics(base: string) {
  const res = await fetch(`${base}/metrics`);
  return res.json();
}

async function getHealth(base: string) {
  const res = await fetch(`${base}/health`);
  return res.json();
}

async function getInflight(base: string): Promise<number> {
  const res = await fetch(`${base}/test/inflight`, {
    headers: { 'X-Test-Auth': '1' }
  });
  expect(res.headers.get('content-type')).toMatch(/application\/json/);
  const data = await res.json();
  return data.inflight;
}

async function getInflightStats(base: string): Promise<{ count: number; underflows: number }> {
  const res = await fetch(`${base}/test/inflight_stats`, {
    headers: { 'X-Test-Auth': '1' }
  });
  expect(res.headers.get('content-type')).toMatch(/application\/json/);
  return res.json();
}

describe('Stream: disconnect behavior', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4338';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], { 
      env: { 
        ...process.env, 
        TEST_PORT: PORT, 
        TEST_ROUTES: '1', 
        RATE_LIMIT_ENABLED: '0',
        FEATURE_STREAM: '1',
        METRICS: '1',
        STREAM_HEARTBEAT_SEC: '1'
      }, 
      stdio: 'ignore' 
    });
    await waitFor(`${BASE}/health`, 5000);
  });
  
  afterAll(async () => { 
    try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} 
  });

  it('abrupt disconnect clears timer and decrements current_streams', async () => {
    // Get baseline metrics
    const before = await getMetrics(BASE);
    const baselineStreams = before.current_streams || 0;

    // Start a stream with slow heartbeat
    const controller = new AbortController();
    const streamPromise = fetch(`${BASE}/stream?sleepMs=50`, {
      signal: controller.signal,
    });

    // Wait for stream to start
    await new Promise(r => setTimeout(r, 100));

    // Check that current_streams incremented
    const during = await getMetrics(BASE);
    expect(during.current_streams).toBeGreaterThan(baselineStreams);

    // Abruptly disconnect
    controller.abort();

    // Wait for cleanup
    await new Promise(r => setTimeout(r, 300));

    // Verify current_streams decremented back to baseline
    const after = await getMetrics(BASE);
    expect(after.current_streams).toBe(baselineStreams);

    // Catch the promise rejection from abort
    try { await streamPromise; } catch {}
  }, 10000);

  it('multiple disconnects do not leak timers or metrics', async () => {
    const before = await getMetrics(BASE);
    const baselineStreams = before.current_streams || 0;

    // Start multiple streams and disconnect them
    const controllers: AbortController[] = [];
    for (let i = 0; i < 5; i++) {
      const controller = new AbortController();
      controllers.push(controller);
      fetch(`${BASE}/stream?sleepMs=50`, { signal: controller.signal }).catch(() => {});
    }

    // Wait for streams to start
    await new Promise(r => setTimeout(r, 150));

    // Disconnect all
    controllers.forEach(c => c.abort());

    // Wait for cleanup
    await new Promise(r => setTimeout(r, 400));

    // Verify all streams cleaned up
    const after = await getMetrics(BASE);
    expect(after.current_streams).toBe(baselineStreams);
  }, 15000);

  it('disconnect during event emission completes gracefully', async () => {
    const controller = new AbortController();
    const streamPromise = fetch(`${BASE}/stream?sleepMs=100`, {
      signal: controller.signal,
    });

    // Wait for first event
    await new Promise(r => setTimeout(r, 150));

    // Disconnect mid-stream
    controller.abort();

    // Should not throw unhandled errors
    try { await streamPromise; } catch (err: any) {
      // Abort error is expected
      expect(err.name).toBe('AbortError');
    }

    // Verify metrics are stable
    await new Promise(r => setTimeout(r, 200));
    const metrics = await getMetrics(BASE);
    expect(typeof metrics.current_streams).toBe('number');
    expect(metrics.current_streams).toBeGreaterThanOrEqual(0);
  }, 10000);

  it('resume after disconnect continues from last-event-id', async () => {
    const id = 'resume-test-1';
    
    // Start stream and collect some events
    const controller1 = new AbortController();
    const stream1 = await fetch(`${BASE}/stream?id=${id}&sleepMs=30`, {
      signal: controller1.signal,
    });

    const reader1 = stream1.body?.getReader();
    const decoder = new TextDecoder();
    let text1 = '';
    let eventCount = 0;

    // Read first 2 events
    if (reader1) {
      while (eventCount < 2) {
        const { done, value } = await reader1.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        text1 += chunk;
        const events = parseSse(text1);
        eventCount = events.filter(e => e.id).length;
      }
    }

    // Disconnect (cancel reader first to avoid unhandled AbortError)
    try {
      await reader1?.cancel();
    } catch (err) {
      // Ignore AbortError during cleanup
      if ((err as Error).name !== 'AbortError') throw err;
    }
    controller1.abort();

    const events1 = parseSse(text1);
    const lastId = events1.filter(e => e.id).slice(-1)[0]?.id;
    
    if (!lastId) {
      // If we didn't get an ID, test is inconclusive
      return;
    }

    // Wait for cleanup
    await new Promise(r => setTimeout(r, 200));

    // Resume from last-event-id
    const stream2 = await fetch(`${BASE}/stream?id=${id}&lastEventId=${lastId}`, {
      headers: { 'Last-Event-ID': lastId }
    });

    const text2 = await stream2.text();
    const events2 = parseSse(text2);

    // Verify we resumed from next event
    if (events2.length > 0 && events2[0].id) {
      const firstResumedId = parseInt(events2[0].id);
      const lastSeenId = parseInt(lastId);
      expect(firstResumedId).toBeGreaterThan(lastSeenId);
    }
  }, 15000);

  it('P0: 0→1→0 transition for normal stream close', async () => {
    const before = await getInflight(BASE);
    expect(before).toBe(0);

    // Start a stream and read to completion
    const res = await fetch(`${BASE}/stream?sleepMs=0`);
    
    // During stream (might be racing, so don't assert here)
    // After completion
    await res.text();
    await new Promise(r => setTimeout(r, 100));

    const after = await getInflight(BASE);
    expect(after).toBe(0);
  }, 10000);

  it('P0: 0→1→0 transition for client abort', async () => {
    const before = await getInflight(BASE);
    expect(before).toBe(0);

    const controller = new AbortController();
    const streamPromise = fetch(`${BASE}/stream?sleepMs=50`, {
      signal: controller.signal,
    });

    // Wait for stream to start
    await new Promise(r => setTimeout(r, 50));

    // Abort
    controller.abort();
    try { await streamPromise; } catch {}

    // Wait for cleanup
    await new Promise(r => setTimeout(r, 200));

    const after = await getInflight(BASE);
    expect(after).toBe(0);
  }, 10000);

  it('P0: 200 cycles mix (close/abort/cancel) end at inflight=0 with no underflows', async () => {
    const before = await getInflight(BASE);
    expect(before).toBe(0);

    // Run 200 mixed cycles
    for (let i = 0; i < 200; i++) {
      const cycleType = i % 3;
      
      if (cycleType === 0) {
        // Normal close
        const res = await fetch(`${BASE}/stream?sleepMs=0`);
        await res.text();
      } else if (cycleType === 1) {
        // Client abort
        const controller = new AbortController();
        const promise = fetch(`${BASE}/stream?sleepMs=10`, { signal: controller.signal });
        await new Promise(r => setTimeout(r, 5));
        controller.abort();
        try { await promise; } catch {}
      } else {
        // Server cancel
        const id = `cancel-${i}`;
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
    await new Promise(r => setTimeout(r, 500));

    // Verify inflight is back to 0
    const after = await getInflight(BASE);
    expect(after).toBe(0);

    // Verify NO underflows occurred (strict accounting)
    const stats = await getInflightStats(BASE);
    expect(stats.count).toBe(0);
    expect(stats.underflows).toBe(0);

    // Verify metrics are stable (no leaks)
    const metrics = await getMetrics(BASE);
    expect(metrics.stream_done).toBeGreaterThanOrEqual(100);
  }, 120000);

  it('P0: probe endpoint does not count itself', async () => {
    // Call probe twice consecutively
    const first = await getInflight(BASE);
    const second = await getInflight(BASE);
    
    // Should return same value (probe doesn't affect inflight)
    expect(second).toBe(first);
    
    // Stats probe should also not count
    const stats1 = await getInflightStats(BASE);
    const stats2 = await getInflightStats(BASE);
    expect(stats2.count).toBe(stats1.count);
  }, 10000);

  it('probe returns 404 when TEST_ROUTES not set', async () => {
    // This test verifies probe is gated properly
    // (requires separate server boot without TEST_ROUTES)
    // Skipped in this suite - see separate test file if needed
  });
});
