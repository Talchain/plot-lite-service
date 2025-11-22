#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

(async function main(){
  const budget = Number(process.env.P95_BUDGET_MS || '600');
  const baseUrl = process.env.TEST_BASE_URL || process.env.BASE_URL || 'http://127.0.0.1:4311';
  const outDir = path.resolve(process.cwd(), 'reports', 'warp');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'loadcheck.json');
  const ndjsonFile = path.join(outDir, 'loadcheck.ndjson');

  let record = {
    timestamp: new Date().toISOString(),
    budget_ms: budget,
    p50_ms: null,
    p95_ms: null,
    p99_ms: null,
    over_budget: null,
    probe_exit_code: 0,
    error_name: null,
    error_message: null,
  };

  try {
    const { runProbe } = require('./loadcheck-probe.cjs');
    const res = await runProbe({ baseUrl, path: '/draft-flows?template=pricing_change&seed=101', connections: 10, durationSeconds: Number(process.env.LOADCHECK_DURATION_S || '10') });
    record.p50_ms = (typeof res?.p50_ms === 'number') ? res.p50_ms : null;
    record.p95_ms = (typeof res?.p95_ms === 'number') ? res.p95_ms : null;
    record.p99_ms = (typeof res?.p99_ms === 'number') ? res.p99_ms : null;
    record.over_budget = (typeof record.p95_ms === 'number') ? (record.p95_ms > budget) : null;
  } catch (e) {
    record.probe_exit_code = (e && (e.name === 'ReadinessTimeout' || e.message === 'readiness_timeout')) ? 2 : 1;
    record.error_name = (e && e.name) || null;
    record.error_message = (e && e.message) || String(e || 'probe_error');
  }

  fs.writeFileSync(outFile, JSON.stringify(record, null, 2) + '\n');
  fs.appendFileSync(ndjsonFile, JSON.stringify(record) + '\n');
  console.log('Loadcheck JSON written:', outFile);

  const strict = process.env.STRICT_LOADCHECK === '1';
  if (strict) {
    if (record.probe_exit_code !== 0) {
      console.error(`STRICT: probe failed (exit ${record.probe_exit_code}) ${record.error_name || ''} ${record.error_message || ''}`);
      process.exit(1);
    }
    if (record.p95_ms == null) {
      console.error('STRICT: missing p95_ms');
      process.exit(1);
    }
    if (record.p95_ms > budget) {
      console.error(`STRICT: p95_ms ${record.p95_ms} exceeded budget ${budget} ms`);
      process.exit(1);
    }
  }

  // Non-strict: succeed when not over budget and no fatal probe error
  if (record.over_budget === true) {
    console.error(`p95_ms ${record.p95_ms} exceeded budget ${budget} ms`);
    process.exit(1);
  }
  process.exit(0);
})();
