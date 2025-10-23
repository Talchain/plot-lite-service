#!/usr/bin/env node
/**
 * P1D-1: Fail CI if any test file contains .only
 * Prevents accidental commits of focused tests
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function* walkDir(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      yield* walkDir(path);
    } else if (entry.isFile() && /\.test\.(ts|js|mjs)$/.test(entry.name)) {
      yield path;
    }
  }
}

async function checkForOnly() {
  const violations = [];
  
  for await (const file of walkDir('tests')) {
    const content = await readFile(file, 'utf8');
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match it.only, describe.only, test.only
      if (/\b(it|describe|test)\.only\(/.test(line)) {
        violations.push({ file, line: i + 1, text: line.trim() });
      }
    }
  }
  
  if (violations.length > 0) {
    console.error('❌ .only found in test files:');
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}`);
      console.error(`    ${v.text}`);
    }
    console.error('\nRemove .only before committing');
    process.exit(1);
  }
  
  console.log('✅ No .only found in test files');
}

checkForOnly().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
