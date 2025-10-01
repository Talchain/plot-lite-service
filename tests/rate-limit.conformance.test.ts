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

function epochSec(): number { return Math.floor(Date.now() / 1000); }

describe('Rate-limit conformance', () => {
  let child: ReturnType<typeof spawn> | null = null;
  let logs = '';
  const PORT = '4366';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], {
      env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', RATE_LIMIT_ENABLED: '1', RATE_LIMIT_RPM: '3' },
      stdio: ['ignore','pipe','pipe']
    });
    child.stdout?.on('data', d => { logs += d.toString(); });
    child.stderr?.on('data', d => { logs += d.toString(); });
    await waitFor(`${BASE}/health`, 5000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('GET/HEAD persist headers; 429 has numeric Retry-After and sane X-RateLimit-Reset', async () => {
    // Allowed GET
    let r = await fetch(`${BASE}/draft-flows?template=pricing_change&seed=101`);
    expect(r.status).toBe(200);
    expect(r.headers.get('x-ratelimit-limit')).toBeTruthy();
    expect(r.headers.get('x-ratelimit-remaining')).toBeTruthy();

    // Allowed HEAD should also get headers
    r = await fetch(`${BASE}/draft-flows?template=pricing_change&seed=101`, { method: 'HEAD' });
    expect(r.status).toBe(200);
    expect(r.headers.get('x-ratelimit-limit')).toBeTruthy();
    expect(r.headers.get('x-ratelimit-remaining')).toBeTruthy();

    // Exhaust quickly to induce 429
    await fetch(`${BASE}/draft-flows?template=pricing_change&seed=101`);
    const limited = await fetch(`${BASE}/draft-flows?template=pricing_change&seed=101`);
    expect(limited.status).toBe(429);
    const ra = Number(limited.headers.get('retry-after') || '0');
    expect(Number.isFinite(ra) && ra > 0).toBe(true);
    const reset = Number(limited.headers.get('x-ratelimit-reset') || '0');
    const now = epochSec();
    expect(reset).toBeGreaterThan(now + 0); // in the future
    expect(reset).toBeLessThan(now + 3600); // within 1 hour
  });

  it('does not log payloads or query strings', async () => {
    logs = '';
    await fetch(`${BASE}/draft-flows?template=pricing_change&seed=101&Authorization=sekret`);
    await new Promise(r => setTimeout(r, 100));
    // No '?' should appear in structured access logs
    expect(logs.includes('?')).toBe(false);
  });
});
