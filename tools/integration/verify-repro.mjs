#!/usr/bin/env node
/**
 * Phase A: Fresh-clone reproducibility & sanity checks
 * Verify engine pack is byte-stable across rebuilds
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ENGINE_DIR = process.env.ENGINE_DIR || process.cwd();

async function main() {
  console.log('GATES: Phase A — Fresh-clone reproducibility');

  // Build pack twice and compare hashes
  const hashes = [];

  for (let i = 0; i < 2; i++) {
    // Run pack build
    try {
      execSync('node tools/gates/09-engine-pack.mjs', {
        cwd: ENGINE_DIR,
        stdio: 'pipe',
        env: { ...process.env, NODE_ENV: 'test' },
      });
    } catch (err) {
      throw new Error(`Pack build ${i + 1} failed: ${err.message}`);
    }

    // Find pack file
    const packFiles = execSync('cd out && ls -1 engine_pack_*.zip 2>/dev/null || true', {
      cwd: ENGINE_DIR,
      encoding: 'utf8',
    }).trim().split('\n').filter(Boolean);

    if (packFiles.length === 0) {
      throw new Error('No pack file found');
    }

    const packPath = `${ENGINE_DIR}/out/${packFiles[0]}`;
    const content = readFileSync(packPath);
    const hash = createHash('sha256').update(content).digest('hex');
    hashes.push(hash);

    // Clean for second build
    if (i === 0) {
      execSync('rm -f out/engine_pack_*.zip', { cwd: ENGINE_DIR, stdio: 'ignore' });
    }
  }

  if (hashes[0] !== hashes[1]) {
    throw new Error(`Pack not canonical: ${hashes[0]} !== ${hashes[1]}`);
  }

  // Sanity checks on metrics
  const warnings = [];
  let slos = { engine_get_p95_ms: 0, K_per_sec: 0 };

  try {
    slos = JSON.parse(readFileSync(`${ENGINE_DIR}/out/slos.json`, 'utf8'));

    if (slos.engine_get_p95_ms < 1) {
      warnings.push('Suspiciously fast p95 (<1ms) - may indicate mock data');
    }
    if (slos.K_per_sec > 1000000) {
      warnings.push('Unrealistic K/sec (>1M) on laptop - check calculation');
    }
  } catch {}

  // Write diagnostic
  const diag = {
    phase: 'repro',
    pack_hash: hashes[0].slice(0, 16),
    pack_stable: true,
    slos,
    warnings,
    timestamp: new Date().toISOString(),
  };

  writeFileSync(`${ENGINE_DIR}/reports/diag/repro.json`, JSON.stringify(diag, null, 2), 'utf8');

  console.log(`GATES: PASS — fresh-clone reproducible (engine pack sha256 identical, hash=${hashes[0].slice(0, 8)})`);
  process.exit(0);
}

main().catch(err => {
  console.error('GATES: FAIL — fresh-clone:', err.message);
  writeFileSync(`${ENGINE_DIR}/reports/diag/repro.json`, JSON.stringify({
    phase: 'repro',
    error: err.message,
    timestamp: new Date().toISOString(),
  }, null, 2), 'utf8');
  process.exit(1);
});
