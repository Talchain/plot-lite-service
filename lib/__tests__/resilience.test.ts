import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';

async function waitFor(url: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('timeout waiting for ' + url);
}

describe('resilience niceties', () => {
  it('health has runtime/caches; X-Request-ID echoed; live and ops snapshot work; TIMEOUT path mapped', async () => {
    const PORT = '4317';
    const BASE = `http://127.0.0.1:${PORT}`;
    const child = spawn('node', ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', OPS_SNAPSHOT: '1' }, stdio: 'ignore' });
    try {
      await waitFor(`${BASE}/health`, 5000);
      await waitFor(`${BASE}/live`, 5000);

      // X-Request-ID echoed
      const ok = await fetch(`${BASE}/draft-flows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seed: 1 }) });
      expect(ok.ok).toBe(true);
      const reqId = ok.headers.get('X-Request-ID');
      expect(reqId).toBeTruthy();

      // Health runtime/caches sanity
      const h = await (await fetch(`${BASE}/health`)).json();
      expect(h.runtime?.node).toBeTruthy();
      expect(typeof h.runtime?.uptime_s).toBe('number');
      expect(typeof h.runtime?.rss_mb).toBe('number');
      expect(typeof h.runtime?.heap_used_mb).toBe('number');
      expect(typeof h.runtime?.eventloop_delay_ms).toBe('number');
      expect(typeof h.runtime?.p95_ms).toBe('number');
      expect(typeof h.runtime?.p99_ms).toBe('number');
      expect(typeof h.caches?.idempotency_current).toBe('number');

      // /ops/snapshot guarded route
      const snap = await fetch(`${BASE}/ops/snapshot`);
      expect(snap.ok).toBe(true);

      // TIMEOUT typed error path
      const t = await fetch(`${BASE}/__test/force-error?type=TIMEOUT`, { method: 'POST' });
      expect(t.status).toBe(504);
      const tj = await t.json();
      expect(tj.error?.type).toBe('TIMEOUT');
    } finally {
      try { process.kill(child.pid!, 'SIGINT'); } catch {}
    }
  });
});