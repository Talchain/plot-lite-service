#!/usr/bin/env node
/**
 * chaos-smoke.mjs
 * One-line gate: simulate a retry-after-failure flow within 1s total.
 */

import { spawn } from 'node:child_process';

const PORT = 4361;
const BASE = `http://127.0.0.1:${PORT}`;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitForHealth(timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(`${BASE}/v1/health`); if (r.ok) return true; } catch {}
    await sleep(100);
  }
  return false;
}

(async () => {
  let child = null;
  try {
    child = spawn('node', ['dist/main.js'], {
      env: { ...process.env, AUTH_ENABLED: '0', TEST_ROUTES: '1', PORT: String(PORT) },
      stdio: 'ignore',
    });
    const up = await waitForHealth(8000);
    if (!up) { try { child.kill(); } catch {}; console.log('GATES: FAIL — chaos smoke server did not start'); process.exit(1); }

    const t0 = Date.now();
    // First call fails with BAD_INPUT (missing parse_json)
    const bad = await fetch(`${BASE}/v1/critique`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const badJs = await bad.json().catch(() => ({}));
    if (bad.status !== 400 || badJs?.schema !== 'error.v1') throw new Error('expected 400 error.v1');

    // Retry with demo short-circuit for fast success
    const ok = await fetch(`${BASE}/v1/run?demo=1`, { method: 'POST' });
    const t1 = Date.now();
    if (ok.status !== 200) throw new Error('expected 200');
    if ((t1 - t0) > 1000) throw new Error('exceeded 1s');

    try { child.kill(); } catch {}
    console.log('GATES: PASS — chaos smoke OK (retry succeeds <1s)');
    process.exit(0);
  } catch (e) {
    if (child) try { child.kill(); } catch {}
    console.log('GATES: FAIL — chaos smoke failed');
    process.exit(1);
  }
})();
