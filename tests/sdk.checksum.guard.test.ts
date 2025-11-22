import { describe, it, beforeAll, afterAll, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

async function waitFor(url: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error('timeout');
}

function sha256Hex(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

describe('SDK checksum guard (seed 4242)', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4339';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', RATE_LIMIT_ENABLED: '0' }, stdio: 'ignore' });
    await waitFor(`${BASE}/health`, 5000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('GET /draft-flows (pricing_change, seed 4242) matches fixture bytes', async () => {
    const res = await fetch(`${BASE}/draft-flows?template=pricing_change&seed=4242`);
    expect(res.ok).toBe(true);
    const body = new Uint8Array(await res.arrayBuffer());
    const got = sha256Hex(Buffer.from(body));
    const expected = sha256Hex(readFileSync('fixtures/pricing_change/4242.json'));
    expect(got).toBe(expected);
  });
});
