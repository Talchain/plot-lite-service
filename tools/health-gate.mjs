#!/usr/bin/env node
/**
 * health-gate.mjs
 * Start server, hit /v1/health 5×, assert schema and p95 < 100ms.
 * Emits exactly one GATES: line; non-zero exit on FAIL.
 */

import { spawn } from 'node:child_process';

const PORT = 4371;
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

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

(async () => {
  let child = null;
  try {
    child = spawn('node', ['dist/main.js'], {
      env: { ...process.env, AUTH_ENABLED: '0', TEST_ROUTES: '1', PORT: String(PORT) },
      stdio: 'ignore',
    });
    const up = await waitForHealth(8000);
    if (!up) { try { child.kill(); } catch {}; console.log('GATES: FAIL — health-gate server did not start'); process.exit(1); }

    const durations = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const res = await fetch(`${BASE}/v1/health`);
      const t1 = performance.now();
      if (res.status !== 200) throw new Error('health status not 200');
      const js = await res.json().catch(() => ({}));
      // Accept minimal health shape (status + p95_ms)
      if (!js || (typeof js.status !== 'string') || (typeof js.p95_ms !== 'number')) throw new Error('health shape mismatch');
      durations.push(Math.round(t1 - t0));
      await sleep(30);
    }

    const p95 = percentile(durations, 95);
    try { child.kill(); } catch {}
    if (p95 < 100) {
      console.log(`GATES: PASS — health OK (p95=${p95}ms)`);
      process.exit(0);
    } else {
      console.log(`GATES: FAIL — health p95 too high (p95=${p95}ms)`);
      process.exit(1);
    }
  } catch (e) {
    if (child) try { child.kill(); } catch {}
    console.log('GATES: FAIL — health gate failed');
    process.exit(1);
  }
})();
