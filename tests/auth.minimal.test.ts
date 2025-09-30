import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';

async function waitFor(url: string, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error('timeout');
}

describe('Minimal auth gate (AUTH_ENABLED=1)', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4354';
  const BASE = `http://127.0.0.1:${PORT}`;
  const TOKEN = 'testtoken123';

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], {
      env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', FEATURE_STREAM: '1', AUTH_ENABLED: '1', AUTH_TOKEN: TOKEN, RATE_LIMIT_ENABLED: '0' }, stdio: 'ignore'
    });
    await waitFor(`${BASE}/health`, 5000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('GET /draft-flows requires token: 401 missing, 403 wrong, 200 correct', async () => {
    const url = `${BASE}/draft-flows?template=pricing_change&seed=101`;
    let r = await fetch(url);
    expect(r.status).toBe(401);
    r = await fetch(url, { headers: { Authorization: 'Bearer nope' } });
    expect(r.status).toBe(403);
    r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j?.schema).toBeDefined();
  });

  it('GET /stream (real) requires token: 401 missing, 403 wrong, 200 correct', async () => {
    let r = await fetch(`${BASE}/stream`);
    expect(r.status).toBe(401);
    r = await fetch(`${BASE}/stream`, { headers: { Authorization: 'Bearer nope' } });
    expect(r.status).toBe(403);
    r = await fetch(`${BASE}/stream`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(r.status).toBe(200);
    const txt = await r.text();
    expect(txt).toMatch(/event: hello/);
  });
});
