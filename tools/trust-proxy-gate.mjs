#!/usr/bin/env node
/**
 * trust-proxy-gate.mjs
 * Verifies SSE per-IP limiter honours Fastify trustProxy when enabled.
 * Emits exactly one GATES line; exits non-zero on failure.
 */

import { spawn } from 'node:child_process';
import http from 'node:http';

const PORT = 4371;
const BASE = `http://127.0.0.1:${PORT}`;
const CAP = 1;
const TIMEOUT_MS = 15000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitForHealth(timeoutMs = 7000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await fetch(`${BASE}/v1/health`); if (r.ok) return true; } catch {}
    await sleep(100);
  }
  return false;
}

function startServer(envExtra = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: 'test',
      TEST_ROUTES: '1',
      AUTH_ENABLED: '0',
      SSE_PER_IP_MAX: String(CAP),
      SSE_GLOBAL_MAX: '100',
      ...envExtra,
    };
    const ps = spawn('node', ['dist/main.js'], { env, stdio: 'ignore', detached: false });
    (async () => {
      const up = await waitForHealth(8000);
      if (up) resolve(ps); else reject(new Error('health timeout'));
    })();
  });
}

const openSockets = new Set();
function openSSE(xff) {
  return new Promise(resolve => {
    const headers = xff ? { 'X-Forwarded-For': xff } : undefined;
    const req = http.get(`${BASE}/v1/stream?latency_ms=2500`, { headers }, res => resolve({ req, res }));
    openSockets.add(req);
    req.on('close', () => { openSockets.delete(req); });
    req.on('error', (err) => resolve({ error: err }));
  });
}

(async () => {
  const abort = setTimeout(() => {
    console.log('GATES: FAIL — trust-proxy gate timeout');
    process.exit(1);
  }, TIMEOUT_MS).unref();

  let ps = null;
  try {
    // Case A: TRUST_PROXY=1 (respect XFF)
    ps = await startServer({ TRUST_PROXY: '1' });

    const a1 = await openSSE('1.1.1.1');
    if (a1?.error || a1.res.statusCode !== 200) throw new Error('caseA first expected 200');
    const a2 = await openSSE('1.1.1.1');
    if (a2?.error || a2.res.statusCode !== 429) throw new Error('caseA second expected 429');
    try { a1.req.destroy(); } catch {}
    await sleep(100);
    const a3 = await openSSE('1.1.1.1');
    if (a3?.error || a3.res.statusCode !== 200) throw new Error('caseA reopen expected 200');
    const a4 = await openSSE('2.2.2.2');
    if (a4?.error || a4.res.statusCode !== 200) throw new Error('caseA different IP expected 200');
    try { a3.req.destroy(); } catch {}
    try { a4.req.destroy(); } catch {}
    try { ps && ps.kill('SIGTERM'); } catch {}

    // Case B: TRUST_PROXY=0 (ignore XFF)
    ps = await startServer({ TRUST_PROXY: '0' });
    const b1 = await openSSE('1.1.1.1');
    if (b1?.error || b1.res.statusCode !== 200) throw new Error('caseB first expected 200');
    const b2 = await openSSE('2.2.2.2');
    if (b2?.error || b2.res.statusCode !== 429) throw new Error('caseB second expected 429');
    try { b1.req.destroy(); } catch {}

    try { ps && ps.kill('SIGTERM'); } catch {}
    console.log(`GATES: PASS — trust-proxy gate OK trustProxy=1 cap=${CAP} port=${PORT}`);
    process.exit(0);
  } catch (err) {
    try { ps && ps.kill('SIGTERM'); } catch {}
    console.log(`GATES: FAIL — trust-proxy mismatch reason=${(err?.message || 'unknown')}`);
    process.exit(1);
  } finally {
    clearTimeout(abort);
    for (const s of openSockets) { try { s.destroy(); } catch {} }
  }
})();
