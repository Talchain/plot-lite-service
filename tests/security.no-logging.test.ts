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

describe('Security: no payload or query-string logging', () => {
  let child: ReturnType<typeof spawn> | null = null;
  let stdout = '';
  const PORT = '4339';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', RATE_LIMIT_ENABLED: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stdout += d.toString(); });
    await waitFor(`${BASE}/health`, 5000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('does not log query strings or obvious payload tokens', async () => {
    // Make a few requests including a query string that must not appear in logs
    await fetch(`${BASE}/draft-flows?template=pricing_change&seed=101&Authorization=sekret`);
    await fetch(`${BASE}/draft-flows?template=__nope__&secret=foo`);
    await fetch(`${BASE}/critique`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parse_json: { nodes: [], password: 'nope' } }) });
    // allow log flush
    await new Promise(r => setTimeout(r, 200));

    // Logs must not contain raw query string or sensitive tokens
    expect(stdout).not.toMatch(/\?template=/i);
    expect(stdout).not.toMatch(/Authorization=se?kr?et/i);
    expect(stdout).not.toMatch(/password/i);
    expect(stdout).not.toMatch(/apikey/i);
    expect(stdout).not.toMatch(/bearer /i);
    expect(stdout).not.toMatch(/parse_json/i);
  });
});
