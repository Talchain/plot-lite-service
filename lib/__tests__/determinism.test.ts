import { describe, it, expect } from 'vitest';
import { spawn } from 'child_process';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:4311';

async function waitFor(url: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('timeout waiting for ' + url);
}

describe('seed determinism', () => {
  it('returns identical bytes for 100 identical requests', async () => {
    const body = { fixture_case: 'price-rise-15pct-enGB', seed: 12345 };
    const texts: string[] = [];
    for (let i = 0; i < 100; i++) {
      const res = await fetch(`${BASE}/draft-flows`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const txt = await res.text();
      texts.push(txt);
    }
    const first = texts[0];
    for (const t of texts) expect(t).toBe(first);
    // Also ensure list order stable
    const json = JSON.parse(first);
    expect(Array.isArray(json.drafts)).toBe(true);
    // naive compare sorted ids order
    const ids = json.drafts.map((d: any) => d.id).join('|');
    for (const t of texts) {
      const j = JSON.parse(t);
      expect(j.drafts.map((d: any) => d.id).join('|')).toBe(ids);
    }
  });

  it('cross-process equality for the same input', async () => {
    const PORT2 = '4314';
    const BASE2 = `http://127.0.0.1:${PORT2}`;
    const child = spawn('node', ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT2, TEST_ROUTES: '1' }, stdio: 'ignore' });
    try {
      await waitFor(`${BASE2}/health`, 5000);
      const body = { fixture_case: 'price-rise-15pct-enGB', seed: 999 };
      const r1 = await fetch(`${BASE}/draft-flows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const r2 = await fetch(`${BASE2}/draft-flows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const t1 = await r1.text();
      const t2 = await r2.text();
      expect(t1).toBe(t2);
    } finally {
      try { process.kill(child.pid!, 'SIGINT'); } catch {}
    }
  });
});