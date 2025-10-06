#!/usr/bin/env node
/**
 * Phase 6: SLOs & performance
 * - Collect engine_get_p95_ms from /draft-flows (≥50 samples)
 * - ETag/304 discipline
 * - Compute K/sec on fixed fixture
 * - Assert p95 ≤ 600ms
 */

import { createServer } from '../../src/createServer.js';
import { writeFileSync } from 'node:fs';

const PORT = 14312;
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;

let app;

async function main() {
  console.log('GATES: Phase 6 — SLOs & performance');

  // Start server
  process.env.TEST_ROUTES = '1';
  process.env.RATE_LIMIT_ENABLED = '0'; // Disable for perf testing
  app = await createServer({ enableTestRoutes: true });
  await app.listen({ port: PORT, host: HOST });

  // Collect p95 over 50 samples
  const durations = [];
  const url = `${BASE}/draft-flows?template=pricing_change&seed=4242`;

  for (let i = 0; i < 50; i++) {
    const start = Date.now();
    const res = await fetch(url);
    const end = Date.now();

    if (!res.ok) throw new Error(`Request failed: ${res.status}`);

    durations.push(end - start);

    // Verify ETag discipline
    const etag = res.headers.get('etag');
    if (!etag) throw new Error('Missing ETag');

    // Test 304 on second request
    if (i === 0) {
      const res2 = await fetch(url, { headers: { 'If-None-Match': etag } });
      if (res2.status !== 304) throw new Error(`Expected 304, got ${res2.status}`);
    }
  }

  // Compute p95
  durations.sort((a, b) => a - b);
  const p95_index = Math.floor(durations.length * 0.95);
  const engine_get_p95_ms = durations[p95_index];

  if (engine_get_p95_ms > 600) {
    throw new Error(`p95 exceeds budget: ${engine_get_p95_ms}ms > 600ms`);
  }

  // Compute K/sec (models evaluated per second) - using BMA budget
  const budget_k = 1000;
  const avg_duration_ms = durations.reduce((a, b) => a + b, 0) / durations.length;
  const K_per_sec = Math.round((budget_k / avg_duration_ms) * 1000);

  // Write SLOs artifact
  const slos = {
    schema: 'slos.v1',
    engine_get_p95_ms: Math.round(engine_get_p95_ms),
    K_per_sec,
    samples: durations.length,
    timestamp: new Date().toISOString(),
  };

  writeFileSync('out/slos.json', JSON.stringify(slos, null, 2), 'utf8');

  await app.close();

  console.log(`GATES: PASS — slos OK (engine_get_p95_ms=${slos.engine_get_p95_ms}ms, K_per_sec=${K_per_sec})`);
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
