#!/usr/bin/env node
// tools/smoke.mjs — Staging smoke test (health + determinism)
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';

const host = process.env.PLOT_STAGING_URL || 'https://plot-lite-service-staging.onrender.com';
const healthUrl = `${host}/v1/health`;
const versionUrl = `${host}/version`;
const runUrl = `${host}/v1/run`;
const fixture = path.join(process.cwd(), 'fixtures', 'golden_seed42_chain3.json');

async function main() {
  console.log(`🔍 Smoke test against: ${host}`);
  console.log('');

  // 1) Version check
  console.log('1️⃣  Version check...');
  const v = await fetch(versionUrl);
  if (!v.ok) {
    throw new Error(`Version check failed: ${v.status} ${v.statusText}`);
  }
  const vj = await v.json();
  console.log('   ✅ Version:', {
    version: vj.version,
    commit: vj.commit?.substring(0, 8) || 'dev',
    scm_lite: vj.flags?.scm_lite_enable ? 'ON' : 'OFF',
    auth: vj.flags?.auth_enabled ? 'ON' : 'OFF',
  });
  console.log('');

  // 2) Health check
  console.log('2️⃣  Health check...');
  const h = await fetch(healthUrl);
  if (!h.ok) {
    throw new Error(`Health check failed: ${h.status} ${h.statusText}`);
  }
  const hj = await h.json();
  console.log('   ✅ Health OK:', {
    engine_p95_ms: hj.engine_p95_ms,
    engine_p95_ms_rolling: hj.engine_p95_ms_rolling,
    idem_cache_size: hj.idem_cache_size,
    json_429_count: hj.json_429_count,
    sse_429_count: hj.sse_429_count,
  });
  console.log('');

  // 3) Determinism check (2 quick runs with same seed)
  console.log('3️⃣  Determinism check (2 runs with same seed)...');
  
  if (!fs.existsSync(fixture)) {
    throw new Error(`Fixture not found: ${fixture}`);
  }
  
  const body = fs.readFileSync(fixture, 'utf8');
  const headers = { 'Content-Type': 'application/json' };
  
  // Add auth token if available
  const token = process.env.AUTH_TOKEN || process.env.PLOT_AUTH_TOKEN;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const r1 = await fetch(runUrl, { method: 'POST', headers, body });
  if (!r1.ok) {
    const text = await r1.text();
    throw new Error(`Run request 1 failed: ${r1.status} ${r1.statusText}\n${text}`);
  }
  const j1 = await r1.json();
  
  const r2 = await fetch(runUrl, { method: 'POST', headers, body });
  if (!r2.ok) {
    const text = await r2.text();
    throw new Error(`Run request 2 failed: ${r2.status} ${r2.statusText}\n${text}`);
  }
  const j2 = await r2.json();
  
  const h1 = j1?.model_card?.response_hash;
  const h2 = j2?.model_card?.response_hash;
  
  if (!h1 || !h2) {
    throw new Error(`Missing response_hash in response (h1: ${h1}, h2: ${h2})`);
  }
  
  if (h1 !== h2) {
    throw new Error(`Determinism check failed: hash mismatch\n  Run 1: ${h1}\n  Run 2: ${h2}`);
  }
  
  console.log(`   ✅ Determinism OK: ${h1}`);
  console.log('');

  console.log('✅ Smoke test PASS');
  process.exit(0);
}

main().catch((e) => {
  console.error('');
  console.error('❌ Smoke test FAIL:', e.message);
  console.error('');
  process.exit(1);
});
