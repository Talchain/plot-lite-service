#!/usr/bin/env node
/**
 * Ban Math.random() and Date.now() in src/trust/** and src/util/** files
 * Ensures determinism in trust signal generation and hashing paths
 */

import { promises as fs } from 'fs';
import { resolve, join } from 'path';

const TRUST_DIR = resolve(process.cwd(), 'src/trust');
const UTIL_DIR = resolve(process.cwd(), 'src/util');

async function* walkFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath);
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
      yield fullPath;
    }
  }
}

async function checkFile(filePath) {
  const content = await fs.readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isComment = /^\s*\/\//.test(line) || /^\s*\*/.test(line);
    
    // Match Math.random() but not in comments
    if (/Math\.random\(\)/.test(line) && !isComment) {
      violations.push({
        file: filePath,
        line: i + 1,
        content: line.trim(),
        type: 'Math.random()',
      });
    }
    
    // Match Date.now() but not in comments
    if (/Date\.now\(\)/.test(line) && !isComment) {
      violations.push({
        file: filePath,
        line: i + 1,
        content: line.trim(),
        type: 'Date.now()',
      });
    }
  }

  return violations;
}

async function main() {
  console.log('🔍 Scanning src/trust/** and src/util/** for Math.random() and Date.now() ...\n');

  const dirs = [
    { path: TRUST_DIR, label: 'src/trust/**' },
    { path: UTIL_DIR, label: 'src/util/**' }
  ];

  const allViolations = [];

  for (const { path, label } of dirs) {
    try {
      await fs.access(path);
    } catch {
      console.log(`⚠️  Skipping ${label} (directory not found)`);
      continue;
    }

    for await (const file of walkFiles(path)) {
      const violations = await checkFile(file);
      allViolations.push(...violations);
    }
  }

  if (allViolations.length > 0) {
    console.error('❌ FAIL: Non-deterministic code detected in trust/util paths\n');
    console.error('Trust signals and hashing paths must be deterministic. Found violations:\n');
    
    for (const v of allViolations) {
      console.error(`  ${v.file}:${v.line}`);
      console.error(`    ${v.type}: ${v.content}\n`);
    }

    console.error('Fix: Replace with deterministic alternatives:');
    console.error('  - Math.random() → Use seed-based PRNG');
    console.error('  - Date.now() → Use stable timestamps or remove timing');
    console.error('  - Use stable topology rules');
    console.error('  - Use deterministic heuristics\n');

    process.exit(1);
  }

  console.log('✅ PASS: No Math.random() or Date.now() found in src/trust/** or src/util/**\n');
  process.exit(0);
}

main();
