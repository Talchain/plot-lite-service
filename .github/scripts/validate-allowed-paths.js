// Validate that a unified diff only touches allowed folders.
// Usage: node .github/scripts/validate-allowed-paths.js warp.patch
// Allowed: docs/, .github/, tools/, openapi/, fixtures/, test/
// Blocked: src/** (must go to a branch)

const fs = require('fs');

const allowed = ['docs/', '.github/', 'tools/', 'openapi/', 'fixtures/', 'test/'];
const blockedPrefix = 'src/';

function isAllowed(p) {
  if (!p || p === '/dev/null') return true;
  if (p.startsWith(blockedPrefix)) return false;
  return allowed.some(prefix => p.startsWith(prefix));
}

function parseChangedFiles(text) {
  // lines like: diff --git a/FILE b/FILE
  const files = new Set();
  const re = /^diff --git a\/(.+?) b\/(.+)$/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const b = m[2];
    if (b && b !== '/dev/null') files.add(b);
  }
  return [...files];
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: validate-allowed-paths.js <patch>');
  process.exit(2);
}

const patch = fs.readFileSync(file, 'utf8');
const changed = parseChangedFiles(patch);
if (changed.length === 0) {
  console.log('No changed files detected in patch');
  process.exit(0);
}

const bad = changed.filter(f => !isAllowed(f));
if (bad.length) {
  console.error('Blocked paths detected:\n' + bad.map(x => ' - ' + x).join('\n'));
  console.error('Only allowed folders are: ' + allowed.join(', '));
  process.exit(1);
}

console.log('Allowed paths OK:\n' + changed.map(x => ' - ' + x).join('\n'));
process.exit(0);
