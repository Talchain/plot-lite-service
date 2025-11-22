#!/usr/bin/env node
/**
 * Fix OpenAPI structure: Move misplaced paths from components section back to paths section
 */
import { readFileSync, writeFileSync } from 'fs';

const file = 'contracts/openapi.yaml';
const content = readFileSync(file, 'utf-8');
const lines = content.split('\n');

// Find the components: line
const componentsLineIndex = lines.findIndex(line => line.trim() === 'components:');
console.log(`Found components: at line ${componentsLineIndex + 1}`);

// Find all path definitions that start with "  /v1/" after components:
const misplacedPaths = [];
let currentPath = null;
let pathStartIndex = null;

for (let i = componentsLineIndex + 1; i < lines.length; i++) {
  const line = lines[i];
  
  // Check if this is a path definition (starts with "  /v1/")
  if (/^  \/v1\//.test(line)) {
    // Save previous path if exists
    if (currentPath !== null) {
      misplacedPaths.push({
        startIndex: pathStartIndex,
        endIndex: i - 1,
        lines: lines.slice(pathStartIndex, i)
      });
    }
    
    // Start new path
    currentPath = line;
    pathStartIndex = i;
  }
}

// Save last path
if (currentPath !== null && pathStartIndex !== null) {
  misplacedPaths.push({
    startIndex: pathStartIndex,
    endIndex: lines.length - 1,
    lines: lines.slice(pathStartIndex)
  });
}

console.log(`Found ${misplacedPaths.length} misplaced paths`);
misplacedPaths.forEach((p, i) => {
  const pathName = p.lines[0].trim().split(':')[0];
  console.log(`  ${i + 1}. ${pathName} (lines ${p.startIndex + 1}-${p.endIndex + 1})`);
});

// Reconstruct file:
// 1. Everything before components:
// 2. Misplaced paths (inserted here)
// 3. components: line
// 4. Everything after components: (excluding misplaced paths)

const beforeComponents = lines.slice(0, componentsLineIndex);
const componentsLine = lines[componentsLineIndex];

// Get components content (skip misplaced paths)
const afterComponentsStart = componentsLineIndex + 1;
const firstMisplacedIndex = misplacedPaths[0]?.startIndex || lines.length;
const componentsContent = lines.slice(afterComponentsStart, firstMisplacedIndex);

// Reconstruct
const newLines = [
  ...beforeComponents,
  ...misplacedPaths.flatMap(p => p.lines),
  '',  // Blank line before components
  componentsLine,
  ...componentsContent
];

// Write back
const newContent = newLines.join('\n');
writeFileSync(file, newContent, 'utf-8');

console.log(`\n✅ Fixed! Moved ${misplacedPaths.length} paths to correct location`);
console.log(`   New file has ${newLines.length} lines (was ${lines.length})`);
