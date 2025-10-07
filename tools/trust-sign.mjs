#!/usr/bin/env node
/**
 * Sign engine pack with Ed25519
 * Usage: node tools/trust-sign.mjs [--out <signatures.json>]
 */

import { createHash, sign } from 'crypto';
import { readFileSync, writeFileSync, readdirSync } from 'fs';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const signaturesPath = outIdx >= 0 ? args[outIdx + 1] : 'out/signatures.json';

// Find most recent pack
const packs = readdirSync('out').filter(f => /^engine_pack_.*\.zip$/.test(f)).sort().reverse();
if (packs.length === 0) {
  console.log('GATES: FAIL — no engine pack found');
  process.exit(1);
}
const packName = packs[0];
const packPath = `out/${packName}`;

// Read keys
const privateKeyPath = 'out/keys/private.pem';
const publicKeyPath = 'out/keys/public.pem';
const keyManifestPath = 'out/keys/manifest.json';

try {
  const privateKeyPem = readFileSync(privateKeyPath, 'utf8');
  const publicKeyPem = readFileSync(publicKeyPath, 'utf8');
  const keyManifest = JSON.parse(readFileSync(keyManifestPath, 'utf8'));

  // Compute key fingerprint if not in manifest
  const keyFpr = keyManifest.key_fpr || keyManifest.key_id ||
    createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 16);

  // Read and hash pack
  const packBytes = readFileSync(packPath);
  const packHash = createHash('sha256').update(packBytes).digest('hex');

  // Sign pack bytes with real Ed25519
  const signatureBuffer = sign(null, packBytes, privateKeyPem);
  const signatureB64 = signatureBuffer.toString('base64');

  const signatures = {
    schema: 'signatures.v1',
    algorithm: 'Ed25519',
    key_fpr: keyFpr,
    timestamp: new Date().toISOString(),
    pack: {
      filename: packName,
      sha256: packHash,
      signature_b64: signatureB64
    },
    public_key_pem: publicKeyPem
  };

  writeFileSync(signaturesPath, JSON.stringify(signatures, null, 2));
  console.log(`GATES: PASS — pack-sign signatures generated (fpr=${keyFpr})`);
} catch (err) {
  console.log(`GATES: FAIL — pack-sign error: ${err.message}`);
  process.exit(1);
}
