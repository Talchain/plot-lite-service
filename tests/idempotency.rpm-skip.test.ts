import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
async function waitFor(url: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok || r.status === 404) return; } catch {}
    await sleep(60);
  }
  throw new Error('timeout');
}
function nextPort(): number { return 23700 + Math.floor(Math.random() * 300); }

async function startServer(env: Record<string, string>) {
  const port = String(nextPort());
  const child = spawn(process.execPath, ['tools/test-server.js'], {
    env: { ...process.env, TEST_ROUTES: '1', TEST_PORT: port, ...env }, stdio: 'ignore'
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
        process.kill(child.pid, 'SIGINT');
        setTimeout(() => { try { if (child?.pid) process.kill(child.pid, 'SIGKILL'); } catch {}; finish(); }, 1200);
      } else finish();
    } catch { finish(); }
  });
}

const baseBody = { graph: { nodes: [{ id: 'a', label: 'A' }], edges: [] } };

function parseIntSafe(v: string | null): number {
  if (!v) return NaN;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}

describe('Idempotent replays do not consume RPM for POST /v1/run', () => {
  it('same Idempotency-Key does not decrement remaining; new key 429s under tiny RPM', async () => {
    const { port, child } = await startServer({ AUTH_ENABLED: '0', RATE_LIMIT_ENABLED: '1', RATE_LIMIT_RPM: '1', IDEMPOTENCY_ENABLE: '1' });
    const BASE = `http://127.0.0.1:${port}`;
    try {
      const hdrs = { 'Content-Type': 'application/json', 'Idempotency-Key': 'K1' } as any;

      const r1 = await fetch(`${BASE}/v1/run`, { method: 'POST', headers: hdrs, body: JSON.stringify(baseBody) });
      expect(r1.status).toBe(200);
      expect(r1.headers.get('idempotent-replayed')).toBe('0');
      const rem1 = parseIntSafe(r1.headers.get('x-ratelimit-remaining'));
      // Under RPM=1, remaining should be 0 after first request
      expect(rem1).toBe(0);

      const r2 = await fetch(`${BASE}/v1/run`, { method: 'POST', headers: hdrs, body: JSON.stringify(baseBody) });
      expect(r2.status).toBe(200);
      expect(r2.headers.get('idempotent-replayed')).toBe('1');
      const rem2 = parseIntSafe(r2.headers.get('x-ratelimit-remaining'));
      expect(rem2).toBe(rem1); // unchanged on replay

      const r3 = await fetch(`${BASE}/v1/run`, { method: 'POST', headers: { ...hdrs, 'Idempotency-Key': 'K2' }, body: JSON.stringify(baseBody) });
      expect(r3.status).toBe(429);
      // 429 clarity headers
      expect(r3.headers.get('retry-after')).toBeTruthy();
      expect(r3.headers.get('x-ratelimit-reset')).toBeTruthy();
      expect(r3.headers.get('x-ratelimit-reason')).toBe('per_ip');
    } finally {
      await stopServer(child);
    }
  });
});
