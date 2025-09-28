import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';

async function waitFor(url: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('timeout');
}

describe('Perf/limits: 429 with Retry-After', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4340';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', RATE_LIMIT_ENABLED: '1', RATE_LIMIT_RPM: '2' }, stdio: 'ignore' });
    await waitFor(`${BASE}/health`, 5000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('429 includes Retry-After within a sane bound', async () => {
    const url = `${BASE}/draft-flows?template=pricing_change&seed=101`;
    // three quick requests to hit the limit of 2
    await fetch(url);
    await fetch(url);
    const r = await fetch(url);
    expect(r.status).toBe(429);
    const ra = r.headers.get('retry-after');
    expect(ra).toBeTruthy();
    const n = Number(ra);
    expect(Number.isFinite(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(60);
  });
});
