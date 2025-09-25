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
  const res = run(process.execPath, ['tools/loadcheck.js']);
  if (res.code !== 0) {
    console.error('loadcheck failed');
    process.exit(res.code);
  }
  const line = res.out.split('\n').find(l => l.includes('Loadcheck p95_ms=')) || '';
  const parsed = parseLine(line) || {};
  const outDir = path.resolve(process.cwd(), 'reports', 'warp');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'loadcheck.json');
  fs.writeFileSync(outFile, JSON.stringify({ timestamp: new Date().toISOString(), ...parsed }, null, 2));
  console.log('Loadcheck JSON written:', outFile);
})();