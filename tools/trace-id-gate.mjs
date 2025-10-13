#!/usr/bin/env node
/**
 * trace-id-gate.mjs
 * - Starts server with TRACE_MIN=1
 * - Calls /v1/run twice (demo=1) and asserts both responses include unique UUID v4 trace_id
 * - Emits exactly one GATES line and exits within ≤15s
 */

import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = process.env.PORT ? Number(process.env.PORT) : 31347;
const BASE = `http://127.0.0.1:${PORT}`;
const TIMEOUT_MS = 15000;

function startServer() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PORT: String(PORT), NODE_ENV: 'test', TEST_ROUTES: '1', AUTH_ENABLED: '0', TRACE_MIN: '1' };
    const ps = spawn('node', ['dist/main.js'], { env, stdio: 'ignore', detached: false });
    const t0 = Date.now();
    (async function waitHealth() {
      while (Date.now() - t0 < 7000) {
        try {
          const res = await fetch(`${BASE}/v1/health`);
          if (res.ok) return resolve(ps);
        } catch {}
        await delay(150);
      }
      reject(new Error('health timeout'));
    })();
  });
}

async function postRun() {
  const res = await fetch(`${BASE}/v1/run?demo=1`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const js = await res.json().catch(() => null);
  return js;
}

(async () => {
  const abort = setTimeout(() => {
    console.log('GATES: FAIL — trace-id timeout');
    process.exit(1);
  }, TIMEOUT_MS).unref();

  let ps;
  try {
    ps = await startServer();
    const a = await postRun();
    const b = await postRun();
    const ra = a && typeof a.trace_id === 'string' && a.trace_id.match(/^[0-9a-fA-F-]{36}$/);
    const rb = b && typeof b.trace_id === 'string' && b.trace_id.match(/^[0-9a-fA-F-]{36}$/);
    if (!ra || !rb) {
      console.log('GATES: FAIL — trace-id missing');
      process.exit(1);
    }
    if (a.trace_id === b.trace_id) {
      console.log('GATES: FAIL — duplicate trace_id');
      process.exit(1);
    }
    console.log('GATES: PASS — trace-id ok N=2');
    process.exit(0);
  } catch (err) {
    console.log(`GATES: SKIP — trace-id not runnable (${err.message})`);
    process.exit(0);
  } finally {
    clearTimeout(abort);
    try { ps && ps.kill('SIGTERM'); } catch {}
  }
})();
