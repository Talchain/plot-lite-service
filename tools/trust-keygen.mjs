#!/usr/bin/env node
/**
 * Generate Ed25519 keypair for pack signing
 * Usage: node tools/trust-keygen.mjs [--out <keys-dir>]
 */

import { generateKeyPairSync, createHash } from 'crypto';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const keysDir = outIdx >= 0 ? args[outIdx + 1] : 'out/keys';

// Check if keys already exist
if (existsSync(`${keysDir}/private.pem`)) {
  console.log(`GATES: PASS — keys already exist at ${keysDir}`);
  process.exit(0);
}

// Create directory
mkdirSync(keysDir, { recursive: true });

// Generate real Ed25519 keypair
const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

// Compute key fingerprint (sha256 of public key)
const keyFpr = createHash('sha256').update(publicKey).digest('hex').slice(0, 16);

// Write keys
writeFileSync(`${keysDir}/private.pem`, privateKey, 'utf8');
writeFileSync(`${keysDir}/public.pem`, publicKey, 'utf8');
writeFileSync(`${keysDir}/manifest.json`, JSON.stringify({
  schema: 'key-manifest.v1',
  algorithm: 'Ed25519',
  key_id: keyFpr,
  key_fpr: keyFpr,
  created: new Date().toISOString()
}, null, 2));

console.log(`GATES: PASS — keygen Ed25519 keypair generated (fpr=${keyFpr})`);
