import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

function waitFor(url: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  return new Promise(async (resolve, reject) => {
    while (Date.now() - start < timeoutMs) {
      try { const r = await fetch(url); if (r.ok) return resolve(); } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    reject(new Error('timeout'));
  });
}

describe('Contracts: Report v1 schema', () => {
  const schema = JSON.parse(readFileSync('contracts/report.v1.schema.json', 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);

  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4333';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT }, stdio: 'ignore' });
    await waitFor(`${BASE}/health`, 5000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('GET /draft-flows returns schema:"report.v1" and meta.seed', async () => {
    const res = await fetch(`${BASE}/draft-flows?template=pricing_change&seed=101`);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    const ok = validate(json);
    if (!ok) throw new Error('schema violation: ' + JSON.stringify(validate.errors));
    expect(json.schema).toBe('report.v1');
    expect(typeof json.meta?.seed).toBe('number');
  });
});
