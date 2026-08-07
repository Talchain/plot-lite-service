import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { waitFor } from './utils.js';

// ROADMAP 2.879 — this file used to carry a private `waitFor` built on
// `new Promise(async (resolve, reject) => …)`, the repo's only async promise
// executor and the `no-async-promise-executor` finding that spreading
// `@eslint/js`'s recommended set surfaced. It is deleted rather than reshaped:
// `tests/utils.ts` already exports a shared `waitFor` that ~20 specs use, and
// this file's ~45 sibling copies are already plain `async function`s.
//
// The rejection semantics that changed, stated rather than left silent: the
// `Promise` constructor DISCARDS an async executor's rejection, so any throw
// escaping the executor's inner `try` left the promise permanently unsettled —
// a silent hang, with the real error lost. Here the only rejecting `await`
// (`fetch`) sat inside the `try/catch`, so nothing was being swallowed on a
// reachable path; the hazard was latent. Resolve/poll/deadline behaviour is
// unchanged; only the timeout message is now labelled instead of bare
// 'timeout', and nothing asserts it.
//
// The shared helper's semantics are pinned by tests/gates/wait-for-semantics.test.ts.
const waitForOk = (url: string, timeoutMs = 5000): Promise<boolean> =>
  waitFor(
    async () => {
      const r = await fetch(url);
      return r.ok;
    },
    { timeout: timeoutMs, interval: 100, label: url },
  );

describe('Contracts: Report v1 schema', () => {
  const schema = JSON.parse(readFileSync('contracts/report.v1.schema.json', 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);

  let child: ReturnType<typeof spawn> | null = null;
  const PORT = '4333';
  const BASE = `http://127.0.0.1:${PORT}`;

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], { env: { ...process.env, TEST_PORT: PORT }, stdio: 'ignore' });
    await waitForOk(`${BASE}/health`, 5000);
  });
  afterAll(async () => { try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch {} });

  it('GET /draft-flows returns schema:"report.v1" and meta.seed', async () => {
    const res = await fetch(`${BASE}/draft-flows?template=pricing_change&seed=101`);
    expect(res.status).toBe(200);
    const json: unknown = await res.json();
    const ok = validate(json);
    if (!ok) throw new Error('schema violation: ' + JSON.stringify(validate.errors));
    const obj = json as any;
    expect(obj.schema).toBe('report.v1');
    expect(typeof obj.meta?.seed).toBe('number');
  });
});
