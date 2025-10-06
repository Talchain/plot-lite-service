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

function pickHeaders(h: Headers, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = h.get(k) || h.get(k.toLowerCase()) || '';
    if (v) out[k.toLowerCase()] = v;
  }
  return out;
}

describe('Contracts: strict GET↔HEAD parity on /draft-flows', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4361';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], {
      env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '0', RATE_LIMIT_ENABLED: '1' }, stdio: 'ignore'
    });
    await waitFor(`${BASE}/health`, 6000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('mirrors headers, ETag and Content-Length; HEAD has no body', async () => {
    const url = `${BASE}/draft-flows?template=pricing_change&seed=101`;

    const getRes = await fetch(url);
    const getTxt = await getRes.text();
    expect(getRes.status).toBe(200);
    const getLen = Buffer.byteLength(getTxt, 'utf8');

    const headRes = await fetch(url, { method: 'HEAD' });
    expect(headRes.status).toBe(200);
    const headTxt = await headRes.text();
    expect(headTxt.length).toBe(0);

    const keys = ['content-type','cache-control','vary','etag','content-length'];
    const getPicked = pickHeaders(getRes.headers, keys);
    const headPicked = pickHeaders(headRes.headers, keys);

    // Header values match for selected keys
    expect(headPicked).toEqual(getPicked);

    // ETag equal
    expect(headPicked['etag']).toBeDefined();
    expect(headPicked['etag']).toBe(getPicked['etag']);

    // Content-Length equal to GET body bytes
    expect(Number(getPicked['content-length'] || '0')).toBe(getLen);
    expect(Number(headPicked['content-length'] || '0')).toBe(getLen);
  });
});
