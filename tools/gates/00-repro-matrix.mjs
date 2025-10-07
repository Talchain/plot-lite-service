#!/usr/bin/env node
/**
 * Task B: Fresh-clone reproducibility matrix (v0.3.6)
 * - Run 2x builds, verify identical hashes
 * - Generate summary.json and artifacts.json
 */

import { execSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';

const ENGINE_DIR = process.env.ENGINE_DIR || process.cwd();

async function main() {
  console.log('GATES: Task B — Reproducibility matrix (v0.3.6, 2 runs)');

  mkdirSync(`${ENGINE_DIR}/reports/repro`, { recursive: true });

  // Test current OS (macOS in this case)
  const currentOS = process.platform;
  const runs = [];
  const hashes = [];

  // Run 2x builds
  for (let i = 0; i < 2; i++) {
    const result = {
      run: i + 1,
      os: currentOS,
      arch: process.arch,
      node: process.version,
      status: 'PASS',
      duration_s: 0,
      pack_hash: '',
      timestamp: new Date().toISOString(),
    };

    const start = Date.now();

    try {
      // Rebuild pack to verify reproducibility
      execSync('node tools/gates/09-engine-pack.mjs', {
        cwd: ENGINE_DIR,
        stdio: 'pipe',
        env: { ...process.env, NODE_ENV: 'test' },
      });

      // Get pack hash
      const packFile = execSync('cd out && ls -1 engine_pack_*.zip 2>/dev/null | head -1', {
        cwd: ENGINE_DIR,
        encoding: 'utf8',
      }).trim();

      if (packFile) {
        const hashOutput = execSync(`shasum -a 256 out/${packFile} | awk '{print $1}'`, {
          cwd: ENGINE_DIR,
          encoding: 'utf8',
        }).trim();

        result.pack_hash = hashOutput;
        hashes.push(hashOutput);
      }

      result.duration_s = Math.round((Date.now() - start) / 1000);
    } catch (err) {
      result.status = 'FAIL';
      result.error = err.message;
    }

    runs.push(result);
  }

  // Check if hashes are identical
  const hashesIdentical = hashes.length === 2 && hashes[0] === hashes[1];

  if (!hashesIdentical) {
    console.log('GATES: FAIL — pack hashes differ across runs');
    console.log(`  Run 1: ${hashes[0]?.slice(0, 16) || 'N/A'}`);
    console.log(`  Run 2: ${hashes[1]?.slice(0, 16) || 'N/A'}`);
    process.exit(1);
  }

  // Write OS-specific report
  const osName = currentOS === 'darwin' ? 'darwin' : currentOS === 'linux' ? 'linux' : 'windows';
  writeFileSync(`${ENGINE_DIR}/reports/repro/${osName}.json`, JSON.stringify(runs, null, 2), 'utf8');

  // Write summary.json
  const summary = {
    schema: 'repro-summary.v1',
    os_tested: 1,
    runs_per_os: 2,
    all_identical: hashesIdentical,
    canonical_hash: hashes[0].slice(0, 16),
    timestamp: new Date().toISOString()
  };
  writeFileSync(`${ENGINE_DIR}/reports/repro/summary.json`, JSON.stringify(summary, null, 2), 'utf8');

  // Write artifacts.json
  const artifacts = {
    schema: 'repro-artifacts.v1',
    runs: runs.map(r => ({
      run: r.run,
      os: r.os,
      pack_hash: r.pack_hash.slice(0, 16),
      duration_s: r.duration_s
    })),
    timestamp: new Date().toISOString()
  };
  writeFileSync(`${ENGINE_DIR}/reports/repro/artifacts.json`, JSON.stringify(artifacts, null, 2), 'utf8');

  console.log(`GATES: PASS — reproducibility OK (2 runs, hash=${hashes[0].slice(0, 8)} identical)`);

  process.exit(0);
}

main().catch(err => {
  console.error('GATES: FAIL — repro-matrix:', err.message);
  process.exit(1);
});
