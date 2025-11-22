import { describe, it, beforeAll, afterAll, expect } from 'vitest';
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

function epochSec(): number { return Math.floor(Date.now() / 1000); }

describe('Rate-limit boundary minute rollover', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4389';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], {
      env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', RATE_LIMIT_ENABLED: '1', RATE_LIMIT_RPM: '1' },
      stdio: 'ignore'
    });
    await waitFor(`${BASE}/health`, 5000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('second call in same minute 429s; headers are well-formed', async () => {
    // First allowed GET
    const r1 = await fetch(`${BASE}/draft-flows?template=pricing_change&seed=101`);
    expect(r1.status).toBe(200);
    expect(r1.headers.get('x-ratelimit-limit')).toBeTruthy();
    expect(r1.headers.get('x-ratelimit-remaining')).toBeTruthy();

    // Second call in same minute should 429 when rpm=1
    const r2 = await fetch(`${BASE}/draft-flows?template=pricing_change&seed=101`);
    expect(r2.status).toBe(429);
    const ra = Number(r2.headers.get('retry-after') || '0');
    expect(Number.isFinite(ra) && ra > 0).toBe(true);
    const reset = r2.headers.get('x-ratelimit-reset') || '';
    expect(String(reset)).not.toBe('');
    const resetNum = Number(reset);
    const now = epochSec();
    expect(resetNum).toBeGreaterThan(now);
    expect(resetNum).toBeLessThan(now + 3600);
    expect(String(r2.headers.get('x-ratelimit-reason') || '')).toMatch(/per_ip|global/);
  });
});
