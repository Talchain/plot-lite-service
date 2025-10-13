#!/usr/bin/env node
/**
 * Self-Check Hash Stability Gate
 * - Starts server (unless TEST_BASE_URL provided), waits for /v1/health
 * - Calls /v1/self-check 10x and verifies identical hash and bytes
 * - Verifies parity against /v1/run?demo=1 model_card.response_hash
 * - Emits exactly one GATES: line and exits non-zero on failure
 */

import { spawn } from 'node:child_process';

const PORT = Number(process.env.SELFCHECK_PORT || 4311);
const BASE = process.env.TEST_BASE_URL || `http://127.0.0.1:${PORT}`;
const CYCLES = 10;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitForHealth(base, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const res = await fetch(`${base}/v1/health`); if (res.ok) return true; } catch {}
    await sleep(200);
  }
  return false;
}

async function main() {
  let child = null;
  try {
    if (!process.env.TEST_BASE_URL) {
      child = spawn('node', ['dist/main.js'], {
        env: { ...process.env, TEST_ROUTES: '1', AUTH_ENABLED: '0', RATE_LIMIT_ENABLED: '0', PORT: String(PORT) },
        stdio: 'ignore',
      });
      const up = await waitForHealth(BASE, 6000);
      if (!up) {
        try { child.kill(); } catch {}
        console.log('GATES: FAIL — self-check server did not start');
        process.exit(1);
      }
    }

    const hashes = [];
    const bytes = [];

    for (let i = 0; i < CYCLES; i++) {
      try {
        const res = await fetch(`${BASE}/v1/self-check`);
        if (!res.ok) { throw new Error(`status ${res.status}`); }
        const data = await res.json();
        if (!data.hash || typeof data.hash !== 'string') {
          console.log('GATES: FAIL — self-check response malformed');
          process.exit(1);
        }
        hashes.push(data.hash);
        bytes.push(data.bytes);
      } catch {
        if (child) try { child.kill(); } catch {}
        console.log('GATES: FAIL — self-check endpoint unreachable');
        process.exit(1);
      }
    }

    const uniqueHashes = new Set(hashes);
    if (uniqueHashes.size !== 1) {
      if (child) try { child.kill(); } catch {}
      console.log(`GATES: FAIL — self-check unstable (distinct_hashes=${uniqueHashes.size})`);
      process.exit(1);
    }
    const uniqueBytes = new Set(bytes);
    if (uniqueBytes.size !== 1) {
      if (child) try { child.kill(); } catch {}
      console.log('GATES: FAIL — self-check byte count drift detected');
      process.exit(1);
    }

    // Parity: POST /v1/run with the golden scenario graph; sha256Stable(full response) should equal self-check hash
    try {
      // dynamic import of dist fixture
      const mod = await import(new URL('../dist/fixtures/self-check.js', import.meta.url));
      const canon = await import(new URL('../dist/util/canonical-json.js', import.meta.url));
      const scenario = mod.GOLDEN_SCENARIO || {};
      const body = { graph: scenario.graph };
      const res = await fetch(`${BASE}/v1/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const obj = await res.json();
      const selfHash = hashes[0];
      const fullHash = canon.sha256Stable(obj);
      if (typeof fullHash !== 'string' || fullHash !== selfHash) {
        if (child) try { child.kill(); } catch {}
        console.log('GATES: FAIL — self-check parity mismatch');
        process.exit(1);
      }
    } catch {
      if (child) try { child.kill(); } catch {}
      console.log('GATES: FAIL — self-check parity check failed');
      process.exit(1);
    }

    if (child) try { child.kill(); } catch {}
    console.log(`GATES: PASS — self-check hash stable across ${CYCLES} runs`);
    process.exit(0);
  } catch {
    if (child) try { child.kill(); } catch {}
    console.log('GATES: FAIL — self-check gate crashed');
    process.exit(1);
  }
}

main();
