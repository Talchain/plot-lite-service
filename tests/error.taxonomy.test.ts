import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { ERR_MSG } from '../src/lib/error-messages.js';

async function waitFor(url: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('timeout');
}

describe('Error taxonomy: stable types and catalogue phrases', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4342';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', RATE_LIMIT_ENABLED: '0' }, stdio: 'ignore' });
    await waitFor(`${BASE}/health`, 5000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('INVALID_TEMPLATE → 404 BAD_INPUT with catalogue phrase', async () => {
    const r = await fetch(`${BASE}/draft-flows?template=__nope__&seed=101`);
    expect(r.status).toBe(404);
    const j: any = await r.json();
    expect(j?.error?.type).toBe('BAD_INPUT');
    expect(j?.error?.message).toBe(ERR_MSG.INVALID_TEMPLATE);
  });

  it('INVALID_SEED → 404 BAD_INPUT with catalogue phrase', async () => {
    const r = await fetch(`${BASE}/draft-flows?template=pricing_change&seed=999999`);
    expect(r.status).toBe(404);
    const j: any = await r.json();
    expect(j?.error?.type).toBe('BAD_INPUT');
    expect(j?.error?.message).toBe(ERR_MSG.INVALID_SEED);
  });

  it('BAD_QUERY_PARAMS → 400 BAD_INPUT with catalogue phrase', async () => {
    const r = await fetch(`${BASE}/draft-flows?template=pricing_change&seed=nan`);
    expect(r.status).toBe(400);
    const j: any = await r.json();
    expect(j?.error?.type).toBe('BAD_INPUT');
    expect(j?.error?.message).toBe(ERR_MSG.BAD_QUERY_PARAMS);
  });

  it('TIMEOUT → 504 with catalogue phrase', async () => {
    const r = await fetch(`${BASE}/draft-flows?template=pricing_change&seed=101&force_error=TIMEOUT`);
    expect(r.status).toBe(504);
    const j: any = await r.json();
    expect(j?.error?.type).toBe('TIMEOUT');
    expect(j?.error?.message).toBe(ERR_MSG.TIMEOUT_UPSTREAM);
  });

  it('RETRYABLE → 503 with catalogue phrase and retryable=true', async () => {
    const r = await fetch(`${BASE}/draft-flows?template=pricing_change&seed=101&force_error=RETRYABLE`);
    expect(r.status).toBe(503);
    const j: any = await r.json();
    expect(j?.error?.type).toBe('RETRYABLE');
    expect(j?.error?.message).toBe(ERR_MSG.RETRYABLE_UPSTREAM);
  });

  it('INTERNAL → 500 with generic phrase (no stack)', async () => {
    const r = await fetch(`${BASE}/draft-flows?template=pricing_change&seed=101&force_error=INTERNAL`);
    expect(r.status).toBe(500);
    const j: any = await r.json();
    expect(j?.error?.type).toBe('INTERNAL');
    expect(j?.error?.message).toBe(ERR_MSG.INTERNAL_UNEXPECTED);
  });

  it('RATE_LIMIT → 429 with Retry-After and catalogue phrase', async () => {
    const PORT2 = '4343';
    const BASE2 = `http://127.0.0.1:${PORT2}`;
    const child2 = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT2, TEST_ROUTES: '1', RATE_LIMIT_ENABLED: '1', RATE_LIMIT_RPM: '1' }, stdio: 'ignore' });
    try {
      await waitFor(`${BASE2}/health`, 5000);
      await fetch(`${BASE2}/draft-flows?template=pricing_change&seed=101`);
      const r = await fetch(`${BASE2}/draft-flows?template=pricing_change&seed=101`);
      expect(r.status).toBe(429);
      const ra = r.headers.get('retry-after');
      expect(ra).toBeTruthy();
      const j: any = await r.json();
      expect(j?.error?.type).toBe('RATE_LIMIT');
      expect(j?.error?.message).toBe(ERR_MSG.RATE_LIMIT_RPM);
    } finally {
      try { process.kill(child2.pid!, 'SIGINT'); } catch {}
    }
  }, 10000);
});
