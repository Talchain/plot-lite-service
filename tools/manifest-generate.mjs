#!/usr/bin/env node
import { statSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

function listFiles(dir, out = [], root = dir) {
  const ents = readdirSync(dir, { withFileTypes: true });
  for (const e of ents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out, root);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

try {
  const outDir = process.argv[2] ? resolve(process.argv[2]) : null;
  if (!outDir) {
    console.error('usage: node tools/manifest-generate.mjs <pack-dir>');
    process.exit(1);
  }
  const files = listFiles(outDir);
  const jsonFiles = files.map(p => {
    const st = statSync(p);
    let sha256 = null;
    try {
      const buf = readFileSync(p);
      sha256 = createHash('sha256').update(buf).digest('hex');
    } catch {}
    return { path: p.slice(outDir.length + 1), size_bytes: st.size, sha256 };
  });
  const created_utc = new Date().toISOString();
  const engine = process.env.PACK_ENGINE_URL || '';
  const commit = process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0,7) : '';
  const obj = {
    schema: 'pack.manifest.v1',
    created_utc,
    path: outDir,
    commit,
    engine,
    files: jsonFiles,
  };
  console.log(JSON.stringify(obj, null, 2));
  process.exit(0);
} catch (e) {
  console.error(e?.message || String(e));
  process.exit(1);
}
