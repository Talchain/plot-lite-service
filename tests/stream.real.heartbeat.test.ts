import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';

async function waitFor(url: string, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error('timeout');
}

describe('Real Stream: heartbeat comment when idle', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4352';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', FEATURE_STREAM: '1', STREAM_HEARTBEAT_SEC: '1', RATE_LIMIT_ENABLED: '0' }, stdio: 'ignore' });
    await waitFor(`${BASE}/health`, 5000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('emits : ping comment within ~1s when idle before tokens', async () => {
    // Introduce latency so token is delayed beyond 1s
    const r = await fetch(`${BASE}/stream?sleepMs=1200`);
    const txt = await r.text();
    expect(r.status).toBe(200);
    // Heartbeat comment lines start with ':' per SSE
    const hasPing = txt.split('\n').some(line => line.startsWith(': '));
    expect(hasPing).toBe(true);
    // Ensure normal events still complete
    expect(txt).toMatch(/event: hello/);
    expect(txt).toMatch(/event: done/);
  });
});
