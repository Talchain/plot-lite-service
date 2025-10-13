#!/usr/bin/env node
/**
 * sdk-smoke.mjs
 * Verifies error.v1 decoding for 401, 403, 400 using real server responses.
 * Emits exactly one GATES line.
 */

import { spawn } from 'node:child_process';

function nextPort() { return 18000 + Math.floor(Math.random() * 1000); }
const PORT = nextPort();
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'test-token-123';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitForHealth(timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/v1/health`, { headers: { Authorization: `Bearer ${TOKEN}` } });
      if (res.ok) return true;
    } catch {}
    await sleep(100);
  }
  return false;
}

(async () => {
  let child = null;
  try {
    child = spawn('node', ['dist/main.js'], {
      env: { ...process.env, AUTH_ENABLED: '1', AUTH_TOKEN: TOKEN, TEST_ROUTES: '1', PORT: String(PORT) },
      stdio: 'ignore',
    });
    const up = await waitForHealth(8000);
    if (!up) { try { child.kill(); } catch {}; console.log('GATES: FAIL — sdk smoke server did not start'); process.exit(1); }

    // 401: no Authorization header
    const r401 = await fetch(`${BASE}/v1/version`);
    const j401 = await r401.json().catch(() => ({}));
    if (r401.status !== 401 || j401?.schema !== 'error.v1') { throw new Error('401 mismatch'); }

    // 403: invalid token
    const r403 = await fetch(`${BASE}/v1/version`, { headers: { Authorization: 'Bearer wrong' } });
    const j403 = await r403.json().catch(() => ({}));
    if (r403.status !== 403 || j403?.schema !== 'error.v1') { throw new Error('403 mismatch'); }

    // 400: Ajv validation error on /v1/run with empty body
    const r400 = await fetch(`${BASE}/v1/run`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({}) });
    const j400 = await r400.json().catch(() => ({}));
    if (r400.status !== 400 || j400?.schema !== 'error.v1') { throw new Error('400 mismatch'); }

    // 200: success decode for /v1/run?demo=1
    const r200 = await fetch(`${BASE}/v1/run?demo=1`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } });
    const j200 = await r200.json().catch(() => ({}));
    if (r200.status !== 200 || j200?.schema !== 'run.v1' || typeof j200?.model_card?.response_hash !== 'string' || j200.model_card.response_hash.length !== 64) {
      throw new Error('200 decode mismatch');
    }

    await new Promise(resolve => {
      try {
        child.once('exit', resolve);
        try { child.kill('SIGTERM'); } catch {}
        setTimeout(() => { try { child.kill('SIGKILL'); } catch {}; resolve(); }, 1500);
      } catch { resolve(); }
    });
    console.log(`GATES: PASS — sdk smoke OK port=${PORT} token_len=${TOKEN.length}`);
    process.exit(0);
  } catch (e) {
    if (child) {
      try { child.kill('SIGTERM'); } catch {}
    }
    console.log(`GATES: FAIL — sdk smoke failed reason=${(e?.message || 'unknown')}`);
    process.exit(1);
  }
})();
