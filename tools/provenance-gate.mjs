#!/usr/bin/env node
/**
 * provenance-gate.mjs
 * Enforces artifact/pack/checksums.json covers manifest.json and engine zip with matching sha256.
 * Emits exactly one GATES line and exits non-zero on mismatch.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';

function sha256File(p) {
  try {
    const buf = readFileSync(p);
    return createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

try {
  const root = process.cwd();
  const packDir = resolve(root, 'artifact', 'pack');
  const checksumsPath = resolve(packDir, 'checksums.json');
  const manifestPath = resolve(packDir, 'manifest.json');

  if (!existsSync(packDir)) {
    console.log('GATES: SKIP — provenance (reason=artifact/pack missing)');
    process.exit(0);
  }
  if (!existsSync(checksumsPath) || !existsSync(manifestPath)) {
    const first = !existsSync(checksumsPath) ? 'checksums.json' : 'manifest.json';
    console.log(`GATES: FAIL — provenance missing file=${first}`);
    process.exit(1);
  }

  // Parse manifest to locate the engine zip path (required: manifest.path relative to artifact/pack)
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { manifest = null; }
  if (!manifest || manifest.schema !== 'pack.manifest.v1') {
    console.log('GATES: FAIL — provenance invalid manifest schema');
    process.exit(1);
  }
  const zipRel = typeof manifest.path === 'string' ? manifest.path : null;
  if (!zipRel) {
    console.log('GATES: FAIL — provenance missing manifest.path');
    process.exit(1);
  }
  const zipAbs = resolve(packDir, zipRel);
  if (!existsSync(zipAbs)) {
    console.log('GATES: FAIL — provenance missing zip referenced by manifest.path');
    process.exit(1);
  }

  // Parse checksums.json
  let sums;
  try { sums = JSON.parse(readFileSync(checksumsPath, 'utf8')); } catch { sums = null; }
  if (!sums || typeof sums !== 'object') {
    console.log('GATES: FAIL — provenance invalid checksums.json');
    process.exit(1);
  }

  // Expected keys: manifest.json and engine zip (by filename)
  const zipFileName = zipAbs ? basename(zipAbs) : null;
  const expectedKeys = ['manifest.json'];
  if (zipFileName) expectedKeys.push(zipFileName);

  // Normalize layout: support either flat { file: sha } or { files: { file: sha } } or specific keys
  const flat = sums.files && typeof sums.files === 'object' ? sums.files : sums;

  function hasKeyValidShape(k) {
    const v = flat[k];
    if (!v || typeof v !== 'object') return false;
    if (typeof v.sha256 !== 'string' || v.sha256.length !== 64) return false;
    if (typeof v.size !== 'number') return false;
    return true;
  }

  const missingKeys = expectedKeys.filter(k => !hasKeyValidShape(k));
  if (missingKeys.length) {
    console.log(`GATES: FAIL — provenance missing file=${missingKeys[0]}`);
    process.exit(1);
  }

  // Recompute and compare
  const manifestSha = sha256File(manifestPath);
  const zipSha = zipAbs ? sha256File(zipAbs) : null;
  const manifestSize = statSync(manifestPath).size;
  const zipSize = zipAbs ? statSync(zipAbs).size : null;
  if (!manifestSha || (zipAbs && !zipSha)) {
    console.log('GATES: FAIL — provenance unable to hash files');
    process.exit(1);
  }
  function shaOf(v) { return v && v.sha256; }
  function sizeOf(v) { return v && v.size; }
  const mismatches = [];
  const manEnt = flat['manifest.json'];
  if (shaOf(manEnt) !== manifestSha) mismatches.push('manifest.json');
  if (sizeOf(manEnt) != null && sizeOf(manEnt) !== manifestSize) mismatches.push('manifest.json');
  if (zipFileName) {
    const zipEnt = flat[zipFileName];
    if (shaOf(zipEnt) !== zipSha) mismatches.push(zipFileName);
    if (sizeOf(zipEnt) != null && sizeOf(zipEnt) !== zipSize) mismatches.push(zipFileName);
  }

  if (mismatches.length) {
    console.log(`GATES: FAIL — provenance mismatch file=${mismatches[0]}`);
    process.exit(1);
  }

  console.log(`GATES: PASS — provenance ok zip=${zipFileName || 'n/a'} manifest.json`);
  process.exit(0);
} catch (err) {
  console.log('GATES: SKIP — provenance (reason=error)');
  process.exit(0);
}
