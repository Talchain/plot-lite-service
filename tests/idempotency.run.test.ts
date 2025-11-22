import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';

async function waitFor(url: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok || r.status === 404) return; } catch {}
    await new Promise(r => setTimeout(r, 60));
  }
  throw new Error('timeout');
}

function nextPort(): number { return 19000 + Math.floor(Math.random() * 1000); }
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
        setTimeout(() => { try { if (child?.pid) process.kill(child.pid, 'SIGKILL'); } catch {}; finish(); }, 1500);
      } else finish();
    } catch { finish(); }
  });
}

const body = {
  graph: { nodes: [{ id: 'a', label: 'A' }], edges: [] },
  seed: 42,
  k_samples: 1000
};

describe('Idempotency-Key for POST /v1/run', () => {
  it('replays identical response for same key within TTL', async () => {
    const { port, child } = await startServer({ AUTH_ENABLED: '0' });
    const BASE = `http://127.0.0.1:${port}`;
    const headers: any = { 'Content-Type': 'application/json', 'Idempotency-Key': 'k1' };

    const r1 = await fetch(`${BASE}/v1/run`, { method: 'POST', headers, body: JSON.stringify(body) });
    expect(r1.status).toBe(200);
    expect(r1.headers.get('idempotent-replayed')).toBe('0');
    const j1 = await r1.json();

    const r2 = await fetch(`${BASE}/v1/run`, { method: 'POST', headers, body: JSON.stringify(body) });
    expect(r2.status).toBe(200);
    expect(r2.headers.get('idempotent-replayed')).toBe('1');
    const j2 = await r2.json();
    expect(j2?.model_card?.response_hash).toBe(j1?.model_card?.response_hash);

    await stopServer(child);
  });

  it('does not reuse across principals (different Authorization)', async () => {
    const { port, child } = await startServer({ AUTH_ENABLED: '1', AUTH_TOKEN: 'tok' });
    const BASE = `http://127.0.0.1:${port}`;
    const headers1: any = { 'Content-Type': 'application/json', 'Idempotency-Key': 'kX', 'Authorization': 'Bearer tok' };
    const headers2: any = { 'Content-Type': 'application/json', 'Idempotency-Key': 'kX', 'Authorization': 'Bearer wrong' };

    const r1 = await fetch(`${BASE}/v1/run`, { method: 'POST', headers: headers1, body: JSON.stringify(body) });
    expect(r1.status).toBe(200);
    expect(r1.headers.get('idempotent-replayed')).toBe('0');

    const r2 = await fetch(`${BASE}/v1/run`, { method: 'POST', headers: headers2, body: JSON.stringify(body) });
    expect([401,403]).toContain(r2.status);
    // replay header should not indicate replay for wrong principal
    expect(r2.headers.get('idempotent-replayed')).not.toBe('1');

    await stopServer(child);
  });
});
