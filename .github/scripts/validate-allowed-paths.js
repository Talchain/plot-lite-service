/*
  Validates that a given patch file only touches allowed paths.
  Usage: node .github/scripts/validate-allowed-paths.js warp.patch
*/
const fs = require('fs');
const path = require('path');

const allowed = [
  'test/',
  'tools/',
  '.github/',
  'docs/',
  'openapi/',
  'fixtures/'
];

function main() {
  const patchPath = process.argv[2];
  if (!patchPath) {
    console.log('No patch provided; allowing by default.');
    process.exit(0);
  }
  const abs = path.resolve(process.cwd(), patchPath);
  if (!fs.existsSync(abs)) {
    console.log('Patch file not found; allowing by default.');
    process.exit(0);
  }
  const txt = fs.readFileSync(abs, 'utf8');
  const files = new Set();
  for (const line of txt.split(/\r?\n/)) {
    if (line.startsWith('+++ b/')) files.add(line.slice(6));
    if (line.startsWith('--- a/')) files.add(line.slice(6));
  }
  const disallowed = [];
  for (const f of files) {
    if (f === '/dev/null') continue;
    if (!allowed.some((p) => f.startsWith(p))) disallowed.push(f);
    if (f.startsWith('src/')) disallowed.push(f);
  }
  if (disallowed.length) {
    console.error('Disallowed paths in patch:', JSON.stringify(disallowed, null, 2));
    process.exit(1);
  }
  console.log('Allowed paths only.');
}

main();
