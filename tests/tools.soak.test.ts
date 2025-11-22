import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';

async function waitFor(url: string, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error('timeout');
}

describe('tools/soak.mjs', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4356';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', FEATURE_STREAM: '1', STREAM_HEARTBEAT_SEC: '1', RATE_LIMIT_ENABLED: '0' }, stdio: 'ignore' });
    await waitFor(`${BASE}/health`, 5000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('runs soak and prints JSON summary with counters and p95', async () => {
    const p = spawn(process.execPath, ['tools/soak.mjs', '--base', BASE, '--n', '2', '--duration', '3'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d.toString(); });
    const code: number = await new Promise(res => p.on('close', c => res(c ?? 1)));
    expect(code).toBe(0);
    const txt = out.trim().split('\n').pop() || '{}';
    const j: any = JSON.parse(txt);
    expect(typeof j.started).toBe('number');
    expect(typeof j.finished).toBe('number');
    expect(typeof j.limited).toBe('number');
    expect(typeof j.p95_ms).toBe('number');
  });
});
