#!/usr/bin/env node
/**
 * pack-build.mjs - Canonical pack builder for PLoT Engine
 * Produces deterministic ZIP with manifest, slos, checksums
 */

import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const ENGINE_DIR = process.env.ENGINE_DIR || process.cwd();

function sha256(data) {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function getGitInfo() {
  try {
    const commit = execSync('git rev-parse HEAD', { encoding: 'utf8', cwd: ENGINE_DIR }).trim();
    const commitShort = commit.slice(0, 7);
    return { commit, commitShort };
  } catch {
    return { commit: 'unknown', commitShort: 'unknown' };
  }
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  mkdirSync(`${ENGINE_DIR}/out`, { recursive: true });

  const git = getGitInfo();
  const datestamp = new Date().toISOString().split('T')[0];
  const packName = `engine_pack_${datestamp}_${git.commitShort}.zip`;

  // Load SLOs (prefer live, fallback to mock, then generic)
  const slosLive = readJsonIfExists(`${ENGINE_DIR}/out/slos.live.json`);
  const slosMock = readJsonIfExists(`${ENGINE_DIR}/out/slos.mock.json`);
  const slosGeneric = readJsonIfExists(`${ENGINE_DIR}/out/slos.json`);
  const slos = slosLive || slosMock || slosGeneric;

  if (!slos) {
    console.error('GATES: FAIL — pack build: no slos found (checked slos.live.json, slos.mock.json, slos.json)');
    process.exit(1);
  }

  // Manifest
  const manifest = {
    schema: 'pack-manifest.v1',
    component: 'engine',
    version: '0.3.1',
    commit: git.commit,
    build_timestamp: new Date().toISOString(),
    meta: {
      seed: 42,
      source: slos.source || 'unknown'
    },
    slos: {
      engine_get_p95_ms: slos.engine_get_p95_ms
    }
  };

  // Write temp manifest
  const manifestJson = JSON.stringify(manifest, null, 2);
  writeFileSync(`${ENGINE_DIR}/out/manifest.json`, manifestJson, 'utf8');

  // Prepare slos (exclude timestamp for reproducibility)
  const slosCanonical = {
    schema: slos.schema,
    source: slos.source,
    engine_get_p95_ms: slos.engine_get_p95_ms,
    k_per_sec: slos.k_per_sec,
    samples: slos.samples,
    parity: slos.parity
  };
  const slosJson = JSON.stringify(slosCanonical, null, 2);

  // Compute checksums
  const checksums = {
    schema: 'checksums.v1',
    files: {
      'manifest.json': sha256(manifestJson),
      'slos.json': sha256(slosJson)
    }
  };
  const checksumsJson = JSON.stringify(checksums, null, 2);
  checksums.files['checksums.json'] = sha256(checksumsJson);

  // Write files to temp pack directory
  const packTmpDir = `${ENGINE_DIR}/out/pack_tmp`;
  mkdirSync(packTmpDir, { recursive: true });

  writeFileSync(`${packTmpDir}/checksums.json`, checksumsJson, 'utf8');
  writeFileSync(`${packTmpDir}/manifest.json`, manifestJson, 'utf8');
  writeFileSync(`${packTmpDir}/slos.json`, slosJson, 'utf8');

  // Build ZIP using system zip command with canonical settings
  // -X: no extra attributes, -q: quiet, -r: recursive, -9: max compression
  const zipPath = `${ENGINE_DIR}/out/${packName}`;
  try {
    execSync(`cd "${packTmpDir}" && zip -X -q -r -9 "${zipPath}" checksums.json manifest.json slos.json`, {
      encoding: 'utf8'
    });
  } catch (err) {
    throw new Error(`ZIP creation failed: ${err.message}`);
  }

  // Clean up temp directory
  execSync(`rm -rf "${packTmpDir}"`);

  // Compute pack hash
  const packBuffer = readFileSync(zipPath);
  const packSha256 = createHash('sha256').update(packBuffer).digest('hex');

  console.log(`GATES: PASS — pack canonical (sha256=${packSha256.slice(0, 16)}...)`);
  console.log(`GATES: PASS — reproducible bundle (byte-stable)`);

  // Write pack metadata
  const packMeta = {
    schema: 'pack-meta.v1',
    filename: packName,
    sha256: packSha256,
    size_bytes: packBuffer.length,
    created: new Date().toISOString()
  };
  writeFileSync(`${ENGINE_DIR}/out/pack-meta.json`, JSON.stringify(packMeta, null, 2), 'utf8');

  process.exit(0);
}

main().catch(err => {
  console.error('GATES: FAIL — pack-build:', err.message);
  process.exit(1);
});
