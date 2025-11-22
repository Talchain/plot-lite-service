#!/usr/bin/env node
/**
 * health-env-gate.mjs
 * Verifies /v1/health includes optional environment and build when env vars set.
 * Emits one GATES line and exits ≤15s.
 */
import { spawn } from 'node:child_process';

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function nextPort(){ return 22100 + Math.floor(Math.random()*500); }

(async () => {
  const timeout = setTimeout(() => { console.log('GATES: FAIL — health env timeout'); process.exit(1); }, 15000).unref();
  const PORT = nextPort();
  const BASE = `http://127.0.0.1:${PORT}`;
  const env = { ...process.env, PORT: String(PORT), TEST_ROUTES: '1', AUTH_ENABLED: '0', ENVIRONMENT: 'staging', BUILD_ID_SHORT: 'abc1234' };
  let ps;
  try {
    ps = spawn('node', ['dist/main.js'], { env, stdio: 'ignore' });
    const t0 = Date.now();
    while (Date.now() - t0 < 7000) {
      try { const r = await fetch(`${BASE}/v1/health`); if (r.ok) break; } catch {}
      await sleep(80);
    }
    const res = await fetch(`${BASE}/v1/health`);
    const js = await res.json();
    if (js?.environment !== 'staging' || js?.build !== 'abc1234') throw new Error('fields missing');
    console.log('GATES: PASS — health env ok');
    process.exit(0);
  } catch (e) {
    console.log(`GATES: FAIL — health env ${e?.message || 'unknown'}`);
    process.exit(1);
  } finally {
    clearTimeout(timeout);
    try { ps && ps.kill('SIGTERM'); } catch {}
  }
})();
