import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';

async function waitFor(url: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error('timeout');
}

describe('Metrics: enriched fields behind METRICS=1', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4359';
  const BASE = `http://127.0.0.1:${PORT}`;
  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', RATE_LIMIT_ENABLED: '0', METRICS: '1' }, stdio: 'ignore' });
    await waitFor(`${BASE}/health`, 5000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('exposes current_streams and last_heartbeat_ms keys', async () => {
    const r = await fetch(`${BASE}/metrics`);
    expect(r.ok).toBe(true);
    const j: any = await r.json();
    expect(typeof j.current_streams).toBe('number');
    expect(typeof j.last_heartbeat_ms).toBe('number');
  });
});
