import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function nextPort() { return 22700 + Math.floor(Math.random() * 500); }

async function waitHealth(base: string, to = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < to) {
    try { const r = await fetch(`${base}/v1/health`); if (r.ok) return true; } catch {}
    await sleep(80);
  }
  return false;
}

describe('health counters and last reload timestamp', () => {
  it('exposes json_429_count, sse_429_count and last_config_reload_iso', async () => {
    const PORT = nextPort();
    const BASE = `http://127.0.0.1:${PORT}`;
    try { mkdirSync('artifact', { recursive: true }); } catch {}
    // Prepare runtime-config.json for successful SIGHUP reload later
    writeFileSync('artifact/runtime-config.json', JSON.stringify({ sse_per_ip_max: 1, sse_global_max: 1, rate_limit_rpm: 1 }, null, 2));
    const env = { ...process.env, PORT: String(PORT), TEST_ROUTES: '1', AUTH_ENABLED: '0', SSE_PER_IP_MAX: '1', SSE_GLOBAL_MAX: '1', RATE_LIMIT_RPM: '1' } as any;
    const ps = spawn(process.execPath, ['dist/main.js'], { env, stdio: 'ignore' });
    try {
      const up = await waitHealth(BASE);
      expect(up).toBe(true);

      // Trigger JSON 429 quickly by two POSTs to /v1/draft (RPM=1)
      const h = { 'Content-Type': 'application/json' } as any;
      const r1 = await fetch(`${BASE}/v1/draft`, { method: 'POST', headers: h, body: JSON.stringify({ description: 'ok' }) });
      expect([200, 201].includes(r1.status)).toBe(true);
      const r2 = await fetch(`${BASE}/v1/draft`, { method: 'POST', headers: h, body: JSON.stringify({ description: 'ok' }) });
      expect(r2.status).toBe(429);

      // Trigger SSE 429 (per_ip/global caps = 1)
      // Start first stream with a long-running query
      const ac = new AbortController();
      const p1 = fetch(`${BASE}/v1/stream?latency_ms=5000`, { signal: ac.signal }).catch(() => null);
      
      // Wait longer to ensure first stream is fully established and holding a slot
      await sleep(500);
      
      // Second stream should hit 429 immediately (slot already taken)
      const r429sse = await fetch(`${BASE}/v1/stream?latency_ms=10`);
      expect(r429sse.status).toBe(429);
      
      // Abort first stream and wait for cleanup
      try { ac.abort(); } catch {}
      await p1;

      // Check health counters (both should be ≥1 after 429 responses)
      const health1 = await fetch(`${BASE}/v1/health`).then(r => r.json());
      expect(typeof health1).toBe('object');
      expect(typeof health1.json_429_count).toBe('number');
      expect(typeof health1.sse_429_count).toBe('number');
      expect(health1.json_429_count).toBeGreaterThanOrEqual(1);
      expect(health1.sse_429_count).toBeGreaterThanOrEqual(1);

      // SIGHUP to set last_config_reload_iso
      try { ps.kill('SIGHUP'); } catch {}
      await sleep(250);
      const health2 = await fetch(`${BASE}/v1/health`).then(r => r.json());
      expect(typeof health2.last_config_reload_iso === 'string' && health2.last_config_reload_iso.length > 0).toBe(true);
    } finally {
      try { ps.kill('SIGTERM'); } catch {}
    }
  }, 20000);
});
