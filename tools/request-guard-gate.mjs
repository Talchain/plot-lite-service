#!/usr/bin/env node
/**
 * tools/request-guard-gate.mjs
 * Quick gate:
 * - 413 on oversized /v1/run body
 * - 400 on out-of-range /v1/stream?latency_ms
 * Emits one line: GATES: PASS — request guards ok
 */
import { spawn } from 'node:child_process';

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function nextPort(){ return 23000 + Math.floor(Math.random()*500); }
async function waitHealth(base, to=6000){ const t0=Date.now(); while(Date.now()-t0<to){ try{ const r=await fetch(`${base}/v1/health`); if(r.ok) return true; }catch{} await sleep(80);} return false; }

(async () => {
  const abort = setTimeout(() => { console.log('GATES: FAIL — request guards timeout'); process.exit(1); }, 15000).unref();
  const PORT = nextPort();
  const BASE = `http://127.0.0.1:${PORT}`;
  const env = { ...process.env, PORT: String(PORT), TEST_ROUTES: '1', AUTH_ENABLED: '0' };
  const ps = spawn(process.execPath, ['dist/main.js'], { env, stdio: 'ignore' });
  try {
    const up = await waitHealth(BASE);
    if (!up) throw new Error('health timeout');
    // 413: body > 128KiB
    const big = 'x'.repeat(140 * 1024);
    const r413 = await fetch(`${BASE}/v1/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: `{"pad":"${big}"}` });
    if (r413.status !== 413) throw new Error(`expected 413, got ${r413.status}`);
    // 400: out-of-range stream param
    const r400 = await fetch(`${BASE}/v1/stream?latency_ms=20000`);
    if (r400.status !== 400) throw new Error(`expected 400, got ${r400.status}`);
    console.log('GATES: PASS — request guards ok');
    process.exit(0);
  } catch (e) {
    console.log(`GATES: FAIL — request guards ${e?.message || 'unknown'}`);
    process.exit(1);
  } finally {
    clearTimeout(abort);
    try { ps.kill('SIGTERM'); } catch {}
  }
})();
