#!/usr/bin/env node
// CI assertions for nightly Evidence Pack
// - Ensures p95 <= 600
// - Validates SSE event enum matches frozen set
// - Validates /health includes required keys
// - Validates HEAD vs GET headers parity for selected headers

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function latestPackDir(root = 'artifact') {
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^Evidence-Pack-\d{8}-\d{4}$/.test(d.name))
    .map(d => d.name)
    .sort();
  if (!dirs.length) throw new Error('No Evidence-Pack-* directories found');
  return join(root, dirs[dirs.length - 1]);
}

function fail(msg) {
  console.error('ci-assert: FAIL -', msg);
  process.exit(1);
}

function ok(msg) {
  console.log('ci-assert:', msg);
}

try {
  const pack = latestPackDir();
  ok(`latest pack: ${pack}`);

  // p95 budget
  const lcPath = join(pack, 'reports', 'loadcheck.json');
  const lc = JSON.parse(readFileSync(lcPath, 'utf8'));
  const p95 = Number(lc.p95_ms || 0);
  if (!(p95 > 0 && p95 <= 600)) fail(`p95_ms out of budget: ${p95}`);
  ok(`p95_ms OK: ${p95}`);

  // SSE contract
  const sseSchemaPath = resolve('contracts', 'sse-event.schema.json');
  const sse = JSON.parse(readFileSync(sseSchemaPath, 'utf8'));
  const gotEnum = (sse?.properties?.event?.enum || []).slice().sort();
  const wantEnum = ['hello','token','cost','done','cancelled','limited','error'].sort();
  if (JSON.stringify(gotEnum) !== JSON.stringify(wantEnum)) {
    fail(`SSE enum mismatch. got=${JSON.stringify(gotEnum)} want=${JSON.stringify(wantEnum)}`);
  }
  ok('SSE events enum OK');

  // /health minimal keys present
  const healthPath = join(pack, 'engine', 'health.json');
  const health = JSON.parse(readFileSync(healthPath, 'utf8'));
  for (const k of ['status','p95_ms','test_routes_enabled','replay']) {
    if (!(k in health)) fail(`/health missing key: ${k}`);
  }
  ok('/health required keys present');

  // HEAD vs GET parity (selected headers)
  function parseHeaders(p) {
    const raw = readFileSync(p, 'utf8').split(/\r?\n/);
    const map = new Map();
    for (const line of raw) {
      if (!line || /^HTTP\//i.test(line)) continue;
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const k = line.slice(0, idx).trim().toLowerCase();
      const v = line.slice(idx + 1).trim();
      map.set(k, v);
    }
    return map;
  }
  const getH = parseHeaders(join(pack, 'engine', 'draft-flows-200.h'));
  const headH = parseHeaders(join(pack, 'engine', 'head-200.h'));
  const keys = ['content-type','cache-control','vary','etag','content-length'];
  for (const k of keys) {
    const gv = getH.get(k);
    const hv = headH.get(k);
    if (!gv || !hv) fail(`header missing in parity check: ${k}`);
    if (gv !== hv) fail(`header differs (${k}): GET='${gv}' HEAD='${hv}'`);
  }
  ok('HEAD vs GET header parity OK');

  ok('All assertions passed');
  process.exit(0);
} catch (e) {
  fail(e?.message || String(e));
}
