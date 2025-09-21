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

describe('rate limiting headers and health', () => {
  it('emits X-RateLimit headers on 2xx and Retry-After on 429; health shows metrics', async () => {
    const PORT = '4315';
    const BASE = `http://127.0.0.1:${PORT}`;
    const child = spawn('node', ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', RATE_LIMIT_ENABLED: '1', RATE_LIMIT_RPM: '3' }, stdio: 'ignore' });
    try {
      await waitFor(`${BASE}/health`, 5000);

      // First request should pass and include X-RateLimit-* headers
      const ok = await fetch(`${BASE}/draft-flows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seed: 1 }) });
      expect(ok.ok).toBe(true);
      const lim = ok.headers.get('X-RateLimit-Limit');
      const rem = ok.headers.get('X-RateLimit-Remaining');
      expect(lim).toBe('3');
      expect(rem).toBeDefined();

      // Make enough requests to trigger 429
      await fetch(`${BASE}/draft-flows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seed: 1 }) });
      await fetch(`${BASE}/draft-flows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seed: 1 }) });
      const tooMany = await fetch(`${BASE}/draft-flows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seed: 1 }) });
      expect(tooMany.status).toBe(429);
      const ra = tooMany.headers.get('Retry-After');
      expect(ra).toBeTruthy();

      // Health should show enabled=true, rpm=3 and last5m_429>=1
      const h = await fetch(`${BASE}/health`);
      const hj = await h.json();
      // debug output to help diagnose if structure changes
      // eslint-disable-next-line no-console
      console.log('health:', hj);
      expect(hj.rate_limit?.enabled).toBe(true);
      expect(hj.rate_limit?.rpm).toBe(3);
      expect((hj.rate_limit?.last5m_429 || 0) >= 1).toBe(true);
    } finally {
      try { process.kill(child.pid!, 'SIGINT'); } catch {}
    }
  });
});