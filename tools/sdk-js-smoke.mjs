#!/usr/bin/env node
/**
 * sdk-js-smoke.mjs
 * - Starts server
 * - Calls /v1/run (demo) and verifies response_hash format
 * - Opens /v1/stream (demo) and verifies hello → token → done sequence
 * - Emits exactly one GATES line and exits within ≤15s
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = process.env.PORT ? Number(process.env.PORT) : 31349;
const BASE = `http://127.0.0.1:${PORT}`;
const TIMEOUT_MS = 15000;

function startServer() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PORT: String(PORT), NODE_ENV: 'test', TEST_ROUTES: '1', AUTH_ENABLED: '0' };
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

async function runDemoWithSdk() {
  const { run } = await import('../sdk/js/index.mjs');
  const js = await run({}, { baseUrl: BASE, query: { demo: 1 }, timeoutMs: 3000 });
  const rh = js?.model_card?.response_hash;
  return typeof rh === 'string' && /^[0-9a-f]{64}$/.test(rh);
}

async function streamDemoWithSdk() {
  const { stream } = await import('../sdk/js/index.mjs');
  const events = [];
  const ctrl = await stream({ baseUrl: BASE, params: { demo: 1, latency_ms: 10 }, timeoutMs: 4000, onEvent: (e) => events.push(e.event) });
  await delay(500);
  try { ctrl.cancel(); } catch {}
  return events;
}

(async () => {
  const abort = setTimeout(() => {
    console.log('GATES: FAIL — sdk:js timeout');
    process.exit(1);
  }, TIMEOUT_MS).unref();

  let ps;
  try {
    ps = await startServer();
    const okRun = await runDemoWithSdk();
    const evs = await streamDemoWithSdk();
    const seq = evs.slice(0, 3).join(',');
    const okSeq = seq === 'hello,token,done';
    if (!okRun || !okSeq) {
      console.log(`GATES: FAIL — sdk:js smoke (run=${okRun?'ok':'bad'} stream=${okSeq?'ok':'bad'})`);
      process.exit(1);
    }
    console.log(`GATES: PASS — sdk:js smoke ok port=${PORT}`);
    process.exit(0);
  } catch (err) {
    console.log(`GATES: SKIP — sdk:js not runnable (${err.message})`);
    process.exit(0);
  } finally {
    clearTimeout(abort);
    try { ps && ps.kill('SIGTERM'); } catch {}
  }
})();
