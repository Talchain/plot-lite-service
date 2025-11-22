import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function nextPort() { return 22900 + Math.floor(Math.random() * 500); }
async function waitHealth(base: string, to=6000) {
  const t0 = Date.now();
  while (Date.now()-t0 < to) { try { const r = await fetch(`${base}/v1/health`); if (r.ok) return true; } catch{} await sleep(80); }
  return false;
}

const minimalGraph = { nodes: [{ id: 'a', label: 'A' }], edges: [] as any[] };

describe('request guards', () => {
  it('413 oversized body; 400 unknown field; JSON 429 headers; 400 out-of-range stream param', async () => {
    const PORT = nextPort();
    const BASE = `http://127.0.0.1:${PORT}`;
    const env = { ...process.env, TEST_ROUTES: '1', AUTH_ENABLED: '0', PORT: String(PORT), RATE_LIMIT_ENABLED: '1', RATE_LIMIT_RPM: '3' } as any;
    const ps = spawn(process.execPath, ['dist/main.js'], { env, stdio: 'ignore' });
    try {
      const up = await waitHealth(BASE);
      expect(up).toBe(true);

      // 400: unknown field in /v1/run (run first to avoid RPM interference)
      const r400 = await fetch(`${BASE}/v1/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ graph: minimalGraph, unknown_field: 1 }) });
      expect(r400.status).toBe(400);

      // RPM=3: drive /v1/draft to 4th=429; assert headers
      const ok1 = await fetch(`${BASE}/v1/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: 'ok' }) });
      expect(ok1.status).toBe(200);
      const ok2 = await fetch(`${BASE}/v1/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: 'ok' }) });
      expect(ok2.status).toBe(200);
      const ok3 = await fetch(`${BASE}/v1/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: 'ok' }) });
      expect(ok3.status).toBe(200);
      const tooSoon = await fetch(`${BASE}/v1/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: 'ok' }) });
      expect(tooSoon.status).toBe(429);
      // ensure X-RateLimit-Reason absent on 2xx
      const keys2xx = new Set<string>(); ok1.headers.forEach((_, k) => keys2xx.add(k.toLowerCase()));
      expect(keys2xx.has('x-ratelimit-reason')).toBe(false);
      const ra = tooSoon.headers.get('retry-after');
      const reset = tooSoon.headers.get('x-ratelimit-reset');
      const reason = tooSoon.headers.get('x-ratelimit-reason');
      expect(ra && String(Number(ra)) === ra).toBe(true);
      expect(typeof reset).toBe('string');
      expect(Number(reset)).toBeGreaterThan(Math.floor(Date.now()/1000));
      expect(reason).toBeTruthy();

      // 413: create body > 128KiB (run has per-route 96KiB; global 128KiB)
      const big = 'x'.repeat(140 * 1024);
      const r413 = await fetch(`${BASE}/v1/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: `{"pad":"${big}"}` });
      expect(r413.status).toBe(413);

      // 413: critique per-route limit (64KiB)
      const big2 = 'y'.repeat(80 * 1024);
      const r413c = await fetch(`${BASE}/v1/critique`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: `{"pad":"${big2}"}` });
      expect(r413c.status).toBe(413);

      // 400: out-of-range stream param
      const rStream = await fetch(`${BASE}/v1/stream?latency_ms=20000`);
      expect(rStream.status).toBe(400);
    } finally {
      try { ps.kill('SIGTERM'); } catch {}
    }
  }, 15000);
});
