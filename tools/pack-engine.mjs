#!/usr/bin/env node
/**
 * pack-engine.mjs
 * Create a canonical engine pack zip from artifact/pack contents.
 * - Uses system `zip` if available. Entries are passed in sorted order.
 * - Emits a single GATES line with path and sha256.
 */

import { existsSync, readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, relative, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

function sha256File(p) {
  const h = createHash('sha256');
  h.update(readFileSync(p));
  return h.digest('hex');
}

function listFilesRecursive(dir, base = dir) {
  const items = readdirSync(dir).sort();
  const files = [];
  for (const it of items) {
    const full = join(dir, it);
    const st = statSync(full);
    if (st.isDirectory()) files.push(...listFilesRecursive(full, base));
    else files.push(full);
  }
  return files;
}

try {
  const root = process.cwd();
  const packDir = resolve(root, 'artifact', 'pack');
  if (!existsSync(packDir)) {
    console.log('GATES: FAIL — engine pack missing (artifact/pack)');
    process.exit(1);
  }
  // Validate manifest before proceeding
  const manifestPath = resolve(packDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.log('GATES: FAIL — engine pack manifest invalid (reason=missing manifest.json)');
    process.exit(1);
  }
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); }
  catch { console.log('GATES: FAIL — engine pack manifest invalid (reason=unreadable JSON)'); process.exit(1); }
  if (manifest?.schema !== 'pack.manifest.v1') {
    console.log(`GATES: FAIL — engine pack manifest invalid (reason=schema ${manifest?.schema})`);
    process.exit(1);
  }
  if (manifest?.component !== 'engine') {
    console.log('GATES: FAIL — engine pack manifest invalid (reason=component)');
    process.exit(1);
  }
  // Validate meta fields
  if (!manifest?.meta || typeof manifest.meta !== 'object') {
    console.log('GATES: FAIL — engine pack manifest invalid (reason=missing meta)');
    process.exit(1);
  }
  if (typeof manifest.meta.created_by !== 'string' || !manifest.meta.created_by) {
    console.log('GATES: FAIL — engine pack manifest invalid (reason=meta.created_by)');
    process.exit(1);
  }
  if (typeof manifest.meta.version_git_sha !== 'string' || !manifest.meta.version_git_sha) {
    console.log('GATES: FAIL — engine pack manifest invalid (reason=meta.version_git_sha)');
    process.exit(1);
  }
  if (!manifest.meta.build_env || typeof manifest.meta.build_env !== 'object') {
    console.log('GATES: FAIL — engine pack manifest invalid (reason=meta.build_env)');
    process.exit(1);
  }
  if (typeof manifest.meta.build_env.node !== 'string' || typeof manifest.meta.build_env.platform !== 'string') {
    console.log('GATES: FAIL — engine pack manifest invalid (reason=build_env fields)');
    process.exit(1);
  }
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  const required = ['manifest.json', 'slos.json', 'checksums.json'];
  const missing = required.filter(n => !files.some((f) => f?.path === n));
  if (missing.length) {
    console.log(`GATES: FAIL — engine pack manifest invalid (reason=missing files: ${missing.join(',')})`);
    process.exit(1);
  }
  let healed = false;
  for (const f of files) {
    if (!f || typeof f.path !== 'string' || typeof f.size_bytes !== 'number') {
      console.log('GATES: FAIL — engine pack manifest invalid (reason=files entry shape)');
      process.exit(1);
    }
    const p = resolve(packDir, f.path);
    if (!existsSync(p)) {
      console.log(`GATES: FAIL — engine pack manifest invalid (reason=missing file ${f.path})`);
      process.exit(1);
    }
    const s = statSync(p).size;
    if (s !== f.size_bytes) {
      // Auto-heal well-known generated files sizes
      const name = String(f.path || '');
      if (name.endsWith('manifest.json') || name.endsWith('checksums.json')) {
        f.size_bytes = s;
        healed = true;
      } else {
        console.log(`GATES: FAIL — engine pack manifest invalid (reason=size mismatch ${f.path} expected=${f.size_bytes} actual=${s})`);
        process.exit(1);
      }
    }
  }
  if (healed) {
    try { writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8'); } catch {}
  }

  const fileList = listFilesRecursive(packDir);
  const date = new Date().toISOString().slice(0, 10);
  const sha7 = (process.env.GITHUB_SHA || 'dev').slice(0, 7);
  const zipName = `engine_pack_${date}_${sha7}.zip`;
  const zipPath = resolve(root, 'artifact', zipName);

  // Try to zip using system zip
  const args = ['-X', zipPath, ...fileList.map(f => relative(root, f))];
  // Ensure cwd is project root so relative paths work
  const res = spawnSync('zip', args, { cwd: root, encoding: 'utf8' });
  if (res.status !== 0) {
    console.error((res.stdout || '') + (res.stderr || ''));
    console.log('GATES: FAIL — zip tool not available or packing failed');
    process.exit(1);
  }
  const sum = sha256File(zipPath);
  // Also write a small pointer file
  const pointerPath = resolve(process.cwd(), 'artifact', 'pack', 'pack-pointer.json');
  writeFileSync(pointerPath, JSON.stringify({ file: zipPath, sha256: sum }, null, 2) + '\n', 'utf8');

  // Update manifest.path to reference current zip relative to artifact/pack
  try {
    const relFromPack = relative(packDir, zipPath).replace(/\\/g, '/');
    const manRaw = readFileSync(manifestPath, 'utf8');
    const manObj = JSON.parse(manRaw);
    manObj.path = relFromPack;
    writeFileSync(manifestPath, JSON.stringify(manObj, null, 2) + '\n', 'utf8');
  } catch {}

  // Merge/update checksums.json with manifest.json and zip filename
  try {
    const packDir = resolve(process.cwd(), 'artifact', 'pack');
    const checksumsPath = resolve(packDir, 'checksums.json');
    let obj = {};
    try { obj = JSON.parse(readFileSync(checksumsPath, 'utf8')); } catch {}
    const flat = (obj && typeof obj === 'object' && obj.files && typeof obj.files === 'object') ? obj.files : (obj && typeof obj === 'object' ? obj : {});
    // Ensure manifest.json and current zip present with sha256 + size bytes
    const zipName = basename(zipPath);
    const manifestSize = statSync(manifestPath).size;
    const zipSize = statSync(zipPath).size;
    const manifestSha = sha256File(manifestPath);
    flat['manifest.json'] = { sha256: manifestSha, size: manifestSize };
    flat[zipName] = { sha256: sum, size: zipSize };
    // Prune stale zip entries so checksums.json only tracks current artifacts
    for (const k of Object.keys(flat)) {
      if (k.endsWith('.zip') && k !== zipName) delete flat[k];
    }
    const out = (obj && obj.files && typeof obj.files === 'object') ? { ...obj, files: flat } : flat;
    writeFileSync(checksumsPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
  } catch {}

  // Ensure manifest.files entries reflect current sizes for manifest.json and checksums.json
  try {
    const manObj = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (Array.isArray(manObj.files)) {
      const patchSize = (name, size) => {
        const ent = manObj.files.find((f) => f && f.path === name);
        if (ent) ent.size_bytes = size;
      };
      const manifestSizeNow = statSync(manifestPath).size;
      const checksumsSizeNow = statSync(resolve(packDir, 'checksums.json')).size;
      patchSize('manifest.json', manifestSizeNow);
      patchSize('checksums.json', checksumsSizeNow);
      writeFileSync(manifestPath, JSON.stringify(manObj, null, 2) + '\n', 'utf8');
    }
  } catch {}

  console.log(`GATES: PASS — engine pack written path=${zipPath} sha256=${sum}`);
  process.exit(0);
} catch (err) {
  console.error(String(err?.message || err));
  console.log('GATES: FAIL — engine pack error');
  process.exit(1);
}
