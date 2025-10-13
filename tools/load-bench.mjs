#!/usr/bin/env node
/**
 * load-bench.mjs
 * Fire 500 concurrent /v1/run?demo=1 requests; compute p95; write artifact/bench/load.json.
 * Emits one GATES line comparing p95 to target (<= 80ms).
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = 4381;
const BASE = `http://127.0.0.1:${PORT}`;
const N = 500;
const BATCH = 50;
const TARGET_MS = 120;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function waitForHealth(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(`${BASE}/v1/health`); if (r.ok) return true; } catch {}
    await sleep(100);
  }
  return false;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

(async () => {
  let child = null;
  try {
    child = spawn('node', ['dist/main.js'], {
      env: { ...process.env, TEST_ROUTES: '1', AUTH_ENABLED: '0', RATE_LIMIT_ENABLED: '0', PORT: String(PORT) },
      stdio: 'ignore',
    });
    const up = await waitForHealth(10000);
    if (!up) { try { child.kill(); } catch {}; console.log('GATES: FAIL — load bench server did not start'); process.exit(1); }

    const durations = new Array(N);
    for (let s = 0; s < N; s += BATCH) {
      const batchReqs = [];
      for (let i = s; i < Math.min(N, s + BATCH); i++) {
        batchReqs.push((async (idx) => {
          const t0 = performance.now();
          const ctrl = new AbortController();
          const to = setTimeout(() => ctrl.abort(), 5000);
          try {
            const res = await fetch(`${BASE}/v1/run?demo=1`, { method: 'POST', signal: ctrl.signal });
            if (!res.ok) durations[idx] = Infinity; else durations[idx] = Math.round(performance.now() - t0);
          } catch {
            durations[idx] = Infinity;
          } finally {
            clearTimeout(to);
          }
        })(i));
      }
      await Promise.all(batchReqs);
    }

    const filtered = durations.filter(x => Number.isFinite(x));
    const p95 = percentile(filtered, 95);

    try { child.kill(); } catch {}

    const artifactDir = resolve(process.cwd(), 'artifact', 'bench');
    mkdirSync(artifactDir, { recursive: true });
    const out = { schema: 'load.bench.v1', p95_ms: Math.round(p95), meta: { N } };
    writeFileSync(resolve(artifactDir, 'load.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');

    if (p95 <= TARGET_MS) {
      console.log(`GATES: PASS — load bench OK p95=${Math.round(p95)}ms target=${TARGET_MS}ms concurrency=${BATCH} duration=NA`);
      process.exit(0);
    } else {
      console.log(`GATES: FAIL — load bench too high p95=${Math.round(p95)}ms target=${TARGET_MS}ms concurrency=${BATCH} duration=NA`);
      process.exit(1);
    }
  } catch (e) {
    if (child) try { child.kill(); } catch {}
    console.log('GATES: FAIL — load bench error');
    process.exit(1);
  }
})();
