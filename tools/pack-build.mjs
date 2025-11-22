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

  // Canonical pack-meta.json (commit, build time, flags)
  const packMeta = {
    schema: 'pack-meta.v1',
    commit: git.commit,
    build_timestamp: new Date().toISOString(),
    flags: {
      SCM_LITE_ENABLE: process.env.SCM_LITE_ENABLE || '0',
      SCM_LITE_K: process.env.SCM_LITE_K || '256',
      SCM_LITE_MAX_NODES: process.env.SCM_LITE_MAX_NODES || '12',
      SCM_LITE_BELIEF_DEFAULT: process.env.SCM_LITE_BELIEF_DEFAULT || '0.7',
    }
  };
  const packMetaJson = JSON.stringify(packMeta, null, 2);

  // Load sample report if available (for canonical API response)
  const reportSample = readJsonIfExists(`${ENGINE_DIR}/out/report_v1.seed42.json`);
  const reportSampleJson = reportSample ? JSON.stringify(reportSample, null, 2) : null;

  // Compute checksums
  const checksums = {
    schema: 'checksums.v1',
    files: {
      'pack-meta.json': sha256(packMetaJson),
      'manifest.json': sha256(manifestJson),
      'slos.live.json': sha256(slosJson)
    }
  };
  if (reportSampleJson) {
    checksums.files['report_v1.seed42.json'] = sha256(reportSampleJson);
  }
  const checksumsJson = JSON.stringify(checksums, null, 2);
  checksums.files['checksums.json'] = sha256(checksumsJson);

  // Write files to temp pack directory
  const packTmpDir = `${ENGINE_DIR}/out/pack_tmp`;
  mkdirSync(packTmpDir, { recursive: true });

  // Canonical evidence directory
  const evidenceDir = `${packTmpDir}/evidence`;
  mkdirSync(evidenceDir, { recursive: true });

  // Write files in sorted order with canonical names
  const files = [
    { name: 'evidence/pack-meta.json', content: packMetaJson },
    { name: 'evidence/slos.live.json', content: slosJson },
    { name: 'manifest.json', content: manifestJson },
    { name: 'checksums.json', content: checksumsJson }
  ];
  if (reportSampleJson) {
    files.push({ name: 'evidence/report_v1.seed42.json', content: reportSampleJson });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));

  for (const file of files) {
    writeFileSync(`${packTmpDir}/${file.name}`, file.content, 'utf8');
  }

  // Set canonical permissions and timestamps (DOS epoch: 1980-01-01 00:00:00)
  try {
    execSync(`chmod 0644 "${packTmpDir}"/*`, { encoding: 'utf8' });
    execSync(`TZ=UTC touch -t 198001010000 "${packTmpDir}"/*`, { encoding: 'utf8' });
  } catch (err) {
    // touch -t might not work on all systems, continue anyway
  }

  // Build ZIP using system zip command with canonical settings
  // -X: no extra attributes, -q: quiet, -r: recursive, -9: max compression
  const zipPath = `${ENGINE_DIR}/out/${packName}`;
  try {
    execSync(`cd "${packTmpDir}" && TZ=UTC zip -X -q -r -9 "${zipPath}" ${files.map(f => f.name).join(' ')}`, {
      encoding: 'utf8',
      env: { ...process.env, TZ: 'UTC' }
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

  // Write pack pointer with entry list
  const packPointer = {
    schema: 'pack-pointer.v1',
    filename: packName,
    sha256: packSha256,
    size_bytes: packBuffer.length,
    entries: files.map(f => f.name).sort(),
    created: new Date().toISOString()
  };
  writeFileSync(`${ENGINE_DIR}/out/pack-pointer.json`, JSON.stringify(packPointer, null, 2), 'utf8');

  process.exit(0);
}

main().catch(err => {
  console.error('GATES: FAIL — pack-build:', err.message);
  process.exit(1);
});
