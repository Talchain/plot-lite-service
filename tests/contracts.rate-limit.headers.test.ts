import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';

async function waitFor(url: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('timeout');
}

describe('Contracts: 429 headers (Retry-After, X-RateLimit-Reset)', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4347';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], {
      env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', RATE_LIMIT_ENABLED: '1', RATE_LIMIT_RPM: '2' },
      stdio: 'ignore',
    });
    await waitFor(`${BASE}/health`, 5000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('includes numeric Retry-After and sane X-RateLimit-Reset', async () => {
    const url = `${BASE}/draft-flows?template=pricing_change&seed=101`;
    await fetch(url);
    await fetch(url);
    const r = await fetch(url);
    expect(r.status).toBe(429);
    const ra = r.headers.get('retry-after');
    const reset = r.headers.get('x-ratelimit-reset');
    expect(ra).toBeTruthy();
    expect(reset).toBeTruthy();
    const raNum = Number(ra);
    expect(Number.isFinite(raNum)).toBe(true);
    expect(raNum).toBeGreaterThanOrEqual(1);
    expect(raNum).toBeLessThanOrEqual(120);
    const now = Math.ceil(Date.now() / 1000);
    const resetNum = Number(reset);
    expect(Number.isFinite(resetNum)).toBe(true);
    expect(resetNum).toBeGreaterThanOrEqual(now);
    expect(resetNum).toBeLessThanOrEqual(now + 120);
  });
});
