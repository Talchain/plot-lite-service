#!/usr/bin/env node
/**
 * Validate OpenAPI structure - ensure paths are in paths: section, not components:
 */
import yaml from 'yaml';
import fs from 'fs';

const content = fs.readFileSync('contracts/openapi.yaml', 'utf-8');
const lines = content.split('\n');

// Find components: line
const componentsLineIndex = lines.findIndex(line => line.trim() === 'components:');
if (componentsLineIndex === -1) {
  console.error('❌ FAIL: No components: section found');
  process.exit(1);
}

console.log(`✅ components: found at line ${componentsLineIndex + 1}`);

// Check for paths after components:
const pathsAfterComponents = [];
for (let i = componentsLineIndex + 1; i < lines.length; i++) {
  const line = lines[i];
  if (/^  \/v1\//.test(line)) {
    pathsAfterComponents.push({ line: i + 1, path: line.trim() });
  }
}

if (pathsAfterComponents.length > 0) {
  console.error('❌ FAIL: Found paths after components: section');
  pathsAfterComponents.forEach(p => {
    console.error(`  Line ${p.line}: ${p.path}`);
  });
  console.error('');
  console.error('All paths must be before the components: section.');
  console.error('Run: node tools/fix-openapi-structure.mjs');
  process.exit(1);
}

console.log('✅ No paths found after components: section');

// Parse and validate
const doc = yaml.parse(content);

if (!doc.paths) {
  console.error('❌ FAIL: No paths section found');
  process.exit(1);
}

const pathCount = Object.keys(doc.paths).length;
console.log(`✅ Found ${pathCount} paths in paths: section`);

// Check for path-like keys in components
if (doc.components) {
  const componentKeys = Object.keys(doc.components);
  const pathLikeKeys = componentKeys.filter(k => k.startsWith('/'));
  
  if (pathLikeKeys.length > 0) {
    console.error('❌ FAIL: Found path-like keys in components: section');
    pathLikeKeys.forEach(k => console.error(`  ${k}`));
    process.exit(1);
  }
  
  console.log('✅ No path-like keys in components: section');
}

console.log('');
console.log('✅ OpenAPI structure validation PASSED');
