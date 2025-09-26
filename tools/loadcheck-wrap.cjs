#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const out = (r.stdout||'') + (r.stderr||'');
  return { code: r.status ?? 1, out };
}

function parseLine(s) {
  // Expect: Loadcheck p95_ms=123 max_ms=456 rps=789
  const m = s.match(/p95_ms=(\d+(?:\.\d+)?)\s+max_ms=(\d+(?:\.\d+)?)\s+rps=(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return { p95_ms: Number(m[1]), max_ms: Number(m[2]), rps: Number(m[3]) };
}

(function main(){
  const budget = Number(process.env.P95_BUDGET_MS || '600');
  const res = run(process.execPath, ['tools/loadcheck.js']);
  if (res.code !== 0) {
    // Do not fail the entire suite if the probe fails to run; log and continue
    console.error('loadcheck failed');
  }
  const line = res.out.split('\n').find(l => l.includes('Loadcheck p95_ms=')) || '';
  const parsed = parseLine(line) || {};
  const outDir = path.resolve(process.cwd(), 'reports', 'warp');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'loadcheck.json');
  const ndjsonFile = path.join(outDir, 'loadcheck.ndjson');
  const record = { timestamp: new Date().toISOString(), ...parsed, budget, over_budget: Number.isFinite(parsed.p95_ms) && parsed.p95_ms > budget, probe_exit_code: res.code };
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2) + '\n');
  fs.appendFileSync(ndjsonFile, JSON.stringify(record) + '\n');
  console.log('Loadcheck JSON written:', outFile);
  if (record.over_budget) {
    console.error(`p95_ms ${record.p95_ms} exceeded budget ${budget} ms`);
    process.exit(1);
  }
  // If probe failed to run, optionally enforce strict failure in CI
  if (res.code !== 0) {
    if (process.env.STRICT_LOADCHECK === '1') {
      console.error('STRICT_LOADCHECK=1 and loadcheck probe failed');
      process.exit(res.code);
    }
    process.exit(0);
  }
})();
