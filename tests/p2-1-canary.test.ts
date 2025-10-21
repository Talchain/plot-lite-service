import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';

async function wait(url: string, ms = 8000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
}

describe('P2-1: Canary Header', () => {
  let child: any;
  const BASE = 'http://127.0.0.1:4354';

  beforeAll(async () => {
    child = spawn(process.execPath, ['dist/main.js'], {
      env: { ...process.env, PORT: '4354', PROMETHEUS_ENABLE: '1', RATE_LIMIT_ENABLED: '0' },
      stdio: 'ignore'
    });
    await wait(`${BASE}/health`);
  }, 12000);

  afterAll(() => { try { if (child?.pid) process.kill(child.pid); } catch {} });

  it('canonical header works', async () => {
    const r = await fetch(`${BASE}/v1/stream?demo=1`, { headers: { 'X-Enable-Enhanced-Stream': '1' } });
    expect(r.ok).toBe(true);
    await r.body?.getReader().cancel();
  });

  it('legacy header works', async () => {
    const r = await fetch(`${BASE}/v1/stream?demo=1`, { headers: { 'X-Stream-Enhanced': 'yes' } });
    expect(r.ok).toBe(true);
    await r.body?.getReader().cancel();
  });

  it('emits metrics', async () => {
    await fetch(`${BASE}/v1/stream?demo=1`, { headers: { 'X-Enable-Enhanced-Stream': '1' } });
    const m = await fetch(`${BASE}/metrics`);
    const text = await m.text();
    expect(text).toContain('plot_engine_stream_canary_total');
    expect(text).toMatch(/plot_engine_stream_canary_total.*\d+/);
  });
});
