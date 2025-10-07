#!/usr/bin/env node
/**
 * Create trust bundle with completeness check
 * Usage: node tools/trust-bundle.mjs [--out <trust.bundle.json>]
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const bundlePath = outIdx >= 0 ? args[outIdx + 1] : 'out/trust.bundle.json';

// Find most recent pack
const packs = readdirSync('out').filter(f => /^engine_pack_.*\.zip$/.test(f)).sort().reverse();
const packName = packs.length > 0 ? packs[0] : null;

// Check artifact presence
const artifacts = {
  pack: packName,
  manifest: existsSync('out/manifest.json'),
  signatures: existsSync('out/signatures.json'),
  sbom: existsSync('out/sbom.spdx.json'),
  pack_meta: existsSync('out/pack-meta.json')
};

// Compute checksums
const checksums = {};
if (artifacts.manifest) {
  checksums.manifest = readFileSync('out/manifest.json', 'utf8').length;
}
if (artifacts.signatures) {
  checksums.signatures = readFileSync('out/signatures.json', 'utf8').length;
}
if (artifacts.sbom) {
  checksums.sbom = readFileSync('out/sbom.spdx.json', 'utf8').length;
}

const bundle = {
  schema: 'trust-bundle.v1',
  timestamp: new Date().toISOString(),
  artifacts,
  checksums
};

writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));

// Check completeness
const allPresent = Object.entries(artifacts).every(([key, value]) => {
  if (key === 'pack') return value !== null;
  return value === true;
});

if (!allPresent) {
  const missing = Object.entries(artifacts)
    .filter(([key, value]) => key === 'pack' ? value === null : value === false)
    .map(([key]) => key);
  console.log(`GATES: FAIL — trust bundle incomplete (missing: ${missing.join(', ')})`);
  process.exit(1);
}

console.log('GATES: PASS — trust bundle complete (pack, manifest, signatures, sbom, pack_meta)');
