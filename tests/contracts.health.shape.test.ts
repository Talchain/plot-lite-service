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

describe('Contracts: health shape', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4334';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1' }, stdio: 'ignore' });
    await waitFor(`${BASE}/health`, 5000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('exposes minimal shape and required keys', async () => {
    const r = await fetch(`${BASE}/health`);
    expect(r.status).toBe(200);
    const j: any = await r.json();
    expect(typeof j.status).toBe('string');
    expect(['ok', 'degraded', 'down']).toContain(j.status);
    expect(typeof j.p95_ms).toBe('number');
    expect(typeof j.test_routes_enabled).toBe('boolean');
    expect(j.replay).toBeDefined();
    expect(typeof j.replay?.lastStatus).toBe('string');
  });
});
