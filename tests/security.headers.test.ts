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

describe('Security headers + prod test routes guard', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4336';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', RATE_LIMIT_ENABLED: '0' }, stdio: 'ignore' });
    await waitFor(`${BASE}/health`, 5000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('GET /draft-flows carries security headers', async () => {
    const r = await fetch(`${BASE}/draft-flows?template=pricing_change&seed=101`);
    expect(r.status).toBe(200);
    const must = [
      'content-security-policy',
      'referrer-policy',
      'x-content-type-options',
      'x-frame-options'
    ];
    const set = new Set<string>();
    r.headers.forEach((_v, k) => set.add(k.toLowerCase()));
    for (const h of must) expect(set.has(h)).toBe(true);
  });
});
