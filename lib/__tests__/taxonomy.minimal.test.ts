import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';

function waitFor(url: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  return new Promise(async (resolve, reject) => {
    while (Date.now() - start < timeoutMs) {
      try { const r = await fetch(url); if (r.ok) return resolve(); } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    reject(new Error('timeout'));
  });
}

describe('Rate limit and timeout taxonomy shapes', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4321';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', RATE_LIMIT_ENABLED: '1', RATE_LIMIT_RPM: '1' }, stdio: 'ignore' });
    await waitFor(`${BASE}/health`, 5000);
  });

  afterAll(async () => {
    try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {}
  });

  it('returns 429 with RATE_LIMIT type and X-RateLimit-Reset header', async () => {
    // Warm one request
    await fetch(`${BASE}/draft-flows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seed: 1 }) });
    // Second request should trip the limit
    const r = await fetch(`${BASE}/draft-flows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seed: 1 }) });
    expect(r.status).toBe(429);
    const j = await r.json();
    expect(j?.error?.type).toBe('RATE_LIMIT');
    expect(r.headers.get('Retry-After')).toBeTruthy();
    expect(r.headers.get('X-RateLimit-Reset')).toBeTruthy();
  });

  it('maps TIMEOUT to 504 via forced header on GET /draft-flows', async () => {
    // Use a fresh server without rate limiting to avoid 429 masking
    const PORT2 = '4322';
    const BASE2 = `http://127.0.0.1:${PORT2}`;
    const child2 = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT2, TEST_ROUTES: '1', RATE_LIMIT_ENABLED: '0' }, stdio: 'ignore' });
    try {
      await waitFor(`${BASE2}/health`, 5000);
      const res = await fetch(`${BASE2}/draft-flows?template=pricing_change&seed=101`, { method: 'GET', headers: { 'x-debug-force-error': 'TIMEOUT' } });
      expect(res.status).toBe(504);
      const j = await res.json();
      expect(j?.error?.type).toBe('TIMEOUT');
    } finally {
      try { process.kill(child2.pid!, 'SIGINT'); } catch {}
    }
  });
});
