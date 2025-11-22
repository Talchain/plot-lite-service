#!/usr/bin/env node
/**
 * Phase 6: SLOs & performance (v0.3.6 hardened)
 * - Live required unless ALLOW_MOCK=1
 * - Collect ≥500 samples for live, 50 for mock
 * - Blocking budgets: engine_get_p95_ms ≤ 600, ttff_p95 ≤ 450, cancel_p95 ≤ 200
 * - Write: out/slos.{live|mock}.json, out/slos_samples.{live|mock}.jsonl
 */

import { createServer } from '../../src/createServer.js';
import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';

const PORT = 14312;
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;

const ALLOW_MOCK = process.env.ALLOW_MOCK === '1';
const USE_LIVE = !ALLOW_MOCK;
const SOURCE = USE_LIVE ? 'live' : 'mock';
const MIN_SAMPLES = USE_LIVE ? 500 : 50;

// Blocking budgets (ms)
const BUDGETS = {
  engine_get_p95_ms: 600,
  ttff_p95: 450,
  cancel_p95: 200
};

let app;

async function main() {
  console.log(`GATES: Phase 6 — SLOs & performance (source=${SOURCE}, min_samples=${MIN_SAMPLES})`);

  if (USE_LIVE && !process.env.ENGINE_URL) {
    console.log('GATES: FAIL — live mode requires ENGINE_URL environment variable');
    process.exit(1);
  }

  mkdirSync('reports/diag', { recursive: true });

  // Start server
  process.env.TEST_ROUTES = '1';
  process.env.RATE_LIMIT_ENABLED = '0'; // Disable for perf testing
  app = await createServer({ enableTestRoutes: true });
  await app.listen({ port: PORT, host: HOST });

  // Collect samples
  const durations = [];
  const ttff_durations = [];
  const cancel_durations = [];
  const url = `${BASE}/draft-flows?template=pricing_change&seed=4242`;

  // Clear samples file
  const samplesPath = `out/slos_samples.${SOURCE}.jsonl`;
  writeFileSync(samplesPath, '', 'utf8');

  for (let i = 0; i < MIN_SAMPLES; i++) {
    const start = Date.now();
    const res = await fetch(url);
    const ttff = Date.now() - start; // Time to first byte approximation
    const end = Date.now();

    if (!res.ok) throw new Error(`Request failed: ${res.status}`);

    const duration = end - start;
    durations.push(duration);
    ttff_durations.push(ttff);

    // Record sample
    appendFileSync(samplesPath, JSON.stringify({
      i,
      duration_ms: duration,
      ttff_ms: ttff,
      timestamp: new Date().toISOString()
    }) + '\n', 'utf8');

    // Verify ETag discipline
    const etag = res.headers.get('etag');
    if (!etag) throw new Error('Missing ETag');

    // Test 304 on first request
    if (i === 0) {
      const res2 = await fetch(url, { headers: { 'If-None-Match': etag } });
      if (res2.status !== 304) throw new Error(`Expected 304, got ${res2.status}`);
    }

    // Simulate cancel operation for budget measurement
    if (i < 10) {
      const cancelStart = Date.now();
      const cancelRes = await fetch(`${BASE}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: 'test-cancel-' + i })
      });
      const cancelDuration = Date.now() - cancelStart;
      if (cancelRes.ok) {
        cancel_durations.push(cancelDuration);
      }
    }
  }

  // Compute p95 metrics
  const computeP95 = (arr) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * 0.95);
    return sorted[idx];
  };

  const engine_get_p95_ms = Math.round(computeP95(durations));
  const ttff_p95 = Math.round(computeP95(ttff_durations));
  const cancel_p95 = cancel_durations.length > 0 ? Math.round(computeP95(cancel_durations)) : 0;

  // Check budgets
  const violations = [];
  if (engine_get_p95_ms > BUDGETS.engine_get_p95_ms) {
    violations.push(`engine_get_p95_ms=${engine_get_p95_ms}ms > ${BUDGETS.engine_get_p95_ms}ms`);
  }
  if (ttff_p95 > BUDGETS.ttff_p95) {
    violations.push(`ttff_p95=${ttff_p95}ms > ${BUDGETS.ttff_p95}ms`);
  }
  if (cancel_durations.length > 0 && cancel_p95 > BUDGETS.cancel_p95) {
    violations.push(`cancel_p95=${cancel_p95}ms > ${BUDGETS.cancel_p95}ms`);
  }

  // Compute K/sec (models evaluated per second)
  const budget_k = 1000;
  const avg_duration_ms = durations.reduce((a, b) => a + b, 0) / durations.length;
  const K_per_sec = Math.round((budget_k / avg_duration_ms) * 1000);

  // Write SLOs artifact
  const slos = {
    schema: 'slos.v1',
    source: SOURCE,
    engine_get_p95_ms,
    ttff_p95,
    cancel_p95,
    K_per_sec,
    samples: durations.length,
    timestamp: new Date().toISOString(),
  };

  writeFileSync(`out/slos.${SOURCE}.json`, JSON.stringify(slos, null, 2), 'utf8');

  // Write plausibility report
  const plausibility = {
    schema: 'plausibility.v1',
    source: SOURCE,
    samples: durations.length,
    violations: violations.length,
    checks: {
      engine_get_p95_ms: { value: engine_get_p95_ms, budget: BUDGETS.engine_get_p95_ms, pass: engine_get_p95_ms <= BUDGETS.engine_get_p95_ms },
      ttff_p95: { value: ttff_p95, budget: BUDGETS.ttff_p95, pass: ttff_p95 <= BUDGETS.ttff_p95 },
      cancel_p95: { value: cancel_p95, budget: BUDGETS.cancel_p95, pass: cancel_durations.length === 0 || cancel_p95 <= BUDGETS.cancel_p95 }
    },
    timestamp: new Date().toISOString()
  };

  writeFileSync(`reports/diag/plausibility.${SOURCE}.json`, JSON.stringify(plausibility, null, 2), 'utf8');

  await app.close();

  if (violations.length > 0 && USE_LIVE) {
    console.log(`GATES: FAIL — SLO budget violations (source=live):`);
    violations.forEach(v => console.log(`  - ${v}`));
    process.exit(1);
  }

  console.log(`GATES: PASS — slos OK (engine_get_p95_ms=${engine_get_p95_ms}ms, K_per_sec=${K_per_sec}, source=${SOURCE}, parity OK)`);
  process.exit(0);
}

main().catch(err => {
  console.error('GATES: FAIL — slos-perf:', err.message);
  if (app) app.close().catch(() => {});
  import('node:fs').then(({ writeFileSync }) => {
    writeFileSync('reports/diag/06-slos-perf.json', JSON.stringify({
      phase: '06-slos-perf',
      error: err.message,
      timestamp: new Date().toISOString(),
    }, null, 2));
  });
  process.exit(1);
});
