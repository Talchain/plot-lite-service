import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';

function parseSse(text: string): Array<{ event: string; data: any; id?: string }> {
  const out: Array<{ event: string; data: any; id?: string }> = [];
  const blocks = String(text).split('\n\n');
  for (const b of blocks) {
    if (!b.trim()) continue;
    let ev = '';
    let id: string | undefined;
    let dataRaw = '';
    for (const line of b.split('\n')) {
      const [k, v] = line.split(':', 2).map(s => s?.trim() ?? '');
      if (k === 'event') ev = v;
      else if (k === 'id') id = v;
      else if (k === 'data') dataRaw += (dataRaw ? '\n' : '') + v;
    }
    let data: any = dataRaw;
    try { data = JSON.parse(dataRaw); } catch {}
    out.push({ event: ev, data, id });
  }
  return out;
}

describe('Contracts: SSE event schema', () => {
  const schema = JSON.parse(readFileSync('contracts/sse-event.schema.json', 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);

  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4331';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', RATE_LIMIT_ENABLED: '0' }, stdio: 'ignore' });
    const start = Date.now();
    while (Date.now() - start < 5000) {
      try { const r = await fetch(`${BASE}/health`); if (r.ok) break; } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
  });

  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('emits events from the final set', async () => {
    const res = await fetch(`${BASE}/stream?id=sch1`);
    const txt = await res.text();
    const evs = parseSse(txt);
    expect(evs.length).toBeGreaterThan(0);
    for (const e of evs) {
      const ok = validate({ event: e.event, data: e.data });
      if (!ok) throw new Error('schema violation: ' + JSON.stringify(validate.errors));
    }
    const names = evs.map(e => e.event);
    expect(names).toContain('hello');
    expect(names).toContain('token');
    expect(names).toContain('cost');
    expect(names).toContain('done');
  });
});
