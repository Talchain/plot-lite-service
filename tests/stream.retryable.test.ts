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

describe('Stream: retryable error smoke', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4346';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    // Ensure we use the test-only /stream route (not the real one)
    child = spawn(process.execPath, ['tools/test-server.js'], {
      env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', FEATURE_STREAM: '0', RATE_LIMIT_ENABLED: '0' },
      stdio: 'ignore'
    });
    await waitFor(`${BASE}/health`, 5000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('emits error event with type=RETRYABLE and closes', async () => {
    const r = await fetch(`${BASE}/stream?fail=RETRYABLE`);
    const txt = await r.text();
    // Primary check: raw SSE contains an error event
    expect(/\nevent:\s*error\s*\n/i.test(txt)).toBe(true);
    // Extract the JSON payload next to the error event (single-line data)
    const m = txt.match(/\nevent:\s*error[\s\S]*?\ndata:\s*(\{.*\})/i);
    expect(m).toBeTruthy();
    const data = JSON.parse(m![1]);
    expect(data?.type).toBe('RETRYABLE');
  });
});
