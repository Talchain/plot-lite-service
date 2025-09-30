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

function parseSse(text: string): Array<{ event: string; id?: string; data?: any }> {
  const out: Array<{ event: string; id?: string; data?: any }> = [];
  for (const block of String(text).split('\n\n')) {
    if (!block.trim()) continue;
    let ev = '', id: string | undefined, dataRaw = '';
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) { continue; }
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

describe('Real Stream: backpressure maps to limited and closes', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4353';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', FEATURE_STREAM: '1', STREAM_FORCE_LIMIT: '1', RATE_LIMIT_ENABLED: '0' }, stdio: 'ignore' });
    await waitFor(`${BASE}/health`, 5000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('emits terminal limited event then closes', async () => {
    const r = await fetch(`${BASE}/stream`);
    const txt = await r.text();
    expect(r.status).toBe(200);
    const events = parseSse(txt).map(e => e.event);
    expect(events).toContain('limited');
    // Expect not to have any events after 'limited'
    const limitedIdx = events.indexOf('limited');
    expect(limitedIdx).toBeGreaterThanOrEqual(0);
    expect(limitedIdx).toBe(events.length - 1);
  });
});
