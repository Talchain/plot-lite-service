#!/usr/bin/env node
// CI assertions for nightly Evidence Pack
// - Ensures p95 <= 600
// - Validates SSE event enum matches frozen set
// - Validates /health includes required keys
// - Validates HEAD vs GET headers parity for selected headers

import { readdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

function latestPackDir(root = 'artifact') {
  try {
    const dirs = readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^Evidence-Pack-\d{8}-\d{4}$/.test(d.name))
      .map(d => d.name)
      .sort();
    if (!dirs.length) return null;
    return join(root, dirs[dirs.length - 1]);
  } catch {
    return null;
  }
}

function prunePacks(root = 'artifact', keep = 7) {
  try {
    const dirs = readdirSync(root, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^Evidence-Pack-\d{8}-\d{4}$/.test(d.name))
      .map(d => d.name)
      .sort();
    const excess = Math.max(0, dirs.length - keep);
    for (let i = 0; i < excess; i++) {
      const victim = join(root, dirs[i]);
      rmSync(victim, { recursive: true, force: true });
      console.log('ci-assert: pruned', victim);
    }
  } catch {}
}

function fail(msg) {
  console.error('ci-assert: FAIL -', msg);
  // Attempt to append to GitHub Step Summary if available
  try {
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) {
      const lines = [
        '### Evidence Pack Gates — Failure',
        `- message: ${msg}`,
      ];
      appendFileSync(summary, lines.join('\n') + '\n');
    }
  } catch {}
  process.exit(1);
}

function ok(msg) {
  console.log('ci-assert:', msg);
}

