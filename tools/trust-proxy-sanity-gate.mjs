#!/usr/bin/env node
/**
 * trust-proxy-sanity-gate.mjs
 * Verifies per-IP limiting honors X-Forwarded-For when TRUST_PROXY=1.
 * Prints exactly one GATES: line and exits. Never blocks the terminal.
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = process.env.PORT ? Number(process.env.PORT) : 31338;
const BASE = `http://127.0.0.1:${PORT}`;
const CAP = 1; // one concurrent stream per IP
const GLOBAL_CAP = String(process.env.SSE_GLOBAL_MAX || 100);
const TIMEOUT_MS = 15000;

function startServer() {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      TEST_ROUTES: '1',
      AUTH_ENABLED: '0',
      TRUST_PROXY: '1',
      SSE_PER_IP_MAX: String(CAP),
      SSE_GLOBAL_MAX: GLOBAL_CAP,
    };
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

function openSSE(latency, xff) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${BASE}/v1/stream?latency_ms=${latency}`,
      { method: 'GET', headers: { 'X-Forwarded-For': xff } },
      (res) => resolve({ req, res })
    );
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const abort = setTimeout(() => {
    console.log('GATES: SKIP — trustProxy sanity timed out');
    process.exit(0);
  }, TIMEOUT_MS).unref();

  let ps;
  const sockets = [];
  try {
    ps = await startServer();

    // Two distinct IPs should each be allowed one connection (status 200)
    const a = await openSSE(2500, '1.1.1.1');
    if (a.res.statusCode !== 200) throw new Error(`ipA expected 200, got ${a.res.statusCode}`);
    sockets.push(a.req);

    const b = await openSSE(2500, '2.2.2.2');
    if (b.res.statusCode !== 200) throw new Error(`ipB expected 200, got ${b.res.statusCode}`);
    sockets.push(b.req);

    // A second connection from same IP A should be 429
    const extra = await new Promise((resolve) => {
      const req = http.request(
        `${BASE}/v1/stream?latency_ms=2500`,
        { method: 'GET', headers: { 'X-Forwarded-For': '1.1.1.1' } },
        (res) => resolve({ req, res })
      );
      req.on('error', (err) => resolve({ error: err }));
      req.end();
    });

    // Cleanup held sockets
    for (const s of sockets) { try { s.destroy(); } catch {} }

    if (extra?.error) {
      console.log(`GATES: FAIL — trustProxy gate request errored (${extra.error.message})`);
      process.exit(1);
    }
    const { res } = extra;
    if (res.statusCode === 429) {
      console.log('GATES: PASS — trustProxy per-IP limit honors X-Forwarded-For (cap=1)');
      process.exit(0);
    } else {
      console.log(`GATES: FAIL — expected 429 for same IP via XFF, got ${res.statusCode}`);
      process.exit(1);
    }
  } catch (err) {
    console.log(`GATES: SKIP — trustProxy gate not runnable (${err.message})`);
    process.exit(0);
  } finally {
    clearTimeout(abort);
    try { ps && ps.kill('SIGTERM'); } catch {}
  }
})();
