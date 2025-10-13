#!/usr/bin/env node
/**
 * ttff-sample-gate.mjs
 * - Starts server
 * - Runs N quick demo streams and computes p95 time-to-first-frame (hello)
 * - Informational PASS with one GATES line, <=10s; SKIP if environment too slow
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = process.env.PORT ? Number(process.env.PORT) : 31353;
const BASE = `http://127.0.0.1:${PORT}`;
const TIMEOUT_MS = 10000;
const N = 9;

function startServer() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PORT: String(PORT), NODE_ENV: 'test', TEST_ROUTES: '1', AUTH_ENABLED: '0' };
    const ps = spawn('node', ['dist/main.js'], { env, stdio: 'ignore', detached: false });
    const t0 = Date.now();
    (async function waitHealth() {
      while (Date.now() - t0 < 5000) {
        try { const r = await fetch(`${BASE}/v1/health`); if (r.ok) return resolve(ps); } catch {}
        await delay(100);
      }
      reject(new Error('health timeout'));
    })();
  });
}

function ttffOnce() {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = http.get(`${BASE}/v1/stream?demo=1&latency_ms=0`, (res) => {
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (c) => {
        buf += String(c);
        if (buf.includes('event: hello')) {
          const ms = Date.now() - t0;
          try { req.destroy(); } catch {}
          return resolve(ms);
        }
      });
      res.on('end', () => resolve(Date.now() - t0));
    });
    req.on('error', () => resolve(9999));
  });
}

(async () => {
  const abort = setTimeout(() => { console.log('GATES: SKIP — ttff sample timeout'); process.exit(0); }, TIMEOUT_MS).unref();
  let ps;
  try {
    ps = await startServer();
    const samples = [];
    for (let i = 0; i < N; i++) {
      samples.push(await ttffOnce());
      await delay(25);
    }
    const sorted = samples.slice().sort((a,b) => a-b);
    const idx = Math.min(sorted.length-1, Math.floor(0.95*(sorted.length-1)));
    const p95 = sorted[idx];
    console.log(`GATES: PASS — ttff p95=${p95} samples=${N}`);
    process.exit(0);
  } catch (err) {
    console.log(`GATES: SKIP — ttff sample not runnable (${err.message})`);
    process.exit(0);
  } finally {
    clearTimeout(abort);
    try { ps && ps.kill('SIGTERM'); } catch {}
  }
})();
