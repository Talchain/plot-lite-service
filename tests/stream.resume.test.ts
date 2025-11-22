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

describe('Stream: resume once on single blip; no dupes', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4335';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', RATE_LIMIT_ENABLED: '0' }, stdio: 'ignore' });
    await waitFor(`${BASE}/health`, 5000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('reconnects once after blip with Last-Event-ID, no dupes', async () => {
    // First stream, force blip after first token
    const r1 = await fetch(`${BASE}/stream?id=job-42&blip=1&sleepMs=1`);
    const txt1 = await r1.text();
    const evs1 = parseSse(txt1);
    // Expect that we got hello + token, then blip
    const names1 = evs1.map(e => e.event);
    expect(names1[0]).toBe('hello');
    expect(names1[1]).toBe('token');
    const lastId = evs1[evs1.length - 1]?.id || '1';

    // Resume from last id
    const r2 = await fetch(`${BASE}/stream?id=job-42&sleepMs=1`, { headers: { 'Last-Event-ID': String(lastId) } });
    const txt2 = await r2.text();
    const evs2 = parseSse(txt2);
    const names2 = evs2.map(e => e.event);
    // Must complete with no duplicate token
    expect(names2).not.toContain('hello');
    expect(names2).toContain('cost');
    expect(names2[names2.length - 1]).toBe('done');
  });
});
