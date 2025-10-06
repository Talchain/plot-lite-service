import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';

async function waitFor(url: string, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('timeout');
}

describe('Privacy: access logs scrub queries and tokens', () => {
  let child: ReturnType<typeof spawn> | null = null;
  let logs = '';
  const PORT = '4377';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], {
      env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', RATE_LIMIT_ENABLED: '0' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout?.on('data', d => { logs += d.toString(); });
    child.stderr?.on('data', d => { logs += d.toString(); });
    await waitFor(`${BASE}/health`, 5000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('does not log query strings or Authorization tokens', async () => {
    const r = await fetch(`${BASE}/draft-flows?template=pricing_change&seed=101&debug=on`, {
      headers: { 'Authorization': 'Bearer test' }
    });
    expect(r.status).toBe(200);
    await new Promise(r => setTimeout(r, 200));
    expect(logs).not.toMatch(/\?template=/i);
    expect(logs).not.toMatch(/Authorization/i);
    expect(logs).not.toMatch(/Bearer\s+test/i);
  });
});
