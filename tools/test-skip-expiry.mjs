#!/usr/bin/env node
/**
 * P1D-1: Fail CI if any it.skip lacks issue link or has expired
 * Prevents stale skipped tests from accumulating
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

async function checkSkipExpiry() {
  const violations = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  for await (const file of walkDir('tests')) {
    const content = await readFile(file, 'utf8');
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Match it.skip, describe.skip, test.skip
      if (/\b(it|describe|test)\.skip\(/.test(line)) {
        // Check for issue link or expires date in surrounding lines
        const context = lines.slice(Math.max(0, i - 2), i + 3).join('\n');
        
        const hasIssue = /https:\/\/github\.com\/[^\/]+\/[^\/]+\/issues\/\d+/.test(context);
        const expiresMatch = context.match(/expires:\s*(\d{4}-\d{2}-\d{2})/);
        
        if (!hasIssue && !expiresMatch) {
          violations.push({
            file,
            line: i + 1,
            text: line.trim(),
            reason: 'Missing issue link or expires date'
          });
        } else if (expiresMatch) {
          const expiryDate = new Date(expiresMatch[1]);
          expiryDate.setHours(0, 0, 0, 0);
          
          if (expiryDate < today) {
            violations.push({
              file,
              line: i + 1,
              text: line.trim(),
              reason: `Expired: ${expiresMatch[1]}`
            });
          }
        }
      }
    }
  }
  
  if (violations.length > 0) {
    console.error('❌ Skipped tests with issues:');
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}`);
      console.error(`    ${v.text}`);
      console.error(`    ${v.reason}`);
    }
    console.error('\nFix or remove expired/undocumented skips');
    process.exit(1);
  }
  
  console.log('✅ All skipped tests have valid issue links or future expiry dates');
}

checkSkipExpiry().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
