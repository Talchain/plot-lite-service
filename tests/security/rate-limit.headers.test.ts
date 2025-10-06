import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';

async function waitFor(url: string, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error('timeout');
}

describe('Security: rate-limit headers correctness', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4362';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], {
      env: { ...process.env, TEST_PORT: PORT, RATE_LIMIT_ENABLED: '1', RATE_LIMIT_RPM: '1', TEST_ROUTES: '0' }, stdio: 'ignore'
    });
    await waitFor(`${BASE}/health`, 6000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('429 has numeric Retry-After and future X-RateLimit-Reset', async () => {
    const url = `${BASE}/draft-flows?template=pricing_change&seed=101`;
    // First request should pass
    await fetch(url);
    // Second request in same minute should 429 with LIMIT=1
    const r2 = await fetch(url);
    const txt = await r2.text();
    expect(r2.status).toBe(429);
    const ra = r2.headers.get('Retry-After');
    const reset = r2.headers.get('X-RateLimit-Reset');
    expect(ra).toBeTruthy();
    expect(reset).toBeTruthy();
    const raNum = Number(ra);
    const resetNum = Number(reset);
    expect(Number.isFinite(raNum) && raNum >= 0).toBe(true);
    const nowSec = Math.floor(Date.now() / 1000);
    expect(Number.isFinite(resetNum) && resetNum >= nowSec).toBe(true);
    expect(txt).toMatch(/Please retry/);
  });
});
