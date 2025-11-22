#!/usr/bin/env node
/**
 * idempotency-gate.mjs
 * Verifies Idempotency-Key behavior on POST /v1/run.
 * - Two identical posts with the same key → second is replayed (header Idempotent-Replayed=1)
 * - Body equality check via response_hash
 * Emits exactly one GATES line and exits ≤15s.
 */
import { spawn } from 'node:child_process';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function nextPort() { return 20000 + Math.floor(Math.random() * 2000); }

async function waitForHealth(base, timeoutMs = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await fetch(`${base}/v1/health`); if (r.ok) return true; } catch {}
    await sleep(80);
  }
  return false;
}

(async () => {
  const abort = setTimeout(() => { console.log('GATES: FAIL — idempotency gate timeout'); process.exit(1); }, 15000).unref();
  const PORT = nextPort();
  const BASE = `http://127.0.0.1:${PORT}`;
  const env = { ...process.env, AUTH_ENABLED: '0', TEST_ROUTES: '1', PORT: String(PORT) };
  let ps = null;
  try {
    ps = spawn('node', ['dist/main.js'], { env, stdio: 'ignore' });
    const up = await waitForHealth(BASE, 7000);
    if (!up) throw new Error('server not healthy');

    const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': 'k-gate-1' };
    const body = { graph: { nodes: [{ id: 'n1', label: 'N1' }], edges: [] }, seed: 42, k_samples: 1000 };

    const r1 = await fetch(`${BASE}/v1/run`, { method: 'POST', headers, body: JSON.stringify(body) });
    const h1 = r1.headers.get('idempotent-replayed');
    if (r1.status !== 200 || (h1 && h1 !== '0')) throw new Error('first not computed fresh');
    const j1 = await r1.json().catch(() => ({}));

    const r2 = await fetch(`${BASE}/v1/run`, { method: 'POST', headers, body: JSON.stringify(body) });
    const h2 = r2.headers.get('idempotent-replayed');
    if (r2.status !== 200 || h2 !== '1') throw new Error('second not replayed');
    const j2 = await r2.json().catch(() => ({}));
    if (!j1?.model_card?.response_hash || j1.model_card.response_hash !== j2?.model_card?.response_hash) throw new Error('hash mismatch');

    try { ps.kill('SIGTERM'); } catch {}
    console.log('GATES: PASS — idempotency ok');
    process.exit(0);
  } catch (e) {
    try { ps && ps.kill('SIGTERM'); } catch {}
    console.log(`GATES: FAIL — idempotency ${e?.message || 'unknown'}`);
    process.exit(1);
  } finally {
    clearTimeout(abort);
  }
})();
