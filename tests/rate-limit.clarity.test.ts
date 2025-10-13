import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function nextPort() { return 22800 + Math.floor(Math.random() * 500); }
async function waitHealth(base: string, to = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < to) {
    try { const r = await fetch(`${base}/v1/health`); if (r.ok) return true; } catch {}
    await sleep(80);
  }
  return false;
}

const minimalGraph = {
  nodes: [{ id: 'a', label: 'A' }],
  edges: [] as any[],
};

describe('429 clarity headers', () => {
  it('JSON route 429 includes Retry-After and X-RateLimit-Reason; 2xx has no X-RateLimit-Reason', async () => {
    const PORT = nextPort();
    const BASE = `http://127.0.0.1:${PORT}`;
    try { mkdirSync('artifact', { recursive: true }); } catch {}
    writeFileSync('artifact/runtime-config.json', JSON.stringify({ sse_per_ip_max: 2, sse_global_max: 100, rate_limit_rpm: 1 }, null, 2));
    const env = { ...process.env, PORT: String(PORT), TEST_ROUTES: '1', AUTH_ENABLED: '0' } as any;
    const ps = spawn(process.execPath, ['dist/main.js'], { env, stdio: 'ignore' });
    try {
      const up = await waitHealth(BASE);
      expect(up).toBe(true);
      // Ensure runtime-config is active (SIGHUP)
      try { ps.kill('SIGHUP'); } catch {}
      await sleep(250);
      // First request should be 200
      const r1 = await fetch(`${BASE}/v1/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ graph: minimalGraph }) });
      expect(r1.status).toBe(200);
      expect(r1.headers.get('X-RateLimit-Reason')).toBeNull();
      // Second request in same minute should be 429
      const r2 = await fetch(`${BASE}/v1/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ graph: minimalGraph }) });
      expect(r2.status).toBe(429);
      expect(r2.headers.get('Retry-After')).toBeTruthy();
      expect(r2.headers.get('X-RateLimit-Reason')).toBe('per_ip');
    } finally {
      try { ps.kill('SIGTERM'); } catch {}
    }
  }, 15000);

  it('SSE 429 includes Retry-After and X-RateLimit-Reason', async () => {
    const PORT = nextPort();
    const BASE = `http://127.0.0.1:${PORT}`;
    try { mkdirSync('artifact', { recursive: true }); } catch {}
    writeFileSync('artifact/runtime-config.json', JSON.stringify({ sse_per_ip_max: 1, sse_global_max: 100, rate_limit_rpm: 60 }, null, 2));
    const env = { ...process.env, PORT: String(PORT), TEST_ROUTES: '1', AUTH_ENABLED: '0' } as any;
    const ps = spawn(process.execPath, ['dist/main.js'], { env, stdio: 'ignore' });
    try {
      const up = await waitHealth(BASE);
      expect(up).toBe(true);
      try { ps.kill('SIGHUP'); } catch {}
      await sleep(200);
      const ac1 = new AbortController();
      // Hold one SSE slot
      const p1 = fetch(`${BASE}/v1/stream?latency_ms=2000`, { signal: ac1.signal }).catch(() => null);
      await sleep(150);
      // Second should 429 with headers
      const r429 = await fetch(`${BASE}/v1/stream?latency_ms=10`);
      expect(r429.status).toBe(429);
      expect(r429.headers.get('Retry-After')).toBe('1');
      const reason = r429.headers.get('X-RateLimit-Reason');
      expect(reason === 'per_ip' || reason === 'global').toBe(true);
      try { ac1.abort(); } catch {}
      await p1; // settle
    } finally {
      try { ps.kill('SIGTERM'); } catch {}
    }
  }, 15000);
});
