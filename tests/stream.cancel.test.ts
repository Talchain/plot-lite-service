import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';

function parseSse(text: string): Array<{ event: string; id?: string; data?: any }> {
  const out: Array<{ event: string; id?: string; data?: any }> = [];
  for (const block of String(text).split('\n\n')) {
    if (!block.trim()) continue;
    let ev = '', id: string | undefined, dataRaw = '';
    for (const line of block.split('\n')) {
      const [k, v] = line.split(':', 2).map(s => s?.trim() ?? '');
      if (k === 'event') ev = v;
      else if (k === 'id') id = v;
      else if (k === 'data') dataRaw += (dataRaw ? '\n' : '') + v;
    }
    let data: any = dataRaw;
    try { data = JSON.parse(dataRaw); } catch {}
    out.push({ event: ev, id, data });
  }
  return out;
}

async function waitFor(url: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error('timeout');
}

describe('Stream: cancel idempotency', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4337';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', RATE_LIMIT_ENABLED: '0' }, stdio: 'ignore' });
    await waitFor(`${BASE}/health`, 5000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('pre-token cancel emits cancelled and closes; second cancel is no-op', async () => {
    const id = 'job-c1';
    const p = fetch(`${BASE}/stream?id=${id}&sleepMs=5`);
    // Cancel quickly (likely before token)
    await new Promise(r => setTimeout(r, 2));
    const c1 = await fetch(`${BASE}/stream/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    expect(c1.ok).toBe(true);

    const res = await p;
    const txt = await res.text();
    const evs = parseSse(txt);
    const names = evs.map(e => e.event);
    expect(names).toContain('cancelled');

    // Second cancel is a no-op (still 200)
    const c2 = await fetch(`${BASE}/stream/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    expect(c2.ok).toBe(true);
  });

  it('mid-stream cancel emits cancelled once', async () => {
    const id = 'job-c2';
    const p = fetch(`${BASE}/stream?id=${id}&sleepMs=1`);
    // Wait a moment to allow hello/token emission
    await new Promise(r => setTimeout(r, 5));
    await fetch(`${BASE}/stream/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    const res = await p;
    const txt = await res.text();
    const evs = parseSse(txt);
    const names = evs.map(e => e.event);
    const cancelledCount = names.filter(n => n === 'cancelled').length;
    expect(cancelledCount).toBe(1);
  });
});
