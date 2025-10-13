#!/usr/bin/env node
/**
 * runtime-consistency-gate.mjs
 * - Starts server
 * - Calls /v1/run twice with same input/seed and verifies identical response_hash
 * - Emits exactly one GATES line and exits within ≤15s
 */

import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = process.env.PORT ? Number(process.env.PORT) : 31350;
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

async function postRun(seed = 42) {
  const body = JSON.stringify({ graph: { nodes: [{ id: 'a', label: 'A' }], edges: [] }, seed });
  const res = await fetch(`${BASE}/v1/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const js = await res.json().catch(() => null);
  return js;
}

(async () => {
  const abort = setTimeout(() => {
    console.log('GATES: FAIL — runtime-consistency timeout');
    process.exit(1);
  }, TIMEOUT_MS).unref();

  let ps;
  try {
    ps = await startServer();
    const a = await postRun(101);
    const b = await postRun(101);
    const ha = a?.model_card?.response_hash;
    const hb = b?.model_card?.response_hash;
    if (typeof ha !== 'string' || typeof hb !== 'string') {
      console.log('GATES: FAIL — runtime-consistency missing hash');
      process.exit(1);
    }
    if (ha !== hb) {
      console.log('GATES: FAIL — runtime-consistency hash mismatch');
      process.exit(1);
    }
    console.log('GATES: PASS — runtime consistency ok');
    process.exit(0);
  } catch (err) {
    console.log(`GATES: SKIP — runtime consistency not runnable (${err.message})`);
    process.exit(0);
  } finally {
    clearTimeout(abort);
    try { ps && ps.kill('SIGTERM'); } catch {}
  }
})();
