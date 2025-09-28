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

describe('Caching: ETag/304 and HEAD parity', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4338';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT, RATE_LIMIT_ENABLED: '0' }, stdio: 'ignore' });
    await waitFor(`${BASE}/health`, 5000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('GET 200 -> GET 304 via If-None-Match; HEAD mirrors ETag/Vary', async () => {
    const url = `${BASE}/draft-flows?template=pricing_change&seed=101`;
    const r1 = await fetch(url);
    expect(r1.status).toBe(200);
    const et = r1.headers.get('etag');
    expect(et).toBeTruthy();

    const r2 = await fetch(url, { headers: { 'If-None-Match': String(et) } });
    expect(r2.status).toBe(304);

    const h1 = await fetch(url, { method: 'HEAD' });
    expect(h1.status).toBe(200);
    expect(h1.headers.get('etag')).toBe(et);
    expect(h1.headers.get('vary')).toBe('If-None-Match');

    const h2 = await fetch(url, { method: 'HEAD', headers: { 'If-None-Match': String(et) } });
    expect(h2.status).toBe(304);
  });
});
