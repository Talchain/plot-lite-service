import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function nextPort() { return 22600 + Math.floor(Math.random() * 500); }

async function waitHealth(base: string, to = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < to) {
    try { const r = await fetch(`${base}/v1/health`); if (r.ok) return true; } catch {}
    await sleep(80);
  }
  return false;
}

describe('runtime config hot-reload', () => {
  it('SIGHUP reload increases sse_per_ip_max from 1 to 2', async () => {
    const PORT = nextPort();
    const BASE = `http://127.0.0.1:${PORT}`;
    try { mkdirSync('artifact', { recursive: true }); } catch {}
    writeFileSync('artifact/runtime-config.json', JSON.stringify({ sse_per_ip_max: 1, sse_global_max: 100, rate_limit_rpm: 60 }, null, 2));
    const env = { ...process.env, PORT: String(PORT), TEST_ROUTES: '1', AUTH_ENABLED: '0', SSE_PER_IP_MAX: '1' } as any;
    const ps = spawn(process.execPath, ['dist/main.js'], { env, stdio: 'ignore' });
    try {
      const up = await waitHealth(BASE);
      expect(up).toBe(true);
      const ac1 = new AbortController();
      const p1 = fetch(`${BASE}/v1/stream?latency_ms=2500`, { signal: ac1.signal }).then(r => r.status).catch(() => 0);
      await sleep(150);
      const r429 = await fetch(`${BASE}/v1/stream?latency_ms=10`);
      expect(r429.status).toBe(429);
      writeFileSync('artifact/runtime-config.json', JSON.stringify({ sse_per_ip_max: 2, sse_global_max: 100, rate_limit_rpm: 60 }, null, 2));
      try { ps.kill('SIGHUP'); } catch {}
      await sleep(250);
      const r200 = await fetch(`${BASE}/v1/stream?latency_ms=10`);
      expect(r200.status).toBe(200);
      try { ac1.abort(); } catch {}
    } finally {
      try { ps.kill('SIGTERM'); } catch {}
    }
  }, 15000);
});
