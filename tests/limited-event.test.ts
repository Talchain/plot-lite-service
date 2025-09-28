import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';

function parseSse(text: string): string[] {
  const names: string[] = [];
  for (const block of String(text).split('\n\n')) {
    if (!block.trim()) continue;
    for (const line of block.split('\n')) {
      const [k, v] = line.split(':', 2).map(s => s?.trim() ?? '');
      if (k === 'event') names.push(v);
    }
  }
  return names;
}

async function waitFor(url: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('timeout');
}

describe('Streaming: limited event under pressure', () => {
  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4341';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', RATE_LIMIT_ENABLED: '0' }, stdio: 'ignore' });
    await waitFor(`${BASE}/health`, 5000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('emits limited event and closes', async () => {
    const res = await fetch(`${BASE}/stream?limited=1`);
    const txt = await res.text();
    const names = parseSse(txt);
    expect(names[0]).toBe('limited');
    expect(names.length).toBe(1);
  });
});
