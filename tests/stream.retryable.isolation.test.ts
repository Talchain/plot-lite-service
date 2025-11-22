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

describe('Stream retryable error is test-routes only', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4348';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server-no-test-routes.js'], { env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '0', RATE_LIMIT_ENABLED: '0' }, stdio: 'ignore' });
    await waitFor(`${BASE}/ready`, 5000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('ignores ?fail=RETRYABLE when TEST_ROUTES=0', async () => {
    const r = await fetch(`${BASE}/stream?fail=RETRYABLE`);
    const txt = await r.text();
    // Should NOT include an error event in normal runtime
    expect(/\nevent:\s*error\n/i.test(txt)).toBe(false);
  });
});
