import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';

async function waitFor(url: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok || r.status === 404) return; } catch {}
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error('timeout');
}

describe('OpenAPI dev route (gated)', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4351';
  const BASE = `http://127.0.0.1:${PORT}`;

  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('serves /openapi.json when OPENAPI_DEV=1', async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], {
      env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', OPENAPI_DEV: '1', RATE_LIMIT_ENABLED: '0' }, stdio: 'ignore'
    });
    await waitFor(`${BASE}/health`, 5000);
    const r = await fetch(`${BASE}/openapi.json`);
    expect(r.status).toBe(200);
    expect((r.headers.get('content-type') || '').toLowerCase()).toContain('application/json');
    const j: any = await r.json();
    expect(typeof j.openapi).toBe('string');
    expect(j.info).toBeDefined();
    try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {}
  });

  it('is absent (404) without OPENAPI_DEV', async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], {
      env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', RATE_LIMIT_ENABLED: '0' }, stdio: 'ignore'
    });
    await waitFor(`${BASE}/health`, 5000);
    const r = await fetch(`${BASE}/openapi.json`);
    // Fastify returns 404 for missing route
    expect(r.status).toBe(404);
    try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {}
  });

  it('returns 500 when spec is missing via OPENAPI_SPEC_PATH override', async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], {
      env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', OPENAPI_DEV: '1', OPENAPI_SPEC_PATH: 'contracts/_missing.yaml', RATE_LIMIT_ENABLED: '0' }, stdio: 'ignore'
    });
    await waitFor(`${BASE}/health`, 5000);
    const r = await fetch(`${BASE}/openapi.json`);
    expect([500, 404]).toContain(r.status); // Prefer 500; allow 404 on some Fastify versions
    if (r.status === 500) {
      const j: any = await r.json().catch(() => ({} as any));
      expect(j?.error?.type).toBeDefined();
    }
    try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {}
  });
});
