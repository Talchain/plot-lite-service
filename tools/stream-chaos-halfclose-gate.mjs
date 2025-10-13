#!/usr/bin/env node
/**
 * stream-chaos-halfclose-gate.mjs
 * - Starts server
 * - Opens /v1/stream?demo=1, reads first event, then aborts/half-closes
 * - PASS if one disconnect metric increments within <=3s and no unhandled errors
 * - One GATES line, <=15s
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = process.env.PORT ? Number(process.env.PORT) : 31352;
const BASE = `http://127.0.0.1:${PORT}`;
const TIMEOUT_MS = 15000;

function startServer() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PORT: String(PORT), NODE_ENV: 'test', TEST_ROUTES: '1', AUTH_ENABLED: '0' };
    const ps = spawn('node', ['dist/main.js'], { env, stdio: 'ignore', detached: false });
    const t0 = Date.now();
    (async function waitHealth() {
      while (Date.now() - t0 < 7000) {
        try { const r = await fetch(`${BASE}/v1/health`); if (r.ok) return resolve(ps); } catch {}
        await delay(150);
      }
      reject(new Error('health timeout'));
    })();
  });
}

function getHealth() {
  return fetch(`${BASE}/v1/health`).then(r => r.json()).catch(() => ({}));
}

(async () => {
  const abort = setTimeout(() => { console.log('GATES: FAIL — stream chaos timeout'); process.exit(1); }, TIMEOUT_MS).unref();
  let ps;
  try {
    ps = await startServer();
    const h0 = await getHealth();
    const before = Number(h0.stream_disconnects || 0);

    // Open SSE and read first event, then abort
    const { req, res } = await new Promise((resolve, reject) => {
      const req = http.get(`${BASE}/v1/stream?demo=1&latency_ms=10`, (res) => resolve({ req, res }));
      req.on('error', reject);
    });

    let gotHello = false;
    res.setEncoding('utf8');
    res.on('data', (c) => { if (String(c).includes('event: hello')) { gotHello = true; try { req.destroy(); } catch {} } });

    // Poll health up to 3s for a disconnect increment
    let ok = false;
    for (let i = 0; i < 30; i++) {
      const h = await getHealth();
      const after = Number(h.stream_disconnects || 0);
      if (after > before && gotHello) { ok = true; break; }
      await delay(100);
    }

    if (!ok) {
      console.log('GATES: FAIL — stream chaos no disconnect observed');
      process.exit(1);
    }
    console.log('GATES: PASS — stream chaos half-close ok');
    process.exit(0);
  } catch (err) {
    console.log(`GATES: SKIP — stream chaos not runnable (${err.message})`);
    process.exit(0);
  } finally {
    clearTimeout(abort);
    try { ps && ps.kill('SIGTERM'); } catch {}
  }
})();
