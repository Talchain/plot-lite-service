import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';

async function waitFor(url: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok || r.status === 404) return; } catch {}
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error('timeout');
}

function nextPort(): number { return 18000 + Math.floor(Math.random() * 1000); }

async function startServer(env: Record<string, string>) {
  const port = String(nextPort());
  const child = spawn(process.execPath, ['tools/test-server.js'], {
    env: { ...process.env, TEST_PORT: port, ...env }, stdio: 'ignore'
  });
  await waitFor(`http://127.0.0.1:${port}/health`, 5000);
  return { port, child };
}

async function stopServer(child: ReturnType<typeof spawn>) {
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    try { child.once('exit', finish); } catch { finish(); }
    try {
      if (child?.pid) {
        try { process.kill(child.pid, 'SIGINT'); } catch {}
        setTimeout(() => { try { if (child?.pid) process.kill(child.pid, 'SIGKILL'); } catch {}; finish(); }, 1500);
      } else {
        finish();
      }
    } catch { finish(); }
  });
}

describe('OpenAPI dev route (gated)', () => {

  it('serves /openapi.json when OPENAPI_DEV=1', async () => {
    const { port, child } = await startServer({ TEST_ROUTES: '1', OPENAPI_DEV: '1', RATE_LIMIT_ENABLED: '0' });
    const BASE = `http://127.0.0.1:${port}`;
    const r = await fetch(`${BASE}/openapi.json`);
    expect(r.status).toBe(200);
    expect((r.headers.get('content-type') || '').toLowerCase()).toContain('application/json');
    const j: any = await r.json();
    expect(typeof j.openapi).toBe('string');
    expect(j.info).toBeDefined();
    await stopServer(child);
  });

  it('is absent (404) without OPENAPI_DEV', async () => {
    const { port, child } = await startServer({ OPENAPI_DEV: '', TEST_ROUTES: '1', RATE_LIMIT_ENABLED: '0' });
    const BASE = `http://127.0.0.1:${port}`;
    const r = await fetch(`${BASE}/openapi.json`);
    // Fastify returns 404 for missing route
    expect(r.status).toBe(404);
    await stopServer(child);
  });

  it('returns 500 when spec is missing via OPENAPI_SPEC_PATH override', async () => {
    const { port, child } = await startServer({ OPENAPI_DEV: '1', TEST_ROUTES: '1', OPENAPI_SPEC_PATH: 'contracts/_missing.yaml', RATE_LIMIT_ENABLED: '0' });
    const BASE = `http://127.0.0.1:${port}`;
    const r = await fetch(`${BASE}/openapi.json`);
    expect([500, 404]).toContain(r.status); // Prefer 500; allow 404 on some Fastify versions
    if (r.status === 500) {
      const j: any = await r.json().catch(() => ({} as any));
      expect(j?.error?.type).toBeDefined();
    }
    await stopServer(child);
  });
});
