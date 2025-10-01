import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';

async function waitFor(url: string, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error('timeout');
}

describe('Metrics endpoint (gated)', () => {
  const PORT = '4355';
  const BASE = `http://127.0.0.1:${PORT}`;

  it('absent when METRICS unset', async () => {
    let child: ReturnType<typeof spawn> | null = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', RATE_LIMIT_ENABLED: '0' }, stdio: 'ignore' });
    await waitFor(`${BASE}/health`, 5000);
    const r = await fetch(`${BASE}/metrics`);
    expect(r.status).toBe(404);
    try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {}
  });

  it('exposes counters and draft p95s when METRICS=1', async () => {
    let child: ReturnType<typeof spawn> | null = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', METRICS: '1', RATE_LIMIT_ENABLED: '0' }, stdio: 'ignore' });
    await waitFor(`${BASE}/health`, 5000);
    // trigger a few draft-flows to populate history
    await fetch(`${BASE}/draft-flows?template=pricing_change&seed=101`);
    await fetch(`${BASE}/draft-flows?template=pricing_change&seed=101`);
    const r = await fetch(`${BASE}/metrics`);
    expect(r.status).toBe(200);
    const j: any = await r.json();
    expect(typeof j.stream_started).toBe('number');
    expect(typeof j.stream_done).toBe('number');
    expect(typeof j.stream_cancelled).toBe('number');
    expect(typeof j.stream_limited).toBe('number');
    expect(typeof j.stream_retryable).toBe('number');
    expect(Array.isArray(j.draft_flows_p95_last5)).toBe(true);
    expect(j.draft_flows_p95_last5.length).toBeLessThanOrEqual(5);
    try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {}
  });
});
