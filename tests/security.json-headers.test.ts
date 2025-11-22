import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
async function waitFor(url: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await sleep(60);
  }
  throw new Error('timeout');
}
function nextPort(): number { return 23600 + Math.floor(Math.random() * 400); }

function hasHeaders(r: Response, keys: string[]): boolean {
  const set = new Set<string>();
  r.headers.forEach((_v, k) => set.add(k.toLowerCase()));
  return keys.every(k => set.has(k.toLowerCase()));
}

describe('JSON-only security headers', () => {
  let child: ReturnType<typeof spawn> | null = null;
  let BASE = '';

  beforeAll(async () => {
    const port = String(nextPort());
    BASE = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['tools/test-server.js'], {
      env: { 
        ...process.env, 
        TEST_PORT: port, 
        TEST_ROUTES: '1', 
        AUTH_ENABLED: '0', 
        RATE_LIMIT_ENABLED: '0',
        NODE_ENV: 'test'
      }, 
      stdio: 'ignore'
    });
    await waitFor(`${BASE}/health`, 5000);
  });
  afterAll(async () => { 
    try { 
      if (child?.pid) {
        process.kill(child.pid, 'SIGTERM');
        await sleep(100);
      }
    } catch {} 
  });

  it('GET /health has JSON security headers', async () => {
    const r = await fetch(`${BASE}/health`);
    expect(r.status).toBe(200);
    expect(hasHeaders(r, ['X-Content-Type-Options','Referrer-Policy','Cache-Control'])).toBe(true);
  });

  it('POST /v1/run has JSON security headers; SSE /v1/stream does not', async () => {
    const body = { graph: { nodes: [{ id: 'a', label: 'A' }], edges: [] } };
    const r1 = await fetch(`${BASE}/v1/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect(r1.status).toBe(200);
    expect(hasHeaders(r1, ['X-Content-Type-Options','Referrer-Policy','Cache-Control'])).toBe(true);

    const r2 = await fetch(`${BASE}/v1/stream?latency_ms=5`);
    // Ensure we're asserting on the 200 SSE path, not an error JSON
    expect(r2.status).toBe(200);
    // SSE response should not include JSON-only headers
    const set = new Set<string>();
    r2.headers.forEach((_v, k) => set.add(k.toLowerCase()));
    expect(set.has('x-content-type-options')).toBe(false);
    expect(set.has('referrer-policy')).toBe(false);
    // Cache-Control may differ for SSE; ensure not set to no-store by our middleware
    const cc = (r2.headers.get('cache-control') || '').toLowerCase();
    expect(cc).not.toContain('no-store');
  });
});
