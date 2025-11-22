#!/usr/bin/env node
/**
 * config-hotreload-gate.mjs
 * Scenario:
 * 1) Start server with SSE_PER_IP_MAX=1
 * 2) Open one /v1/stream (non-demo) to hold slot
 * 3) Write artifact/runtime-config.json with { sse_per_ip_max: 2, ... }
 * 4) Send SIGHUP to reload
 * 5) Second /v1/stream now succeeds (200)
 * Single line GATES and ≤15s runtime.
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function nextPort(){ return 22500 + Math.floor(Math.random()*500); }

async function waitHealth(base, to=6000){
  const t0 = Date.now();
  while (Date.now()-t0 < to){
    try { const r = await fetch(`${base}/v1/health`); if (r.ok) return true; } catch {}
    await sleep(80);
  }
  return false;
}

(async () => {
  const abort = setTimeout(() => { console.log('GATES: FAIL — hotreload timeout'); process.exit(1); }, 15000).unref();
  const PORT = nextPort();
  const BASE = `http://127.0.0.1:${PORT}`;
  const env = { ...process.env, PORT: String(PORT), TEST_ROUTES: '1', AUTH_ENABLED: '0', SSE_PER_IP_MAX: '1' };
  let ps;
  try {
    // Ensure artifact dir and initial config
    try { mkdirSync('artifact', { recursive: true }); } catch {}
    writeFileSync('artifact/runtime-config.json', JSON.stringify({ sse_per_ip_max: 1, sse_global_max: 100, rate_limit_rpm: 60 }, null, 2));

    ps = spawn('node', ['dist/main.js'], { env, stdio: 'ignore' });
    const up = await waitHealth(BASE);
    if (!up) throw new Error('health timeout');

    // 1) Open long-ish SSE without demo to hold slot
    const ac1 = new AbortController();
    const p1 = fetch(`${BASE}/v1/stream?latency_ms=2500`, { signal: ac1.signal }).then(r => r.status).catch(() => 0);
    await sleep(150); // give it time to acquire slot

    // 2) Second should be 429 initially
    const r429 = await fetch(`${BASE}/v1/stream?latency_ms=10`);
    if (r429.status !== 429) throw new Error('initial not 429');

    // 3) Write new config and SIGHUP
    writeFileSync('artifact/runtime-config.json', JSON.stringify({ sse_per_ip_max: 2, sse_global_max: 100, rate_limit_rpm: 60 }, null, 2));
    try { ps.kill('SIGHUP'); } catch {}
    await sleep(200);

    // 4) Now second should succeed (200)
    const r200 = await fetch(`${BASE}/v1/stream?latency_ms=10`);
    if (r200.status !== 200) throw new Error('post-reload not 200');

    // Cleanup first stream
    try { ac1.abort(); } catch {}

    console.log('GATES: PASS — hotreload caps ok');
    process.exit(0);
  } catch (e) {
    console.log(`GATES: FAIL — hotreload ${e?.message || 'unknown'}`);
    process.exit(1);
  } finally {
    clearTimeout(abort);
    try { ps && ps.kill('SIGTERM'); } catch {}
  }
})();
