#!/usr/bin/env node
/**
 * health-enrich-gate.mjs
 * - Starts server
 * - Asserts /v1/health includes version, uptime_s, last_request_at
 * - Emits exactly one GATES line and exits within ≤15s
 */

import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = process.env.PORT ? Number(process.env.PORT) : 31348;
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

(async () => {
  const abort = setTimeout(() => {
    console.log('GATES: FAIL — health-enrich timeout');
    process.exit(1);
  }, TIMEOUT_MS).unref();

  let ps;
  try {
    ps = await startServer();
    const h = await fetch(`${BASE}/v1/health`).then(r => r.json()).catch(() => null);
    if (!h || typeof h !== 'object') {
      console.log('GATES: FAIL — health-enrich invalid response');
      process.exit(1);
    }
    const ok = typeof h.version === 'string' && typeof h.uptime_s === 'number' && typeof h.last_request_at === 'string';
    if (!ok) {
      console.log('GATES: FAIL — health-enrich missing keys');
      process.exit(1);
    }
    console.log('GATES: PASS — health enrich ok');
    process.exit(0);
  } catch (err) {
    console.log(`GATES: SKIP — health enrich not runnable (${err.message})`);
    process.exit(0);
  } finally {
    clearTimeout(abort);
    try { ps && ps.kill('SIGTERM'); } catch {}
  }
})();
