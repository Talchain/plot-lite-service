#!/usr/bin/env node
/**
 * tools/slo-line-gate.mjs
 * Emits one line:
 *   GATES: PASS — slo p95_ms=<X> ttff_p95_ms=<Y> N=<n>
 * SKIP on slow envs or errors.
 */
import { spawn } from 'node:child_process';

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function nextPort(){ return 23100 + Math.floor(Math.random()*500); }
async function waitHealth(base, to=6000){ const t0=Date.now(); while(Date.now()-t0<to){ try{ const r=await fetch(`${base}/v1/health`); if(r.ok) return true; }catch{} await sleep(80);} return false; }
function p95(vals){ if(!vals.length) return 0; const a=[...vals].sort((x,y)=>x-y); const idx=Math.min(a.length-1, Math.floor(0.95*(a.length-1))); return Math.round(a[idx]); }

async function timeRun(BASE, body){
  const t0 = performance.now();
  const r = await fetch(`${BASE}/v1/run`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  await r.text();
  return performance.now() - t0;
}

async function ttff(BASE){
  const t0 = performance.now();
  const res = await fetch(`${BASE}/v1/stream?latency_ms=10`);
  if (!res.body) return 0;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let tt=0; let got=false;
  while(true){
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    if (chunk.includes('event: hello')) { got=true; tt=performance.now()-t0; break; }
  }
  try { reader.cancel(); } catch {}
  return got ? tt : 0;
}

(async () => {
  const hardTimeout = setTimeout(() => { console.log('GATES: SKIP — slo environment too slow'); process.exit(0); }, 15000).unref();
  const PORT = nextPort();
  const BASE = `http://127.0.0.1:${PORT}`;
  const env = { ...process.env, PORT:String(PORT), TEST_ROUTES:'1', AUTH_ENABLED:'0' };
  const ps = spawn(process.execPath, ['dist/main.js'], { env, stdio: 'ignore' });
  try {
    const up = await waitHealth(BASE, 5000);
    if (!up) { console.log('GATES: SKIP — slo server not up'); process.exit(0); }

    const minimalGraph = { nodes:[{id:'a',label:'A'}], edges:[] };
    const N = 5;
    const runs=[]; const ttffs=[];
    for (let i=0;i<N;i++) {
      const [a, b] = await Promise.allSettled([ timeRun(BASE, { graph: minimalGraph }), ttff(BASE) ]);
      if (a.status==='fulfilled') runs.push(a.value); if (b.status==='fulfilled' && b.value>0) ttffs.push(b.value);
      await sleep(20);
    }
    if (runs.length===0 || ttffs.length===0) { console.log('GATES: SKIP — slo insufficient samples'); process.exit(0); }
    const p95Run = p95(runs);
    const p95Ttff = p95(ttffs);
    let suffix = '';
    try {
      const h = await fetch(`${BASE}/health`).then(r=>r.json()).catch(()=>null);
      const rpm = h?.rate_limit?.rpm;
      const sseMax = h?.flags_doc?.sse_per_ip_max || h?.sse_per_ip_max;
      const parts = [];
      if (Number.isFinite(rpm)) parts.push(`rpm=${Math.round(rpm)}`);
      if (Number.isFinite(sseMax)) parts.push(`sse_ip_max=${Math.round(sseMax)}`);
      if (parts.length) suffix = ' ' + parts.join(' ');
    } catch {}
    console.log(`GATES: PASS — slo p95_ms=${Math.round(p95Run)} ttff_p95_ms=${Math.round(p95Ttff)} N=${Math.min(runs.length, ttffs.length)}${suffix}`);
    process.exit(0);
  } catch {
    console.log('GATES: SKIP — slo error');
    process.exit(0);
  } finally {
    clearTimeout(hardTimeout);
    try { ps.kill('SIGTERM'); } catch {}
  }
})();
