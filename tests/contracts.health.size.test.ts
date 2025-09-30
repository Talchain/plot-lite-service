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

describe('Contracts: /health payload size < 4 KiB', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4344';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT, RATE_LIMIT_ENABLED: '0' }, stdio: 'ignore' });
    await waitFor(`${BASE}/health`, 5000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('stays small to avoid drift', async () => {
    const r = await fetch(`${BASE}/health`);
    expect(r.ok).toBe(true);
    const txt = await r.text();
    const bytes = Buffer.byteLength(txt, 'utf8');
    expect(bytes).toBeLessThan(4096);
  });
});