try {
  const pack = latestPackDir();
  if (!pack) {
    console.error('ci-assert: No Evidence Pack found under artifact/. Run PACK_SELF_START=1 bash tools/verify-and-pack.sh first.');
    process.exit(2);
  }
  // Gates state
  const gates = {
    p50: { ok: false, value: null },
    p95: { ok: false, value: null, budget: 600 },
    p99: { ok: false, value: null, budget: 900 },
    sse_enum: { ok: false },
    health_keys: { ok: false, missing: [] },
    head_parity: { ok: false, diffs: [] },
    health_size: { ok: false, bytes: null, limit: 4096 },
  };
  let allOk = true;
  let rateLimitOk = null;

  // p95 budget (+ p50/p99 capture; optional STRICT_P99 gate)
  try {
    const lcPath = join(pack, 'reports', 'loadcheck.json');
    const lc = JSON.parse(readFileSync(lcPath, 'utf8'));
    const p50 = Number(lc.p50_ms || 0);
    const p95 = Number(lc.p95_ms || 0);
    const p99 = Number(lc.p99_ms || 0);
    gates.p50.value = p50;
    gates.p95.value = p95;
    gates.p99.value = p99;
    if (!(p95 > 0 && p95 <= gates.p95.budget)) {
      allOk = false; gates.p95.ok = false;
      console.log(`GATE p95: FAIL — p95_ms=${p95} > budget=${gates.p95.budget} (see ${lcPath})`);
    } else {
      gates.p95.ok = true;
      console.log(`GATE p95: PASS — p95_ms=${p95} (budget <= ${gates.p95.budget})`);
    }
    if (p50 > 0) {
      gates.p50.ok = true;
      console.log(`GATE p50: PASS — p50_ms=${p50}`);
    }
    // Optional STRICT_P99 gate
    const STRICT_P99 = process.env.STRICT_P99 === '1';
    if (p99 && p99 > gates.p99.budget) {
      if (STRICT_P99) { allOk = false; console.log(`GATE p99: FAIL — p99_ms=${p99} > budget=${gates.p99.budget} (STRICT_P99=1) (see ${lcPath})`); }
      else console.log(`WARN p99: p99_ms=${p99} > ${gates.p99.budget} (STRICT_P99=0)`);
    } else if (p99) {
      console.log(`INFO p99: p99_ms=${p99} (<= ${gates.p99.budget})`);
    }
  } catch (e) { allOk = false; console.log(`GATE p95: FAIL — cannot read loadcheck.json (${(e?.message)||e})`); }

  // SSE contract
  try {
    const sseSchemaPath = resolve('contracts', 'sse-event.schema.json');
    const sse = JSON.parse(readFileSync(sseSchemaPath, 'utf8'));
    const gotEnum = (sse?.properties?.event?.enum || []).slice().sort();
    const wantEnum = ['hello','token','cost','done','cancelled','limited','error'].sort();
    const match = JSON.stringify(gotEnum) === JSON.stringify(wantEnum);
    gates.sse_enum.ok = match;
    if (!match) { allOk = false; console.log(`GATE sse_enum: FAIL — got=${JSON.stringify(gotEnum)} want=${JSON.stringify(wantEnum)} (see ${sseSchemaPath})`); }
    else console.log('GATE sse_enum: PASS — schema enum matches');
  } catch (e) { allOk = false; console.log(`GATE sse_enum: FAIL — cannot read SSE schema (${(e?.message)||e})`); }

  // /health minimal keys present + size gate
  try {
    const healthPath = join(pack, 'engine', 'health.json');
    const healthPretty = readFileSync(healthPath, 'utf8');
    const health = JSON.parse(healthPretty);
    const required = ['status','p95_ms','test_routes_enabled','replay'];
    const missing = required.filter(k => !(k in health));
    gates.health_keys.ok = missing.length === 0;
    gates.health_keys.missing = missing;
    try { rateLimitOk = typeof (health?.rate_limit?.enabled) === 'boolean'; } catch {}
    if (missing.length) { allOk = false; console.log(`GATE health_keys: FAIL — missing: ${missing.join(', ')} (see ${healthPath})`); }
    else console.log('GATE health_keys: PASS — required keys present');

    // Determine health bytes from captured headers if available; fallback to raw length
    let bytes = null;
    try {
      const hdrs = readFileSync(join(pack, 'engine', 'health.h'), 'utf8');
      const m = hdrs.split(/\r?\n/).find(l => /^content-length:/i.test(l));
      if (m) {
        const v = Number(String(m.split(':',2)[1]||'').trim());
        if (Number.isFinite(v)) bytes = v;
      }
    } catch {}
    if (bytes == null) {
      bytes = Buffer.byteLength(healthPretty, 'utf8');
    }
    gates.health_size.bytes = bytes;
    if (Number.isFinite(bytes) && bytes <= gates.health_size.limit) {
      gates.health_size.ok = true;
      console.log(`GATE health_size: PASS — health_size=${bytes}B (<= ${gates.health_size.limit}B)`);
    } else {
      gates.health_size.ok = false; allOk = false;
      console.log(`GATE health_size: FAIL — health_size=${bytes}B (> ${gates.health_size.limit}B)`);
    }

    // Non-blocking flags manifest drift note
    try {
      const flags = JSON.parse(readFileSync(resolve('contracts', 'flags.manifest.json'), 'utf8'));
      const rows = Array.isArray(flags?.flags) ? flags.flags : [];
      const notes = [];
      for (const r of rows) {
        const key = String(r?.key || '');
        if (!key) continue;
        // map known keys to health fields
        let present = false; let actual = undefined; let def = r?.default;
        if (key === 'test_routes_enabled') { actual = !!health?.test_routes_enabled; present = 'test_routes_enabled' in health; }
        else if (key === 'rate_limit.enabled') { actual = !!(health?.rate_limit?.enabled); present = !!health?.rate_limit; }
        else if (key === 'metrics') { /* requires METRICS=1 live; skip */ present = true; actual = undefined; }
        // env-only keys are informational; skip strict compare
        else { continue; }
        if (!present) notes.push(`missing:${key}`);
        else if (typeof def === 'boolean' && typeof actual === 'boolean' && def !== actual) notes.push(`default_drift:${key} doc=${def} actual=${actual}`);
      }
      if (notes.length) console.log('FLAGS: NOTE —', notes.join('; '));
      else console.log('FLAGS: NOTE — ok');
    } catch {}
  } catch (e) { allOk = false; console.log(`GATE health_keys: FAIL — cannot read health.json (${(e?.message)||e})`); }

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
  try {
    const getH = parseHeaders(join(pack, 'engine', 'draft-flows-200.h'));
    const headH = parseHeaders(join(pack, 'engine', 'head-200.h'));
    const keys = ['content-type','cache-control','vary','etag','content-length'];
    const diffs = [];
    for (const k of keys) {
      const gv = getH.get(k);
      const hv = headH.get(k);
      if (!gv || !hv) diffs.push({ key: k, error: 'missing' });
      else if (gv !== hv) diffs.push({ key: k, get: gv, head: hv });
    }
    gates.head_parity.ok = diffs.length === 0;
    gates.head_parity.diffs = diffs;
    if (diffs.length) { allOk = false; console.log(`GATE head_parity: FAIL — diffs=${JSON.stringify(diffs)} (see engine/head-200.h vs engine/draft-flows-200.h; manifest: pack-manifest.txt)`); }
    else console.log('GATE head_parity: PASS — selected headers equal');
  } catch (e) { allOk = false; console.log(`GATE head_parity: FAIL — cannot read header captures (${(e?.message)||e})`); }

  // Write pack-summary.json
  try {
    const sha = (process.env.GITHUB_SHA || '').slice(0,7) || execSync('git --no-pager rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const ref = process.env.GITHUB_REF_NAME || execSync('git --no-pager rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    const summary = {
      sha,
      ref,
      node: process.version,
      p50_ms: gates.p50.value,
      p95_ms: gates.p95.value,
      p99_ms: gates.p99.value,
      health_bytes: gates.health_size.bytes,
      gates,
    };
    writeFileSync(join(pack, 'pack-summary.json'), JSON.stringify(summary, null, 2));
  } catch {}

  // Append GitHub Step Summary if available (best-effort)
  try {
    const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (stepSummaryPath) {
      const badge = `${allOk ? 'PASS' : 'FAIL'} | p95_ms=${gates.p95.value ?? 'n/a'} (budget <= ${gates.p95.budget})`;
      const lines = [
        badge,
        '### Evidence Pack Gates',
        `- pack: ${pack}`,
        `- p95_ms: ${gates.p95.value ?? 'n/a'} (budget <= ${gates.p95.budget})`,
        `- gates: ${JSON.stringify({ p95: gates.p95.ok, sse_enum: gates.sse_enum.ok, health: gates.health_keys.ok, head_parity: gates.head_parity.ok })}`,
      ];
      try {
        appendFileSync(stepSummaryPath, lines.join('\n') + '\n');
      } catch (e) {
        console.error('ci-assert: failed to write to GitHub Step Summary', e?.message || e);
      }
    }
  } catch {}

  // Try read metrics snapshot (optional, gated by METRICS=1 during pack capture)
  let streamsTail = '';
  try {
    const metricsPath = join(pack, 'engine', 'metrics.json');
    const m = JSON.parse(readFileSync(metricsPath, 'utf8'));
    const s = {
      started: Number(m?.stream_started || 0),
      done: Number(m?.stream_done || 0),
      cancelled: Number(m?.stream_cancelled || 0),
      limited: Number(m?.stream_limited || 0),
      retryable: Number(m?.stream_retryable || 0),
    };
    streamsTail = ` streams:${JSON.stringify(s)}`;
  } catch {}

  // Consolidated PASS line (keep per-gate lines above)
  if (allOk) {
    const p95v = gates.p95.value ?? 'n/a';
    const tail = rateLimitOk ? 'sse, health, head-parity, rate-limit OK' : 'sse, health, head-parity OK';
    console.log(`GATES: PASS — p95=${p95v}ms; ${tail}${streamsTail}`);
    try {
      const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
      if (stepSummaryPath) appendFileSync(stepSummaryPath, `GATES: PASS — p95=${p95v}ms; ${tail}${streamsTail}\n`);
    } catch {}
  }

  // Prune packs respecting PACK_RETAIN_N (default 7)
  try {
    const keep = Math.max(1, Number(process.env.PACK_RETAIN_N || '7'));
    prunePacks('artifact', keep);
  } catch {}

  if (!allOk) fail(`One or more gates failed — see evidence in ${pack}`);
  ok('All assertions passed');
  process.exit(0);
} catch (e) {
  fail(e?.message || String(e));
}
