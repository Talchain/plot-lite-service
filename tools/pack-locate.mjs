#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

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

try {
  const json = process.argv.includes('--json');
  const p = latestPackDir('artifact');
  const out = p ? resolve(p) : '<none>';
  if (json) {
    console.log(JSON.stringify({ path: out }));
  } else {
    console.log(out);
  }
  process.exit(0);
} catch (e) {
  const json = process.argv.includes('--json');
  const out = '<none>';
  if (json) console.log(JSON.stringify({ path: out })); else console.log(out);
  process.exit(0);
}
