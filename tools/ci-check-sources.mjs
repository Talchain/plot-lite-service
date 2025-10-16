#!/usr/bin/env node
/**
 * CI Guard: Ensure no dist/*.js exists without corresponding src/*.ts
 */
import { readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';

function findJsFiles(dir, base = dir) {
  const results = [];
  const entries = readdirSync(dir);
  
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    
    if (stat.isDirectory()) {
      results.push(...findJsFiles(fullPath, base));
    } else if (entry.endsWith('.js')) {
      results.push(relative(base, fullPath));
    }
  }
  
  return results;
}

const distDir = join(process.cwd(), 'dist');
if (!existsSync(distDir)) {
  console.log('✅ No dist/ directory - skipping source check');
  process.exit(0);
}

const jsFiles = findJsFiles(distDir);
const orphans = [];

for (const jsFile of jsFiles) {
  const tsFile = jsFile.replace(/\.js$/, '.ts');
  const tsPath = join(process.cwd(), 'src', tsFile);
  
  if (!existsSync(tsPath)) {
    orphans.push(jsFile);
  }
}

if (orphans.length > 0) {
  console.error('❌ Found compiled files without source:');
  for (const orphan of orphans) {
    console.error(`   dist/${orphan} → src/${orphan.replace(/\.js$/, '.ts')} (MISSING)`);
  }
  console.error('\nAll compiled files must have corresponding TypeScript sources.');
  process.exit(1);
}

console.log(`✅ Source check passed: ${jsFiles.length} compiled files have sources`);
process.exit(0);
