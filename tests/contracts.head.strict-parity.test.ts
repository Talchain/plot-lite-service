import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';

async function waitFor(url: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error('timeout');
}

function headerMap(h: Headers) {
  const m = new Map<string, string>();
  h.forEach((v, k) => m.set(k.toLowerCase(), v));
  return m;
}

describe('Contracts: HEAD mirrors GET caching headers exactly', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4345';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT, RATE_LIMIT_ENABLED: '0' }, stdio: 'ignore' });
    await waitFor(`${BASE}/health`, 5000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('cache-control, etag, vary, content-type, content-length identical; HEAD has no body', async () => {
    const url = `${BASE}/draft-flows?template=pricing_change&seed=101`;
    const rGet = await fetch(url);
    expect(rGet.status).toBe(200);
    const getBody = await rGet.text();
    const getBytes = Buffer.byteLength(getBody, 'utf8');
    const rHead = await fetch(url, { method: 'HEAD' });
    expect(rHead.status).toBe(200);
    const headBody = await rHead.text();
    expect(headBody.length).toBe(0);

    const mGet = headerMap(rGet.headers);
    const mHead = headerMap(rHead.headers);
    const keys = ['cache-control','etag','vary','content-type','content-length'];

    for (const k of keys) {
      expect(mGet.has(k)).toBe(true);
      expect(mHead.has(k)).toBe(true);
      expect(mHead.get(k)).toBe(mGet.get(k));
    }

    // If server sets Content-Length, it must equal GET body length in bytes
    const cl = mHead.get('content-length');
    if (cl) {
      const n = Number(cl);
      expect(Number.isFinite(n)).toBe(true);
      expect(n).toBe(getBytes);
    }

    // Exact set equality for caching headers under test
    const presentGet = keys.filter(k => mGet.has(k)).sort().join(',');
    const presentHead = keys.filter(k => mHead.has(k)).sort().join(',');
    expect(presentHead).toBe(presentGet);
  });
});
