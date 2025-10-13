#!/usr/bin/env node
/**
 * perf-collect.mjs
 * Deterministically collect simple SLO metrics into artifact/slos.json
 * - Starts the engine on a temp port with TEST_ROUTES=1 AUTH_ENABLED=0
 * - Issues >= 60 requests to POST /v1/run?demo=1
 * - Computes p95 (integer ms) for end-to-end latency
 * - Writes artifact/slos.json with stable 2-space indentation and stable key order
 */

import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync, readFileSync, copyFileSync, statSync } from 'node:fs';
import { resolve, join as joinPath } from 'node:path';
import { createHash } from 'node:crypto';

const PORT = 4321;
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForHealth(timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/v1/health`);
      if (res.ok) return true;
    } catch {}
    await sleep(100);
  }
  return false;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

async function collect() {
  // Start server
  const child = spawn('node', ['dist/main.js'], {
    env: {
      ...process.env,
      TEST_ROUTES: '1',
      AUTH_ENABLED: '0',
      RATE_LIMIT_ENABLED: '0',
      PORT: String(PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Log to tmp (optional)
  const logPath = `/tmp/engine-perf-${PORT}.log`;
  const logStream = createWriteStream(logPath);
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  const healthy = await waitForHealth(8000);
  if (!healthy) {
    try { child.kill(); } catch {}
    console.error('Failed to start engine for perf collection');
    process.exit(1);
  }

  const MIN_OK = 60;
  const TARGET_OK = 65;
  const WARMUP_DROP = 5;
  const durations = [];
  let successes = 0;
  let attempts = 0;
  const MAX_ATTEMPTS = 500; // safety cap

  while (successes < TARGET_OK && attempts < MAX_ATTEMPTS) {
    attempts++;
    try {
      const t0 = performance.now();
      const res = await fetch(`${BASE}/v1/run?demo=1`, { method: 'POST' });
      const t1 = performance.now();
      if (res.ok) {
        successes++;
        durations.push(Math.round(t1 - t0));
      }
    } catch {
      // ignore and continue until we hit TARGET successes
    }
  }

  if (successes < MIN_OK) {
    try { child.kill(); } catch {}
    console.error(`perf:collect gathered insufficient samples (N=${successes})`);
    process.exit(1);
  }

  const trimmed = durations.slice(WARMUP_DROP);
  const p95 = percentile(trimmed.length > 0 ? trimmed : durations, 95);

  // Write artifact/slos.json
  const artifactDir = resolve(process.cwd(), 'artifact');
  mkdirSync(artifactDir, { recursive: true });
  const outPath = resolve(artifactDir, 'slos.json');
  const payload = {
    schema: 'slos.v1',
    engine_get_p95_ms: Math.round(p95),
    meta: {
      n: successes,
      timestamp: new Date().toISOString(),
    },
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');

  // Write pack artifacts
  const packDir = resolve(artifactDir, 'pack');
  mkdirSync(packDir, { recursive: true });
  const packSlosPath = resolve(packDir, 'slos.json');
  copyFileSync(outPath, packSlosPath);
  // checksums.json (for now, include slos only; manifest hash can be added by other tooling)
  function sha256File(p) {
    const h = createHash('sha256');
    h.update(readFileSync(p));
    return h.digest('hex');
  }
  const checksumsPath = resolve(packDir, 'checksums.json');
  const checksums = { slos_json_sha256: sha256File(packSlosPath) };
  writeFileSync(checksumsPath, JSON.stringify(checksums, null, 2) + '\n', 'utf8');

  // Now build manifest with exact sizes (including self size via small fixpoint loop)
  const dateStr = new Date().toISOString().slice(0, 10);
  const gitSha = String(process.env.GITHUB_SHA || process.env.BUILD_ID || 'dev');
  const sha7 = gitSha.slice(0, 7);
  const zipName = `engine_pack_${dateStr}_${sha7}.zip`;
  const zipPathRel = `artifact/${zipName}`; // relative path as contract allows

  const fileEntriesBase = [
    { path: 'checksums.json', size_bytes: statSync(joinPath(packDir, 'checksums.json')).size },
    { path: 'slos.json',      size_bytes: statSync(joinPath(packDir, 'slos.json')).size },
    // manifest size_bytes to be computed via fixpoint
  ].sort((a, b) => a.path.localeCompare(b.path));

  const manifestPath = resolve(packDir, 'manifest.json');
  function clampIsoSeconds(iso) { return iso.replace(/\.\d{3}Z$/, 'Z'); }
  const createdUtc = clampIsoSeconds(new Date().toISOString());
  const createdBy = String(process.env.GITHUB_ACTOR || process.env.USER || 'local');
  const buildEnv = {
    node: process.version,
    platform: process.platform,
  };

  let manifestSize = 0;
  for (let i = 0; i < 5; i++) {
    const files = [...fileEntriesBase, { path: 'manifest.json', size_bytes: manifestSize }]
      .sort((a, b) => a.path.localeCompare(b.path));
    const manifestObj = {
      schema: 'pack.manifest.v1',
      component: 'engine',
      created_utc: createdUtc,
      path: zipPathRel,
      files,
      meta: {
        seed: 0,
        commit: sha7,
        version: '1.0.0',
        created_by: createdBy,
        version_git_sha: gitSha,
        build_env: buildEnv,
      },
    };
    const txt = JSON.stringify(manifestObj, null, 2) + '\n';
    const computed = Buffer.byteLength(txt, 'utf8');
    if (computed === manifestSize) { writeFileSync(manifestPath, txt, 'utf8'); break; }
    manifestSize = computed;
    if (i === 4) writeFileSync(manifestPath, txt, 'utf8');
  }

  try { child.kill(); } catch {}
  console.log(`Wrote ${outPath} (engine_get_p95_ms=${Math.round(p95)}, N=${successes})`);
}

collect().catch(err => {
  console.error('perf:collect error:', err?.message || String(err));
  process.exit(1);
});
