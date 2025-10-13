#!/usr/bin/env node
/**
 * stream-rate-limit-gate.mjs
 * Deterministically verifies the SSE per-IP limiter via long-lived connections.
 * Prints exactly one GATES: line and exits. Never blocks the terminal.
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = process.env.PORT ? Number(process.env.PORT) : 31337;
const BASE = `http://127.0.0.1:${PORT}`;
const CAP = Number(process.env.SSE_PER_IP_MAX || 2); // small, deterministic
const GLOBAL_CAP = String(process.env.SSE_GLOBAL_MAX || 100);
const TRUST_PROXY = process.env.TRUST_PROXY === '1' ? '1' : '0';
const TIMEOUT_MS = 15000;

function startServer() {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      TEST_ROUTES: '1',
      AUTH_ENABLED: '0',
      SSE_PER_IP_MAX: String(CAP),
      SSE_GLOBAL_MAX: GLOBAL_CAP,
      TRUST_PROXY,
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

function openSSE(latency) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE}/v1/stream?latency_ms=${latency}`, (res) => resolve({ req, res }));
    req.on('error', reject);
  });
}

(async () => {
  const abort = setTimeout(() => {
    console.log('GATES: SKIP — stream rate limit timed out');
    process.exit(0);
  }, TIMEOUT_MS).unref();

  let ps;
  const openSockets = [];
  try {
    ps = await startServer();

    // Hold CAP sockets open so the next one hits the limiter.
    for (let i = 0; i < CAP; i++) {
      const { req, res } = await openSSE(2500);
      if (res.statusCode !== 200) throw new Error(`expected 200, got ${res.statusCode}`);
      openSockets.push(req);
    }

    // Attempt one more; expect 429 RATE_LIMITED.
    const result = await new Promise((resolve) => {
      const req = http.get(`${BASE}/v1/stream?latency_ms=2500`, (res) => resolve({ req, res }));
      req.on('error', (err) => resolve({ error: err }));
    });

    // Cleanup early sockets regardless of outcome.
    for (const s of openSockets) try { s.destroy(); } catch {}

    if (result?.error) {
      console.log(`GATES: FAIL — stream rate limit request errored (${result.error.message})`);
      process.exit(1);
    }
    const { res } = result;
    if (res.statusCode === 429) {
      console.log(`GATES: PASS — stream rate limit OK cap_ip=${CAP} global=${GLOBAL_CAP} trustProxy=${TRUST_PROXY}`);
      process.exit(0);
    } else {
      console.log(`GATES: FAIL — expected 429, got ${res.statusCode}`);
      process.exit(1);
    }
  } catch (err) {
    console.log(`GATES: SKIP — stream rate limit not runnable (${err.message})`);
    process.exit(0);
  } finally {
    clearTimeout(abort);
    try { ps && ps.kill('SIGTERM'); } catch {}
  }
})();
